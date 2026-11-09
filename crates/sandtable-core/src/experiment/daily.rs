//! 逐日跨 replicate 聚合:同一数值字段的样本统计 + 逐日序列输出(P2 内核面)。
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use super::stats::t_critical_975;

/// 逐日聚合的 CI 口径(P2):mean ± t(0.975, n−1) · sd / √n;
/// df > 30 复用实验层的正态近似 1.96。
pub const DAILY_CI_METHOD: &str = "mean ± t(0.975,n-1)*sample_sd/sqrt(n); df>30 uses 1.96";
/// 逐日聚合的样本标准差口径:分母 n−1(贝塞尔校正),不是总体 sd 的 n。
pub const DAILY_SD_METHOD: &str = "sample_sd: sqrt(sum((x-mean)^2)/(n-1))";

/// 同一数值字段跨 replicate 的样本统计。`Option` 字段只装真实观测;
/// 无定义 / 无观测时整键省略,禁 0 填空。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AggregateMetricStats {
    pub n: usize,
    pub mean: f64,
    pub sd: f64,
    pub ci95_lo: f64,
    pub ci95_hi: f64,
    pub min: f64,
    pub max: f64,
}

/// 一个公共日跨 replicate 的逐字段聚合。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DailyAggregatedDay {
    pub day: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alive_at_start: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub new_churned: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub churn_rate: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battles: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wins: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub win_rate: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gold_earned: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gold_spent: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sink_ratio: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gold_supply: Option<AggregateMetricStats>,
    /// 第 1 天无 G(d−1),inflation 无定义,整键缺席。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inflation: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub income_per_active: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spending_per_active: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mean_power: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub levelups: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upgrades: Option<AggregateMetricStats>,
}

/// 同一候选的多份已跑 `RunMetrics` 的逐日跨 replicate 聚合输出(P2 内核面)。
///
/// 置信带只跨 replicate 计算:输入 <2 份即显式拒绝,禁止给单次 `days.csv`
/// 套置信带。天数不一致时只保留公共日集合并把裁掉的天数原样报出。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DailyAggregation {
    pub replicates: usize,
    pub common_days: usize,
    pub trimmed_days: Vec<u32>,
    pub trim_warning: String,
    pub ci_method: &'static str,
    pub sd_method: &'static str,
    pub day_stats: Vec<DailyAggregatedDay>,
    /// RunMetrics 层的可选指标跨 replicate 统计;整组均为 None 时不输出该键。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_d1: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_d3: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_d7: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_d14: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retention_d30: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gacha_pulls_to_hit: Option<AggregateMetricStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loot_gold_per_player: Option<AggregateMetricStats>,
}

fn metric_stats(values: &[f64]) -> Option<AggregateMetricStats> {
    let n = values.len();
    if n == 0 {
        return None;
    }
    let mean = values.iter().sum::<f64>() / n as f64;
    let sd = if n == 1 {
        0.0
    } else {
        let ss: f64 = values.iter().map(|v| (v - mean).powi(2)).sum();
        (ss / (n - 1) as f64).sqrt()
    };
    let half = if n == 1 {
        0.0
    } else {
        t_critical_975(n - 1) * sd / (n as f64).sqrt()
    };
    Some(AggregateMetricStats {
        n,
        mean,
        sd,
        ci95_lo: mean - half,
        ci95_hi: mean + half,
        min: values.iter().cloned().fold(f64::INFINITY, f64::min),
        max: values.iter().cloned().fold(f64::NEG_INFINITY, f64::max),
    })
}

fn optional_metric_stats(values: &[Option<f64>]) -> Option<AggregateMetricStats> {
    let values: Vec<f64> = values.iter().flatten().copied().collect();
    (!values.is_empty())
        .then(|| metric_stats(&values))
        .flatten()
}

/// 逐日跨 replicate 聚合(P2 第一步的内核契约)。
///
/// `metrics` 必须是同一候选的多份已跑结果;replicates <2 返回可读错误,
/// 单次运行的逐日序列不得由这里产生 CI。各 replicate 的日集取交集,
/// 交外天数写入 `trimmed_days` 与 `trim_warning`,不静默对齐或补齐。
/// DayStat 的数值字段逐字段输出 n / mean / 样本 sd / CI₉₅ / min / max;
/// inflation 第 1 天无定义,该日字段缺席。
/// retention / gacha / loot 等 RunMetrics 可选指标只聚合真实 Some 值,
/// 全部缺失时整键缺席,不用 0 填空。
pub fn daily_aggregate_metrics(
    metrics: &[crate::metrics::RunMetrics],
) -> crate::Result<DailyAggregation> {
    if metrics.len() < 2 {
        return Err(crate::Error::Config(format!(
            "逐日跨 replicate 聚合至少需要 2 份结果(当前 {} 份);单次运行不得套置信带",
            metrics.len()
        )));
    }

    let day_sets = metrics
        .iter()
        .map(|m| m.day_stats.iter().map(|d| d.day).collect::<BTreeSet<_>>())
        .collect::<Vec<_>>();
    let all_days = day_sets
        .iter()
        .flat_map(BTreeSet::iter)
        .copied()
        .collect::<BTreeSet<_>>();
    let common_days = day_sets
        .iter()
        .fold(None, |acc, set| match acc {
            None => Some(set.clone()),
            Some(mut common) => {
                common.retain(|day| set.contains(day));
                Some(common)
            }
        })
        .unwrap_or_default();
    let trimmed_days = all_days
        .difference(&common_days)
        .copied()
        .collect::<Vec<_>>();
    let trim_warning = if trimmed_days.is_empty() {
        String::new()
    } else {
        format!(
            "各 replicate 的 days 长度不一致:公共天数取交 {} 天,裁掉 days {:?}(未补齐、未静默对齐)",
            common_days.len(),
            trimmed_days
        )
    };

    let day_stats = common_days
        .iter()
        .map(|day| {
            let stats = metrics
                .iter()
                .map(|m| {
                    m.day_stats.iter().find(|d| d.day == *day).ok_or_else(|| {
                        crate::Error::Config(format!(
                            "replicate {} 缺少公共 day {}",
                            m.replicate, day
                        ))
                    })
                })
                .collect::<crate::Result<Vec<_>>>()?;
            Ok::<_, crate::Error>(DailyAggregatedDay {
                day: *day,
                active: metric_stats(&stats.iter().map(|d| d.active as f64).collect::<Vec<_>>()),
                alive_at_start: metric_stats(
                    &stats
                        .iter()
                        .map(|d| d.alive_at_start as f64)
                        .collect::<Vec<_>>(),
                ),
                new_churned: metric_stats(
                    &stats
                        .iter()
                        .map(|d| d.new_churned as f64)
                        .collect::<Vec<_>>(),
                ),
                churn_rate: metric_stats(&stats.iter().map(|d| d.churn_rate).collect::<Vec<_>>()),
                battles: metric_stats(&stats.iter().map(|d| d.battles as f64).collect::<Vec<_>>()),
                wins: metric_stats(&stats.iter().map(|d| d.wins as f64).collect::<Vec<_>>()),
                win_rate: metric_stats(&stats.iter().map(|d| d.win_rate).collect::<Vec<_>>()),
                gold_earned: metric_stats(
                    &stats
                        .iter()
                        .map(|d| d.gold_earned as f64)
                        .collect::<Vec<_>>(),
                ),
                gold_spent: metric_stats(
                    &stats
                        .iter()
                        .map(|d| d.gold_spent as f64)
                        .collect::<Vec<_>>(),
                ),
                sink_ratio: metric_stats(&stats.iter().map(|d| d.sink_ratio).collect::<Vec<_>>()),
                gold_supply: metric_stats(
                    &stats
                        .iter()
                        .map(|d| d.gold_supply as f64)
                        .collect::<Vec<_>>(),
                ),
                inflation: if *day == 1 {
                    None
                } else {
                    metric_stats(&stats.iter().filter_map(|d| d.inflation).collect::<Vec<_>>())
                },
                income_per_active: metric_stats(
                    &stats
                        .iter()
                        .map(|d| d.income_per_active)
                        .collect::<Vec<_>>(),
                ),
                spending_per_active: metric_stats(
                    &stats
                        .iter()
                        .map(|d| d.spending_per_active)
                        .collect::<Vec<_>>(),
                ),
                mean_power: metric_stats(&stats.iter().map(|d| d.mean_power).collect::<Vec<_>>()),
                levelups: metric_stats(
                    &stats.iter().map(|d| d.levelups as f64).collect::<Vec<_>>(),
                ),
                upgrades: metric_stats(
                    &stats.iter().map(|d| d.upgrades as f64).collect::<Vec<_>>(),
                ),
            })
        })
        .collect::<crate::Result<_>>()?;

    Ok(DailyAggregation {
        replicates: metrics.len(),
        common_days: common_days.len(),
        trimmed_days,
        trim_warning,
        ci_method: DAILY_CI_METHOD,
        sd_method: DAILY_SD_METHOD,
        day_stats,
        retention_d1: optional_metric_stats(
            &metrics.iter().map(|m| m.retention_d1).collect::<Vec<_>>(),
        ),
        retention_d3: optional_metric_stats(
            &metrics.iter().map(|m| m.retention_d3).collect::<Vec<_>>(),
        ),
        retention_d7: optional_metric_stats(
            &metrics.iter().map(|m| m.retention_d7).collect::<Vec<_>>(),
        ),
        retention_d14: optional_metric_stats(
            &metrics.iter().map(|m| m.retention_d14).collect::<Vec<_>>(),
        ),
        retention_d30: optional_metric_stats(
            &metrics.iter().map(|m| m.retention_d30).collect::<Vec<_>>(),
        ),
        gacha_pulls_to_hit: optional_metric_stats(
            &metrics
                .iter()
                .map(|m| m.gacha_pulls_to_hit)
                .collect::<Vec<_>>(),
        ),
        loot_gold_per_player: optional_metric_stats(
            &metrics
                .iter()
                .map(|m| m.loot_gold_per_player)
                .collect::<Vec<_>>(),
        ),
    })
}
