//! 分布检验(文档 24 章 R1):随机原语的测试台,**不进仿真路径**——
//! 与 DuckDB 同纪律:事后验证,不进一次仿真运行。
//!
//! Pearson χ² = Σ(Oᵢ−Eᵢ)²/Eᵢ,df = 独立桶数 − 1;p ≥ α 通过。
//! 语义对照 SciPy `stats.chisquare`(非运行时依赖,口径交叉验证)。

use crate::Error;

/// 桶期望计数下限(Cochran 1954 经典规则):不满则先合并相邻桶,
/// 否则 χ² 近似失真、检验无效。
pub const MIN_EXPECTED: f64 = 5.0;

/// χ² 检验结果。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChiSquare {
    /// 检验统计量 Σ(Oᵢ−Eᵢ)²/Eᵢ
    pub stat: f64,
    /// 自由度(独立桶数 − 1)
    pub df: usize,
    /// p 值(χ² 生存函数在 stat 处的取值)
    pub p_value: f64,
}

impl ChiSquare {
    /// p ≥ α 通过。
    pub fn pass(&self, alpha: f64) -> bool {
        self.p_value >= alpha
    }
}

/// Pearson χ²:observed / expected 等长、至少 2 桶、期望全为正。
pub fn chi_square(observed: &[f64], expected: &[f64]) -> Result<ChiSquare, Error> {
    if observed.len() != expected.len() {
        return Err(Error::Config(format!(
            "观测桶 {} 与期望桶 {} 不等长",
            observed.len(),
            expected.len()
        )));
    }
    if observed.len() < 2 {
        return Err(Error::Config("至少 2 个桶才能做 χ² 检验".into()));
    }
    if expected.iter().any(|&e| e <= 0.0 || e.is_nan()) {
        return Err(Error::Config("期望计数必须为正".into()));
    }
    let stat: f64 = observed
        .iter()
        .zip(expected.iter())
        .map(|(&o, &e)| (o - e).powi(2) / e)
        .sum();
    let df = observed.len() - 1;
    Ok(ChiSquare {
        stat,
        df,
        p_value: p_value(stat, df),
    })
}

/// Cochran 桶合并:期望 < min_expected 的桶并入相邻桶(左优先,首桶并右),
/// 逐轮到全桶达标或不足 2 桶。合并后 df 相应下降。
pub fn merge_buckets(
    observed: &[f64],
    expected: &[f64],
    min_expected: f64,
) -> (Vec<f64>, Vec<f64>) {
    let mut o: Vec<f64> = observed.to_vec();
    let mut e: Vec<f64> = expected.to_vec();
    loop {
        if o.len() < 2 {
            break;
        }
        let Some(i) = e
            .iter()
            .enumerate()
            .filter(|(_, &v)| v < min_expected)
            .min_by(|(i, &v), (j, &w)| v.total_cmp(&w).then(i.cmp(j)))
            .map(|(i, _)| i)
        else {
            break;
        };
        let (keep, drop) = if i == 0 { (0usize, 1usize) } else { (i - 1, i) };
        o[keep] += o[drop];
        e[keep] += e[drop];
        o.remove(drop);
        e.remove(drop);
    }
    (o, e)
}

/// χ²(df) 生存函数:P(X ≥ stat) = Q(df/2, stat/2),Q 为正则化上不完全伽马。
pub fn p_value(stat: f64, df: usize) -> f64 {
    if df == 0 {
        return f64::NAN;
    }
    if stat <= 0.0 {
        return 1.0;
    }
    gammq(df as f64 / 2.0, stat / 2.0)
}

/// Q(a, x) = 1 − P(a, x):x < a+1 用级数(P),否则用连分数(Q)。
fn gammq(a: f64, x: f64) -> f64 {
    if x < a + 1.0 {
        1.0 - gammp(a, x)
    } else {
        gammp_cf(a, x)
    }
}

/// P(a, x) 级数展开(收敛域 x < a+1)。
fn gammp(a: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    let mut ap = a;
    let mut sum = 1.0 / a;
    let mut del = sum;
    for _ in 0..1000 {
        ap += 1.0;
        del *= x / ap;
        sum += del;
        if del.abs() < sum.abs() * 1e-15 {
            break;
        }
    }
    sum * (-x + a * x.ln() - ln_gamma(a)).exp()
}

/// Q(a, x) 连分数(Lentz 改良法,收敛域 x ≥ a+1)。
fn gammp_cf(a: f64, x: f64) -> f64 {
    const TINY: f64 = 1e-300;
    let mut b = x + 1.0 - a;
    let mut c = 1.0 / TINY;
    let mut d = 1.0 / b;
    let mut h = d;
    for i in 1..1000 {
        let an = -(i as f64) * (i as f64 - a);
        b += 2.0;
        d = an * d + b;
        if d.abs() < TINY {
            d = TINY;
        }
        c = b + an / c;
        if c.abs() < TINY {
            c = TINY;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < 1e-15 {
            break;
        }
    }
    h * (-x + a * x.ln() - ln_gamma(a)).exp()
}

/// ln Γ(x),x > 0.5:Lanczos g=7 近似(NR 系数,|ε| < 2×10⁻¹⁰)。
fn ln_gamma(x: f64) -> f64 {
    const COF: [f64; 6] = [
        76.180_091_729_471_46,
        -86.505_320_329_416_77,
        24.014_098_240_830_91,
        -1.231_739_572_450_155,
        0.120_865_097_386_617_9e-2,
        -0.539_523_938_495_3e-5,
    ];
    let y = x;
    let mut tmp = y + 5.5;
    tmp -= (y + 0.5) * tmp.ln();
    let mut ser = 1.000_000_000_190_015;
    for (i, &c) in COF.iter().enumerate() {
        ser += c / (y + 1.0 + i as f64);
    }
    -tmp + (2.506_628_274_631_000_5 * ser / y).ln()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 卡方临界值对照(标准 χ² 表):stat=3.8415/df=1 → p≈0.05;
    /// stat=10.828/df=1 → p≈0.001。p 值口径与 scipy chisquare 一致。
    #[test]
    fn p值_临界值对照() {
        let p1 = p_value(3.8415, 1);
        assert!((p1 - 0.05).abs() < 1e-3, "p = {p1}");
        let p2 = p_value(10.828, 1);
        assert!((p2 - 0.001).abs() < 1e-4, "p = {p2}");
        assert_eq!(p_value(0.0, 5), 1.0);
        assert!(p_value(5.991, 2) > 0.049 && p_value(5.991, 2) < 0.051);
    }

    #[test]
    fn 卡方_均匀通过_偏离失败() {
        // 完美均匀 → p = 1
        let chi = chi_square(&[500.0; 4], &[500.0; 4]).unwrap();
        assert!((chi.stat - 0.0).abs() < 1e-12);
        assert_eq!(chi.df, 3);
        assert!(chi.p_value > 0.999);
        // 轻微偏离仍通过 α=0.01
        let chi = chi_square(&[505.0, 495.0, 498.0, 502.0], &[500.0; 4]).unwrap();
        assert!(chi.pass(0.01), "轻偏离应过 α=0.01: p={}", chi.p_value);
        // 严重偏离 → 失败
        let chi = chi_square(&[800.0, 100.0, 50.0, 50.0], &[250.0; 4]).unwrap();
        assert!(!chi.pass(0.01), "重偏离应失败: p={}", chi.p_value);
    }

    #[test]
    fn 桶合并_期望不足则合并() {
        // 期望 2.0(< 5)的桶与左邻合并
        let (o, e) = merge_buckets(
            &[10.0, 10.0, 2.0, 20.0],
            &[10.0, 10.0, 2.0, 20.0],
            MIN_EXPECTED,
        );
        assert_eq!(o.len(), 3);
        assert_eq!(o, &[10.0, 12.0, 20.0]);
        assert!(
            e.iter().all(|&v| v >= MIN_EXPECTED),
            "合并后 {e:?} 仍有桶低于阈值"
        );
        // 全达标不合并
        let (o, e) = merge_buckets(&[1.0; 5], &[5.0; 5], MIN_EXPECTED);
        assert_eq!(o.len(), 5);
        assert_eq!(o, &[1.0; 5]);
        assert_eq!(e, &[5.0; 5]);
        // 极端:两桶都不足 → 合并到 1 桶(检验方应判样本不足)
        let (o, _e) = merge_buckets(&[3.0, 4.0], &[3.0, 4.0], MIN_EXPECTED);
        assert_eq!(o.len(), 1);
        assert_eq!(o, &[7.0]);
    }

    #[test]
    fn 卡方_输入校验() {
        assert!(chi_square(&[1.0], &[1.0]).is_err(), "单桶不可检验");
        assert!(chi_square(&[1.0, 2.0], &[1.0, 2.0, 3.0]).is_err(), "不等长");
        assert!(chi_square(&[1.0, 2.0], &[1.0, 0.0]).is_err(), "零期望");
        assert!(chi_square(&[1.0, 2.0], &[1.0, -1.0]).is_err(), "负期望");
    }

    #[test]
    fn 万次均匀采样_检验通过() {
        // R1 验收:万次均匀采样 χ² 全过(10 桶)
        use crate::rng::{DayRng, Purpose};
        let buckets = 10usize;
        let mut rng = DayRng::new(42, 7, 3);
        let mut obs = vec![0.0f64; buckets];
        for _ in 0..100_000 {
            let u = rng.draw(Purpose::Shuffle).f64();
            let b = (u * buckets as f64).floor() as usize;
            obs[b.min(buckets - 1)] += 1.0;
        }
        let exp = vec![10_000.0; buckets];
        let (o, e) = merge_buckets(&obs, &exp, MIN_EXPECTED);
        let chi = chi_square(&o, &e).unwrap();
        assert!(chi.pass(0.01), "均匀 χ² {} p={}", chi.stat, chi.p_value);
    }

    #[test]
    fn 偏离分布_万次采样_检验失败() {
        // 有偏采样(前 5 桶翻倍)应被 α=0.01 抓出
        use crate::rng::{DayRng, Purpose};
        let buckets = 10usize;
        let mut rng = DayRng::new(42, 7, 3);
        let mut obs = vec![0.0f64; buckets];
        for _ in 0..100_000 {
            let u = rng.draw(Purpose::Shuffle).f64();
            let biased = (u * 10.0).floor() as usize;
            let b = if biased < 5 { biased } else { biased - 5 };
            obs[b] += 1.0;
        }
        let exp = vec![10_000.0; buckets];
        let (o, e) = merge_buckets(&obs, &exp, MIN_EXPECTED);
        let chi = chi_square(&o, &e).unwrap();
        assert!(!chi.pass(0.01), "有偏分布应失败: p={}", chi.p_value);
    }
}
