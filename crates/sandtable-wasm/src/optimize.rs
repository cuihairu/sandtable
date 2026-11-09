//! 寻优域(web 绑定):预算上限 + 进化寻优 + 随机森林代理(native/wasm 入口成对)。

use wasm_bindgen::prelude::*;

// 显式 use 优先于 prelude 的 glob(wasm-bindgen 会导出 core 别名,须显式声明遮蔽回核心 crate)
use sandtable_core as core;
use serde_json::json;

use crate::sweep::{MAX_SWEEP_SIMS, MAX_SWEEP_SIM_SCALE};

/// Web 寻优预算:种群 × (代数 + 1) × replicates ≤ 200 次仿真(与扫描同账)。
/// 寻优是内核单次调用、无候选级中断边界,超预算直接拒绝,不冻住浏览器。
pub const MAX_OPTIMIZE_SIMS: u64 = MAX_SWEEP_SIMS;

/// 进化寻优(native 纯函数):读 scenario + model + optimize 三节实验文件,
/// [`core::optimize::optimize`] 单次调用跑完整个 种群 × 代 寻优(与 CLI
/// `optimize` 同源),返回 spec / evaluated / total_sims / best / best_fitness /
/// history / all / front0(CLI opt.json 同构)。evolutionary = 字典序适应度,
/// pareto = 约束感知非支配排序;超出 Web 预算时 Err。
pub fn optimize_native(yaml: &str) -> Result<serde_json::Value, String> {
    let (cfg, spec) =
        core::scenario::load_optimize_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    let sims = spec.population as u64 * (spec.generations as u64 + 1) * spec.replicates as u64;
    if sims > MAX_OPTIMIZE_SIMS {
        return Err(format!(
            "参数错误: 种群 × (代数+1) × replicates = {sims} 超出 Web 预算 {MAX_OPTIMIZE_SIMS}(调小 population / generations / replicates,更大实验走 CLI)"
        ));
    }
    let scale = cfg.players as u64 * cfg.days as u64;
    if scale > MAX_SWEEP_SIM_SCALE {
        return Err(format!(
            "参数错误: players × days = {scale} 超出 Web 预算 {MAX_SWEEP_SIM_SCALE}(Web 定位小中型仿真,更大实验走 CLI)"
        ));
    }
    let result = core::optimize::optimize(&cfg, &spec).map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(result).map_err(|e| format!("配置错误: {e}"))
}

/// 进化寻优(wasm 入口):JSON 字符串,形状同 [`optimize_native`]。
#[wasm_bindgen]
pub fn optimize(yaml: &str) -> Result<JsValue, JsValue> {
    let v = optimize_native(yaml).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 代理训练(native 纯函数):已跑候选结果 → 随机森林(与 CLI `surrogate
/// train` 同源)。零额外仿真;代理只读 sweep 产物,不进仿真路径(文档 09 章
/// 红线)。返回训练账(trained / excluded,内核过滤口径)+ 特征重要性 +
/// 模型全量 JSON(`model` 原样,预测时回传)。
pub fn surrogate_train_native(
    results_json: &str,
    metric: &str,
    trees: u32,
    max_depth: u32,
    min_samples_leaf: u32,
    seed: u64,
) -> Result<serde_json::Value, String> {
    let results: Vec<core::sweep::CandidateResult> = serde_json::from_str(results_json)
        .map_err(|e| format!("参数错误: 候选结果解析失败: {e}"))?;
    let key = core::experiment::MetricKey::parse(metric)
        .ok_or_else(|| format!("参数错误: 未知指标 {metric}"))?;
    let spec = core::surrogate::SurrogateSpec {
        trees,
        max_depth,
        min_samples_leaf: min_samples_leaf as usize,
        seed,
    };
    spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    let trained = core::surrogate::RandomForest::trained_row_count(&results, key)
        .map_err(|e| format!("配置错误: {e}"))?;
    let model = core::surrogate::RandomForest::fit(&results, key, spec)
        .map_err(|e| format!("配置错误: {e}"))?;
    let model_value = serde_json::to_value(&model).map_err(|e| format!("配置错误: {e}"))?;
    Ok(json!({
        "metric": model.metric,
        "features": model.features,
        "importance": model.importance,
        "spec": model.spec,
        "trained": trained,
        "excluded": results.len() - trained,
        "model": model_value,
    }))
}

/// 代理训练(wasm 入口):JSON 字符串,形状同 [`surrogate_train_native`]。
#[wasm_bindgen]
pub fn surrogate_train(
    results_json: &str,
    metric: &str,
    trees: u32,
    max_depth: u32,
    min_samples_leaf: u32,
    seed: u64,
) -> Result<JsValue, JsValue> {
    let v = surrogate_train_native(
        results_json,
        metric,
        trees,
        max_depth,
        min_samples_leaf,
        seed,
    )
    .map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 代理预测(native 纯函数):模型 JSON + 参数点 → 森林均值 + 树间分歧
/// 包络(内核 [`core::surrogate::SurrogatePrediction`])。**树间分歧是描述性
/// 散布(全部树各自预测的 min/max),不是统计置信区间**——字段名不带
/// ci/confidence/interval,前端不得画成置信带;置信带只在内核逐日聚合输出上。
pub fn surrogate_predict_native(
    model_json: &str,
    params_json: &str,
) -> Result<serde_json::Value, String> {
    let model: core::surrogate::RandomForest =
        serde_json::from_str(model_json).map_err(|e| format!("参数错误: 代理模型解析失败: {e}"))?;
    // model.json 是外部输入面:回读先校验(特征下标越界会在预测时 panic)
    model.validate().map_err(|e| format!("参数错误: {e}"))?;
    let params: std::collections::BTreeMap<String, f64> =
        serde_json::from_str(params_json).map_err(|e| format!("参数错误: 参数点解析失败: {e}"))?;
    let envelope = model
        .predict_envelope(&params)
        .map_err(|e| format!("参数错误: {e}"))?;
    Ok(json!({
        "metric": model.metric,
        "mean": envelope.mean,
        "spread_min": envelope.spread_min,
        "spread_max": envelope.spread_max,
        "trees": envelope.trees,
    }))
}

/// 代理预测(wasm 入口):JSON 字符串,形状同 [`surrogate_predict_native`]。
#[wasm_bindgen]
pub fn surrogate_predict(model_json: &str, params_json: &str) -> Result<JsValue, JsValue> {
    let v = surrogate_predict_native(model_json, params_json).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
