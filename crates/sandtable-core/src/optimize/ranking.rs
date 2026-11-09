//! 排名面:约束感知排序(Ranking 枚举,hard_pass 分层 + 层内 Pareto)。

use super::fitness::{rank_and_crowd, Fitness, ParetoFit};
use super::result::GenerationStats;
use super::spec::{OptimMode, OptimSpec};
use crate::sweep::{CandidateResult, SweepRng};

/// 种群适应度的两种形态:主循环单份,精英序 / 锦标赛 / 统计按形态分支。
#[derive(Debug, Clone)]
pub(super) enum Ranking {
    /// 字典序适应度(evolutionary)
    Evo(Vec<Fitness>),
    /// 层级 + 拥挤距离(pareto)
    Pareto(Vec<ParetoFit>),
}

/// ParetoFit 全序:hard_pass 降 → rank 升 → crowding 降(同分保评估序)。
pub(super) fn cmp_pareto(a: &ParetoFit, b: &ParetoFit) -> std::cmp::Ordering {
    b.hard_pass
        .cmp(&a.hard_pass)
        .then(a.rank.cmp(&b.rank))
        .then(
            b.crowding
                .partial_cmp(&a.crowding)
                .unwrap_or(std::cmp::Ordering::Equal),
        )
}

impl Ranking {
    pub(super) fn compute(
        mode: OptimMode,
        results: &[CandidateResult],
        spec: &OptimSpec,
    ) -> Ranking {
        match mode {
            OptimMode::Evolutionary => Ranking::Evo(
                results
                    .iter()
                    .map(|r| Fitness::of(r, spec.objective.as_ref()))
                    .collect(),
            ),
            OptimMode::Pareto => Ranking::Pareto(rank_and_crowd(results, &spec.objectives)),
        }
    }

    pub(super) fn len(&self) -> usize {
        match self {
            Ranking::Evo(f) => f.len(),
            Ranking::Pareto(f) => f.len(),
        }
    }

    /// 精英索引:按适应度降序前 elite 个(稳定排序,同分保评估序)。
    pub(super) fn elite_order(&self, elite: usize) -> Vec<usize> {
        let mut order: Vec<usize> = (0..self.len()).collect();
        match self {
            Ranking::Evo(fits) => {
                order.sort_by(|&a, &b| {
                    fits[b]
                        .partial_cmp(&fits[a])
                        .unwrap_or(std::cmp::Ordering::Equal)
                });
            }
            Ranking::Pareto(fits) => {
                order.sort_by(|&a, &b| cmp_pareto(&fits[a], &fits[b]));
            }
        }
        order.truncate(elite);
        order
    }

    /// 锦标赛选择(size 2):随机抽两个索引,适应度高者胜。
    pub(super) fn tournament(&self, rng: &mut SweepRng) -> usize {
        let n = self.len();
        let a = (rng.next_f64() * n as f64) as usize % n;
        let b = (rng.next_f64() * n as f64) as usize % n;
        match self {
            Ranking::Evo(fits) => {
                if fits[b].better(fits[a]) {
                    b
                } else {
                    a
                }
            }
            Ranking::Pareto(fits) => {
                if cmp_pareto(&fits[b], &fits[a]) == std::cmp::Ordering::Less {
                    b
                } else {
                    a
                }
            }
        }
    }

    /// 逐代统计(收敛信号;population 级,不是子代批)。
    pub(super) fn gen_stats(
        &self,
        generation: u32,
        results: &[CandidateResult],
        spec: &OptimSpec,
        hard_total: u32,
        evaluated: usize,
    ) -> GenerationStats {
        let feasible = match self {
            Ranking::Evo(f) => f.iter().filter(|x| x.hard_pass == hard_total).count(),
            Ranking::Pareto(f) => f.iter().filter(|x| x.hard_pass == hard_total).count(),
        };
        match self {
            Ranking::Evo(fits) => GenerationStats {
                generation,
                evaluated,
                feasible,
                best: fits
                    .iter()
                    .copied()
                    .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
                    .unwrap_or(Fitness {
                        hard_pass: 0,
                        score: f64::NEG_INFINITY,
                    }),
                front0: 0,
            },
            Ranking::Pareto(fits) => {
                // 最优层 = hard_pass 最大的层;best 记代表点(前沿 0 拥挤
                // 距离最大者)的首目标折算值,front0 记前沿规模
                let max_pass = fits
                    .iter()
                    .filter(|f| f.rank != u32::MAX)
                    .map(|f| f.hard_pass)
                    .max()
                    .unwrap_or(0);
                let mut front: Vec<usize> = (0..fits.len())
                    .filter(|&i| fits[i].hard_pass == max_pass && fits[i].rank == 0)
                    .collect();
                if front.is_empty() {
                    return GenerationStats {
                        generation,
                        evaluated,
                        feasible,
                        best: Fitness {
                            hard_pass: max_pass,
                            score: f64::NEG_INFINITY,
                        },
                        front0: 0,
                    };
                }
                front.sort_by(|&a, &b| {
                    fits[b]
                        .crowding
                        .partial_cmp(&fits[a].crowding)
                        .unwrap_or(std::cmp::Ordering::Equal)
                        .then(a.cmp(&b))
                });
                let rep = front[0];
                let score = ParetoFit::objective_values(&results[rep], &spec.objectives)
                    .first()
                    .copied()
                    .unwrap_or(f64::NEG_INFINITY);
                GenerationStats {
                    generation,
                    evaluated,
                    feasible,
                    best: Fitness {
                        hard_pass: max_pass,
                        score,
                    },
                    front0: front.len(),
                }
            }
        }
    }

    /// 末代最优层信息(pareto 用):返回 (max_pass, 前沿 0 索引按拥挤距离降序)。
    pub(super) fn pareto_front(&self) -> Option<(u32, Vec<usize>)> {
        let fits = match self {
            Ranking::Pareto(f) => f,
            Ranking::Evo(_) => return None,
        };
        let max_pass = fits
            .iter()
            .filter(|f| f.rank != u32::MAX)
            .map(|f| f.hard_pass)
            .max()?;
        let mut front: Vec<usize> = (0..fits.len())
            .filter(|&i| fits[i].hard_pass == max_pass && fits[i].rank == 0)
            .collect();
        front.sort_by(|&a, &b| {
            fits[b]
                .crowding
                .partial_cmp(&fits[a].crowding)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(a.cmp(&b))
        });
        Some((max_pass, front))
    }
}
