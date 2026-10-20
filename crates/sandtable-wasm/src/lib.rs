//! WebAssembly 薄绑定(文档 08/18 章:Phase 6)。
//!
//! 纪律:**不放仿真逻辑**——只转发 sandtable-core(load → validate → run),
//! 输出与 CLI `simulate` 的 report.json 同构(`{meta, results}`,另附
//! `days_csv` 与 CLI 写盘产物逐字节一致,文档 09 章),统计等价
//! 由 CLI 侧等价测试锁死。meta 只带版本字段;`generated_at_unix`/`git_sha`
//! 是环境字段,由前端构建注入,不在绑定层伪造。
//!
//! Web 定位小中型仿真(文档 09 章:WASM 内存 4GB 上限、单线程),
//! replicates 上限 64,更大的实验引导走 CLI / 桌面。
//!
//! 参数扫描(文档 12/14/15 章)同为薄转发:sweep_plan / sweep_candidate /
//! sweep_recommend 与 CLI sweep / recommend 同源;单线程下候选并行不可用,
//! 由 JS 逐候选驱动、候选间让出主线程(见 sweep 段注释)。

use wasm_bindgen::prelude::*;

// 显式 use 优先于 prelude 的 glob(wasm-bindgen 会导出 core 别名,须显式声明遮蔽回核心 crate)
use sandtable_core as core;

use serde_json::json;

/// 单次 Web 实验的 replicates 上限(内存边界,见模块注释)。
pub const MAX_REPLICATES: u32 = 64;

fn load(yaml: &str) -> Result<core::config::SimConfig, String> {
    let cfg = core::scenario::load_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    Ok(cfg)
}

/// 校验配置(native 纯函数,wasm 包装见 [`validate_config`])。
///
/// 返回 `{config_hash, players, days, schema_version, model_version}`;
/// 配置非法时 Err,消息与 CLI 退出码 2 的 stderr 同源。
pub fn validate_config_native(yaml: &str) -> Result<serde_json::Value, String> {
    let cfg = load(yaml)?;
    Ok(json!({
        "config_hash": core::config::config_hash(&cfg),
        "players": cfg.players,
        "days": cfg.days,
        "schema_version": core::SCHEMA_VERSION,
        "model_version": core::MODEL_VERSION,
    }))
}

/// 运行仿真(native 纯函数):R 个 replicate 的 [`core::metrics::RunMetrics`]
/// 序列化数组,与 CLI `simulate` report.json 的 `results` 逐字段同构
/// (同 seed 同配置时逐值相等,含 day_stats / cohort_stats)。
///
/// 另附 `days_csv`:replicate 1 的按天 CSV([`core::export::day_csv`]),
/// 与 CLI `simulate --out` 写盘的 days.csv **逐字节一致**(文档 09 章契约,
/// `web_parity` 测试锁死)——浏览器导出的文件 CLI 可直接继续分析。
pub fn run_simulation_native(yaml: &str, replicates: u32) -> Result<serde_json::Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    if replicates > MAX_REPLICATES {
        return Err(format!(
            "参数错误: Web 端 replicates 上限 {MAX_REPLICATES}(更大实验走 CLI / 桌面)"
        ));
    }
    let cfg = load(yaml)?;
    let results: Vec<core::metrics::RunMetrics> =
        (0..replicates).map(|r| core::sim::run(&cfg, r)).collect();
    Ok(json!({
        "meta": {
            "schema_version": core::SCHEMA_VERSION,
            "model_version": core::MODEL_VERSION,
        },
        "config_hash": core::config::config_hash(&cfg),
        "days_csv": core::export::day_csv(&results[0]),
        "results": results,
    }))
}

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
    let candidates = spec
        .plan(cfg.base_seed)
        .map_err(|e| format!("配置错误: {e}"))?;
    let sims = candidates.len() as u64 * spec.replicates as u64;
    if sims > MAX_SWEEP_SIMS {
        return Err(format!(
            "参数错误: 候选数 × replicates = {sims} 超出 Web 预算 {MAX_SWEEP_SIMS}(调小网格或 replicates 粗筛,更大实验走 CLI)"
        ));
    }
    let scale = cfg.players as u64 * cfg.days as u64;
    if scale > MAX_SWEEP_SIM_SCALE {
        return Err(format!(
            "参数错误: players × days = {scale} 超出 Web 预算 {MAX_SWEEP_SIM_SCALE}(Web 定位小中型仿真,更大实验走 CLI)"
        ));
    }
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

/// 校验配置(wasm 入口):返回 JSON 字符串,前端 `JSON.parse`。
///
/// 不用 serde-wasm-bindgen 直出对象——其 JsValue 协议与 wasm-bindgen 新版
/// 存在静默不兼容(实测 to_value 产出空对象);字符串是 wasm ABI 最稳通道。
#[wasm_bindgen]
pub fn validate_config(yaml: &str) -> Result<JsValue, JsValue> {
    let v = validate_config_native(yaml).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 参数定义注册表(native 纯函数):静态全量 `core::registry::all()`,
/// 每项恰为 {path, kind, default, desc}(WB-03.04)。注册表不含配置读取,
/// 无入参、不会失败;desc 是注册表里的 zh 原文,译名在前端显示层。
pub fn param_registry_native() -> serde_json::Value {
    json!(core::registry::all().cloned().collect::<Vec<_>>())
}

/// 参数定义注册表(wasm 入口):JSON 字符串,形状同 [`param_registry_native`]。
#[wasm_bindgen]
pub fn param_registry() -> JsValue {
    JsValue::from_str(&param_registry_native().to_string())
}

/// 当前配置数值读取(native 纯函数):load+validate 后逐数值注册路径
/// `registry::read_numeric`,返回 `{path: 当前生效值}`(WB-03.05)。
///
/// - 数值槽 = u32/u64/i64/f64/mix;非数值槽(dur/expr/table)**缺键 ≠ 0**,
///   其有效形态就是配置文本本身(WB-03.07 回写契约);
/// - loot/gacha 未配置时返回的是内核真实生效缺省(read_numeric 的
///   unwrap_or),不是前端拿注册表 default 补值;
/// - u64 槽位(seed/pity_*)走无损通道(WB-03.08):≤ 2^53−1 返回 JSON
///   数字;超出 JS 安全整数的值以**十进制字符串**无损表达,
///   不经 f64 静默舍入(apply 侧对越界值明确拒绝,见 apply_numeric)。
pub fn param_values_native(yaml: &str) -> Result<serde_json::Value, String> {
    const MAX_SAFE: u64 = 9_007_199_254_740_991;
    let cfg = load(yaml)?;
    let mut out = serde_json::Map::new();
    for spec in core::registry::all() {
        if let Some(raw) = core::registry::read_u64_raw(&cfg, spec.path) {
            let v = if raw <= MAX_SAFE {
                json!(raw)
            } else {
                json!(raw.to_string())
            };
            out.insert(spec.path.to_string(), v);
            continue;
        }
        if let Ok(v) = core::registry::read_numeric(&cfg, spec.path) {
            out.insert(spec.path.to_string(), json!(v));
        }
    }
    Ok(serde_json::Value::Object(out))
}

/// 当前配置数值读取(wasm 入口):JSON 字符串,形状同 [`param_values_native`]。
#[wasm_bindgen]
pub fn param_values(yaml: &str) -> Result<JsValue, JsValue> {
    let v = param_values_native(yaml).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 数值参数应用(native 纯函数):按内核寻址 `registry::apply_numeric`
/// 应用单条数值编辑,应用后**重验**(显式性契约:如对未配置 loot 的配置
/// 应用 rate_mult 会经 get_or_insert 物化半配置 loot,on_victory 空必须
/// 在编辑期报错而不是等到运行),通过后返回应用后 config_hash 与回读值
/// (apply/read 镜像证明)(WB-03.06)。
///
/// 错误全部 `配置错误: ` 前缀(与 validate_config 同通道,前端
/// classifyWasmError 直接分类):未知路径带相近路径建议、非数值槽
/// (时长/公式/结构表)、非法类型与范围(u32/u64 为负等)。u64/seed 经
/// f64 通道,超过 JS 安全整数的精度边界归 WB-03.08。
pub fn param_apply_native(yaml: &str, path: &str, value: f64) -> Result<serde_json::Value, String> {
    let mut cfg = load(yaml)?;
    core::registry::apply_numeric(&mut cfg, path, value).map_err(|e| format!("配置错误: {e}"))?;
    core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    let back = core::registry::read_numeric(&cfg, path).map_err(|e| format!("配置错误: {e}"))?;
    Ok(json!({
        "config_hash": core::config::config_hash(&cfg),
        "path": path,
        "value": back,
    }))
}

/// 数值参数应用(wasm 入口):JSON 字符串,形状同 [`param_apply_native`]。
#[wasm_bindgen]
pub fn param_apply(yaml: &str, path: &str, value: f64) -> Result<JsValue, JsValue> {
    let v = param_apply_native(yaml, path, value).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// KPI 可用性入口(native 纯函数):对给定配置,内核 `MetricKey::ALL` 逐项
/// `unavailable_reason`(WB-03.09 可用性语义 = 内核口径:天数不足 /
/// gacha / loot 未配置)。返回 `[{metric, reason}]`,空数组 = 全部可用;
/// metric 是内核 ID(snake_case),reason 是内核原文(中文,进错误通道
/// 原样透传,不前端改写)。名称/显示名/格式在 TS metricMeta 面(显示层)。
pub fn kpi_availability_native(yaml: &str) -> Result<serde_json::Value, String> {
    let cfg = load(yaml)?;
    Ok(json!(core::experiment::MetricKey::ALL
        .iter()
        .filter_map(|k| {
            core::experiment::MetricKey::unavailable_reason(*k, &cfg)
                .map(|reason| json!({ "metric": k.name(), "reason": reason }))
        })
        .collect::<Vec<_>>()))
}

/// KPI 可用性(wasm 入口):JSON 字符串,形状同 [`kpi_availability_native`]。
#[wasm_bindgen]
pub fn kpi_availability(yaml: &str) -> Result<JsValue, JsValue> {
    let v = kpi_availability_native(yaml).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 运行仿真(wasm 入口):返回 JSON 字符串(形状同 [`run_simulation_native`])。
#[wasm_bindgen]
pub fn run_simulation(yaml: &str, replicates: u32) -> Result<JsValue, JsValue> {
    let v = run_simulation_native(yaml, replicates).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
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

/// A/B 统计比较(native 纯函数,WB-03.10):双臂 YAML + 双臂**已跑**结果
/// 数组(results JSON,与 run_simulation 输出的 `results` 字段同构)进内核。
/// CRN 成对前提(base_seed 一致 / replicate 等长非零)、指标可用性预检、
/// 逐 replicate extract(None 不 0 填)由 core::experiment::compare_arms
/// 显式判定,配对统计结论由内核直出,前端不另算(WB-03.11)。
///
/// 错误通道与既有桥一致(classifyWasmError 直接分类):
/// - 指标名不在 MetricKey 表、results JSON 解析失败 → `参数错误: `;
/// - YAML 非法、成对前提破坏、指标在某臂不可用 → `配置错误: `。
pub fn ab_compare_native(
    base_yaml: &str,
    cand_yaml: &str,
    metric: &str,
    results_a_json: &str,
    results_b_json: &str,
) -> Result<serde_json::Value, String> {
    let key = core::experiment::MetricKey::parse(metric).ok_or_else(|| {
        let all = core::experiment::MetricKey::ALL
            .iter()
            .map(|k| k.name())
            .collect::<Vec<_>>()
            .join(", ");
        format!("参数错误: 未知指标 {metric}(可选:{all})")
    })?;
    let cfg_a = load(base_yaml)?;
    let cfg_b = load(cand_yaml)?;
    let arm_a: Vec<core::metrics::RunMetrics> = serde_json::from_str(results_a_json)
        .map_err(|e| format!("参数错误: base 臂结果解析失败: {e}"))?;
    let arm_b: Vec<core::metrics::RunMetrics> = serde_json::from_str(results_b_json)
        .map_err(|e| format!("参数错误: cand 臂结果解析失败: {e}"))?;
    let comparison = core::experiment::compare_arms(&cfg_a, &cfg_b, key, &arm_a, &arm_b)
        .map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(&comparison).map_err(|e| format!("配置错误: {e}"))
}

/// A/B 统计比较(wasm 入口):JSON 字符串,形状同 [`ab_compare_native`]。
#[wasm_bindgen]
pub fn ab_compare(
    base_yaml: &str,
    cand_yaml: &str,
    metric: &str,
    results_a_json: &str,
    results_b_json: &str,
) -> Result<JsValue, JsValue> {
    let v = ab_compare_native(base_yaml, cand_yaml, metric, results_a_json, results_b_json)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
    );

    #[test]
    fn validate_valid_and_invalid() {
        let v = validate_config_native(YAML).unwrap();
        assert_eq!(v["players"], 40);
        assert_eq!(v["days"], 3);
        assert!(
            v["config_hash"].as_str().unwrap().len() == 64,
            "SHA-256 hex"
        );

        let err = validate_config_native(
            "schema_version: '1'\nscenario: {population: 40, duration: '3d'}\nmodel:\n  dungeon:\n    tiers: 0\n",
        )
        .unwrap_err();
        assert!(err.starts_with("配置错误"), "{err}");
    }

    #[test]
    fn param_registry_is_full_static_table() {
        let defs = param_registry_native();
        let n = defs.as_array().unwrap().len();
        assert_eq!(n, 64, "注册表全量 64 项");
        let first = &defs[0];
        assert_eq!(first["path"], "scenario.population");
        assert_eq!(first["kind"], "u32", "kind serde 小写串");
        assert_eq!(
            first.as_object().unwrap().len(),
            4,
            "恰四字段,可选元信息不出场"
        );
    }

    #[test]
    fn param_apply_uses_kernel_addressing_and_revalidates() {
        // 正常应用:回读值 = 应用的值,hash 是 64 位十六进制
        let ok = param_apply_native(YAML, "model.warrior.attack", 250.0).unwrap();
        assert_eq!(ok["value"].as_f64(), Some(250.0));
        assert_eq!(ok["path"], "model.warrior.attack");
        assert_eq!(ok["config_hash"].as_str().unwrap().len(), 64, "SHA-256 hex");
        // 同值重放不改 hash(应用是幂等写)
        let replay = param_apply_native(YAML, "model.warrior.attack", 100.0).unwrap();
        assert_ne!(
            replay["config_hash"], ok["config_hash"],
            "不同值必不同 hash"
        );
        // 未知路径:带相近路径建议,配置错误前缀
        let e = param_apply_native(YAML, "model.warrior.atk", 1.0).unwrap_err();
        assert!(e.starts_with("配置错误") && e.contains("未知参数"), "{e}");
        // 非数值槽:不可数值扫描
        let e2 = param_apply_native(YAML, "scenario.duration", 30.0).unwrap_err();
        assert!(e2.contains("该参数不是数值"), "{e2}");
        // 非法类型/范围:u32 为负
        let e3 = param_apply_native(YAML, "scenario.population", -1.0).unwrap_err();
        assert!(e3.contains("不能为负"), "{e3}");
        // 显式性契约:未配置 loot 时应用 rate_mult 物化半配置 loot,重验即在编辑期报错
        let e4 = param_apply_native(YAML, "model.loot.rate_mult", 2.0).unwrap_err();
        assert!(e4.contains("on_victory"), "{e4}");
    }

    #[test]
    fn ab_compare_pairs_kernel_run_arms() {
        let cand_yaml = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "model:\n  warrior: {attack: 250}\n",
        );
        let a = run_simulation_native(YAML, 6).unwrap();
        let b = run_simulation_native(cand_yaml, 6).unwrap();
        let out = ab_compare_native(
            YAML,
            cand_yaml,
            "win_rate",
            &a["results"].to_string(),
            &b["results"].to_string(),
        )
        .unwrap();
        assert_eq!(out["metric"], "win_rate");
        assert_eq!(out["arm_a"]["n"], 6);
        assert_eq!(out["arm_b"]["n"], 6);
        // 配对差均值 = B 均值 − A 均值(内核直出,前端不重算)
        let mean = |v: &serde_json::Value| -> f64 {
            v["results"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| m["win_rate"].as_f64().unwrap())
                .sum::<f64>()
                / 6.0
        };
        let expected = mean(&b) - mean(&a);
        assert!((out["diff_mean"].as_f64().unwrap() - expected).abs() < 1e-9);
        // verdict 是内核三值之一(序列化为枚举名)
        assert!(
            ["BHigher", "AHigher", "NoDifference"].contains(&out["verdict"].as_str().unwrap()),
            "{out}"
        );
    }

    #[test]
    fn ab_compare_rejects_bad_inputs_explicitly() {
        let cand_yaml = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 9}\n",
        );
        let a = run_simulation_native(YAML, 4).unwrap();
        let b = run_simulation_native(cand_yaml, 4).unwrap();
        let a_json = &a["results"].to_string();
        let b_json = &b["results"].to_string();
        // 未知指标 → 参数错误 + 可选清单
        let e = ab_compare_native(YAML, YAML, "winrate", a_json, a_json).unwrap_err();
        assert!(e.starts_with("参数错误") && e.contains("win_rate"), "{e}");
        // 种子错位 → CRN 成对前提破坏,配置错误
        let e = ab_compare_native(YAML, cand_yaml, "win_rate", a_json, b_json).unwrap_err();
        assert!(
            e.starts_with("配置错误") && e.contains("base_seed 不一致"),
            "{e}"
        );
        // results JSON 解析失败 → 参数错误
        let e = ab_compare_native(YAML, YAML, "win_rate", "[{\"win_rate\":", a_json).unwrap_err();
        assert!(
            e.starts_with("参数错误") && e.contains("base 臂结果解析失败"),
            "{e}"
        );
        // 指标在某臂不可用(3d 配置没有 retention_d7)→ 配置错误,不静默跳过
        let e = ab_compare_native(YAML, YAML, "retention_d7", a_json, a_json).unwrap_err();
        assert!(e.starts_with("配置错误") && e.contains("不可用"), "{e}");
        // replicate 不等长 → 配置错误
        let two = run_simulation_native(YAML, 2).unwrap();
        let e = ab_compare_native(YAML, YAML, "win_rate", a_json, &two["results"].to_string())
            .unwrap_err();
        assert!(e.contains("replicate 数不一致或为 0"), "{e}");
    }

    #[test]
    fn param_values_reads_effective_not_registry_default() {
        let yaml = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 99}\n",
            "model:\n  warrior: {attack: 250}\n",
        );
        let vals = param_values_native(yaml).unwrap();
        assert_eq!(
            vals["scenario.seed"].as_f64(),
            Some(99.0),
            "当前生效值,不是注册表 default"
        );
        assert_eq!(vals["model.warrior.attack"].as_f64(), Some(250.0));
        // 未配置 loot → 内核真实生效缺省 1.0(read_numeric unwrap_or)
        assert_eq!(vals["model.loot.rate_mult"].as_f64(), Some(1.0));
        // 非数值槽缺键 ≠ 0
        assert!(vals.get("scenario.duration").is_none());
        assert!(vals.get("model.loot.tables").is_none());
        assert!(vals.get("model.formulas.xp_needed").is_none());
        // 数值注册路径全覆盖:64 − 7 非数值 = 57
        assert_eq!(vals.as_object().unwrap().len(), 57);
        // 非法配置报配置错误(与 validate_config 同前缀)
        let err =
            param_values_native("schema_version: '1'\nscenario: {population: -5}\n").unwrap_err();
        assert!(err.starts_with("配置错误"), "{err}");
    }

    #[test]
    fn u64_beyond_safe_integer_is_lossless_or_rejected() {
        // 读:超出 2^53−1 的 seed 以十进制字符串无损表达,不经 f64 舍入
        let big = 9_007_199_254_740_993u64; // 2^53 + 1
        let yaml = format!(
            "schema_version: '1'\nscenario: {{population: 40, duration: '3d', seed: {big}}}\n"
        );
        let vals = param_values_native(&yaml).unwrap();
        assert_eq!(
            vals["scenario.seed"],
            json!(big.to_string()),
            "越界 u64 读 = 字符串无损表达"
        );
        // 读:安全范围内的 seed 仍是数字
        let small = param_values_native(YAML).unwrap();
        assert_eq!(small["scenario.seed"], json!(7), "范围内 u64 读 = 数字");
        // 写:越界值明确拒绝,不静默舍入
        let e = param_apply_native(YAML, "scenario.seed", big as f64).unwrap_err();
        assert!(e.contains("2^53−1") && e.contains("不静默舍入"), "{e}");
        // 写:pity_hard 同门(未配置 gacha 时 get_or_insert 后仍要先过安全整数门)
        let e2 =
            param_apply_native(YAML, "model.gacha.pity_hard", 9_100_000_000_000_000.0).unwrap_err();
        assert!(e2.contains("2^53−1"), "{e2}");
    }

    #[test]
    fn kpi_availability_comes_from_kernel_rules() {
        // 3 天 + 无 gacha/loot:d3(需 ≥3 之内可用?days=3 满足 d3)——
        // d7 与 gacha、loot 三项不可用,reason 是内核原文
        let yaml = "schema_version: '1'\nscenario: {population: 40, duration: '3d', seed: 7}\n";
        let out = kpi_availability_native(yaml).unwrap();
        let items = out.as_array().unwrap();
        assert_eq!(items.len(), 3, "d7/gacha/loot 三项不可用");
        for it in items {
            assert!(
                it["reason"].as_str().unwrap().starts_with("retention_d7")
                    || it["reason"]
                        .as_str()
                        .unwrap()
                        .starts_with("gacha_pulls_to_hit")
                    || it["reason"]
                        .as_str()
                        .unwrap()
                        .starts_with("loot_gold_per_player"),
                "reason 带内核 ID 前缀: {}",
                it["reason"]
            );
        }
        // 7 天 + gacha + loot 齐备 → 空数组 = 全部可用
        let full = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '7d', seed: 7}\n",
            "model:\n",
            "  gacha: {base_rate: 0.05}\n",
            "  loot:\n",
            "    on_victory: chest\n",
            "    tables:\n",
            "      chest:\n",
            "        weights: { gold_small: 100 }\n",
            "    rewards:\n",
            "      gold_small: { gold: 5, xp: 0 }\n",
        );
        assert!(kpi_availability_native(full)
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn run_matches_core_values() {
        let cfg = core::scenario::load_str(YAML).unwrap();
        let v = run_simulation_native(YAML, 2).unwrap();
        let want: Vec<serde_json::Value> = (0..2u32)
            .map(|r| serde_json::to_value(core::sim::run(&cfg, r)).unwrap())
            .collect();
        assert_eq!(
            v["results"],
            serde_json::Value::Array(want),
            "results 与 core::sim::run 直序列化逐值一致"
        );
        assert_eq!(v["results"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn run_days_csv_byte_identical() {
        let cfg = core::scenario::load_str(YAML).unwrap();
        let v = run_simulation_native(YAML, 2).unwrap();
        let want = core::export::day_csv(&core::sim::run(&cfg, 0));
        assert_eq!(
            v["days_csv"].as_str().unwrap(),
            want,
            "与 CLI simulate --out 写盘的 days.csv 同源同字节"
        );
        assert!(want.starts_with("day,active,"), "首列天索引(文档 09 契约)");
    }

    #[test]
    fn run_rejects_param_bounds() {
        assert!(run_simulation_native(YAML, 0).is_err());
        let e = run_simulation_native(YAML, MAX_REPLICATES + 1).unwrap_err();
        assert!(e.contains("上限"), "{e}");
    }

    // —— 参数扫描(文档 12/14/15 章)——
    // 单轴 attack 网格 90..=110 步 10(3 候选),win_rate 硬约束恒可行 [0,1]。
    const EXP_YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
        "sweep:\n",
        "  replicates: 2\n",
        "  parameters:\n",
        "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
        "  targets:\n",
        "    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
    );

    #[test]
    fn sweep_plan_candidates_and_replicates() {
        let v = sweep_plan_native(EXP_YAML, 0).unwrap();
        assert_eq!(v["candidates"].as_array().unwrap().len(), 3);
        assert_eq!(v["sims"], 6);
        assert_eq!(v["replicates"], 2);
        assert_eq!(v["axes"][0]["path"], "model.warrior.attack");
        assert_eq!(v["candidates"][0]["model.warrior.attack"], 90.0);
        assert_eq!(v["targets"][0]["metric"], "win_rate");

        let v = sweep_plan_native(EXP_YAML, 1).unwrap();
        assert_eq!(v["replicates"], 1, "覆盖生效(粗筛语义,同 CLI)");
        assert_eq!(v["sims"], 3);

        let e = sweep_plan_native(
            "schema_version: '1'\nscenario: {population: 40, duration: '3d', seed: 7}\n",
            0,
        )
        .unwrap_err();
        assert!(e.contains("sweep 节"), "{e}");
    }

    #[test]
    fn sweep_plan_budget_rejected() {
        let big = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "sweep:\n",
            "  replicates: 64\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 90, max: 110, step: 1}\n",
        );
        let e = sweep_plan_native(big, 0).unwrap_err();
        assert!(e.contains("预算"), "{e}");
    }

    // Random 模式(文档 12 章):采样数 = samples,采样流与 base_seed 绑定,
    // 同配置同采样(sweep_plan 输出可复现)。
    const EXP_YAML_RANDOM: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
        "sweep:\n",
        "  mode: random\n",
        "  samples: 5\n",
        "  replicates: 2\n",
        "  parameters:\n",
        "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
        "  targets:\n",
        "    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
    );

    #[test]
    fn sweep_plan_random_count_reproducible() {
        let v = sweep_plan_native(EXP_YAML_RANDOM, 0).unwrap();
        assert_eq!(v["mode"], "random");
        let cands = v["candidates"].as_array().unwrap();
        assert_eq!(cands.len(), 5, "samples 决定候选数");
        for c in cands {
            let x = c["model.warrior.attack"].as_f64().unwrap();
            assert!((90.0..=110.0).contains(&x), "采样落在 [min, max]:{x}");
        }
        assert_eq!(v["sims"], 10);
        // 同配置同采样:两次 plan 候选逐值一致
        let v2 = sweep_plan_native(EXP_YAML_RANDOM, 0).unwrap();
        assert_eq!(v["candidates"], v2["candidates"]);
        // samples 缺省(grid YAML 无 samples 键)走 grid 分支不受影响
        let g = sweep_plan_native(EXP_YAML, 0).unwrap();
        assert_eq!(g["mode"], "grid");
    }

    // 双轴网格:笛卡尔积 = 3×3 = 9 候选(Web 联合可行域矩阵的数据源,
    // docs 22 后续项)。
    #[test]
    fn sweep_plan_two_axis_cartesian() {
        let yaml2 = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "sweep:\n",
            "  replicates: 4\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 100, max: 260, step: 80}\n",
            "    model.combat.p_hit: {min: 0.9, max: 1.0, step: 0.05}\n",
            "  targets:\n",
            "    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
        );
        let v = sweep_plan_native(yaml2, 0).unwrap();
        assert_eq!(v["axes"].as_array().unwrap().len(), 2);
        let cands = v["candidates"].as_array().unwrap();
        assert_eq!(cands.len(), 9, "3 × 3 笛卡尔积");
        assert_eq!(v["sims"], 36);
        // 两轴键都在每个候选里,取值集合恰为格点
        let mut attacks: Vec<f64> = cands
            .iter()
            .map(|c| c["model.warrior.attack"].as_f64().unwrap())
            .collect();
        attacks.sort_by(|a, b| a.partial_cmp(b).unwrap());
        attacks.dedup();
        assert_eq!(attacks, vec![100.0, 180.0, 260.0]);
        let mut hits: Vec<f64> = cands
            .iter()
            .map(|c| c["model.combat.p_hit"].as_f64().unwrap())
            .collect();
        hits.sort_by(|a, b| a.partial_cmp(b).unwrap());
        hits.dedup();
        // min + k·step 有固有浮点漂移(0.9 + 0.05),近似比较
        assert_eq!(hits.len(), 3);
        for (got, want) in hits.iter().zip([0.9, 0.95, 1.0]) {
            assert!((got - want).abs() < 1e-9, "{got} vs {want}");
        }
    }

    // Latin Hypercube(文档 12 章):serde 名 latin_hypercube,采样数 =
    // samples,与 Random 同走 wasm 透传(plan 纯转发不改写候选)。
    #[test]
    fn sweep_plan_lhs_passthrough() {
        let yaml = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "sweep:\n",
            "  mode: latin_hypercube\n",
            "  samples: 6\n",
            "  replicates: 2\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
            "  targets:\n",
            "    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
        );
        let v = sweep_plan_native(yaml, 0).unwrap();
        assert_eq!(v["mode"], "latin_hypercube");
        let cands = v["candidates"].as_array().unwrap();
        assert_eq!(cands.len(), 6, "候选数 = samples");
        assert_eq!(v["sims"], 12);
        for c in cands {
            let x = c["model.warrior.attack"].as_f64().unwrap();
            assert!((90.0..=110.0).contains(&x), "采样落在 [min, max]:{x}");
        }
        // 同配置同采样可复现
        let v2 = sweep_plan_native(yaml, 0).unwrap();
        assert_eq!(v["candidates"], v2["candidates"]);
    }

    #[test]
    fn sweep_candidate_matches_core() {
        let values = r#"{"model.warrior.attack": 100.0}"#;
        let v = sweep_candidate_native(EXP_YAML, 2, values).unwrap();
        let (cfg, spec) = core::scenario::load_experiment_str(EXP_YAML).unwrap();
        let want = core::sweep::run_candidate(
            &cfg,
            &spec,
            &std::collections::BTreeMap::from([("model.warrior.attack".into(), 100.0)]),
        );
        assert_eq!(v, serde_json::to_value(want).unwrap(), "与 core 直跑一致");
        assert!(v["status"] == "ok");
        // 3 天窗口提不出 d14/d30 → 指标少于 ALL,列出的都必须 n = replicates
        let stats = v["metric_stats"].as_array().unwrap();
        assert!(stats.len() < core::experiment::MetricKey::ALL.len());
        assert!(stats.iter().all(|s| s[1]["n"] == 2));

        // 配置错误候选照常上报,不静默丢弃(文档 12 章)
        let bad = sweep_candidate_native(EXP_YAML, 2, r#"{"no.such.path": 1.0}"#).unwrap();
        assert!(bad["status"]["config_error"].as_str().is_some());

        assert!(sweep_candidate_native(EXP_YAML, 0, values).is_err());
        assert!(sweep_candidate_native(EXP_YAML, MAX_REPLICATES + 1, values).is_err());
    }

    #[test]
    fn sweep_recommend_sensitivity_and_interval() {
        let mut results = Vec::new();
        let (cfg, spec) = core::scenario::load_experiment_str(EXP_YAML).unwrap();
        for values in spec.plan(cfg.base_seed).unwrap() {
            results.push(core::sweep::run_candidate(&cfg, &spec, &values));
        }
        let results_json = serde_json::to_string(&results).unwrap();
        let v = sweep_recommend_native(EXP_YAML, &results_json).unwrap();
        let rec = &v["recommendation"];
        assert_eq!(rec["param"], "model.warrior.attack");
        assert_eq!(rec["baseline"], 100.0, "默认 attack 基线");
        // win_rate∈[0,1] 不会全 FAIL(CI 只会 PASS 或越过上界的 BORDERLINE)
        // → 至少存在一个可行段;3 天 toy 配置 CI 宽,端点不预设
        assert!(rec["interval"].is_array(), "{rec}");
        assert!(rec["confidence"].is_string());
        assert!(!rec["reasons"].as_array().unwrap().is_empty());
        assert_eq!(
            v["elasticities"].as_array().unwrap().len(),
            core::experiment::MetricKey::ALL.len()
        );

        // MVP 红线:推荐仅单参数轴(与 CLI recommend 同源拒绝)
        let two_axis = EXP_YAML.replace(
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n    model.warrior.defense: {min: 60, max: 80, step: 10}\n",
        );
        let e = sweep_recommend_native(&two_axis, &results_json).unwrap_err();
        assert!(e.contains("单参数轴"), "{e}");
    }
}
