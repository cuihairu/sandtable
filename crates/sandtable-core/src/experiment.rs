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
#[derive(Debug, Clone, Serialize)]
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
}

impl MetricKey {
    pub const ALL: [MetricKey; 6] = [
        MetricKey::RetentionD7,
        MetricKey::RetentionD3,
        MetricKey::WinRate,
        MetricKey::GoldPerPlayer,
        MetricKey::PowerP50Final,
        MetricKey::ChurnRate,
    ];

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "retention_d7" | "d7" => MetricKey::RetentionD7,
            "retention_d3" | "d3" => MetricKey::RetentionD3,
            "win_rate" => MetricKey::WinRate,
            "gold_per_player" => MetricKey::GoldPerPlayer,
            "power_p50" => MetricKey::PowerP50Final,
            "churn_rate" => MetricKey::ChurnRate,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t表_查值() {
        assert_eq!(t_critical_975(1), 12.706);
        assert_eq!(t_critical_975(30), 2.042);
        assert_eq!(t_critical_975(100), 1.96);
        assert!(t_critical_975(0).is_infinite());
    }

    #[test]
    fn 摘要_常数序列区间退化为点() {
        let s = summarize(&[5.0; 8]);
        assert_eq!(s.mean, 5.0);
        assert_eq!(s.sd, 0.0);
        assert_eq!(s.ci95_lo, 5.0);
        assert_eq!(s.ci95_hi, 5.0);
    }

    #[test]
    fn 摘要_样本越大区间越窄() {
        let w1 = summarize(&[1.0, 3.0, 2.0, 4.0, 2.5, 3.5]);
        let w2 = summarize(&[
            1.0, 3.0, 2.0, 4.0, 2.5, 3.5, 2.2, 3.1, 2.8, 3.3, 1.9, 3.7, 2.6, 3.0, 2.4, 3.2,
        ]);
        assert!(w2.ci95_hi - w2.ci95_lo < w1.ci95_hi - w1.ci95_lo);
    }

    #[test]
    #[allow(non_snake_case)]
    fn 比较_B_全胜判_BHigher() {
        let a = [10.0, 10.5, 9.8, 10.2];
        let b = [12.0, 12.5, 11.8, 12.2];
        let c = compare("m", &a, &b);
        assert_eq!(c.verdict, Verdict::BHigher);
        assert_eq!(c.diff_mean, 2.0);
        assert!(c.effect_size_d > 0.0);
    }

    #[test]
    fn 比较_交叉噪声判_无显著差异() {
        let a = [10.0, 12.0, 9.0, 13.0, 11.0, 10.5, 12.5, 9.5];
        let b = [10.5, 11.5, 9.5, 12.5, 10.8, 11.0, 12.0, 10.0];
        let c = compare("m", &a, &b);
        assert_eq!(c.verdict, Verdict::NoDifference);
    }

    #[test]
    fn 指标键_解析与提取() {
        assert_eq!(MetricKey::parse("d7"), Some(MetricKey::RetentionD7));
        assert_eq!(MetricKey::parse("nope"), None);
        let m = crate::metrics::RunMetrics {
            schema_version: "1",
            model_version: "0.1.0",
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
            power_snapshots: vec![],
            cohort_stats: vec![],
            day_stats: vec![],
        };
        assert_eq!(MetricKey::RetentionD7.extract(&m), Some(0.8));
        assert_eq!(MetricKey::GoldPerPlayer.extract(&m), Some(5000.0));
    }

    /// 单 replicate:CI 退化为点估计(df=0 的 t 值是 ∞,须绕开 ∞·0 = NaN)
    #[test]
    fn 单_replicate_ci_退化为点估计() {
        let s = summarize(&[0.7]);
        assert_eq!(s.n, 1);
        assert_eq!(s.sd, 0.0);
        assert_eq!((s.ci95_lo, s.ci95_hi), (0.7, 0.7));
    }
}
