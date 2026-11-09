//! 扫描域(web 绑定):预算上限 + 计划 / 单候选 / 推荐(native/wasm 入口成对)。

use wasm_bindgen::prelude::*;

// 显式 use 优先于 prelude 的 glob(wasm-bindgen 会导出 core 别名,须显式声明遮蔽回核心 crate)
use sandtable_core as core;
use serde_json::json;

use crate::run::MAX_REPLICATES;

// —— 参数扫描(文档 12/14/15 章)——
//
// Web 端单线程,候选间并行(rayon)不可用:由 JS 逐候选调 [`sweep_candidate`],
// 候选之间让出主线程,进度可渲染;绑定层无状态纯转发,plan / candidate /
// recommend 与 CLI sweep / recommend 同源(core 纯函数)。

/// Web 扫描预算:候选数 × replicates ≤ 200 次仿真(粗筛可调小 replicates,
/// 更大实验走 CLI / 桌面)。
pub const MAX_SWEEP_SIMS: u64 = 200;

/// 单次仿真的规模上限:players × days ≤ 40 万(Web 定位小中型,文档 09 章)。
pub const MAX_SWEEP_SIM_SCALE: u64 = 400_000;

/// 扫描计划(native 纯函数):实验 YAML → 配置 + 扫描定义 → 网格候选。
/// `replicates_override` > 0 时覆盖 sweep.replicates(粗筛语义,同 CLI
/// `sweep --replicates`)。返回 `{config_hash, players, days, base_seed,
/// replicates, mode, axes, candidates, targets, sims}`;超出 Web 预算时 Err。
pub fn sweep_plan_native(
    yaml: &str,
    replicates_override: u32,
) -> Result<serde_json::Value, String> {
    let (cfg, mut spec) =
        core::scenario::load_experiment_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    if replicates_override > 0 {
        spec.replicates = replicates_override;
        spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    }
    // ST-AUD-19 / I-019:预算账在 `plan()` **之前**先算(候选计数纯计算不物化,
    // 与 CLI/MCP 同一 [`core::sweep::candidate_count`] 口径),不「先展开候选再检查」。
    let count = spec
        .candidate_count()
        .map_err(|e| format!("配置错误: {e}"))?;
    let sims = core::sweep::sim_work(count, spec.replicates, 1, 1);
    if sims > MAX_SWEEP_SIMS {
        return Err(format!(
            "参数错误: 候选数 × replicates = {sims} 超出 Web 预算 {MAX_SWEEP_SIMS}(调小网格或 replicates 粗筛,更大实验走 CLI)"
        ));
    }
    let scale = core::sweep::sim_work(1, 1, cfg.players, cfg.days);
    if scale > MAX_SWEEP_SIM_SCALE {
        return Err(format!(
            "参数错误: players × days = {scale} 超出 Web 预算 {MAX_SWEEP_SIM_SCALE}(Web 定位小中型仿真,更大实验走 CLI)"
        ));
    }
    let candidates = spec
        .plan(cfg.base_seed)
        .map_err(|e| format!("配置错误: {e}"))?;
    Ok(json!({
        "config_hash": core::config::config_hash(&cfg),
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

/// 单候选运行(native 纯函数):[`core::sweep::run_candidate`] 转发
/// (应用参数 → validate → R 个 replicate → 汇总 → 约束判定)。
/// `replicates` 须与 [`sweep_plan_native`] 返回值一致(CI 的 n 才对得上)。
pub fn sweep_candidate_native(
    yaml: &str,
    replicates: u32,
    values_json: &str,
) -> Result<serde_json::Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    if replicates > MAX_REPLICATES {
        return Err(format!(
            "参数错误: Web 端 replicates 上限 {MAX_REPLICATES}(更大实验走 CLI / 桌面)"
        ));
    }
    let (cfg, mut spec) =
        core::scenario::load_experiment_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    spec.replicates = replicates;
    spec.validate().map_err(|e| format!("配置错误: {e}"))?;
    let values: std::collections::BTreeMap<String, f64> = serde_json::from_str(values_json)
        .map_err(|e| format!("参数错误: 候选参数解析失败: {e}"))?;
    serde_json::to_value(core::sweep::run_candidate(&cfg, &spec, &values))
        .map_err(|e| format!("候选结果序列化失败: {e}"))
}

/// 推荐(native 纯函数):敏感性矩阵(OAT 弹性,文档 14 章)+ 单轴推荐
/// 区间(文档 15 章)——只从已有候选结果计算,零额外仿真,与 CLI
/// `recommend` 同源。MVP 红线:仅单参数轴。
pub fn sweep_recommend_native(yaml: &str, results_json: &str) -> Result<serde_json::Value, String> {
    let (cfg, spec) =
        core::scenario::load_experiment_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    if spec.parameters.len() != 1 {
        return Err(format!(
            "推荐目前只支持单参数轴,sweep 定义了 {} 个参数(多参数联合可行域属后续阶段)",
            spec.parameters.len()
        ));
    }
    let results: Vec<core::sweep::CandidateResult> = serde_json::from_str(results_json)
        .map_err(|e| format!("参数错误: 候选结果解析失败: {e}"))?;
    let elasticities =
        core::sensitivity::oat_elasticity(&spec, &cfg, &results, core::sensitivity::DEFAULT_DELTA);
    let recommendation = core::recommend::recommend_axis(&spec, &cfg, &results, 0);
    Ok(json!({ "elasticities": elasticities, "recommendation": recommendation }))
}

/// 扫描计划(wasm 入口):JSON 字符串,形状同 [`sweep_plan_native`]。
#[wasm_bindgen]
pub fn sweep_plan(yaml: &str, replicates_override: u32) -> Result<JsValue, JsValue> {
    let v = sweep_plan_native(yaml, replicates_override).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 单候选运行(wasm 入口):JSON 字符串,形状同 [`sweep_candidate_native`]。
#[wasm_bindgen]
pub fn sweep_candidate(yaml: &str, replicates: u32, values_json: &str) -> Result<JsValue, JsValue> {
    let v =
        sweep_candidate_native(yaml, replicates, values_json).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 推荐(wasm 入口):JSON 字符串,形状同 [`sweep_recommend_native`]。
#[wasm_bindgen]
pub fn sweep_recommend(yaml: &str, results_json: &str) -> Result<JsValue, JsValue> {
    let v = sweep_recommend_native(yaml, results_json).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
