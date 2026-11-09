//! 适应度面(文档 12/15 章):字典序 Fitness(硬约束 pass 数主键)与约束感知非支配 ParetoFit + NSGA-II 式分层辅助。

use super::spec::{Direction, Objective};
use crate::sweep::{CandidateResult, CandidateStatus, ConstraintVerdict, TargetKind};
use serde::Serialize;

/// 适应度(字典序,文档 12 章):hard 约束 pass 数主键,objective 次键
/// (方向已折算为越大越好)。配置错误候选 hard_pass 记 0、score 记 −∞ 垫底
/// ——不静默、不崩溃,但也不让坏配置参与选择。
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize)]
pub struct Fitness {
    pub hard_pass: u32,
    pub score: f64,
}

impl Fitness {
    pub(super) fn of(r: &CandidateResult, objective: Option<&Objective>) -> Fitness {
        if matches!(r.status, CandidateStatus::ConfigError(_)) {
            return Fitness {
                hard_pass: 0,
                score: f64::NEG_INFINITY,
            };
        }
        let hard_pass = r
            .target_outcomes
            .iter()
            .filter(|o| o.kind == TargetKind::Hard && o.verdict == ConstraintVerdict::Pass)
            .count() as u32;
        let score = match objective {
            None => 0.0,
            Some(obj) => {
                match r
                    .metric_stats
                    .iter()
                    .find(|(k, _)| *k == obj.metric)
                    .map(|(_, s)| s.mean)
                {
                    Some(v) => match obj.direction {
                        Direction::Maximize => v,
                        Direction::Minimize => -v,
                    },
                    // 指标提不出(run_metrics 缺失):同配置错误的处置,垫底
                    None => f64::NEG_INFINITY,
                }
            }
        };
        Fitness { hard_pass, score }
    }

    pub(super) fn better(self, other: Fitness) -> bool {
        // 字典序:主键严格大,或主键同分次键严格大(NaN 不参与,score 均有限)
        self.hard_pass > other.hard_pass
            || (self.hard_pass == other.hard_pass && self.score > other.score)
    }
}

/// Pareto 适应度(字典序,文档 12 章):hard_pass 分层 → 层内非支配层级
/// (rank 小者优)→ 拥挤距离(大者优,保多样性)。配置错误候选 rank 记
/// u32::MAX、crowding 记 −∞ 垫底——同进化模式的处置,不静默不崩溃。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ParetoFit {
    pub hard_pass: u32,
    pub rank: u32,
    pub crowding: f64,
}

impl ParetoFit {
    /// 个体层只算 hard_pass;rank / crowding 由 [`rank_and_crowd`] 在种群层
    /// 统一算(层级与拥挤距离都是种群相对量)。
    pub(super) fn of(r: &CandidateResult, _objectives: &[Objective]) -> ParetoFit {
        if matches!(r.status, CandidateStatus::ConfigError(_)) {
            return ParetoFit {
                hard_pass: 0,
                rank: u32::MAX,
                crowding: f64::NEG_INFINITY,
            };
        }
        let hard_pass = r
            .target_outcomes
            .iter()
            .filter(|o| o.kind == TargetKind::Hard && o.verdict == ConstraintVerdict::Pass)
            .count() as u32;
        ParetoFit {
            hard_pass,
            rank: 0,
            crowding: 0.0,
        }
    }

    /// 目标值(方向已折算为越大越好;指标提不出记 −∞,同进化模式)。
    pub(super) fn objective_values(r: &CandidateResult, objectives: &[Objective]) -> Vec<f64> {
        objectives
            .iter()
            .map(|obj| {
                match r
                    .metric_stats
                    .iter()
                    .find(|(k, _)| *k == obj.metric)
                    .map(|(_, s)| s.mean)
                {
                    Some(v) => match obj.direction {
                        Direction::Maximize => v,
                        Direction::Minimize => -v,
                    },
                    None => f64::NEG_INFINITY,
                }
            })
            .collect()
    }
}

/// 非支配排序(O(n²),种群规模足够):返回每个候选的层级(0 = 前沿 0)。
/// 支配定义:所有目标不差且至少一个严格好(−∞ 参与比较,同值不算严格好)。
fn pareto_ranks(values: &[Vec<f64>]) -> Vec<u32> {
    let n = values.len();
    let mut ranks = vec![0u32; n];
    let mut remaining: Vec<usize> = (0..n).collect();
    let mut front = 0u32;
    while !remaining.is_empty() {
        let mut next = Vec::new();
        for &i in &remaining {
            let dominated = remaining
                .iter()
                .any(|&j| j != i && dominates(&values[j], &values[i]));
            if !dominated {
                next.push(i);
            }
        }
        for &i in &next {
            ranks[i] = front;
        }
        remaining.retain(|i| !next.contains(i));
        front += 1;
    }
    ranks
}

pub(super) fn dominates(a: &[f64], b: &[f64]) -> bool {
    let not_worse = a.iter().zip(b).all(|(x, y)| x >= y);
    let strictly = a.iter().zip(b).any(|(x, y)| x > y);
    not_worse && strictly
}

/// 拥挤距离(NSGA-II 式,按层级分组):每目标排序后边界点记 ∞,内部点累加
/// 归一化间距;单点层记 ∞。同层内只作破平键,不影响层级。
fn crowding_distances(values: &[Vec<f64>], ranks: &[u32]) -> Vec<f64> {
    let n = values.len();
    let mut crowd = vec![0.0f64; n];
    let mut by_front: Vec<usize> = Vec::new();
    let mut front = 0u32;
    loop {
        by_front.clear();
        for (i, &r) in ranks.iter().enumerate() {
            if r == front {
                by_front.push(i);
            }
        }
        if by_front.is_empty() {
            break;
        }
        if by_front.len() == 1 {
            crowd[by_front[0]] = f64::INFINITY;
        } else {
            for &i in &by_front {
                crowd[i] = 0.0;
            }
            for (m, _) in values[by_front[0]].iter().enumerate() {
                by_front.sort_by(|&a, &b| {
                    values[a][m]
                        .partial_cmp(&values[b][m])
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
                let lo = values[by_front[0]][m];
                let hi = values[by_front[by_front.len() - 1]][m];
                crowd[by_front[0]] = f64::INFINITY;
                crowd[by_front[by_front.len() - 1]] = f64::INFINITY;
                let range = hi - lo;
                if range > 0.0 {
                    for w in 1..by_front.len() - 1 {
                        crowd[by_front[w]] +=
                            (values[by_front[w + 1]][m] - values[by_front[w - 1]][m]) / range;
                    }
                }
            }
        }
        front += 1;
    }
    crowd
}

/// 种群层 Pareto 评估:hard_pass 分层 → 层内 rank + crowding。
/// 配置错误候选(rank u32::MAX)直接垫底,不参与排序。
/// 排序是种群相对量:O(n²) 每层(典型种群几十,仿真成本占大头)。
pub(super) fn rank_and_crowd(
    results: &[CandidateResult],
    objectives: &[Objective],
) -> Vec<ParetoFit> {
    let mut fits: Vec<ParetoFit> = results
        .iter()
        .map(|r| ParetoFit::of(r, objectives))
        .collect();
    let max_pass = fits
        .iter()
        .filter(|f| f.rank != u32::MAX)
        .map(|f| f.hard_pass)
        .max()
        .unwrap_or(0);
    for pass in 0..=max_pass {
        let strata: Vec<usize> = fits
            .iter()
            .enumerate()
            .filter(|(_, f)| f.hard_pass == pass && f.rank != u32::MAX)
            .map(|(i, _)| i)
            .collect();
        if strata.is_empty() {
            continue;
        }
        let values: Vec<Vec<f64>> = strata
            .iter()
            .map(|&i| ParetoFit::objective_values(&results[i], objectives))
            .collect();
        let ranks = pareto_ranks(&values);
        let crowd = crowding_distances(&values, &ranks);
        for (k, &i) in strata.iter().enumerate() {
            fits[i].rank = ranks[k];
            fits[i].crowding = crowd[k];
        }
    }
    fits
}
