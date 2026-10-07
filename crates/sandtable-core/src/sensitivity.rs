//! 敏感性分析(文档 14 章):MVP 用 OAT 弹性,直接从 Grid 扫描数据提取,
//! 零额外仿真成本。
//!
//! 定义(中心差分,δ 默认 5%):
//!
//! ```text
//! E(p → Y) ≈ [Y(p₀+δp₀) − Y(p₀−δp₀)] / (2δ · Y₀)
//! ```
//!
//! 含义:p 变化 1%,Y 变化约 E%,无量纲,跨参数跨指标可比。重要度绑定
//! 单个指标,输出"参数 × 指标"矩阵,不做全局单一排序。
//!
//! 局限(文档 14 章写明):OAT 看不到交互作用;弹性只在基线邻域成立,
//! 不可外推;换指标须重算。
//!
//! 数据纪律:
//! - 只取"其他参数都在基线值上"的候选切片(单轴可分),没有切片如实报
//!   [`SensNote::NotIsolated`];
//! - 基线两侧无格点包夹报 [`SensNote::NoBracket`],不硬算;
//! - 格点不落在探针 p₀ ± δp₀ 上时,取两侧最近格点,实际步长按
//!   [`Elasticity::delta_eff`] 重报——区间端点可追溯;
//! - 弹性区间由两端指标的 CI 区间差保守传播,跨零标注不显著。

use serde::Serialize;

use crate::config::SimConfig;
use crate::experiment::{MetricKey, SampleStats};
use crate::registry::read_numeric;
use crate::sweep::{CandidateResult, SweepSpec};

/// 默认相对步长 δ(文档 14 章)。
pub const DEFAULT_DELTA: f64 = 0.05;

/// 数据可用性备注:不可算时如实标注,不静默给数。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SensNote {
    /// 正常中心差分
    Ok,
    /// 基线两侧无格点包夹(基线在网格边缘),无法差分
    NoBracket,
    /// 网格没有"其他参数都在基线值上"的候选切片,OAT 不可分
    NotIsolated,
    /// 指标缺失(天数不足 / 候选配置错误)
    MissingMetric,
    /// 参数或指标基线为 0,相对弹性无定义
    ZeroBaseline,
}

/// 一条弹性:参数 p 对指标 Y,在基线邻域。
#[derive(Debug, Clone, Serialize)]
pub struct Elasticity {
    /// 被扫参数(注册表路径)
    pub param: String,
    pub metric: MetricKey,
    /// 点估计 E ≈ [Y₊ − Y₋] / (2·δ_eff·Y₀)
    pub e: f64,
    /// 保守区间:由两端指标的 CI 区间差传播
    pub e_lo: f64,
    pub e_hi: f64,
    /// 实际使用的相对步长:(p₊ − p₋) / (2·|p₀|)
    pub delta_eff: f64,
    /// 区间不跨零(文档 14 章:跨零标注"不显著")
    pub significant: bool,
    pub note: SensNote,
}

impl Elasticity {
    /// 能否参与重要度排序。
    pub fn is_usable(&self) -> bool {
        self.note == SensNote::Ok
    }
}

/// 全参数 × 全指标的 OAT 弹性矩阵(文档 14 章输出形式)。
/// `delta` 为相对步长:探针 p₀ ± δ·p₀。
pub fn oat_elasticity(
    spec: &SweepSpec,
    base: &SimConfig,
    results: &[CandidateResult],
    delta: f64,
) -> Vec<Elasticity> {
    let mut out = Vec::new();
    for (i, p) in spec.parameters.iter().enumerate() {
        // 非数值扫轴进不到这里(spec::validate 只收数值路径);防御式标注
        let p0 = match read_numeric(base, &p.path) {
            Ok(v) => v,
            Err(_) => {
                push_all(&mut out, &p.path, SensNote::NotIsolated);
                continue;
            }
        };
        let slice = baseline_slice(spec, base, results, i);
        let bracket = if slice.len() < 2 {
            None
        } else {
            bracket(&slice, p0, delta)
        };
        let Some((gm, gp)) = bracket else {
            let note = if slice.is_empty() {
                SensNote::NotIsolated
            } else {
                SensNote::NoBracket
            };
            push_all(&mut out, &p.path, note);
            continue;
        };
        let span = gp - gm;
        let delta_eff = span / (2.0 * p0.abs());
        for key in MetricKey::ALL {
            let (Some(sm), Some(sp)) = (
                stat_at(spec, results, i, gm, key),
                stat_at(spec, results, i, gp, key),
            ) else {
                out.push(unusable(&p.path, key, SensNote::MissingMetric));
                continue;
            };
            // Y₀ 取基线点指标的线性插值(格点恰在基线上时即该点均值)
            let y0 = sm.mean + (sp.mean - sm.mean) * (p0 - gm) / span;
            if y0.abs() < 1e-12 {
                out.push(unusable(&p.path, key, SensNote::ZeroBaseline));
                continue;
            }
            let e = (sp.mean - sm.mean) / (2.0 * delta_eff * y0);
            // 区间差保守传播:ΔY ∈ [yp.lo − ym.hi, yp.hi − ym.lo];
            // 除以负 Y0 上下界翻转,统一重排
            let d_lo = (sp.ci95_lo - sm.ci95_hi) / (2.0 * delta_eff * y0);
            let d_hi = (sp.ci95_hi - sm.ci95_lo) / (2.0 * delta_eff * y0);
            let (e_lo, e_hi) = if d_lo <= d_hi {
                (d_lo, d_hi)
            } else {
                (d_hi, d_lo)
            };
            out.push(Elasticity {
                param: p.path.clone(),
                metric: key,
                e,
                e_lo,
                e_hi,
                delta_eff,
                significant: !(e_lo <= 0.0 && 0.0 <= e_hi),
                note: SensNote::Ok,
            });
        }
    }
    out
}

fn push_all(out: &mut Vec<Elasticity>, param: &str, note: SensNote) {
    for key in MetricKey::ALL {
        out.push(unusable(param, key, note));
    }
}

fn unusable(param: &str, metric: MetricKey, note: SensNote) -> Elasticity {
    Elasticity {
        param: param.to_string(),
        metric,
        e: f64::NAN,
        e_lo: f64::NAN,
        e_hi: f64::NAN,
        delta_eff: f64::NAN,
        significant: false,
        note,
    }
}

/// 相等判定带容差:网格生成(min + k·step)与配置读数的浮点路径不同。
fn approx(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0)
}

/// 第 axis 个参数轴上,"其他参数都在基线值上"的候选轴值(升序,去重)。
fn baseline_slice(
    spec: &SweepSpec,
    base: &SimConfig,
    results: &[CandidateResult],
    axis: usize,
) -> Vec<f64> {
    let baselines: Vec<Option<f64>> = spec
        .parameters
        .iter()
        .map(|p| read_numeric(base, &p.path).ok())
        .collect();
    let mut pts = Vec::new();
    'cand: for r in results {
        for (j, pj) in spec.parameters.iter().enumerate() {
            if j == axis {
                continue;
            }
            match (r.values.get(&pj.path), baselines[j]) {
                (Some(v), Some(b)) if approx(*v, b) => {}
                _ => continue 'cand,
            }
        }
        if let Some(v) = r.values.get(&spec.parameters[axis].path) {
            pts.push(*v);
        }
    }
    pts.sort_by(f64::total_cmp);
    pts.dedup_by(|a, b| *a == *b);
    pts
}

/// 基线两侧最近包夹格点:下侧取离 p₀(1−δ) 最近、上侧取离 p₀(1+δ) 最近的
/// 严格小于 / 大于 p₀ 的点。网格支持 δ 时就是探针;不支持时退化为相邻格点
/// (步长如实重报)。
fn bracket(slice: &[f64], p0: f64, delta: f64) -> Option<(f64, f64)> {
    let tm = p0 * (1.0 - delta);
    let tp = p0 * (1.0 + delta);
    let gm = slice.iter().filter(|g| **g < p0).copied().min_by(|a, b| {
        (a - tm)
            .abs()
            .total_cmp(&(b - tm).abs())
            .then(b.total_cmp(a))
    })?;
    let gp = slice.iter().filter(|g| **g > p0).copied().min_by(|a, b| {
        (a - tp)
            .abs()
            .total_cmp(&(b - tp).abs())
            .then(a.total_cmp(b))
    })?;
    Some((gm, gp))
}

/// 切片上轴值等于 v 的候选的指标统计。
fn stat_at<'a>(
    spec: &SweepSpec,
    results: &'a [CandidateResult],
    axis: usize,
    v: f64,
    key: MetricKey,
) -> Option<&'a SampleStats> {
    let path = &spec.parameters[axis].path;
    let r = results
        .iter()
        .find(|r| r.values.get(path).is_some_and(|x| approx(*x, v)))?;
    r.metric_stats
        .iter()
        .find(|(k, _)| *k == key)
        .map(|(_, s)| s)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sweep::{CandidateStatus, ParamRange, SweepMode};

    fn spec_1d() -> SweepSpec {
        SweepSpec {
            mode: SweepMode::Grid,
            parameters: vec![ParamRange {
                path: "model.warrior.attack".into(),
                min: 90.0,
                max: 110.0,
                step: 10.0,
            }],
            replicates: 2,
            samples: 0,
            targets: vec![],
        }
    }

    fn stats(mean: f64, ci: f64) -> SampleStats {
        SampleStats {
            n: 3,
            mean,
            sd: ci,
            ci95_lo: mean - ci,
            ci95_hi: mean + ci,
        }
    }

    fn result(values: &[(&str, f64)], y: f64, ci: f64) -> CandidateResult {
        let mut m = std::collections::BTreeMap::new();
        for (k, v) in values {
            m.insert((*k).to_string(), *v);
        }
        CandidateResult {
            values: m,
            status: CandidateStatus::Ok,
            metric_stats: vec![(MetricKey::WinRate, stats(y, ci))],
            target_outcomes: vec![],
        }
    }

    fn win_rate(out: Vec<Elasticity>) -> Elasticity {
        out.into_iter()
            .find(|x| x.metric == MetricKey::WinRate)
            .unwrap()
    }

    /// 线性指标 Y = 2p 的弹性闭式解:E = 1。
    /// 基线 100,δ=5%:探针 95/105 → 两侧最近格点 90/110,δ_eff = 20/200 = 0.1。
    #[test]
    fn 弹性_线性指标闭式解() {
        let spec = spec_1d();
        let base = SimConfig::default(); // attack = 100
        let results: Vec<CandidateResult> = [90.0, 100.0, 110.0]
            .iter()
            .map(|p| result(&[("model.warrior.attack", *p)], 2.0 * p, 1e-3))
            .collect();
        let out = oat_elasticity(&spec, &base, &results, DEFAULT_DELTA);
        assert_eq!(out.len(), MetricKey::ALL.len());
        let e = win_rate(out);
        assert_eq!(e.note, SensNote::Ok);
        assert!((e.delta_eff - 0.1).abs() < 1e-12, "δ_eff = {}", e.delta_eff);
        assert!((e.e - 1.0).abs() < 1e-9, "E = {}", e.e);
        assert!(e.significant, "CI 极窄应显著");
        assert!((e.e_lo - 1.0).abs() < 0.1 && (e.e_hi - 1.0).abs() < 0.1);
        assert!(e.is_usable());
    }

    /// 区间跨零 → 不显著(文档 14 章)。
    #[test]
    fn 弹性_区间跨零不显著() {
        let spec = spec_1d();
        let base = SimConfig::default();
        let results: Vec<CandidateResult> = [90.0, 100.0, 110.0]
            .iter()
            .map(|p| result(&[("model.warrior.attack", *p)], 2.0 * p, 500.0))
            .collect();
        let e = win_rate(oat_elasticity(&spec, &base, &results, DEFAULT_DELTA));
        assert!(!e.significant);
        assert!(e.e_lo <= 0.0 && 0.0 <= e.e_hi);
    }

    /// 基线在网格下边缘:无下侧格点 → NoBracket。
    #[test]
    fn 弹性_边缘无包夹() {
        let mut spec = spec_1d();
        spec.parameters[0].min = 100.0;
        spec.parameters[0].max = 120.0;
        let base = SimConfig::default(); // attack 100 = 网格最小点
        let results: Vec<CandidateResult> = [100.0, 110.0, 120.0]
            .iter()
            .map(|p| result(&[("model.warrior.attack", *p)], 2.0 * p, 1e-3))
            .collect();
        let e = win_rate(oat_elasticity(&spec, &base, &results, DEFAULT_DELTA));
        assert_eq!(e.note, SensNote::NoBracket);
        assert!(!e.is_usable());
    }

    /// 双维网格但另一维没有基线值:切片为空 → NotIsolated。
    #[test]
    fn 弹性_其他维不在基线_不可分() {
        let mut spec = spec_1d();
        spec.parameters.push(ParamRange {
            path: "model.warrior.defense".into(),
            min: 50.0,
            max: 70.0,
            step: 10.0,
        });
        let base = SimConfig::default(); // defense = 80,网格只到 70
        let mut results = Vec::new();
        for a in [90.0, 100.0, 110.0] {
            for d in [50.0, 60.0, 70.0] {
                results.push(result(
                    &[("model.warrior.attack", a), ("model.warrior.defense", d)],
                    2.0 * a,
                    1e-3,
                ));
            }
        }
        let e = win_rate(oat_elasticity(&spec, &base, &results, DEFAULT_DELTA));
        assert_eq!(e.note, SensNote::NotIsolated);
    }

    /// 另一维恰在基线上:切片可分,弹性照常算出。
    #[test]
    fn 弹性_其他维在基线_可分() {
        let mut spec = spec_1d();
        spec.parameters.push(ParamRange {
            path: "model.warrior.defense".into(),
            min: 80.0,
            max: 90.0,
            step: 10.0,
        });
        let base = SimConfig::default(); // defense = 80 是网格点
        let mut results = Vec::new();
        for a in [90.0, 100.0, 110.0] {
            for d in [80.0, 90.0] {
                results.push(result(
                    &[("model.warrior.attack", a), ("model.warrior.defense", d)],
                    2.0 * a,
                    1e-3,
                ));
            }
        }
        let e = win_rate(oat_elasticity(&spec, &base, &results, DEFAULT_DELTA));
        assert_eq!(e.note, SensNote::Ok, "d=80 切片应可分");
        assert!((e.e - 1.0).abs() < 1e-9);
    }

    /// 指标基线为 0:相对弹性无定义,如实标注。
    #[test]
    fn 弹性_零基线标注() {
        let spec = spec_1d();
        let base = SimConfig::default();
        let results: Vec<CandidateResult> = [90.0, 100.0, 110.0]
            .iter()
            .map(|p| result(&[("model.warrior.attack", *p)], 0.0, 1e-3))
            .collect();
        let e = win_rate(oat_elasticity(&spec, &base, &results, DEFAULT_DELTA));
        assert_eq!(e.note, SensNote::ZeroBaseline);
    }

    /// δ 显式传入:格点恰好落在探针上时 δ_eff == δ。
    #[test]
    fn 弹性_格点落在探针上() {
        // p0 = 100,δ = 0.1 → 探针 90/110,正是格点
        let spec = spec_1d();
        let base = SimConfig::default();
        let results: Vec<CandidateResult> = [90.0, 100.0, 110.0]
            .iter()
            .map(|p| result(&[("model.warrior.attack", *p)], 2.0 * p, 1e-3))
            .collect();
        let e = win_rate(oat_elasticity(&spec, &base, &results, 0.1));
        assert!((e.delta_eff - 0.1).abs() < 1e-12);
        assert!((e.e - 1.0).abs() < 1e-9);
    }
}
