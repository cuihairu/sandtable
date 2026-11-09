//! 寻优与代理命令域(桌面壳):扫描优化 + 随机森林训练 / 预测。

use crate::sim::check_sweep_budget;

/// 进化寻优(桌面命令):内核单次调用跑完整体 种群 × 代 寻优,与 CLI
/// `optimize` 同源,返回 spec / evaluated / total_sims / best / best_fitness /
/// history / all / front0(CLI opt.json 同构)。桌面 native 无 Web 预算门
/// (更大寻优本就是桌面定位),但按 [`crate::sim::MAX_DESKTOP_SIM_WORK`] 收紧
/// 驻留内存 / 总工作量;浏览器路径的预算红线在 wasm `optimize_native` 单点拦截。
#[tauri::command]
pub(crate) fn optimize(yaml: String) -> Result<serde_json::Value, String> {
    let (cfg, spec) =
        sandtable_core::scenario::load_optimize_str(&yaml).map_err(|e| format!("配置错误: {e}"))?;
    spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    let count = spec.population as usize * (spec.generations as usize + 1);
    check_sweep_budget(count, spec.replicates, cfg.players, cfg.days)?;
    let result =
        sandtable_core::optimize::optimize(&cfg, &spec).map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(result).map_err(|e| format!("配置错误: {e}"))
}

/// 代理训练(桌面命令):已跑候选结果 → 随机森林;训练账(入训/排除,
/// 内核过滤口径)与特征重要性由内核算出,模型全量 JSON 原样回传预测用。
/// 与 wasm surrogate_train 同构(零额外仿真;代理只读 sweep 产物,不进仿真路径)。
#[tauri::command]
pub(crate) fn surrogate_train(
    results_json: String,
    metric: String,
    trees: u32,
    max_depth: u32,
    min_samples_leaf: u32,
    seed: u64,
) -> Result<serde_json::Value, String> {
    let results: Vec<sandtable_core::sweep::CandidateResult> = serde_json::from_str(&results_json)
        .map_err(|e| format!("参数错误: 候选结果解析失败: {e}"))?;
    let key = sandtable_core::experiment::MetricKey::parse(&metric)
        .ok_or_else(|| format!("参数错误: 未知指标 {metric}"))?;
    let spec = sandtable_core::surrogate::SurrogateSpec {
        trees,
        max_depth,
        min_samples_leaf: min_samples_leaf as usize,
        seed,
    };
    spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    let trained = sandtable_core::surrogate::RandomForest::trained_row_count(&results, key)
        .map_err(|e| format!("配置错误: {e}"))?;
    let model = sandtable_core::surrogate::RandomForest::fit(&results, key, spec)
        .map_err(|e| format!("配置错误: {e}"))?;
    let model_value = serde_json::to_value(&model).map_err(|e| format!("配置错误: {e}"))?;
    Ok(serde_json::json!({
        "metric": model.metric,
        "features": model.features,
        "importance": model.importance,
        "spec": model.spec,
        "trained": trained,
        "excluded": results.len() - trained,
        "model": model_value,
    }))
}

/// 代理预测(桌面命令):模型 + 参数点 → 森林均值 + 树间分歧包络。
/// 树间分歧是描述性散布(全部树各自预测的 min/max),不是统计置信区间
/// (字段名不带 ci/confidence/interval),前端不得画成置信带。
#[tauri::command]
pub(crate) fn surrogate_predict(
    model_json: String,
    params_json: String,
) -> Result<serde_json::Value, String> {
    let model: sandtable_core::surrogate::RandomForest = serde_json::from_str(&model_json)
        .map_err(|e| format!("参数错误: 代理模型解析失败: {e}"))?;
    // model.json 是外部输入面:回读先校验(特征下标越界会在预测时 panic)
    model.validate().map_err(|e| format!("参数错误: {e}"))?;
    let params: std::collections::BTreeMap<String, f64> =
        serde_json::from_str(&params_json).map_err(|e| format!("参数错误: 参数点解析失败: {e}"))?;
    let envelope = model
        .predict_envelope(&params)
        .map_err(|e| format!("参数错误: {e}"))?;
    Ok(serde_json::json!({
        "metric": model.metric,
        "mean": envelope.mean,
        "spread_min": envelope.spread_min,
        "spread_max": envelope.spread_max,
        "trees": envelope.trees,
    }))
}
