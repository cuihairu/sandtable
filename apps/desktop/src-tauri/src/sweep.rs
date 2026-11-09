//! 扫描命令域(桌面壳):计划 / 单候选 / 推荐(复用扫描数据)。

use crate::sim::check_sweep_budget;

/// 扫描计划:实验 YAML → `{config_hash, players, days, base_seed, replicates,
/// mode, axes, candidates, targets, sims}`(无 Web 预算门,桌面按
/// [`crate::sim::MAX_DESKTOP_SIM_WORK`] 收紧;候选上限在 SweepSpec::validate
/// 内);与 wasm sweep_plan 同构。ST-AUD-19 / I-019:预算账在 `plan()` **之前**
/// 先算(candidate_count 纯计数不物化)。
#[tauri::command]
pub(crate) fn sweep_plan(
    yaml: String,
    replicates_override: u32,
) -> Result<serde_json::Value, String> {
    let (cfg, mut spec) = sandtable_core::scenario::load_experiment_str(&yaml)
        .map_err(|e| format!("配置错误: {e}"))?;
    if replicates_override > 0 {
        spec.replicates = replicates_override;
        spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    }
    let count = spec
        .candidate_count()
        .map_err(|e| format!("配置错误: {e}"))?;
    check_sweep_budget(count, spec.replicates, cfg.players, cfg.days)?;
    let candidates = spec
        .plan(cfg.base_seed)
        .map_err(|e| format!("配置错误: {e}"))?;
    let sims = sandtable_core::sweep::sim_work(count, spec.replicates, 1, 1);
    Ok(serde_json::json!({
        "config_hash": sandtable_core::config::config_hash(&cfg),
        "players": cfg.players,
        "days": cfg.days,
        "base_seed": cfg.base_seed,
        "replicates": spec.replicates,
        "mode": spec.mode,
        "axes": spec.parameters,
        "candidates": candidates,
        "targets": spec.targets,
        "sims": sims,
    }))
}

/// 单候选运行:`run_candidate` 转发(应用参数 → validate → R replicate →
/// 汇总 → 约束判定);与 wasm sweep_candidate 同构。
pub(crate) fn sweep_candidate_impl(
    yaml: &str,
    replicates: u32,
    values_json: &str,
) -> Result<serde_json::Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    let (cfg, mut spec) = sandtable_core::scenario::load_experiment_str(yaml)
        .map_err(|e| format!("配置错误: {e}"))?;
    spec.replicates = replicates;
    spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    // 单候选同样吃驻留内存门(R × days)与单份工作量门(R × players × days)
    check_sweep_budget(1, replicates, cfg.players, cfg.days)?;
    let values: std::collections::BTreeMap<String, f64> = serde_json::from_str(values_json)
        .map_err(|e| format!("参数错误: 候选参数解析失败: {e}"))?;
    serde_json::to_value(sandtable_core::sweep::run_candidate(&cfg, &spec, &values))
        .map_err(|e| format!("候选结果序列化失败: {e}"))
}

/// 单候选运行(异步):replicate 循环在 core `run_candidate` 内部,进度与
/// 取消不在本命令粒度——扫描的候选级进度/中止由前端在候选循环边界处理,
/// 候选内 replicate 级控制需内核暴露观测面,刻意不做(与内核解耦)。
/// 异步化只为长候选不占主线程。
#[tauri::command]
pub(crate) async fn sweep_candidate(
    yaml: String,
    replicates: u32,
    values_json: String,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        sweep_candidate_impl(&yaml, replicates, &values_json)
    })
    .await
    .unwrap_or_else(|e| Err(format!("候选任务被中断: {e}")))
}

/// 推荐:敏感性矩阵(OAT)+ 单轴推荐区间,零额外仿真;MVP 红线:仅单参数轴
/// (与 CLI recommend / wasm sweep_recommend 同源拒绝)。
#[tauri::command]
pub(crate) fn sweep_recommend(
    yaml: String,
    results_json: String,
) -> Result<serde_json::Value, String> {
    let (cfg, spec) = sandtable_core::scenario::load_experiment_str(&yaml)
        .map_err(|e| format!("配置错误: {e}"))?;
    if spec.parameters.len() != 1 {
        return Err(format!(
            "推荐目前只支持单参数轴,sweep 定义了 {} 个参数(多参数联合可行域属后续阶段)",
            spec.parameters.len()
        ));
    }
    let results: Vec<sandtable_core::sweep::CandidateResult> = serde_json::from_str(&results_json)
        .map_err(|e| format!("参数错误: 候选结果解析失败: {e}"))?;
    let elasticities = sandtable_core::sensitivity::oat_elasticity(
        &spec,
        &cfg,
        &results,
        sandtable_core::sensitivity::DEFAULT_DELTA,
    );
    let recommendation = sandtable_core::recommend::recommend_axis(&spec, &cfg, &results, 0);
    Ok(serde_json::json!({ "elasticities": elasticities, "recommendation": recommendation }))
}
