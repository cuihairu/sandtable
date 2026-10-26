//! 自定义 KPI(todo「KPI 与模板」):在内置指标白名单上求值的受控表达式。
//!
//! 三条纪律:
//! - **校验 = 编译期**。表达式过 [`crate::formula::compile`] 的白名单
//!   (函数 / 变量 / 长度 / 嵌套),越界即报错,不进运行期。
//! - **可复现 = 表达式原文 + 变量白名单 + 定义版本**。输出把三者与聚合
//!   方法一并回传,任何人拿同样输入重算必得同样结果。
//! - **缺席不填 0**。某 replicate 的指标是 `None`(gacha/loot 未配置等),
//!   该 replicate 记 `None`,聚合只用真实值;n < 2 不给统计区间
//!   (与 [`crate::experiment::daily_aggregate_metrics`] 同一条红线)。

use serde::Serialize;

use crate::experiment::{MetricKey, SampleStats, DAILY_CI_METHOD, DAILY_SD_METHOD};
use crate::formula::{self, Formula};
use crate::metrics::RunMetrics;

/// 自定义 KPI 定义版本。表达式语义或变量白名单变化时递增,随输出记录。
pub const KPI_SCHEMA_VERSION: &str = "1";

/// 可引用变量全集 = 内置指标名(`MetricKey::name`,与 CSV 列名同口径)。
pub fn kpi_var_names() -> Vec<&'static str> {
    MetricKey::ALL.iter().map(|key| key.name()).collect()
}

/// 编译产物:表达式引用了哪些变量(声明序)。
#[derive(Debug, Clone, Serialize)]
pub struct CustomKpiShape {
    pub vars: Vec<&'static str>,
    pub used_vars: Vec<&'static str>,
}

/// 校验表达式并回传形状。**只做编译**,不碰运行期数据。
pub fn validate_expression(expression: &str) -> Result<CustomKpiShape, crate::Error> {
    let (formula, vars) = compile_checked(expression)?;
    Ok(CustomKpiShape {
        used_vars: var_names(&formula, &vars),
        vars: vars.into_iter().collect(),
    })
}

/// 统一校验入口:白名单编译 + 拒绝常量表达式。`validate_expression` 与
/// `evaluate` 都走它,两条路径不可能校验不一致。
fn compile_checked(expression: &str) -> Result<(Formula, Vec<&'static str>), crate::Error> {
    let vars = kpi_var_names();
    let formula = formula::compile(expression, &vars)
        .map_err(|e| crate::Error::Config(format!("KPI 表达式: {e}")))?;
    if formula.var_indices().is_empty() {
        return Err(crate::Error::Config(
            "KPI 表达式未引用任何指标(常量表达式没有可复现的运行口径)".into(),
        ));
    }
    Ok((formula, vars))
}

/// 表达式实际引用的变量名(声明序)。
fn var_names<'a>(formula: &Formula, vars: &[&'a str]) -> Vec<&'a str> {
    formula
        .var_indices()
        .iter()
        .map(|i| vars[*i as usize])
        .collect()
}

/// 自定义 KPI 求值输出(可直接序列化给 wasm / TS 镜像)。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct CustomKpiOutput {
    /// 表达式原文。复算入口:同 expression + vars + 版本 ⇒ 同结果。
    pub expression: String,
    /// 可引用变量全集(声明序)。
    pub vars: Vec<String>,
    /// 表达式实际引用的变量。
    pub used_vars: Vec<String>,
    /// 逐 replicate 值;指标缺席或求值产生 NaN 记 `None`,不填 0。
    pub per_replicate: Vec<Option<f64>>,
    /// 参与聚合的 replicate 数。
    pub n_used: usize,
    /// 跨 replicate 聚合。n < 2 为 `None` —— 单次运行不得套置信带。
    /// 整组统计缺席时不输出该键(与 DailyAggregation 的可选指标同口径,
    /// 缺席 ≠ 0);逐 replicate 值保留位置,缺席记 null。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<SampleStats>,
    /// KPI 定义版本与方法口径,报告里与数值同栏出现。
    pub schema_version: &'static str,
    pub sd_method: &'static str,
    pub ci_method: &'static str,
}

/// 在 `results` 的每个 replicate 上求值表达式并聚合。
///
/// 与内置指标的差别只在「指标从哪里来」:内置走 `MetricKey::extract`,
/// 自定义走公式白名单 + 同一批 `RunMetrics`。两条路共用
/// `MetricKey::ALL` 白名单,所以自定义 KPI 的口径与内置指标可比。
pub fn evaluate(expression: &str, results: &[RunMetrics]) -> Result<CustomKpiOutput, crate::Error> {
    let (formula, vars) = compile_checked(expression)?;

    let per_replicate: Vec<Option<f64>> = results
        .iter()
        .map(|run| {
            // 变量顺序与 MetricKey::ALL 对齐;缺席记 NaN,求值后归 None
            let env: Vec<f64> = MetricKey::ALL
                .iter()
                .map(|key| key.extract(run).unwrap_or(f64::NAN))
                .collect();
            let value = formula.eval(&env);
            Some(value).filter(|v| v.is_finite())
        })
        .collect();

    let values: Vec<f64> = per_replicate.iter().flatten().cloned().collect();
    let n_used = values.len();

    Ok(CustomKpiOutput {
        stats: if n_used >= 2 {
            Some(crate::experiment::summarize(&values))
        } else {
            None
        },
        used_vars: var_names(&formula, &vars)
            .into_iter()
            .map(str::to_string)
            .collect(),
        per_replicate,
        n_used,
        schema_version: KPI_SCHEMA_VERSION,
        sd_method: DAILY_SD_METHOD,
        ci_method: DAILY_CI_METHOD,
        expression: expression.to_string(),
        vars: vars.into_iter().map(str::to_string).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(replicate: u32, retention_d7: Option<f64>, win_rate: f64) -> RunMetrics {
        RunMetrics {
            schema_version: crate::SCHEMA_VERSION.to_string(),
            model_version: crate::MODEL_VERSION.to_string(),
            config_hash: format!("rep-{replicate}"),
            replicate,
            seed: replicate as u64,
            players: 40,
            days: 7,
            day1_cohort: 40,
            retention_d1: Some(1.0),
            retention_d3: Some(1.0),
            retention_d7,
            retention_d14: None,
            retention_d30: None,
            churn_total: 0,
            churn_rate_total: 0.05,
            win_rate,
            gold_earned_total: 1000,
            gold_spent_total: 500,
            whale_gold_share: 0.1,
            inflation_daily_mean: 0.0,
            inflation_last: 0.0,
            sink_ratio_mean: 0.5,
            gacha_pulls_to_hit: None,
            loot_gold_per_player: None,
            power_snapshots: vec![],
            cohort_stats: vec![],
            day_stats: vec![],
        }
    }

    fn shape(expr: &str) -> Result<CustomKpiShape, crate::Error> {
        validate_expression(expr)
    }

    #[test]
    fn var_whitelist_is_the_builtin_metric_set() {
        let names = kpi_var_names();
        assert_eq!(
            names,
            MetricKey::ALL.iter().map(|k| k.name()).collect::<Vec<_>>(),
            "自定义 KPI 的变量集必须与内置指标同名同序(口径可比)"
        );
        assert!(names.iter().all(|n| MetricKey::parse(n).is_some()));
    }

    #[test]
    fn validate_reports_used_vars() {
        let s = shape("max(win_rate, retention_d7) + churn_rate * 2").unwrap();
        // 声明序 = MetricKey::ALL 顺序(retention_d7 在 win_rate 在 churn_rate 前)
        assert_eq!(s.used_vars, vec!["retention_d7", "win_rate", "churn_rate"]);
        assert_eq!(s.vars.len(), MetricKey::ALL.len());
    }

    #[test]
    fn used_vars_are_deduped_and_in_declaration_order() {
        let s = shape("max(win_rate, win_rate) * retention_d7").unwrap();
        assert_eq!(s.used_vars, vec!["retention_d7", "win_rate"]);
    }

    #[test]
    fn validate_rejects_unknown_variable() {
        let err = shape("win_rates * 2").unwrap_err().to_string();
        assert!(err.contains("win_rates"), "未知变量要点名,实得 {err}");
    }

    #[test]
    fn validate_rejects_constant_expression() {
        assert!(
            shape("0.5").is_err(),
            "常量表达式没有可复现的运行口径,必须拒绝"
        );
    }

    #[test]
    fn evaluate_matches_builtin_metric_and_aggregates() {
        let runs = [
            run(0, Some(0.8), 0.5),
            run(1, Some(0.9), 0.6),
            run(2, Some(1.0), 0.7),
        ];
        let out = evaluate("retention_d7", &runs).unwrap();
        assert_eq!(out.per_replicate, vec![Some(0.8), Some(0.9), Some(1.0)]);
        assert_eq!(out.n_used, 3);
        assert!(out.used_vars == vec!["retention_d7"]);

        let built_in: Vec<Option<f64>> = runs
            .iter()
            .map(|r| MetricKey::RetentionD7.extract(r))
            .collect();
        assert_eq!(
            out.per_replicate, built_in,
            "同名表达式必须与内置指标逐值一致"
        );

        let stats = out.stats.as_ref().unwrap();
        let hand = crate::experiment::summarize(&[0.8, 0.9, 1.0]);
        assert_eq!(stats, &hand, "聚合走同一套 n-1 口径");
        assert!(stats.ci95_lo <= stats.mean && stats.mean <= stats.ci95_hi);
    }

    #[test]
    fn evaluate_missing_metric_is_none_not_zero() {
        let runs = [run(0, Some(0.9), 0.6), run(1, Some(0.9), 0.6)];
        let out = evaluate("gacha_pulls_to_hit", &runs).unwrap();
        assert_eq!(out.per_replicate, vec![None, None]);
        assert_eq!(out.n_used, 0);
        assert!(out.stats.is_none(), "无样本不得给统计区间");
    }

    #[test]
    fn evaluate_no_ci_band_on_single_replicate() {
        let runs = [run(0, Some(0.9), 0.6)];
        let out = evaluate("retention_d7", &runs).unwrap();
        assert_eq!(out.n_used, 1);
        assert!(
            out.stats.is_none(),
            "单次运行不得套置信带(与 daily_aggregate 同一红线)"
        );
        assert_eq!(out.per_replicate, vec![Some(0.9)]);
    }

    #[test]
    fn evaluate_non_finite_value_dropped() {
        let runs = [
            run(0, Some(0.9), 0.6),
            run(1, Some(0.9), 0.6),
            run(2, None, 0.7),
        ];
        let out = evaluate("retention_d7 * 1.0", &runs).unwrap();
        assert_eq!(out.n_used, 2);
        let stats = out.stats.as_ref().unwrap();
        assert_eq!(stats.n, 2);
    }

    #[test]
    fn evaluate_carries_definition_version_and_methods() {
        let out = evaluate(
            "retention_d7",
            &[run(0, Some(0.9), 0.6), run(1, Some(0.9), 0.6)],
        )
        .unwrap();
        assert_eq!(out.schema_version, KPI_SCHEMA_VERSION);
        assert_eq!(out.sd_method, DAILY_SD_METHOD);
        assert_eq!(out.ci_method, DAILY_CI_METHOD);
        assert_eq!(out.expression, "retention_d7");
    }

    #[test]
    fn evaluate_rejects_unknown_variable_in_result() {
        let err = evaluate("not_a_metric * 2", &[run(0, Some(0.9), 0.6)])
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("not_a_metric"),
            "求值路径同样走编译校验,实得 {err}"
        );
    }
}
