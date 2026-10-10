//! 输出渲染(文档 09 章):core 只负责把结果渲染成字符串,文件写出由
//! 壳层(CLI)完成——平台边界的核心例子。
//!
//! MVP 输出两种:JSON(完整结构)与 CSV(日序列表);Arrow RecordBatch
//! 以 `arrow` feature 提供(文档 09 章数据契约,见 [`arrow`] 子模块)。

#[cfg(feature = "arrow")]
pub mod arrow;

use crate::metrics::RunMetrics;

/// 完整 JSON 报告(美化输出)。
pub fn to_json(m: &RunMetrics) -> String {
    serde_json::to_string_pretty(m).expect("RunMetrics 序列化不会失败")
}

/// CSV 列均为数值字段,无需转义;浮点统一 6 位小数,避免科学计数法抖动。
fn f(v: f64) -> String {
    format!("{v:.6}")
}

/// 日序列 CSV。首行为表头,列与 DayStat 字段一致。
pub fn day_csv(m: &RunMetrics) -> String {
    let mut out = String::new();
    out.push_str(
        "day,active,alive_at_start,new_churned,churn_rate,battles,wins,win_rate,\
         gold_earned,gold_spent,sink_ratio,gold_supply,inflation,income_per_active,\
         spending_per_active,mean_power,levelups,upgrades\n",
    );
    for d in &m.day_stats {
        let row = [
            d.day.to_string(),
            d.active.to_string(),
            d.alive_at_start.to_string(),
            d.new_churned.to_string(),
            f(d.churn_rate),
            d.battles.to_string(),
            d.wins.to_string(),
            f(d.win_rate),
            d.gold_earned.to_string(),
            d.gold_spent.to_string(),
            f(d.sink_ratio),
            d.gold_supply.to_string(),
            f(d.inflation),
            f(d.income_per_active),
            f(d.spending_per_active),
            f(d.mean_power),
            d.levelups.to_string(),
            d.upgrades.to_string(),
        ];
        out.push_str(&row.join(","));
        out.push('\n');
    }
    out
}

/// 人类可读的终端摘要。
pub fn summary_text(m: &RunMetrics) -> String {
    use std::fmt::Write as _;
    let mut s = String::new();
    let _ = writeln!(
        s,
        "replicate {}  seed {}  config_hash {}",
        m.replicate,
        m.seed,
        &m.config_hash[..16]
    );
    let _ = writeln!(
        s,
        "players {} × days {}   (schema {} / model {})",
        m.players, m.days, m.schema_version, m.model_version
    );
    let _ = writeln!(s, "day1_cohort     {}", m.day1_cohort);
    for (label, v) in [
        ("retention_d3 ", m.retention_d3),
        ("retention_d7 ", m.retention_d7),
        ("retention_d14", m.retention_d14),
        ("retention_d30", m.retention_d30),
    ] {
        if let Some(v) = v {
            let _ = writeln!(s, "{label}      {v:.4}");
        }
    }
    let _ = writeln!(
        s,
        "churn_total     {} ({:.4})",
        m.churn_total, m.churn_rate_total
    );
    let _ = writeln!(s, "win_rate        {:.4}", m.win_rate);
    let _ = writeln!(
        s,
        "gold_earned     {}  spent {}",
        m.gold_earned_total, m.gold_spent_total
    );
    let _ = writeln!(
        s,
        "inflation       日均 {:.4}  末日 {:.4}   sink_ratio 均值 {:.4}",
        m.inflation_daily_mean, m.inflation_last, m.sink_ratio_mean
    );
    let _ = writeln!(
        s,
        "whale_gold_share{:.4}  (MVP 无付费语义)",
        m.whale_gold_share
    );
    if let Some(et) = m.gacha_pulls_to_hit {
        let _ = writeln!(
            s,
            "gacha_pulls_to_hit{:.2}  抽(出到即止会话,文档 24 章)",
            et
        );
    }
    if let Some(last) = m.power_snapshots.last() {
        let _ = writeln!(
            s,
            "power D{}        P50 {:.0}  P90 {:.0}  P99 {:.0}",
            last.day, last.p50, last.p90, last.p99
        );
    }
    if !m.cohort_stats.is_empty() {
        let _ = writeln!(
            s,
            "cohort          count  churned  mean_power  mean_gold  mean_level"
        );
        for c in &m.cohort_stats {
            let _ = writeln!(
                s,
                "  {:<8}  {:>5}  {:>7}  {:>10.0}  {:>9.0}  {:>10.1}",
                c.cohort, c.count, c.churned, c.mean_power, c.mean_gold, c.mean_level
            );
        }
    }
    s
}

/// 比较结果的人类可读摘要。
pub fn comparison_text(c: &crate::experiment::Comparison) -> String {
    use std::fmt::Write as _;
    let mut s = String::new();
    let _ = writeln!(s, "metric          {}", c.metric);
    let _ = writeln!(
        s,
        "arm_a           mean {:.4}  CI95 [{:.4}, {:.4}]  (n={})",
        c.arm_a.mean, c.arm_a.ci95_lo, c.arm_a.ci95_hi, c.arm_a.n
    );
    let _ = writeln!(
        s,
        "arm_b           mean {:.4}  CI95 [{:.4}, {:.4}]  (n={})",
        c.arm_b.mean, c.arm_b.ci95_lo, c.arm_b.ci95_hi, c.arm_b.n
    );
    let _ = writeln!(
        s,
        "diff (B−A)      {:.4}  CI95 [{:.4}, {:.4}]",
        c.diff_mean, c.diff_ci95_lo, c.diff_ci95_hi
    );
    let _ = writeln!(s, "effect_size d   {:.3}", c.effect_size_d);
    let _ = writeln!(s, "verdict         {}", c.verdict.as_str());
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_表头与行数一致() {
        let cfg = crate::config::SimConfig {
            players: 20,
            days: 4,
            ..crate::config::SimConfig::default()
        };
        let m = crate::sim::run(&cfg, 0);
        let csv = day_csv(&m);
        let lines: usize = csv.trim_end().lines().count();
        assert_eq!(lines, 1 + m.day_stats.len());
        assert!(csv.starts_with("day,active,"));
    }

    #[test]
    fn json_往返字段完整() {
        let cfg = crate::config::SimConfig {
            players: 20,
            days: 3,
            ..crate::config::SimConfig::default()
        };
        let m = crate::sim::run(&cfg, 0);
        let json = to_json(&m);
        assert!(json.contains("\"config_hash\""));
        assert!(json.contains("\"retention_d7\""));
        assert!(json.contains("\"sink_ratio\""));
    }
}
