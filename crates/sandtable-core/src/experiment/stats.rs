//! 样本统计与 A/B 判定:汇总统计(t_critical_975 / summarize / SampleStats)、
//! 比较结论(Verdict / Comparison / compare)。
use serde::{Deserialize, Serialize};

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

/// 对 replicate 值序列求 mean / sd / CI₉₅。n = 1 或全同序列时 CI 零宽退化
/// ([`SampleStats::ci_degraded`]),判定层必须显式标注,不得当显著结论外发。
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

impl SampleStats {
    /// CI 是否零宽退化:n<2(sd/half 无定义,记 0)或 CI 上界==下界。
    /// f64 下真正的零宽条件是 `ci95_lo == ci95_hi`:sd==0 只是其子集,
    /// 当 sd 极小但非零、均值很大使 mean±t·sd/√n 舍入塌缩成同值时也零宽,
    /// 用 sd==0 作代理会漏判(2026-11-05 审核发现)。零宽 CI 不含任何
    /// 抽样噪声信息,据此判「显著」等于把单点当置信区间(ST-AUD-01 / I-001)。
    pub fn ci_degraded(&self) -> bool {
        self.n < 2 || self.ci95_lo == self.ci95_hi
    }
}

/// 比较结论(文档 13 章:基于置信区间,不是点估计)。
/// Deserialize:comparison.json 是两向契约,壳层按同结构读回。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub enum Verdict {
    /// B 的配对差 CI 完全在 0 以上
    BHigher,
    /// A 高于 B
    AHigher,
    /// CI 含 0,无显著差异
    NoDifference,
    /// CI 零宽退化(n<2 或配对差零方差):样本不含抽样噪声信息,
    /// 无法下任何统计结论(ST-AUD-01:不得冒充「显著」外发)
    InsufficientEvidence,
}

impl Verdict {
    pub fn as_str(self) -> &'static str {
        match self {
            Verdict::BHigher => "B 高于 A(配对 CI 不含 0)",
            Verdict::AHigher => "A 高于 B(配对 CI 不含 0)",
            Verdict::NoDifference => "无显著差异(配对 CI 含 0)",
            Verdict::InsufficientEvidence => {
                "证据不足(CI 零宽退化:replicates < 2 或配对差零方差,请加 replicates)"
            }
        }
    }
}

/// 一对臂在某指标上的比较结果。
/// Deserialize:comparison.json 是两向契约,壳层(workbook 导出)按同结构读回。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Comparison {
    pub metric: String,
    pub arm_a: SampleStats,
    pub arm_b: SampleStats,
    /// 配对差值(B_r − A_r)的均值与 CI(CRN 配对)
    pub diff_mean: f64,
    pub diff_ci95_lo: f64,
    pub diff_ci95_hi: f64,
    /// 标准化配对效应量 d_z = Δ / s_d(配对差序列均值 / 标准差;
    /// 与配对差 CI 同源,独立双样本 pooled_sd 与配对纪律冲突已被
    /// ST-AUD-05 移除)
    pub effect_size_d: f64,
    /// CI 零宽退化(n<2 或配对差零方差):此时 verdict 恒为
    /// InsufficientEvidence,CI/均值仅作记录,不构成统计结论。
    /// 旧 comparison.json 缺该字段或已按旧口径(sd==0)误写为 false 时,
    /// 反序列化按 diff CI 零宽重推导,避免「单点当置信区间」误判读回
    /// (2026-11-05 审核发现 7)。
    #[serde(default)]
    pub degraded: bool,
    pub verdict: Verdict,
}

impl<'de> serde::Deserialize<'de> for Comparison {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(serde::Deserialize)]
        struct Raw {
            metric: String,
            arm_a: SampleStats,
            arm_b: SampleStats,
            diff_mean: f64,
            diff_ci95_lo: f64,
            diff_ci95_hi: f64,
            effect_size_d: f64,
            #[serde(default)]
            degraded: Option<bool>,
            verdict: Verdict,
        }
        let raw = Raw::deserialize(deserializer)?;
        // 真正的零宽退化条件是 diff CI 上下界相等(不依赖 sd 代理);
        // 显式字段存在且非退化时尊重显式值,否则按 CI 重推导;退化时
        // verdict 一并重标 InsufficientEvidence,避免旧 BHigher 误判读回。
        let degraded = raw.degraded.unwrap_or(false) || raw.diff_ci95_lo == raw.diff_ci95_hi;
        let verdict = if degraded {
            Verdict::InsufficientEvidence
        } else {
            raw.verdict
        };
        Ok(Comparison {
            metric: raw.metric,
            arm_a: raw.arm_a,
            arm_b: raw.arm_b,
            diff_mean: raw.diff_mean,
            diff_ci95_lo: raw.diff_ci95_lo,
            diff_ci95_hi: raw.diff_ci95_hi,
            effect_size_d: raw.effect_size_d,
            degraded,
            verdict,
        })
    }
}

/// 配对比较:输入两臂逐 replicate 的同指标值(顺序即 replicate 序号)。
pub fn compare(metric: &str, arm_a: &[f64], arm_b: &[f64]) -> Comparison {
    debug_assert_eq!(arm_a.len(), arm_b.len(), "两臂 replicate 数应一致");
    let diffs: Vec<f64> = arm_a.iter().zip(arm_b.iter()).map(|(a, b)| b - a).collect();
    let diff = summarize(&diffs);
    let sa = summarize(arm_a);
    let sb = summarize(arm_b);
    // ST-AUD-05 / I-005:CRN 配对设计的效应量口径必须与配对差 CI 同源
    // (d_z = Δ / s_d)。旧 pooled_sd 是独立双样本公式,ρ→1 时 s_d → |sa−sb|
    // 但 pooled_sd 不随之塌缩,系统性低估配对效应且口径与 CI 分叉。
    let effect = if diff.sd > 0.0 {
        diff.mean / diff.sd
    } else {
        0.0
    };
    // ST-AUD-01 / I-001:判定前先查退化。配对差 CI 零宽(n<2 或 sd==0)时
    // ci95_lo == ci95_hi,符号判定必然落在「CI 不含 0」分支,把单点当置信
    // 区间冒充显著。退化时显式标证据不足,CI 数值仅作记录。
    let degraded = diff.ci_degraded();
    let verdict = if degraded {
        Verdict::InsufficientEvidence
    } else if diff.ci95_lo > 0.0 {
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
        degraded,
        verdict,
    }
}
