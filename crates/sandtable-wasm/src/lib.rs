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

#[cfg(test)]
mod tests {
    use super::*;

    const YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
    );

    #[test]
    fn 校验_有效与无效() {
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
    fn 运行_与core直跑逐值一致() {
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
    fn 运行_输出附days_csv与core渲染同字节() {
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
    fn 运行_参数边界拒绝() {
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
    fn 扫描_plan_候选与replicates覆盖() {
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
    fn 扫描_plan_预算拒绝() {
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
    fn 扫描_plan_random_采样数与可复现() {
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
    fn 扫描_plan_双轴网格_笛卡尔积() {
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
    fn 扫描_plan_lhs_透传() {
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
    fn 扫描_candidate_与core直跑逐值一致() {
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
    fn 扫描_recommend_敏感性加单轴区间() {
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
