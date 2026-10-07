//! 平衡推荐(文档 15 章):从 Sweep + 约束判定 + 敏感性输出"推荐区间",
//! 不做自动寻优。
//!
//! MVP 只做单参数轴(文档 15 章红线):对扫轴取每条 hard 约束的可行段
//! (格点逐点判定 + 段端线性插值),全部 hard 约束可行段取交集;区间端点
//! 标注是否插值所得——"96~101"这样的连续区间不可能直接从格点读出。
//! 多参数联合可行域需要代理模型或优化器,属后续阶段。
//!
//! Confidence 是判据不是形容词(文档 15 章):
//! - High:可行区间存在,轴上无 BORDERLINE,且各 hard 指标弹性显著;
//! - Medium:可行,但存在 BORDERLINE 约束或端点弹性不显著;
//! - Low:无可行点或交集为空。

use serde::Serialize;

use crate::config::SimConfig;
use crate::registry::read_numeric;
use crate::sensitivity::{baseline_slice, oat_elasticity, stat_at, DEFAULT_DELTA};
use crate::sweep::{judge, CandidateResult, ConstraintVerdict, SweepSpec, Target, TargetKind};

/// 置信度判据(文档 15 章)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

impl Confidence {
    pub fn as_str(self) -> &'static str {
        match self {
            Confidence::High => "High",
            Confidence::Medium => "Medium",
            Confidence::Low => "Low",
        }
    }
}

/// 单轴推荐结果。区间端点可追溯:[`Recommendation::interpolated`] 标注
/// 端点是否插值所得,理由里给出端点对应的格点对。
#[derive(Debug, Clone, Serialize)]
pub struct Recommendation {
    /// 被推荐的参数轴(注册表路径)
    pub param: String,
    /// 基线值(当前配置读数)
    pub baseline: f64,
    /// 可行区间(端点可插值所得);None = hard 约束无可行点或交集为空
    pub interval: Option<(f64, f64)>,
    /// [下端点, 上端点] 是否插值所得(格点恰在边界上 / 轴边缘时为 false)
    pub interpolated: [bool; 2],
    pub confidence: Confidence,
    /// 生成理由(人读;端点与格点对应关系在列)
    pub reasons: Vec<String>,
}

/// 一条约束的可行段:轴上的连续 pass 分量,取离基线最近的那个。
#[derive(Debug, Clone)]
struct Segment {
    /// 无可行点
    empty: bool,
    lo: f64,
    hi: f64,
    interpolated: [bool; 2],
    /// 轴上 BORDERLINE 格点数(置信度判据输入)
    borderline: usize,
}

/// 对第 `axis` 个扫轴做插值推荐(文档 15 章)。soft 目标不参与可行域,
/// 仅在理由中提示。
pub fn recommend_axis(
    spec: &SweepSpec,
    base: &SimConfig,
    results: &[CandidateResult],
    axis: usize,
) -> Recommendation {
    let path = &spec.parameters[axis].path;
    let baseline = read_numeric(base, path).unwrap_or(f64::NAN);
    let mut reasons = Vec::new();
    let hard: Vec<&Target> = spec
        .targets
        .iter()
        .filter(|t| t.kind == TargetKind::Hard)
        .collect();
    let soft_n = spec.targets.len() - hard.len();
    if soft_n > 0 {
        reasons.push(format!(
            "{soft_n} 条 soft 目标不参与可行域(加权排序属后续阶段)"
        ));
    }
    let none = |reasons: Vec<String>| Recommendation {
        param: path.clone(),
        baseline,
        interval: None,
        interpolated: [false, false],
        confidence: Confidence::Low,
        reasons,
    };

    if hard.is_empty() {
        return none(reasons);
    }
    let axis_vals = baseline_slice(spec, base, results, axis);
    if axis_vals.is_empty() {
        reasons.push("轴上没有基线切片候选(其他维不在基线值上)".into());
        return none(reasons);
    }

    // 每条 hard 约束的可行段
    let mut segments = Vec::new();
    for t in &hard {
        let seg = feasible_segment(spec, results, axis, t, &axis_vals, baseline);
        let bounds = match (t.min, t.max) {
            (Some(min), Some(max)) => format!("[{min}, {max}]"),
            (Some(min), None) => format!("≥ {min}"),
            (None, Some(max)) => format!("≤ {max}"),
            (None, None) => "无界".into(),
        };
        if seg.empty {
            reasons.push(format!(
                "「{}」目标 {}:轴范围内无可行点(CI 均不完全在界内)",
                t.metric.name(),
                bounds
            ));
        } else {
            let end = |b: bool| if b { "插值所得" } else { "格点" };
            reasons.push(format!(
                "「{}」目标 {}:可行段 [{:.6}, {:.6}](下端{},上端{})",
                t.metric.name(),
                bounds,
                seg.lo,
                seg.hi,
                end(seg.interpolated[0]),
                end(seg.interpolated[1])
            ));
        }
        if seg.borderline > 0 {
            reasons.push(format!(
                "「{}」在 {borderline} 个格点上 BORDERLINE(CI 与边界相交,建议加 replicates 收窄)",
                t.metric.name(),
                borderline = seg.borderline
            ));
        }
        segments.push(seg);
    }

    // hard 约束可行段取交集
    let mut interval = Some((f64::NEG_INFINITY, f64::INFINITY));
    let mut interpolated = [false, false];
    for seg in &segments {
        if seg.empty {
            interval = None;
            break;
        }
        let (ilo, ihi) = interval.unwrap();
        let (nlo, nhi) = (ilo.max(seg.lo), ihi.min(seg.hi));
        // 记录提供端点的段,插值标注随之
        if seg.lo >= ilo {
            interpolated[0] = seg.interpolated[0];
        }
        if seg.hi <= ihi {
            interpolated[1] = seg.interpolated[1];
        }
        interval = Some((nlo, nhi));
    }
    if let Some((lo, hi)) = interval {
        if lo > hi {
            reasons.push(format!(
                "各约束可行段交集为空(下界最大 {:.6} > 上界最小 {:.6})",
                lo, hi
            ));
            interval = None;
        }
    }
    let interval = match interval {
        Some((lo, hi)) if hi >= lo => Some((lo, hi)),
        _ => {
            return none(reasons);
        }
    };

    // 置信度判据(文档 15 章)
    let any_borderline = segments.iter().any(|s| s.borderline > 0);
    let elas = oat_elasticity(spec, base, results, DEFAULT_DELTA);
    let mut support_missing: Vec<&str> = Vec::new();
    for t in &hard {
        let ok = elas.iter().any(|e| {
            e.param == **path_for(t, spec, axis)
                && e.metric == t.metric
                && e.is_usable()
                && e.significant
        });
        if !ok {
            support_missing.push(t.metric.name());
        }
    }
    let confidence = if !any_borderline && support_missing.is_empty() {
        Confidence::High
    } else {
        if !support_missing.is_empty() {
            reasons.push(format!(
                "弹性不显著或缺失:{}(区间端点支撑不足)",
                support_missing.join("、")
            ));
        }
        Confidence::Medium
    };

    Recommendation {
        param: path.clone(),
        baseline,
        interval,
        interpolated,
        confidence,
        reasons,
    }
}

/// 该约束目标指标对应的弹性应落在哪条扫轴上(当前就是被推荐的轴)。
fn path_for<'a>(_t: &Target, spec: &'a SweepSpec, axis: usize) -> &'a String {
    &spec.parameters[axis].path
}

/// 单约束可行段:轴上的 pass 分量,取离基线最近的分量;段端在
/// pass/非 pass 相邻格点之间线性插值(插值对象是越界侧的统计序列)。
fn feasible_segment(
    spec: &SweepSpec,
    results: &[CandidateResult],
    axis: usize,
    t: &Target,
    axis_vals: &[f64],
    baseline: f64,
) -> Segment {
    let judged: Vec<Option<ConstraintVerdict>> = axis_vals
        .iter()
        .map(|v| stat_at(spec, results, axis, *v, t.metric).map(|s| judge(t, s)))
        .collect();
    let borderline = judged
        .iter()
        .filter(|v| **v == Some(ConstraintVerdict::Borderline))
        .count();
    let empty = Segment {
        empty: true,
        lo: f64::NAN,
        hi: f64::NAN,
        interpolated: [false, false],
        borderline,
    };
    // 锚点:离基线最近的 pass 格点
    let Some(anchor) = judged
        .iter()
        .enumerate()
        .filter(|(_, v)| **v == Some(ConstraintVerdict::Pass))
        .min_by(|(i, _a), (j, _b)| {
            axis_vals[*i]
                .abs_sub_to(baseline)
                .total_cmp(&axis_vals[*j].abs_sub_to(baseline))
                .then(i.cmp(j))
        })
        .map(|(i, _)| i)
    else {
        return empty;
    };
    // 向两侧扩到 pass 分量端点
    let mut l = anchor;
    while l > 0 && judged[l - 1] == Some(ConstraintVerdict::Pass) {
        l -= 1;
    }
    let mut r = anchor;
    while r + 1 < judged.len() && judged[r + 1] == Some(ConstraintVerdict::Pass) {
        r += 1;
    }
    // 下端点:分量外左侧格点与分量内格点之间插值越界侧统计的边界穿越
    let lo = if l == 0 {
        (axis_vals[0], false)
    } else {
        (
            crossing(
                axis_vals[l - 1],
                axis_vals[l],
                spec,
                results,
                axis,
                t,
                t.min.map(|m| (Side::Lo, m)),
            ),
            true,
        )
    };
    let hi = if r + 1 == judged.len() {
        (axis_vals[axis_vals.len() - 1], false)
    } else {
        (
            crossing(
                axis_vals[r + 1],
                axis_vals[r],
                spec,
                results,
                axis,
                t,
                t.max.map(|m| (Side::Hi, m)),
            ),
            true,
        )
    };
    Segment {
        empty: false,
        lo: lo.0,
        hi: hi.0,
        interpolated: [lo.1, hi.1],
        borderline,
    }
}

#[derive(Clone, Copy)]
enum Side {
    /// ci95_lo 穿越 target.min
    Lo,
    /// ci95_hi 穿越 target.max
    Hi,
}

/// 在格点 p_out(不可行侧)与 p_in(可行侧)之间,线性插值统计序列
/// (ci95_lo 或 ci95_hi)穿越边界值的参数位置。退线(两端统计相等)回退
/// 到可行侧格点(标注不插值)。
fn crossing(
    p_out: f64,
    p_in: f64,
    spec: &SweepSpec,
    results: &[CandidateResult],
    axis: usize,
    t: &Target,
    probe: Option<(Side, f64)>,
) -> f64 {
    let Some((side, bound)) = probe else {
        // 单侧无界:以格点为端(该侧不可行只可能来自另一侧;MVP 取格点)
        return p_in;
    };
    let get = |p: f64| {
        stat_at(spec, results, axis, p, t.metric)
            .map(|s| match side {
                Side::Lo => s.ci95_lo,
                Side::Hi => s.ci95_hi,
            })
            .unwrap_or(f64::NAN)
    };
    let v_out = get(p_out);
    let v_in = get(p_in);
    if !v_out.is_finite() || !v_in.is_finite() || (v_out - v_in).abs() < 1e-15 {
        return p_in;
    }
    let frac = (bound - v_out) / (v_in - v_out);
    // clamp 到格点间(数值噪声防护)
    let frac = frac.clamp(0.0, 1.0);
    p_out + frac * (p_in - p_out)
}

trait AbsSubTo {
    fn abs_sub_to(self, t: f64) -> f64;
}

impl AbsSubTo for f64 {
    fn abs_sub_to(self, t: f64) -> f64 {
        (self - t).abs()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::experiment::{MetricKey, SampleStats};
    use crate::sweep::{CandidateStatus, ParamRange, SweepMode};
    use std::collections::BTreeMap;

    /// 轴 90..110 step 5;win_rate 均值 = 0.45 + 0.005·(p − 90),
    /// CI 半宽 1e-4。基线 100。
    fn setup() -> (SweepSpec, SimConfig, Vec<CandidateResult>) {
        let spec = SweepSpec {
            mode: SweepMode::Grid,
            parameters: vec![ParamRange {
                path: "model.warrior.attack".into(),
                min: 90.0,
                max: 110.0,
                step: 5.0,
            }],
            replicates: 4,
            samples: 0,
            targets: vec![],
        };
        let base = SimConfig::default();
        let results: Vec<CandidateResult> = [90.0, 95.0, 100.0, 105.0, 110.0]
            .iter()
            .map(|p| {
                let mean = 0.45 + 0.005 * (p - 90.0);
                let mut m = BTreeMap::new();
                m.insert("model.warrior.attack".to_string(), *p);
                CandidateResult {
                    values: m,
                    status: CandidateStatus::Ok,
                    metric_stats: vec![(
                        MetricKey::WinRate,
                        SampleStats {
                            n: 4,
                            mean,
                            sd: 1e-4,
                            ci95_lo: mean - 1e-4,
                            ci95_hi: mean + 1e-4,
                        },
                    )],
                    target_outcomes: vec![],
                }
            })
            .collect();
        (spec, base, results)
    }

    fn target(min: f64, max: f64) -> Target {
        Target {
            metric: MetricKey::WinRate,
            min: Some(min),
            max: Some(max),
            kind: TargetKind::Hard,
        }
    }

    /// 线性可行段插值:目标 [0.46, 0.54] → 区间 (92.02, 107.98),端点插值,
    /// 弹性显著且无 BORDERLINE → High。
    #[test]
    fn 推荐_线性插值端点与高置信() {
        let (mut spec, base, results) = setup();
        spec.targets = vec![target(0.46, 0.54)];
        let rec = recommend_axis(&spec, &base, &results, 0);
        assert_eq!(rec.confidence, Confidence::High, "{:?}", rec.reasons);
        let (lo, hi) = rec.interval.expect("应有可行区间");
        assert!((lo - 92.02).abs() < 1e-6, "lo = {lo}");
        assert!((hi - 107.98).abs() < 1e-6, "hi = {hi}");
        assert_eq!(rec.interpolated, [true, true]);
        assert!((rec.baseline - 100.0).abs() < 1e-12);
        // 端点可追溯:理由里有插值标注
        assert!(rec
            .reasons
            .iter()
            .any(|r| r.contains("插值所得") && r.contains("可行段")));
    }

    /// 无可行点 → 区间 None + Low。
    #[test]
    fn 推荐_无可行点_低置信() {
        let (mut spec, base, results) = setup();
        spec.targets = vec![target(0.9, 1.0)];
        let rec = recommend_axis(&spec, &base, &results, 0);
        assert!(rec.interval.is_none());
        assert_eq!(rec.confidence, Confidence::Low);
        assert!(rec.reasons.iter().any(|r| r.contains("无可行点")));
    }

    /// 有 BORDERLINE 格点 → Medium(区间仍可行)。
    #[test]
    fn 推荐_borderline_降为中置信() {
        let (mut spec, base, results) = setup();
        // min = 0.47505:格点 95 的 CI [0.4749, 0.4751] 与下界相交 → BORDERLINE
        spec.targets = vec![target(0.47505, 0.6)];
        let rec = recommend_axis(&spec, &base, &results, 0);
        let (lo, hi) = rec.interval.expect("100/105/110 应可行");
        assert!((lo - 95.03).abs() < 1e-6, "lo = {lo}");
        assert!((hi - 110.0).abs() < 1e-12, "hi = {hi}(轴边缘,格点)");
        assert_eq!(rec.interpolated, [true, false]);
        assert_eq!(rec.confidence, Confidence::Medium, "{:?}", rec.reasons);
        assert!(rec.reasons.iter().any(|r| r.contains("BORDERLINE")));
    }

    /// soft 目标不参与可行域(即使它无处可行)。
    #[test]
    fn 推荐_soft_不参与可行域() {
        let (mut spec, base, results) = setup();
        let mut soft = target(0.9, 1.0);
        soft.kind = TargetKind::Soft;
        spec.targets = vec![target(0.46, 0.54), soft];
        let rec = recommend_axis(&spec, &base, &results, 0);
        assert!(rec.interval.is_some());
        assert!(rec.reasons.iter().any(|r| r.contains("soft")));
    }

    /// 两条 hard 约束可行段不相交 → 交集为空 → Low。
    #[test]
    fn 推荐_交集为空_低置信() {
        let (mut spec, base, results) = setup();
        // t1 可行段 ≈ [90, 95.98],t2 可行段 ≈ [104.02, 110]
        spec.targets = vec![target(0.0, 0.48), target(0.52, 1.0)];
        let rec = recommend_axis(&spec, &base, &results, 0);
        assert!(rec.interval.is_none());
        assert_eq!(rec.confidence, Confidence::Low);
        assert!(rec.reasons.iter().any(|r| r.contains("交集为空")));
    }

    /// 单侧约束(max 侧)插值:目标 [无下界, 0.48] → 上端插值、下端轴边。
    #[test]
    fn 推荐_单侧约束_端点混合() {
        let (mut spec, base, results) = setup();
        spec.targets = vec![Target {
            metric: MetricKey::WinRate,
            min: None,
            max: Some(0.48),
            kind: TargetKind::Hard,
        }];
        let rec = recommend_axis(&spec, &base, &results, 0);
        let (lo, hi) = rec.interval.expect("应有可行区间");
        assert!((lo - 90.0).abs() < 1e-12, "lo = {lo}(轴边缘)");
        // ci95_hi 穿越 0.48:0.4751(95)→ 0.5001(100),p* = 95.98
        assert!((hi - 95.98).abs() < 1e-6, "hi = {hi}");
        assert_eq!(rec.interpolated, [false, true]);
    }
}
