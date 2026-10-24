//! 实验统计(文档 11/13/15 章)。
//!
//! 统计单位是 replicate:R 个 replicate 各产出一个指标值 m_r,对 {m_r}
//! 做 mean / sd / CI₉₅ = mean ± t(0.975, R−1) · sd / √R。t 临界值用硬编码
//! 表(df 1..=30),df > 30 退化为正态近似 1.96——足够的 replicates 下
//! 误差远小于样本噪声。
//!
//! A/B 比较:两臂同 replicate 用同一种子(CRN 配对),主报告配对差值的
//! 置信区间与标准化效应量 d = Δ / pooled_sd。

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use std::collections::BTreeSet;

/// t(0.975, df),df = 1..=30;越界用 1.96。
const T975: [f64; 30] = [
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160,
    2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056,
    2.052, 2.048, 2.045, 2.042,
];

pub fn t_critical_975(df: usize) -> f64 {
    if df == 0 {
        return f64::INFINITY;
    }
    if df <= 30 {
        T975[df - 1]
    } else {
        1.96
    }
}

/// 一组 replicate 值的摘要统计。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SampleStats {
    pub n: usize,
    pub mean: f64,
    pub sd: f64,
    pub ci95_lo: f64,
    pub ci95_hi: f64,
}

/// 对 replicate 值序列求 mean / sd / CI₉₅。n = 1 时 sd 与 CI 无定义,
/// sd 记 0、CI 退化为点估计(报告侧应提示加 replicates)。
pub fn summarize(values: &[f64]) -> SampleStats {
    let n = values.len();
    if n == 0 {
        return SampleStats {
            n: 0,
            mean: 0.0,
            sd: 0.0,
            ci95_lo: 0.0,
            ci95_hi: 0.0,
        };
    }
    let mean = values.iter().sum::<f64>() / n as f64;
    let sd = if n == 1 {
        0.0
    } else {
        let ss: f64 = values.iter().map(|v| (v - mean).powi(2)).sum();
        (ss / (n - 1) as f64).sqrt()
    };
    // n = 1:CI 退化为点估计(df=0 的 t 值是 ∞,∞·0 = NaN,须绕开)
    let half = if n == 1 {
        0.0
    } else {
        t_critical_975(n - 1) * sd / (n as f64).sqrt()
    };
    SampleStats {
        n,
        mean,
        sd,
        ci95_lo: mean - half,
        ci95_hi: mean + half,
    }
}

/// 比较结论(文档 13 章:基于置信区间,不是点估计)。
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
pub enum Verdict {
    /// B 的配对差 CI 完全在 0 以上
    BHigher,
    /// A 高于 B
    AHigher,
    /// CI 含 0,无显著差异
    NoDifference,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::BHigher => "B 高于 A(配对 CI 不含 0)",
            Verdict::AHigher => "A 高于 B(配对 CI 不含 0)",
            Verdict::NoDifference => "无显著差异(配对 CI 含 0)",
        }
    }
}

/// 一对臂在某指标上的比较结果。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Comparison {
    pub metric: String,
    pub arm_a: SampleStats,
    pub arm_b: SampleStats,
    /// 配对差值(B_r − A_r)的均值与 CI(CRN 配对)
    pub diff_mean: f64,
    pub diff_ci95_lo: f64,
    pub diff_ci95_hi: f64,
    /// 标准化效应量 d = Δ / pooled_sd
    pub effect_size_d: f64,
    pub verdict: Verdict,
}

/// 配对比较:输入两臂逐 replicate 的同指标值(顺序即 replicate 序号)。
pub fn compare(metric: &str, arm_a: &[f64], arm_b: &[f64]) -> Comparison {
    debug_assert_eq!(arm_a.len(), arm_b.len(), "两臂 replicate 数应一致");
    let diffs: Vec<f64> = arm_a.iter().zip(arm_b.iter()).map(|(a, b)| b - a).collect();
    let diff = summarize(&diffs);
    let sa = summarize(arm_a);
    let sb = summarize(arm_b);
    let pooled_sd = if arm_a.len() + arm_b.len() > 2 {
        let na = arm_a.len() as f64;
        let nb = arm_b.len() as f64;
        let num = (na - 1.0) * sa.sd.powi(2) + (nb - 1.0) * sb.sd.powi(2);
        (num / (na + nb - 2.0)).sqrt()
    } else {
        0.0
    };
    let effect = if pooled_sd > 0.0 {
        diff.mean / pooled_sd
    } else {
        0.0
    };
    let verdict = if diff.ci95_lo > 0.0 {
        Verdict::BHigher
    } else if diff.ci95_hi < 0.0 {
        Verdict::AHigher
    } else {
        Verdict::NoDifference
    };
    Comparison {
        metric: metric.to_string(),
        arm_a: sa,
        arm_b: sb,
        diff_mean: diff.mean,
        diff_ci95_lo: diff.ci95_lo,
        diff_ci95_hi: diff.ci95_hi,
        effect_size_d: effect,
        verdict,
    }
}

/// 可从 RunMetrics 提取的指标(比较的主指标)。
///
/// 序列化走 [`MetricKey::name`] / [`MetricKey::parse`](snake_case,如
/// `win_rate`),与 CSV 列名、sweep.json 里的约束指标名一致;反序列化
/// 接受 parse 的全部别名。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricKey {
    /// D7 留存(默认主指标)
    RetentionD7,
    /// D3 留存
    RetentionD3,
    /// 全程胜率
    WinRate,
    /// 人均金币产出(全程 / 玩家数)
    GoldPerPlayer,
    /// 期末快照 P50 Power
    PowerP50Final,
    /// 累计流失率
    ChurnRate,
    /// 抽卡期望抽数 E[T](gacha 未配置时为 None,不进比较)
    GachaPullsToHit,
    /// 人均掉落金币(docs/loot-settlement-design.md;loot 未配置时为
    /// None,不进比较)
    LootGoldPerPlayer,
}

impl MetricKey {
    pub const ALL: [MetricKey; 8] = [
        MetricKey::RetentionD7,
        MetricKey::RetentionD3,
        MetricKey::WinRate,
        MetricKey::GoldPerPlayer,
        MetricKey::PowerP50Final,
        MetricKey::ChurnRate,
        MetricKey::GachaPullsToHit,
        MetricKey::LootGoldPerPlayer,
    ];

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "retention_d7" | "d7" => MetricKey::RetentionD7,
            "retention_d3" | "d3" => MetricKey::RetentionD3,
            "win_rate" => MetricKey::WinRate,
            "gold_per_player" => MetricKey::GoldPerPlayer,
            "power_p50" => MetricKey::PowerP50Final,
            "churn_rate" => MetricKey::ChurnRate,
            "gacha_pulls_to_hit" => MetricKey::GachaPullsToHit,
            "loot_gold_per_player" => MetricKey::LootGoldPerPlayer,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            MetricKey::RetentionD7 => "retention_d7",
            MetricKey::RetentionD3 => "retention_d3",
            MetricKey::WinRate => "win_rate",
            MetricKey::GoldPerPlayer => "gold_per_player",
            MetricKey::PowerP50Final => "power_p50",
            MetricKey::ChurnRate => "churn_rate",
            MetricKey::GachaPullsToHit => "gacha_pulls_to_hit",
            MetricKey::LootGoldPerPlayer => "loot_gold_per_player",
        }
    }

    pub fn extract(self, m: &crate::metrics::RunMetrics) -> Option<f64> {
        match self {
            MetricKey::RetentionD7 => m.retention_d7,
            MetricKey::RetentionD3 => m.retention_d3,
            MetricKey::WinRate => Some(m.win_rate),
            MetricKey::GoldPerPlayer => Some(m.gold_earned_total as f64 / m.players.max(1) as f64),
            MetricKey::PowerP50Final => m.power_snapshots.last().map(|s| s.p50),
            MetricKey::ChurnRate => Some(m.churn_rate_total),
            MetricKey::GachaPullsToHit => m.gacha_pulls_to_hit,
            MetricKey::LootGoldPerPlayer => m.loot_gold_per_player,
        }
    }

    /// 可用性预检(审核整改 P1):对给定配置,该指标是否一定有值。
    /// 返回不可用原因;None = 可用。此前不可用指标在 run_candidate 里被
    /// 静默跳过(约束跟着消失、候选照常显示成功),现在在加载实验时
    /// 显式报错。
    pub fn unavailable_reason(self, cfg: &crate::config::SimConfig) -> Option<&'static str> {
        match self {
            MetricKey::RetentionD3 if cfg.days < 3 => {
                Some("retention_d3 需要 days ≥ 3,当前配置不足")
            }
            MetricKey::RetentionD7 if cfg.days < 7 => {
                Some("retention_d7 需要 days ≥ 7,当前配置不足")
            }
            MetricKey::GachaPullsToHit if cfg.gacha.is_none() => {
                Some("gacha_pulls_to_hit 需要 model.gacha 配置,当前未配置")
            }
            MetricKey::LootGoldPerPlayer if cfg.loot.is_none() => {
                Some("loot_gold_per_player 需要 model.loot 配置,当前未配置")
            }
            _ => None,
        }
    }
}

impl Serialize for MetricKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.name())
    }
}

impl<'de> Deserialize<'de> for MetricKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        MetricKey::parse(&s).ok_or_else(|| {
            serde::de::Error::custom(format!(
                "未知指标 {s}(可选:{})",
                MetricKey::ALL
                    .iter()
                    .map(|k| k.name())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })
    }
}

/// A/B 双臂 CRN 成对比较入口(WB-03.10):双臂配置 + 双臂**已跑**结果数组
/// 进内核,结论由 [`compare`] 直出——桥接层(wasm / 桌面)只做 YAML →
/// SimConfig 与 results JSON → RunMetrics 反序列化,统计判定全部在内核,
/// 前端不另算。
///
/// 成对前提全部在这里显式失败,不静默降级:
/// - 双臂 base_seed 必须一致(CRN 按 replicate 序号配对,种子错位则
///   成对差值无意义);
/// - 指标在任一臂不可用(天数不足 / gacha / loot 未配置,
///   [`MetricKey::unavailable_reason`])直接报错,不做单臂跳过;
/// - 双臂 replicate 数等长非零;
/// - 某 replicate 的 [`MetricKey::extract`] 为 None(该臂此指标不产数)
///   报错,不 0 填充(WB-03.02 空值语义)。
pub fn compare_arms(
    cfg_a: &crate::config::SimConfig,
    cfg_b: &crate::config::SimConfig,
    key: MetricKey,
    arm_a: &[crate::metrics::RunMetrics],
    arm_b: &[crate::metrics::RunMetrics],
) -> crate::Result<Comparison> {
    if cfg_a.base_seed != cfg_b.base_seed {
        return Err(crate::Error::Config(format!(
            "双臂 base_seed 不一致(base={} cand={}),CRN 成对比较要求同种子",
            cfg_a.base_seed, cfg_b.base_seed
        )));
    }
    let name = key.name();
    if let Some(reason) = key.unavailable_reason(cfg_a) {
        return Err(crate::Error::Config(format!(
            "指标 {name} 在 base 臂不可用:{reason}"
        )));
    }
    if let Some(reason) = key.unavailable_reason(cfg_b) {
        return Err(crate::Error::Config(format!(
            "指标 {name} 在 cand 臂不可用:{reason}"
        )));
    }
    if arm_a.is_empty() || arm_a.len() != arm_b.len() {
        return Err(crate::Error::Config(format!(
            "双臂 replicate 数不一致或为 0(base={} cand={}),CRN 成对要求等长非零",
            arm_a.len(),
            arm_b.len()
        )));
    }
    let extract_all = |arm: &[crate::metrics::RunMetrics]| -> crate::Result<Vec<f64>> {
        arm.iter()
            .enumerate()
            .map(|(i, m)| {
                key.extract(m).ok_or_else(|| {
                    crate::Error::Config(format!(
                        "指标 {name} 在 replicate {i} 不可用(extract None),\
                             不用 0 填充;检查该臂的快照日/系统配置"
                    ))
                })
            })
            .collect()
    };
    let vals_a = extract_all(arm_a)?;
    let vals_b = extract_all(arm_b)?;
    Ok(compare(name, &vals_a, &vals_b))
}

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
                    metric_stats(&stats.iter().map(|d| d.inflation).collect::<Vec<_>>())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t_table_lookup() {
        assert_eq!(t_critical_975(1), 12.706);
        assert_eq!(t_critical_975(30), 2.042);
        assert_eq!(t_critical_975(100), 1.96);
        assert!(t_critical_975(0).is_infinite());
    }

    #[test]
    fn summary_constant_series_point_interval() {
        let s = summarize(&[5.0; 8]);
        assert_eq!(s.mean, 5.0);
        assert_eq!(s.sd, 0.0);
        assert_eq!(s.ci95_lo, 5.0);
        assert_eq!(s.ci95_hi, 5.0);
    }

    #[test]
    fn summary_larger_sample_narrower_interval() {
        let w1 = summarize(&[1.0, 3.0, 2.0, 4.0, 2.5, 3.5]);
        let w2 = summarize(&[
            1.0, 3.0, 2.0, 4.0, 2.5, 3.5, 2.2, 3.1, 2.8, 3.3, 1.9, 3.7, 2.6, 3.0, 2.4, 3.2,
        ]);
        assert!(w2.ci95_hi - w2.ci95_lo < w1.ci95_hi - w1.ci95_lo);
    }

    #[test]
    #[allow(non_snake_case)]
    fn compare_b_wins_all_verdict_bhigher() {
        let a = [10.0, 10.5, 9.8, 10.2];
        let b = [12.0, 12.5, 11.8, 12.2];
        let c = compare("m", &a, &b);
        assert_eq!(c.verdict, Verdict::BHigher);
        assert_eq!(c.diff_mean, 2.0);
        assert!(c.effect_size_d > 0.0);
    }

    #[test]
    fn compare_crossing_noise_no_difference() {
        let a = [10.0, 12.0, 9.0, 13.0, 11.0, 10.5, 12.5, 9.5];
        let b = [10.5, 11.5, 9.5, 12.5, 10.8, 11.0, 12.0, 10.0];
        let c = compare("m", &a, &b);
        assert_eq!(c.verdict, Verdict::NoDifference);
    }

    #[test]
    fn metric_key_parse_and_extract() {
        assert_eq!(MetricKey::parse("d7"), Some(MetricKey::RetentionD7));
        assert_eq!(MetricKey::parse("nope"), None);
        let m = crate::metrics::RunMetrics {
            schema_version: "1".to_string(),
            model_version: "0.1.0".to_string(),
            config_hash: "x".into(),
            replicate: 0,
            seed: 0,
            players: 100,
            days: 30,
            day1_cohort: 100,
            retention_d1: Some(1.0),
            retention_d3: Some(0.9),
            retention_d7: Some(0.8),
            retention_d14: None,
            retention_d30: None,
            churn_total: 20,
            churn_rate_total: 0.2,
            win_rate: 0.9,
            gold_earned_total: 500_000,
            gold_spent_total: 0,
            whale_gold_share: 0.3,
            inflation_daily_mean: 0.0,
            inflation_last: 0.0,
            sink_ratio_mean: 0.0,
            gacha_pulls_to_hit: Some(31.0),
            loot_gold_per_player: Some(12.5),
            power_snapshots: vec![],
            cohort_stats: vec![],
            day_stats: vec![],
        };
        assert_eq!(MetricKey::RetentionD7.extract(&m), Some(0.8));
        assert_eq!(MetricKey::GoldPerPlayer.extract(&m), Some(5000.0));
        assert_eq!(MetricKey::GachaPullsToHit.extract(&m), Some(31.0));
        assert_eq!(MetricKey::LootGoldPerPlayer.extract(&m), Some(12.5));
        assert_eq!(
            MetricKey::parse("gacha_pulls_to_hit"),
            Some(MetricKey::GachaPullsToHit)
        );
        assert_eq!(
            MetricKey::parse("loot_gold_per_player"),
            Some(MetricKey::LootGoldPerPlayer)
        );
    }

    /// 单 replicate:CI 退化为点估计(df=0 的 t 值是 ∞,须绕开 ∞·0 = NaN)
    #[test]
    fn single_replicate_ci_point_estimate() {
        let s = summarize(&[0.7]);
        assert_eq!(s.n, 1);
        assert_eq!(s.sd, 0.0);
        assert_eq!((s.ci95_lo, s.ci95_hi), (0.7, 0.7));
    }

    // —— compare_arms(WB-03.10:A/B 桥的内核入口)——

    fn test_cfg(days: u32, attack: i64) -> crate::config::SimConfig {
        crate::config::SimConfig {
            players: 40,
            days,
            base_seed: 7,
            warrior: crate::config::WarriorConfig {
                attack,
                ..crate::config::WarriorConfig::default()
            },
            ..crate::config::SimConfig::default()
        }
    }

    fn kernel_arm(cfg: &crate::config::SimConfig, reps: u32) -> Vec<crate::metrics::RunMetrics> {
        (0..reps).map(|r| crate::sim::run(cfg, r)).collect()
    }

    /// 双臂同种子、指标可用:结论与手工 extract + compare 逐字段一致
    /// (桥接层契约 = 内核 compare 语义,不另立统计口径)。
    #[test]
    fn compare_arms_matches_manual_extract_and_compare() {
        let cfg_a = test_cfg(7, 100);
        let cfg_b = test_cfg(7, 140);
        let arm_a = kernel_arm(&cfg_a, 8);
        let arm_b = kernel_arm(&cfg_b, 8);
        let out = compare_arms(&cfg_a, &cfg_b, MetricKey::WinRate, &arm_a, &arm_b).unwrap();
        let manual: Vec<f64> = arm_a.iter().map(|m| m.win_rate).collect();
        let manual_b: Vec<f64> = arm_b.iter().map(|m| m.win_rate).collect();
        let expected = compare("win_rate", &manual, &manual_b);
        assert_eq!(out, expected);
        assert_eq!(out.metric, "win_rate");
        assert_eq!(out.arm_a.n, 8);
        assert_eq!(out.arm_b.n, 8);
    }

    /// 种子错位:CRN 成对前提破坏,显式拒绝。
    #[test]
    fn compare_arms_rejects_seed_mismatch() {
        let cfg_a = test_cfg(7, 100);
        let mut cfg_b = test_cfg(7, 140);
        cfg_b.base_seed = 99;
        let arm_a = kernel_arm(&cfg_a, 4);
        let arm_b = kernel_arm(&cfg_b, 4);
        let err = compare_arms(&cfg_a, &cfg_b, MetricKey::WinRate, &arm_a, &arm_b)
            .unwrap_err()
            .to_string();
        assert!(err.contains("base_seed 不一致"), "{err}");
    }

    /// 任一臂指标不可用(天数不足)→ 显式报错,不单臂跳过。
    #[test]
    fn compare_arms_rejects_unavailable_metric() {
        let cfg_a = test_cfg(2, 100);
        let cfg_b = test_cfg(2, 140);
        let arm_a = kernel_arm(&cfg_a, 4);
        let arm_b = kernel_arm(&cfg_b, 4);
        let err = compare_arms(&cfg_a, &cfg_b, MetricKey::RetentionD7, &arm_a, &arm_b)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("retention_d7") && err.contains("不可用"),
            "{err}"
        );
    }

    /// 长度为 0 / 不等长:等长非零前提,显式拒绝。
    #[test]
    fn compare_arms_rejects_length_mismatch_or_empty() {
        let cfg_a = test_cfg(7, 100);
        let cfg_b = test_cfg(7, 140);
        let arm_a = kernel_arm(&cfg_a, 4);
        let arm_b = kernel_arm(&cfg_b, 4);
        let err = compare_arms(&cfg_a, &cfg_b, MetricKey::WinRate, &arm_a[..3], &arm_b)
            .unwrap_err()
            .to_string();
        assert!(err.contains("replicate 数不一致或为 0"), "{err}");
        let err = compare_arms(&cfg_a, &cfg_b, MetricKey::WinRate, &[], &[])
            .unwrap_err()
            .to_string();
        assert!(err.contains("replicate 数不一致或为 0"), "{err}");
    }

    /// 某 replicate extract 为 None(此处:期末无 Power 快照,config 级
    /// unavailable_reason 查不出)→ 显式报错,不 0 填充(WB-03.02)。
    #[test]
    fn compare_arms_rejects_extract_none() {
        let cfg_a = test_cfg(7, 100);
        let cfg_b = test_cfg(7, 140);
        let mut arm_a = kernel_arm(&cfg_a, 2);
        let arm_b = kernel_arm(&cfg_b, 2);
        arm_a[1].power_snapshots.clear();
        let err = compare_arms(&cfg_a, &cfg_b, MetricKey::PowerP50Final, &arm_a, &arm_b)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("replicate 1") && err.contains("不用 0 填充"),
            "{err}"
        );
    }

    /// results JSON 回读契约(A/B 桥通道):kernel 序列化的结果数组原样
    /// 反序列化回 Vec<RunMetrics>,版本/分群 String 字段与数值逐字段一致;
    /// 序列化形状不因 owned 化改变。
    #[test]
    fn run_metrics_results_json_roundtrip() {
        let cfg = test_cfg(7, 100);
        let arm = kernel_arm(&cfg, 2);
        let json = serde_json::to_string(&arm).unwrap();
        let back: Vec<crate::metrics::RunMetrics> = serde_json::from_str(&json).unwrap();
        assert_eq!(back.len(), arm.len());
        for (orig, got) in arm.iter().zip(back.iter()) {
            assert_eq!(orig.schema_version, got.schema_version);
            assert_eq!(orig.model_version, got.model_version);
            assert_eq!(orig.win_rate, got.win_rate);
            assert_eq!(orig.day_stats.len(), got.day_stats.len());
            assert_eq!(orig.cohort_stats.len(), got.cohort_stats.len());
            assert_eq!(orig.cohort_stats[0].cohort, got.cohort_stats[0].cohort);
            assert_eq!(orig.power_snapshots.len(), got.power_snapshots.len());
        }
        assert_eq!(serde_json::to_string(&back).unwrap(), json);
    }

    // —— 逐日跨 replicate 聚合(P2 内核契约)——

    fn synthetic_run(
        replicate: u32,
        days: u32,
        retention_d3: Option<f64>,
    ) -> crate::metrics::RunMetrics {
        crate::metrics::RunMetrics {
            schema_version: crate::SCHEMA_VERSION.to_string(),
            model_version: crate::MODEL_VERSION.to_string(),
            config_hash: format!("rep-{replicate}"),
            replicate,
            seed: replicate as u64,
            players: 40,
            days,
            day1_cohort: 40,
            retention_d1: Some(1.0),
            retention_d3,
            retention_d7: None,
            retention_d14: None,
            retention_d30: None,
            churn_total: 0,
            churn_rate_total: 0.0,
            win_rate: 1.0,
            gold_earned_total: 0,
            gold_spent_total: 0,
            whale_gold_share: 0.0,
            inflation_daily_mean: 0.0,
            inflation_last: 0.0,
            sink_ratio_mean: 0.0,
            gacha_pulls_to_hit: None,
            loot_gold_per_player: None,
            power_snapshots: vec![],
            cohort_stats: vec![],
            day_stats: (1..=days)
                .map(|day| crate::metrics::DayStat {
                    day,
                    active: (((day - 1 + replicate) % 4) * 2) as u64,
                    alive_at_start: 40,
                    new_churned: 0,
                    churn_rate: 0.0,
                    battles: 4,
                    wins: 3,
                    win_rate: 0.75,
                    gold_earned: 100,
                    gold_spent: 50,
                    sink_ratio: 0.5,
                    gold_supply: 50,
                    inflation: if day == 1 { -1.0 } else { 0.25 },
                    income_per_active: 2.5,
                    spending_per_active: 1.25,
                    mean_power: 10.0 + day as f64,
                    levelups: 1,
                    upgrades: 1,
                })
                .collect(),
        }
    }

    /// replicates <2 明确拒绝:单次运行不得套置信带。
    #[test]
    fn daily_aggregate_rejects_single_replicate() {
        let err = daily_aggregate_metrics(&[]).unwrap_err().to_string();
        assert!(
            err.contains("至少需要 2 份") && err.contains("单次运行不得套置信带"),
            "{err}"
        );
        let err = daily_aggregate_metrics(&[synthetic_run(0, 4, Some(0.9))])
            .unwrap_err()
            .to_string();
        assert!(err.contains("当前 1 份"), "{err}");
    }

    /// 长度不一致按公共日集取交,交外天数显式报出且不补齐。
    #[test]
    fn daily_aggregate_uses_day_intersection_and_reports_trims() {
        let runs = [
            synthetic_run(0, 4, Some(0.9)),
            synthetic_run(1, 3, Some(0.8)),
            synthetic_run(2, 5, Some(0.7)),
        ];
        let out = daily_aggregate_metrics(&runs).unwrap();
        assert_eq!(out.replicates, 3);
        assert_eq!(out.common_days, 3);
        assert_eq!(out.trimmed_days, vec![4, 5]);
        assert!(out.trim_warning.contains("公共天数取交 3 天"), "{out:?}");
        assert!(out.trim_warning.contains("[4, 5]"), "{out:?}");
        assert_eq!(
            out.day_stats.iter().map(|d| d.day).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert!(
            out.day_stats
                .iter()
                .all(|d| d.active.as_ref().unwrap().n == 3),
            "每个公共日跨全部 replicate 聚合,不被天数长短影响"
        );
    }

    /// 可选 RunMetrics 字段真实 Some 才聚合;整组 None 时整键缺席,禁 0 填。
    #[test]
    fn daily_aggregate_keeps_optional_metrics_absent_when_unavailable() {
        let runs = [
            synthetic_run(0, 3, Some(0.9)),
            synthetic_run(1, 3, Some(0.7)),
        ];
        let json = serde_json::to_value(daily_aggregate_metrics(&runs).unwrap()).unwrap();
        assert_eq!(json["retention_d3"]["n"], 2);
        assert!(json.get("gacha_pulls_to_hit").is_none(), "{json}");
        assert!(json.get("loot_gold_per_player").is_none(), "{json}");
        assert!(json.get("retention_d30").is_none(), "{json}");
    }

    /// inflation 第 1 天无定义:该日整键缺席;其余字段 CI 与手算样本一致。
    #[test]
    fn daily_aggregate_matches_manual_sample_statistics() {
        let runs = (0..4)
            .map(|r| synthetic_run(r, 4, Some(0.5)))
            .collect::<Vec<_>>();
        let out = daily_aggregate_metrics(&runs).unwrap();
        let day1 = &out.day_stats[0];
        let day2 = &out.day_stats[1];
        assert!(
            day1.inflation.is_none(),
            "day1 inflation 无定义,须缺席而非 0 填"
        );
        assert!(day2.inflation.is_some(), "day2 inflation 有定义,须进统计");

        let active = day1.active.as_ref().unwrap();
        // replicate 0..4、day 1 的 active = ((day-1+replicate)%4)*2 → 值集 {0,2,4,6}
        // mean=3;Σ(x−mean)²=9+1+1+9=20;样本 sd = sqrt(20/(n-1=3)) ≈ 2.581988897471611
        let expected_sd = (20.0_f64 / 3.0).sqrt();
        let half = t_critical_975(3) * expected_sd / (4.0_f64.sqrt());
        assert_eq!(active.n, 4);
        assert_eq!(active.min, 0.0);
        assert_eq!(active.max, 6.0);
        assert!((active.mean - 3.0).abs() < 1e-12);
        assert!((active.sd - expected_sd).abs() < 1e-12);
        assert!((active.ci95_lo - (3.0 - half)).abs() < 1e-12);
        assert!((active.ci95_hi - (3.0 + half)).abs() < 1e-12);
        assert!(
            out.ci_method.contains("t(0.975,n-1)"),
            "{:?}",
            out.ci_method
        );
        assert!(out.sd_method.contains("/(n-1)"), "{:?}", out.sd_method);
    }
}
