//! Sandtable MCP 服务器(todo 计划 2026-10-20:Rust 实现,官方 rmcp SDK + stdio)。
//!
//! 纪律:**原生直调 sandtable-core**——不经 wasm / Node 边界,单二进制零
//! Node 依赖;工具面五枚(用户拍板,不与先前 Node 草稿留两套):
//!
//! - `sandtable_validate`:校验场景 YAML → config_hash / 规模元数据
//! - `sandtable_run`:跑 R 个 replicate;`results` 与 CLI `simulate`
//!   report.json 同构(同 seed 同配置逐值相等,含 day_stats / cohort_stats)
//! - `sandtable_plan_sweep`:实验 YAML → 规划网格并**真跑全部候选**
//!   (与 CLI `sweep` 同源 [`core::sweep::run_candidate`],候选间 rayon
//!   并行,内核 keyed RNG 保证与串行逐值一致)
//! - `sandtable_analyze`:纯统计工作台(ab_compare / daily_aggregate /
//!   kpi_summary / recommend),零额外仿真,只从已有 results 计算
//! - `sandtable_calibrate`:本地只读观测数据聚合 → 与本地仿真 KPI 对账;
//!   数据只传回残差表,原始观测不外发
//!
//! stdio 传输:stdout 只承载 MCP 帧,任何诊断走 stderr(本实现默认静默)。
//! 错误通道:内核/配置错误原文透传(与 wasm 绑定同纪律,壳层不改写),
//! 以 tool-level error(`is_error: true`)返回,代理可读消息继续。
//!
//! 预算:本服务器面向交互式代理调用,`sandtable_run` replicates 上限
//! 4096,`sandtable_plan_sweep` 候选数 × replicates ≤ 1000 次仿真;
//! 更大实验走 CLI(不受此限)。

use rayon::iter::{IntoParallelRefIterator, ParallelIterator};
use rmcp::{
    handler::server::wrapper::Parameters,
    model::{CallToolResult, ContentBlock},
    schemars, tool, tool_router, ErrorData, ServiceExt,
};
use serde::Deserialize;
use serde_json::{json, Value};
mod calibrate;

use sandtable_core as core;

/// 单次 `sandtable_run` 的 replicates 上限(交互代理预算,见模块注释)。
pub const MAX_RUN_REPLICATES: u32 = 4096;

/// `sandtable_plan_sweep` 的仿真预算:候选数 × replicates ≤ 1000。
pub const MAX_SWEEP_SIMS: u64 = 1000;

pub use calibrate::{
    calibrate_native, CalibrationInput, MAX_CALIBRATION_ANCHORS, MAX_CALIBRATION_REPLICATES,
};

fn load(yaml: &str) -> Result<core::config::SimConfig, String> {
    let cfg = core::scenario::load_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    Ok(cfg)
}

fn parse_results(results_json: &str, what: &str) -> Result<Vec<core::metrics::RunMetrics>, String> {
    serde_json::from_str(results_json).map_err(|e| format!("参数错误: {what}解析失败: {e}"))
}

fn to_tool_result(v: Result<Value, String>) -> Result<CallToolResult, ErrorData> {
    match v {
        Ok(v) => {
            let text = serde_json::to_string(&v).unwrap_or_default();
            Ok(CallToolResult::success(vec![ContentBlock::text(text)]))
        }
        // 内核/配置错误原文透传(tool-level error,不在壳层改写)
        Err(e) => Ok(CallToolResult::error(vec![ContentBlock::text(e)])),
    }
}

// —— native 助手层(与 wasm 绑定 `*_native` 同型:Result<Value, String>,
//    可脱离 MCP 协议直接测试;Web 预算常量不适用,见模块注释)——

/// 校验配置:与 wasm `validate_config_native` 同源(输出同构)。
fn validate_config_native(yaml: &str) -> Result<Value, String> {
    let cfg = load(yaml)?;
    Ok(json!({
        "config_hash": core::config::config_hash(&cfg),
        "players": cfg.players,
        "days": cfg.days,
        "schema_version": core::SCHEMA_VERSION,
        "model_version": core::MODEL_VERSION,
    }))
}

/// 运行仿真:与 wasm `run_simulation_native` 同源(同 seed 逐值相等),
/// 仅预算上限不同(原生无 wasm 4GB / Web 定位约束)。
fn run_simulation_native(yaml: &str, replicates: u32) -> Result<Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    if replicates > MAX_RUN_REPLICATES {
        return Err(format!(
            "参数错误: replicates 超出 MCP 预算上限 {MAX_RUN_REPLICATES}(更大实验走 CLI)"
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

/// 规划并真跑参数扫描:plan 与 CLI `sweep` / wasm `sweep_plan_native`
/// 同源,候选执行与 CLI 同源([`core::sweep::run_candidate`],rayon 并行)。
/// `replicates_override` > 0 时覆盖 sweep.replicates(粗筛语义)。
/// 输出 `{replicates, sims, candidates, results}`,其中 `results` 是
/// [`core::sweep::CandidateResult`] 序列化数组(带判定),可直接喂给
/// `sandtable_analyze` 的 `recommend`。
fn sweep_run_native(yaml: &str, replicates_override: u32) -> Result<Value, String> {
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
    if sims == 0 {
        return Err("参数错误: 扫描网格为空(检查 parameters 的 min/max/step)".into());
    }
    if sims > MAX_SWEEP_SIMS {
        return Err(format!(
            "参数错误: 候选数 × replicates = {sims} 超出 MCP 预算 {MAX_SWEEP_SIMS}(调小网格或 replicates 粗筛,更大实验走 CLI)"
        ));
    }
    // 候选间并行(与 CLI sweep 同纪律);内核 keyed RNG 保证并行与串行
    // 逐值一致(parallel_determinism 测试锁死)。
    let results: Vec<core::sweep::CandidateResult> = candidates
        .par_iter()
        .map(|values| core::sweep::run_candidate(&cfg, &spec, values))
        .collect();
    Ok(json!({
        "replicates": spec.replicates,
        "sims": sims,
        "candidates": candidates,
        "results": results,
    }))
}

/// A/B 统计比较:与 wasm `ab_compare_native` 同源(compare_arms,CRN 配对)。
fn ab_compare_native(
    base_yaml: &str,
    cand_yaml: &str,
    metric: &str,
    results_a_json: &str,
    results_b_json: &str,
) -> Result<Value, String> {
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
    let arm_a = parse_results(results_a_json, "base 臂结果")?;
    let arm_b = parse_results(results_b_json, "cand 臂结果")?;
    let comparison = core::experiment::compare_arms(&cfg_a, &cfg_b, key, &arm_a, &arm_b)
        .map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(&comparison).map_err(|e| format!("配置错误: {e}"))
}

/// 逐日跨 replicate 聚合:与 wasm `daily_aggregate_native` 同源(内核
/// `daily_aggregate_metrics`,SampleStats 口径);replicates < 2 时内核报错
/// 原样透传(单次运行不得套置信带)。
fn daily_aggregate_native(results_json: &str) -> Result<Value, String> {
    let results = parse_results(results_json, "逐日聚合结果")?;
    let aggregation = core::experiment::daily_aggregate_metrics(&results)
        .map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(aggregation).map_err(|e| format!("配置错误: {e}"))
}

/// 运行级 KPI 汇总:内核 `MetricKey::ALL` 逐项 extract → summarize
/// (mean / sd / CI95)。某指标在配置下不可用(gacha / loot 未配置、天数
/// 不足)时该行带内核 `unavailable_reason` 原文,不产出编造数值。
fn kpi_summary_native(yaml: &str, results_json: &str) -> Result<Value, String> {
    let cfg = load(yaml)?;
    let results = parse_results(results_json, "KPI 汇总结果")?;
    if results.is_empty() {
        return Err("参数错误: results 至少需要 1 份".into());
    }
    let rows: Vec<Value> = core::experiment::MetricKey::ALL
        .iter()
        .map(|k| {
            let values: Vec<f64> = results.iter().filter_map(|m| k.extract(m)).collect();
            if values.is_empty() {
                let reason = k
                    .unavailable_reason(&cfg)
                    .unwrap_or("结果中无该指标的逐 replicate 值");
                json!({ "metric": k.name(), "reason": reason })
            } else {
                let s = core::experiment::summarize(&values);
                json!({
                    "metric": k.name(),
                    "reason": Value::Null,
                    "n": s.n,
                    "mean": s.mean,
                    "sd": s.sd,
                    "ci95_lo": s.ci95_lo,
                    "ci95_hi": s.ci95_hi,
                })
            }
        })
        .collect();
    Ok(json!({ "kpis": rows }))
}

/// 单轴推荐:与 wasm `sweep_recommend_native` 同源(OAT 弹性 + 推荐区间,
/// 只从已有候选结果计算,零额外仿真;MVP 红线:仅单参数轴)。
fn recommend_native(yaml: &str, results_json: &str) -> Result<Value, String> {
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

// —— MCP 工具层(参数结构 + rmcp 宏;字段文档即 inputSchema 描述)——

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ValidateParams {
    /// 场景 YAML 全文(schema_version: "1" 开头,与 CLI validate 同源)
    pub yaml: String,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RunParams {
    /// 场景 YAML 全文
    pub yaml: String,
    /// replicate 次数(第 r 次种子 = base_seed + r);MCP 预算上限 4096
    pub replicates: u32,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct PlanSweepParams {
    /// 实验 YAML 全文(schema_version + scenario + sweep 节)
    pub yaml: String,
    /// 覆盖 sweep.replicates(粗筛语义);0 或省略 = 用实验文件自带值
    #[serde(default)]
    #[schemars(default)]
    pub replicates_override: u32,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct AnalyzeParams {
    /// 分析类型:ab_compare(两臂配对比较)/ daily_aggregate(逐日跨 replicate
    /// 聚合,95% CI)/ kpi_summary(运行级 KPI 汇总)/ recommend(单轴推荐区间)
    pub analysis: String,
    /// ab_compare: 基线臂场景 YAML;kpi_summary: 场景 YAML;recommend: 实验 YAML
    #[serde(default)]
    pub base_yaml: Option<String>,
    /// ab_compare: 候选臂场景 YAML
    #[serde(default)]
    pub cand_yaml: Option<String>,
    /// ab_compare: 指标 ID(retention_d7 / retention_d3 / win_rate /
    /// gold_per_player / power_p50 / churn_rate / gacha_pulls_to_hit /
    /// loot_gold_per_player)
    #[serde(default)]
    pub metric: Option<String>,
    /// kpi_summary / daily_aggregate / recommend: results JSON 数组
    /// (sandtable_run 的 results 或 plan_sweep 的 results)
    #[serde(default)]
    pub results_json: Option<Value>,
    /// ab_compare: 基线臂 results JSON 数组
    #[serde(default)]
    pub results_a_json: Option<Value>,
    /// ab_compare: 候选臂 results JSON 数组
    #[serde(default)]
    pub results_b_json: Option<Value>,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CalibrateParams {
    /// 场景 YAML 全文;校准只读取本地 `data_dir`,不外发观测数据。
    pub yaml: String,
    /// 本地只读数据目录;series.file 相对且不得逃出该目录。
    pub data_dir: String,
    /// 字段映射 YAML:anchors 为运行级内核指标锚点;series 映射 CSV 的
    /// day/value/denominator 列并按 sum/ratio 聚合。
    pub mapping: String,
    /// replicate 数(默认 1;≥2 时输出内核 95% CI),预算上限 128。
    #[serde(default = "default_calibration_replicates")]
    pub replicates: u32,
}

fn default_calibration_replicates() -> u32 {
    1
}

/// 必填字符串参数(ab_compare / kpi_summary / recommend 各分支共用)。
fn require_str<'a>(v: &'a Option<String>, analysis: &str, what: &str) -> Result<&'a str, String> {
    v.as_deref()
        .ok_or_else(|| format!("参数错误: {analysis} 需要 {what}"))
}

/// 必填 results JSON 参数(统一走 serde 字符串反序列化通道)。
fn require_json(v: &Option<Value>, analysis: &str, what: &str) -> Result<String, String> {
    v.as_ref()
        .ok_or_else(|| format!("参数错误: {analysis} 需要 {what}"))
        .and_then(|v| {
            serde_json::to_string(v).map_err(|e| format!("参数错误: {what}序列化失败: {e}"))
        })
}

#[derive(Debug, Clone, Default)]
pub struct SandtableMcp;

#[tool_router(server_handler)]
impl SandtableMcp {
    #[tool(
        description = "校验 Sandtable 场景 YAML,返回 config_hash / players / days / schema_version / model_version;配置非法时返回内核错误原文"
    )]
    fn sandtable_validate(
        &self,
        Parameters(ValidateParams { yaml }): Parameters<ValidateParams>,
    ) -> Result<CallToolResult, ErrorData> {
        to_tool_result(validate_config_native(&yaml))
    }

    #[tool(
        description = "运行 Sandtable 仿真:R 个 replicate,返回与 CLI simulate 报告同构的 results(逐 replicate 指标)及 replicate 1 的 days_csv;确定性:同 YAML 同 replicates 逐值一致"
    )]
    fn sandtable_run(
        &self,
        Parameters(RunParams { yaml, replicates }): Parameters<RunParams>,
    ) -> Result<CallToolResult, ErrorData> {
        to_tool_result(run_simulation_native(&yaml, replicates))
    }

    #[tool(
        description = "规划并运行 Sandtable 参数扫描:实验 YAML → 网格候选 → 真跑全部候选(含 PASS/BORDERLINE/FAIL 判定)。返回 {replicates, sims, candidates, results};results 可直接喂给 sandtable_analyze 的 recommend。MCP 预算:候选数 × replicates ≤ 1000 次仿真,更大实验走 CLI"
    )]
    fn sandtable_plan_sweep(
        &self,
        Parameters(PlanSweepParams {
            yaml,
            replicates_override,
        }): Parameters<PlanSweepParams>,
    ) -> Result<CallToolResult, ErrorData> {
        to_tool_result(sweep_run_native(&yaml, replicates_override))
    }

    #[tool(
        description = "Sandtable 结果分析工作台(纯统计,零额外仿真)。analysis=ab_compare: 两臂同指标 CRN 配对比较(需 base_yaml/cand_yaml/metric/results_a_json/results_b_json,results 来自 sandtable_run);analysis=daily_aggregate: 逐日跨 replicate 聚合与 95% CI(需 results_json,replicates ≥ 2);analysis=kpi_summary: 运行级 KPI 汇总表(需 base_yaml=场景 YAML 与 results_json);analysis=recommend: 单参数轴推荐区间(需 base_yaml=实验 YAML 与 results_json=plan_sweep 的 results)"
    )]
    fn sandtable_analyze(
        &self,
        Parameters(AnalyzeParams {
            analysis,
            base_yaml,
            cand_yaml,
            metric,
            results_json,
            results_a_json,
            results_b_json,
        }): Parameters<AnalyzeParams>,
    ) -> Result<CallToolResult, ErrorData> {
        // 分支表达式全部收敛为 Result<Value, String>,错误原文走
        // to_tool_result 的 tool-level error 通道(不在壳层改写)。
        let out: Result<Value, String> = match analysis.as_str() {
            "ab_compare" => {
                let base_yaml = require_str(&base_yaml, &analysis, "base_yaml(基线臂场景 YAML)");
                let cand_yaml = require_str(&cand_yaml, &analysis, "cand_yaml(候选臂场景 YAML)");
                let metric = metric
                    .as_deref()
                    .ok_or_else(|| format!("参数错误: {analysis} 需要 metric"));
                let a = require_json(&results_a_json, &analysis, "results_a_json");
                let b = require_json(&results_b_json, &analysis, "results_b_json");
                match (base_yaml, cand_yaml, metric, a, b) {
                    (Ok(base), Ok(cand), Ok(metric), Ok(a), Ok(b)) => {
                        ab_compare_native(base, cand, metric, &a, &b)
                    }
                    (Err(e), ..)
                    | (_, Err(e), ..)
                    | (_, _, Err(e), ..)
                    | (_, _, _, Err(e), ..)
                    | (_, _, _, _, Err(e)) => Err(e),
                }
            }
            "daily_aggregate" => require_json(&results_json, &analysis, "results_json")
                .and_then(|r| daily_aggregate_native(&r)),
            "kpi_summary" => require_str(&base_yaml, &analysis, "base_yaml(场景 YAML)")
                .and_then(|yaml| {
                    require_json(&results_json, &analysis, "results_json")
                        .and_then(|r| kpi_summary_native(yaml, &r))
                }),
            "recommend" => require_str(&base_yaml, &analysis, "base_yaml(实验 YAML)")
                .and_then(|yaml| {
                    require_json(&results_json, &analysis, "results_json")
                        .and_then(|r| recommend_native(yaml, &r))
                }),
            other => Err(format!(
                "参数错误: 未知分析类型 {other}(可选: ab_compare / daily_aggregate / kpi_summary / recommend)"
            )),
        };
        to_tool_result(out)
    }

    #[tool(
        description = "本地只读数据校准对账:按 mapping 聚合 data_dir 内 CSV 的观测值,运行场景仿真,输出逐锚点 sim/observed 残差与 PASS/FAIL/UNMAPPED 报告。支持运行级 KPI 与 win_rate/gold_per_player/power_p50 逐日锚点;数据只在本地读取,不外发"
    )]
    fn sandtable_calibrate(
        &self,
        Parameters(CalibrateParams {
            yaml,
            data_dir,
            mapping,
            replicates,
        }): Parameters<CalibrateParams>,
    ) -> Result<CallToolResult, ErrorData> {
        let input = CalibrationInput {
            yaml,
            data_dir,
            mapping,
            replicates,
        };
        to_tool_result(calibrate_native(&input))
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // stdio 传输:stdout 只承载 MCP 帧,诊断一律不打印(静默纪律)
    let service = SandtableMcp.serve(rmcp::transport::stdio()).await?;
    service.waiting().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCEN: &str =
        "schema_version: \"1\"\nscenario: {population: 100, duration: \"5d\", seed: 7}\n";

    fn exp_yaml() -> String {
        "schema_version: \"1\"\nscenario: {population: 100, duration: \"10d\"}\nsweep:\n  replicates: 2\n  parameters:\n    model.warrior.attack: {min: 90, max: 110, step: 10}\n  targets:\n    - metric: win_rate\n      min: 0.0\n      max: 1.0\n".into()
    }

    #[test]
    fn validate_rejects_bad_yaml_with_kernel_message() {
        // population=0 触发内核 validate 的规模下限;schema 缺省是合法的
        // (回退默认配置),不能当反例。
        let err = validate_config_native(
            "schema_version: \"1\"\nscenario: {population: 0, duration: \"5d\"}\n",
        )
        .unwrap_err();
        assert!(err.starts_with("配置错误"), "{err}");
    }

    #[test]
    fn run_rejects_zero_and_over_budget_replicates() {
        assert!(run_simulation_native(SCEN, 0)
            .unwrap_err()
            .contains("至少为 1"));
        assert!(run_simulation_native(SCEN, MAX_RUN_REPLICATES + 1)
            .unwrap_err()
            .contains("预算上限"));
    }

    #[test]
    fn run_matches_wasm_contract_shape() {
        let v = run_simulation_native(SCEN, 2).unwrap();
        assert_eq!(v["results"].as_array().unwrap().len(), 2);
        assert!(v["config_hash"].as_str().is_some());
        assert!(v["days_csv"].as_str().unwrap().contains(','));
    }

    #[test]
    fn sweep_runs_all_candidates_and_enforces_budget() {
        let v = sweep_run_native(&exp_yaml(), 0).unwrap();
        assert_eq!(v["sims"], 6);
        assert_eq!(v["results"].as_array().unwrap().len(), 3);

        let big = "schema_version: \"1\"\nscenario: {population: 100, duration: \"10d\"}\nsweep:\n  replicates: 400\n  parameters:\n    model.warrior.attack: {min: 90, max: 110, step: 10}\n".to_string();
        let err = sweep_run_native(&big, 0).unwrap_err();
        assert!(err.contains("超出 MCP 预算"), "{err}");
    }

    #[test]
    fn analyze_ab_compare_produces_verdict() {
        let arm = |m: i64| format!("{SCEN}model:\n  dungeon:\n    m_attack: {m}\n");
        let a = run_simulation_native(&arm(10), 4).unwrap();
        let b = run_simulation_native(&arm(120), 4).unwrap();
        let v = ab_compare_native(
            &arm(10),
            &arm(120),
            "power_p50",
            &a["results"].to_string(),
            &b["results"].to_string(),
        )
        .unwrap();
        assert!(v["verdict"].is_object() || v["verdict"].is_string(), "{v}");
        assert!(v["diff_mean"].is_number());
    }

    #[test]
    fn analyze_daily_aggregate_requires_two_replicates() {
        let one = run_simulation_native(SCEN, 1).unwrap();
        let err = daily_aggregate_native(&one["results"].to_string()).unwrap_err();
        assert!(!err.is_empty(), "内核错误应透传非空消息");
        let two = run_simulation_native(SCEN, 2).unwrap();
        let v = daily_aggregate_native(&two["results"].to_string()).unwrap();
        assert!(!v["day_stats"].as_array().unwrap().is_empty());
    }

    #[test]
    fn kpi_summary_marks_unavailable_and_reports_available() {
        let run = run_simulation_native(SCEN, 2).unwrap();
        let v = kpi_summary_native(SCEN, &run["results"].to_string()).unwrap();
        let kpis = v["kpis"].as_array().unwrap();
        assert_eq!(kpis.len(), core::experiment::MetricKey::ALL.len());
        let win = kpis.iter().find(|r| r["metric"] == "win_rate").unwrap();
        assert!(win["mean"].is_number());
        // 默认配置无 gacha / loot:缺席指标带内核原因,不编造数值
        let gacha = kpis
            .iter()
            .find(|r| r["metric"] == "gacha_pulls_to_hit")
            .unwrap();
        assert!(gacha["reason"].is_string(), "{gacha}");
        assert!(gacha["mean"].is_null());
    }

    #[test]
    fn recommend_single_axis_and_rejects_multi() {
        let sweep = sweep_run_native(&exp_yaml(), 0).unwrap();
        let v = recommend_native(&exp_yaml(), &sweep["results"].to_string()).unwrap();
        assert!(v["recommendation"].is_object(), "{v}");
        assert!(v["elasticities"].is_array() || v["elasticities"].is_object());

        let multi = "schema_version: \"1\"\nscenario: {population: 100, duration: \"10d\"}\nsweep:\n  replicates: 2\n  parameters:\n    model.warrior.attack: {min: 90, max: 110, step: 10}\n    model.warrior.defense: {min: 70, max: 90, step: 10}\n".to_string();
        let sweep2 = sweep_run_native(&multi, 0).unwrap();
        let err = recommend_native(&multi, &sweep2["results"].to_string()).unwrap_err();
        assert!(err.contains("单参数轴"), "{err}");
    }

    #[test]
    fn candidates_plan_echo_matches_results_len() {
        let v = sweep_run_native(&exp_yaml(), 3).unwrap();
        assert_eq!(v["replicates"], 3);
        assert_eq!(v["sims"], 9);
        assert_eq!(v["candidates"].as_array().unwrap().len(), 3);
        assert_eq!(v["results"].as_array().unwrap().len(), 3);
    }
}
