//! 参数寻优(文档 12 章自动寻优节,Phase 8 点火):从扫描"人选方向,机器
//! 验证"升级到"机器在多维空间里找可行点"——平衡推荐遗留的"多参数联合
//! 可行域需要代理模型或优化器"由此接上。
//!
//! 两种模式(2026-10-10 裁定,见 docs 12 非目标节):
//!
//! - **进化算法**(evolutionary):初始种群均匀采样 → 锦标赛选择 × 逐维
//!   均匀交叉 × 均匀变异 × 精英保留。适应度是**字典序**(hard 约束 pass
//!   数主键,objective 指标次键),不是加权分——可解释性优先(文档 15 章
//!   排名与评分的同一条纪律);
//! - **Pareto 多目标**(pareto,裁定 = 约束感知非支配排序):hard_pass
//!   分层 → 层内非支配层级(NSGA-II 式)→ 拥挤距离破平。加权求和被拒绝,
//!   前沿本身即答案;"最优"= 前沿 0 中拥挤距离最大者(代表点),全前沿
//!   落 [`OptimResult::front0`]。
//!
//! 确定性:采样 / 选择 / 交叉 / 变异全部绑 `base_seed` 派生流,同配置同
//! 结果,线程数无关(文档 12 章纪律)。代间串行是算法语义,不是性能欠账;
//! 变异用均匀扰动而非高斯——正态随机属随机函数 R3 分期,寻优不越界抢依赖。
//!
//! Bayesian 的代理模型已裁定随机森林(GP 留后续,docs 12 非目标节),另行实施。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::config::SimConfig;
use crate::experiment::MetricKey;
use crate::sweep::{
    run_candidate, CandidateResult, CandidateStatus, ConstraintVerdict, ParamRange, SweepMode,
    SweepRng, SweepSpec, Target, TargetKind, MAX_CANDIDATES,
};
use crate::Error;

/// 排序方向([`Objective::direction`])。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    #[default]
    Maximize,
    Minimize,
}

impl Direction {
    pub fn as_str(self) -> &'static str {
        match self {
            Direction::Maximize => "maximize",
            Direction::Minimize => "minimize",
        }
    }
}

/// 可行点内的排序目标(可省;省略则任一可行点即达标,同适应度先到先得)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Objective {
    pub metric: MetricKey,
    #[serde(default)]
    pub direction: Direction,
}

/// 寻优模式。evolutionary = 字典序适应度;pareto = 约束感知非支配排序
/// (2026-10-10 裁定,docs 12 非目标节)。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OptimMode {
    #[default]
    Evolutionary,
    Pareto,
}

/// 寻优实验定义(Experiment 文件的 optimize 节;YAML 面在 scenario 加载)。
/// Serialize 供 opt.json 落盘回读。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptimSpec {
    pub mode: OptimMode,
    pub parameters: Vec<ParamRange>,
    /// hard 约束定义可行域(soft 目标不参与寻优——加权排序是推荐层语义)
    pub targets: Vec<Target>,
    /// Monte Carlo 复跑数(每候选 R 次,同扫描语义)
    pub replicates: u32,
    /// 种群大小
    pub population: u32,
    /// 迭代代数
    pub generations: u32,
    /// 精英保留数(每代原样进入下一代,不重评)
    pub elite: u32,
    /// 每维变异概率
    pub mutation_rate: f64,
    /// 变异幅度(相对各维 [min, max] 宽度)
    pub mutation_scale: f64,
    pub objective: Option<Objective>,
    /// Pareto 多目标(mode = pareto;≥2 个;与 objective 互斥)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub objectives: Vec<Objective>,
}

impl OptimSpec {
    /// 校验寻优定义本身(路径合法性、范围、预算账、模式与目标形状)。
    pub fn validate(&self) -> Result<(), Error> {
        if self.replicates == 0 {
            return Err(Error::Config("optimize.replicates 必须 ≥ 1".into()));
        }
        if self.parameters.is_empty() {
            return Err(Error::Config("optimize.parameters 不能为空".into()));
        }
        match self.mode {
            OptimMode::Evolutionary if !self.objectives.is_empty() => {
                return Err(Error::Config(
                    "optimize.objectives 仅 pareto 模式可用(evolutionary 用 objective)".into(),
                ));
            }
            OptimMode::Pareto if self.objective.is_some() => {
                return Err(Error::Config(
                    "optimize.objective 仅 evolutionary 模式可用(pareto 用 objectives)".into(),
                ));
            }
            OptimMode::Pareto if self.objectives.len() < 2 => {
                return Err(Error::Config(
                    "optimize.objectives:pareto 模式至少 2 个目标(单目标请用 evolutionary)".into(),
                ));
            }
            _ => {}
        }
        if self.targets.is_empty() && self.objective.is_none() && self.objectives.is_empty() {
            return Err(Error::Config(
                "optimize.targets 与排序目标不能同时为空(至少给出 hard 约束或 objective/objectives)"
                    .into(),
            ));
        }
        for p in &self.parameters {
            if crate::registry::lookup(&p.path).is_none() {
                let sugg = crate::registry::suggestions(&p.path);
                let hint = if sugg.is_empty() {
                    String::new()
                } else {
                    format!(",你是否想写 {}?", sugg[0])
                };
                return Err(Error::Config(format!(
                    "optimize.parameters: {p:?} 不在参数注册表{hint}"
                )));
            }
            // step 不参与寻优(同 Random / LHS,只作范围元数据保留)
            if !(p.min.is_finite() && p.max.is_finite()) || p.min > p.max {
                return Err(Error::Config(format!(
                    "{}: 寻优范围 [min, max] 非法",
                    p.path
                )));
            }
        }
        for t in &self.targets {
            if t.kind == TargetKind::Soft {
                return Err(Error::Config(format!(
                    "optimize.targets: soft 目标不参与寻优({});寻优的可行域只由 hard 约束定义",
                    t.metric.name()
                )));
            }
            if let (Some(min), Some(max)) = (t.min, t.max) {
                if min > max {
                    return Err(Error::Config(format!(
                        "optimize.targets[{}]: min({min}) > max({max})",
                        t.metric.name()
                    )));
                }
            }
        }
        if self.population < 2 {
            return Err(Error::Config(
                "optimize.population 必须 ≥ 2(锦标赛选择需要对手)".into(),
            ));
        }
        if self.generations == 0 {
            return Err(Error::Config("optimize.generations 必须 ≥ 1".into()));
        }
        if self.elite >= self.population {
            return Err(Error::Config(format!(
                "optimize.elite({}) 必须 < population({})(精英占满种群则无子代产生)",
                self.elite, self.population
            )));
        }
        if !(0.0..=1.0).contains(&self.mutation_rate) {
            return Err(Error::Config("optimize.mutation_rate 必须在 [0, 1]".into()));
        }
        if !(0.0..=1.0).contains(&self.mutation_scale) || self.mutation_scale == 0.0 {
            return Err(Error::Config(
                "optimize.mutation_scale 必须在 (0, 1](相对维宽的比例)".into(),
            ));
        }
        // 成本账(文档 12 章):初始种群 + 每代子代,精英不重评
        let total_candidates = self.population as usize * (self.generations as usize + 1);
        if total_candidates > MAX_CANDIDATES {
            return Err(Error::Config(format!(
                "寻优候选数 {total_candidates}(population × (generations + 1))超上限 {MAX_CANDIDATES}(文档 12 章:先算成本账)"
            )));
        }
        Ok(())
    }

    /// 评估用的扫描 spec(run_candidate 的复用面):参数与约束原样搬运。
    fn eval_spec(&self) -> SweepSpec {
        SweepSpec {
            mode: SweepMode::Grid,
            parameters: self.parameters.clone(),
            replicates: self.replicates,
            samples: 0,
            targets: self.targets.clone(),
        }
    }
}

/// 适应度(字典序,文档 12 章):hard 约束 pass 数主键,objective 次键
/// (方向已折算为越大越好)。配置错误候选 hard_pass 记 0、score 记 −∞ 垫底
/// ——不静默、不崩溃,但也不让坏配置参与选择。
#[derive(Debug, Clone, Copy, PartialEq, PartialOrd, Serialize)]
pub struct Fitness {
    pub hard_pass: u32,
    pub score: f64,
}

impl Fitness {
    fn of(r: &CandidateResult, objective: Option<&Objective>) -> Fitness {
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

    fn better(self, other: Fitness) -> bool {
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
    fn of(r: &CandidateResult, _objectives: &[Objective]) -> ParetoFit {
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
    fn objective_values(r: &CandidateResult, objectives: &[Objective]) -> Vec<f64> {
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

fn dominates(a: &[f64], b: &[f64]) -> bool {
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
fn rank_and_crowd(results: &[CandidateResult], objectives: &[Objective]) -> Vec<ParetoFit> {
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

/// 逐代统计(收敛信号;population 级,不是子代批)。
#[derive(Debug, Clone, Serialize)]
pub struct GenerationStats {
    /// 0 = 初始种群
    pub generation: u32,
    /// 本代实际新评的候选数(初始 = population,之后 = population − elite)
    pub evaluated: usize,
    /// 当前种群中全部 hard 约束 pass 的个体数
    pub feasible: usize,
    /// 当前种群最优适应度
    pub best: Fitness,
    /// 最优层(hard_pass 最大层)前沿 0 的规模;evolutionary 模式恒 0
    pub front0: usize,
}

/// 寻优结果:全历史最优 + 逐代统计 + 成本账。
#[derive(Debug, Clone, Serialize)]
pub struct OptimResult {
    pub spec: OptimSpec,
    /// 全历史最优候选(适应度同分保先到);None 仅当全部候选配置错误。
    /// pareto 模式 = 前沿 0 中拥挤距离最大者(代表点)
    pub best: Option<CandidateResult>,
    pub best_fitness: Option<Fitness>,
    pub history: Vec<GenerationStats>,
    /// 全历史评估候选(按评估序:初始种群 + 各代子代;精英不重评不重复)
    pub all: Vec<CandidateResult>,
    /// 实际评估的候选数(= population + generations × (population − elite))
    pub evaluated: usize,
    /// 总仿真数 = evaluated × replicates(成本账回显)
    pub total_sims: usize,
    /// 末代最优层的前沿 0(全部非支配解,按拥挤距离降序);evolutionary 模式空
    pub front0: Vec<CandidateResult>,
}

/// 种群适应度的两种形态:主循环单份,精英序 / 锦标赛 / 统计按形态分支。
#[derive(Debug, Clone)]
enum Ranking {
    /// 字典序适应度(evolutionary)
    Evo(Vec<Fitness>),
    /// 层级 + 拥挤距离(pareto)
    Pareto(Vec<ParetoFit>),
}

/// ParetoFit 全序:hard_pass 降 → rank 升 → crowding 降(同分保评估序)。
fn cmp_pareto(a: &ParetoFit, b: &ParetoFit) -> std::cmp::Ordering {
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
    fn compute(mode: OptimMode, results: &[CandidateResult], spec: &OptimSpec) -> Ranking {
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

    fn len(&self) -> usize {
        match self {
            Ranking::Evo(f) => f.len(),
            Ranking::Pareto(f) => f.len(),
        }
    }

    /// 精英索引:按适应度降序前 elite 个(稳定排序,同分保评估序)。
    fn elite_order(&self, elite: usize) -> Vec<usize> {
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
    fn tournament(&self, rng: &mut SweepRng) -> usize {
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
    fn gen_stats(
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
    fn pareto_front(&self) -> Option<(u32, Vec<usize>)> {
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

/// 运行寻优(纯内核、单线程、逐代依赖;文档 12 章)。进化与 Pareto 共用
/// 主循环:适应度形态、精英序、锦标赛由 [`Ranking`] 分支,采样/交叉/变异
/// 序列两模式一致(RNG 消耗序不变)。
pub fn optimize(base: &SimConfig, spec: &OptimSpec) -> Result<OptimResult, Error> {
    spec.validate()?;
    let eval_spec = spec.eval_spec();

    // 寻优流与扫描流分立:同 base_seed 的扫描与寻优不共享采样序列
    let mut rng = SweepRng::new(base.base_seed ^ 0x9E37_79B9_7F4A_7C15);
    let pop_n = spec.population as usize;
    let offspring_n = pop_n - spec.elite as usize;
    let hard_total = spec.targets.len() as u32;

    // 初始种群:各维 [min, max] 均匀
    let mut pop: Vec<BTreeMap<String, f64>> = (0..pop_n)
        .map(|_| sample_uniform(&spec.parameters, &mut rng))
        .collect();
    let mut results: Vec<CandidateResult> = pop
        .iter()
        .map(|v| run_candidate(base, &eval_spec, v))
        .collect();

    let mut evaluated = pop_n;
    let mut ranking = Ranking::compute(spec.mode, &results, spec);
    let mut history = vec![ranking.gen_stats(0, &results, spec, hard_total, pop_n)];
    let mut all: Vec<CandidateResult> = results.clone();
    // evolutionary 的全历史最优逐代累积(pareto 只答末代前沿,见 final_best)
    let mut best: Option<(Fitness, CandidateResult)> = None;

    for gen in 1..=spec.generations {
        // 精英:适应度降序前 elite 个
        let elites = ranking.elite_order(spec.elite as usize);

        // 子代:锦标赛(size 2)× 逐维均匀交叉 × 均匀变异
        let mut offspring = Vec::with_capacity(offspring_n);
        while offspring.len() < offspring_n {
            let pa = ranking.tournament(&mut rng);
            let pb = ranking.tournament(&mut rng);
            let mut child = BTreeMap::new();
            for p in &spec.parameters {
                let va = pop[pa].get(&p.path).copied().unwrap_or(p.min);
                let vb = pop[pb].get(&p.path).copied().unwrap_or(p.min);
                let v = if rng.next_f64() < 0.5 { va } else { vb };
                let v = if rng.next_f64() < spec.mutation_rate {
                    let w = p.max - p.min;
                    (v + (rng.next_f64() * 2.0 - 1.0) * spec.mutation_scale * w).clamp(p.min, p.max)
                } else {
                    v
                };
                child.insert(p.path.clone(), v);
            }
            offspring.push(child);
        }
        let off_results: Vec<CandidateResult> = offspring
            .iter()
            .map(|v| run_candidate(base, &eval_spec, v))
            .collect();
        evaluated += offspring_n;
        all.extend(off_results.iter().cloned());

        // 合并:精英原样 + 子代。pop 与 results 同步换血——精英基因重新
        // 进入交配池(修前 bug:pop 停在初始种群,第 2 代起 pop[pa] 读到
        // 初始基因,锦标赛选中的当代个体基因被忽略,GA 退化为初始重组合)
        let mut next_results = Vec::with_capacity(pop_n);
        let mut next_pop = Vec::with_capacity(pop_n);
        for &e in &elites {
            next_results.push(results[e].clone());
            next_pop.push(pop[e].clone());
        }
        next_results.extend(off_results);
        next_pop.extend(offspring);
        results = next_results;
        pop = next_pop;

        ranking = Ranking::compute(spec.mode, &results, spec);
        history.push(ranking.gen_stats(gen, &results, spec, hard_total, offspring_n));
        if spec.mode == OptimMode::Evolutionary {
            for r in &results {
                let f = Fitness::of(r, spec.objective.as_ref());
                match best {
                    None => best = Some((f, r.clone())),
                    Some((bf, _)) if f.better(bf) => best = Some((f, r.clone())),
                    _ => {}
                }
            }
        }
    }

    let (best_fitness, best, front0) = match spec.mode {
        OptimMode::Evolutionary => (
            best.as_ref().map(|(f, _)| *f),
            best.map(|(_, r)| r),
            Vec::new(),
        ),
        OptimMode::Pareto => {
            let (max_pass, front) = ranking.pareto_front().expect("pareto 末代排序已算好");
            let candidates: Vec<CandidateResult> =
                front.iter().map(|&i| results[i].clone()).collect();
            let (rep, best) = match front.first() {
                None => (None, None),
                Some(&i) => (
                    Some(Fitness {
                        hard_pass: max_pass,
                        score: ParetoFit::objective_values(&results[i], &spec.objectives)
                            .first()
                            .copied()
                            .unwrap_or(f64::NEG_INFINITY),
                    }),
                    Some(results[i].clone()),
                ),
            };
            (rep, best, candidates)
        }
    };
    Ok(OptimResult {
        spec: spec.clone(),
        best,
        best_fitness,
        history,
        all,
        evaluated,
        total_sims: evaluated * spec.replicates as usize,
        front0,
    })
}

fn sample_uniform(parameters: &[ParamRange], rng: &mut SweepRng) -> BTreeMap<String, f64> {
    parameters
        .iter()
        .map(|p| {
            let v = p.min + rng.next_f64() * (p.max - p.min);
            (p.path.clone(), v)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SimConfig;
    use crate::experiment::MetricKey;
    use crate::sweep::Target;

    fn spec() -> OptimSpec {
        OptimSpec {
            mode: OptimMode::Evolutionary,
            parameters: vec![ParamRange {
                path: "model.warrior.attack".into(),
                min: 60.0,
                max: 160.0,
                step: 10.0,
            }],
            replicates: 2,
            population: 6,
            generations: 4,
            elite: 2,
            mutation_rate: 0.3,
            mutation_scale: 0.2,
            targets: vec![Target {
                metric: MetricKey::WinRate,
                min: Some(0.5),
                max: None,
                kind: TargetKind::Hard,
            }],
            objective: Some(Objective {
                metric: MetricKey::PowerP50Final,
                direction: Direction::Maximize,
            }),
            objectives: Vec::new(),
        }
    }

    /// 小场景基线(测试提速):100 人 × 10 天,默认三围。
    fn base() -> SimConfig {
        SimConfig {
            players: 100,
            days: 10,
            ..SimConfig::default()
        }
    }

    #[test]
    fn 进化寻优_找到可行点并推向目标方向() {
        let base = base();
        let s = spec();
        let r = optimize(&base, &s).unwrap();
        assert_eq!(r.evaluated, 6 + 4 * 4, "初始种群 + 每代子代");
        assert_eq!(r.total_sims, r.evaluated * 2);
        assert_eq!(r.history.len(), 5, "初始 + 4 代");
        let best = r.best.expect("应找到候选");
        assert!(matches!(best.status, CandidateStatus::Ok));
        // 攻击力越高 power 越高(win_rate 默认已近 1,hard 约束不约束方向)
        let atk = best.values["model.warrior.attack"];
        assert!((60.0..=160.0).contains(&atk), "最优值应在域内:{atk}");
        assert!(r.best_fitness.unwrap().hard_pass == 1, "hard 约束应 pass");
        // 目标方向:末代种群最优不劣于初始种群(精英保留的单调性)
        assert!(r.history.last().unwrap().best.score >= r.history[0].best.score);
        // power 随攻击单调 → 最优应偏向域高端(收敛性冒烟,不逐位卡)
        assert!(atk > 100.0, "maximize power 应把攻击推向高端:{atk}");
    }

    #[test]
    fn 进化寻优_同种子同结果() {
        let base = base();
        let s = spec();
        let a = optimize(&base, &s).unwrap();
        let b = optimize(&base, &s).unwrap();
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    #[test]
    fn 进化寻优_配置错误候选垫底不崩溃() {
        let base = base();
        let mut s = spec();
        // reward_gold 范围含负值 → 部分候选被 validate 拦截为配置错误
        s.parameters.push(ParamRange {
            path: "model.dungeon.reward_gold".into(),
            min: -100.0,
            max: 100.0,
            step: 10.0,
        });
        s.population = 8;
        let r = optimize(&base, &s).unwrap();
        assert!(r.best.is_some(), "配置错误不该让寻优崩溃");
        // 最优不落在配置错误候选上
        let bf = r.best_fitness.unwrap();
        assert!(bf.score > f64::NEG_INFINITY);
    }

    #[test]
    fn 寻优定义校验_预算与形状() {
        let mut s = spec();
        s.population = 1;
        assert!(s.validate().is_err(), "population ≥ 2");
        let mut s = spec();
        s.elite = s.population;
        assert!(s.validate().is_err(), "elite < population");
        let mut s = spec();
        s.mutation_scale = 1.5;
        assert!(s.validate().is_err(), "mutation_scale ≤ 1");
        let mut s = spec();
        s.mutation_rate = -0.1;
        assert!(s.validate().is_err(), "mutation_rate ∈ [0,1]");
        let mut s = spec();
        s.generations = 0;
        assert!(s.validate().is_err(), "generations ≥ 1");
        let mut s = spec();
        s.targets.clear();
        s.objective = None;
        assert!(s.validate().is_err(), "targets 与 objective 不能同时为空");
        let mut s = spec();
        s.targets[0].kind = TargetKind::Soft;
        assert!(s.validate().is_err(), "soft 目标不参与寻优");
        let mut s = spec();
        s.population = 400;
        s.generations = 100;
        assert!(s.validate().is_err(), "预算上限");
        // 合法 spec 应通过
        assert!(spec().validate().is_ok());
    }

    #[test]
    fn 适应度_字典序与方向() {
        use crate::experiment::SampleStats;
        let stat = |m: f64| SampleStats {
            n: 2,
            mean: m,
            sd: 0.0,
            ci95_lo: m,
            ci95_hi: m,
        };
        let ok = |hard_pass: u32, power: f64| CandidateResult {
            values: BTreeMap::new(),
            status: CandidateStatus::Ok,
            metric_stats: vec![(MetricKey::PowerP50Final, stat(power))],
            target_outcomes: (0..hard_pass)
                .map(|_| crate::sweep::TargetOutcome {
                    metric: "win_rate".into(),
                    kind: TargetKind::Hard,
                    min: Some(0.5),
                    max: None,
                    stats: stat(0.9),
                    verdict: ConstraintVerdict::Pass,
                })
                .collect(),
        };
        let obj = Objective {
            metric: MetricKey::PowerP50Final,
            direction: Direction::Maximize,
        };
        // 主键优先:pass 多者胜,score 再大也不翻盘
        let f1 = Fitness::of(&ok(1, 100.0), Some(&obj));
        let f0 = Fitness::of(&ok(0, 999.0), Some(&obj));
        assert!(f1.better(f0) && f1.hard_pass == 1);
        // 次键:同 pass 数比 score
        let f2 = Fitness::of(&ok(1, 200.0), Some(&obj));
        assert!(f2.better(f1));
        // minimize 方向折算
        let obj_min = Objective {
            metric: MetricKey::PowerP50Final,
            direction: Direction::Minimize,
        };
        let flo = Fitness::of(&ok(1, 100.0), Some(&obj_min));
        let fhi = Fitness::of(&ok(1, 200.0), Some(&obj_min));
        assert!(flo.better(fhi), "minimize 时低值更优");
        // 配置错误垫底
        let err = CandidateResult {
            values: BTreeMap::new(),
            status: CandidateStatus::ConfigError("bad".into()),
            metric_stats: vec![],
            target_outcomes: vec![],
        };
        let ferr = Fitness::of(&err, Some(&obj));
        assert!(f0.better(ferr));
    }

    // —— Pareto 模式(2026-10-10 裁定:约束感知非支配排序)——

    fn pareto_spec() -> OptimSpec {
        OptimSpec {
            mode: OptimMode::Pareto,
            parameters: vec![
                ParamRange {
                    path: "model.warrior.attack".into(),
                    min: 60.0,
                    max: 160.0,
                    step: 10.0,
                },
                ParamRange {
                    path: "model.dungeon.reward_gold".into(),
                    min: 800.0,
                    max: 2000.0,
                    step: 100.0,
                },
            ],
            replicates: 2,
            population: 6,
            generations: 3,
            elite: 2,
            mutation_rate: 0.3,
            mutation_scale: 0.2,
            targets: vec![Target {
                metric: MetricKey::ChurnRate,
                min: Some(0.0),
                max: Some(0.3),
                kind: TargetKind::Hard,
            }],
            objective: None,
            objectives: vec![
                Objective {
                    metric: MetricKey::PowerP50Final,
                    direction: Direction::Maximize,
                },
                Objective {
                    metric: MetricKey::GoldPerPlayer,
                    direction: Direction::Minimize,
                },
            ],
        }
    }

    /// 双目标合成候选:power / gold(mean 值直接指定)。
    fn cand2(hard_pass: u32, power: f64, gold: f64) -> CandidateResult {
        use crate::experiment::SampleStats;
        let stat = |m: f64| SampleStats {
            n: 2,
            mean: m,
            sd: 0.0,
            ci95_lo: m,
            ci95_hi: m,
        };
        CandidateResult {
            values: BTreeMap::new(),
            status: CandidateStatus::Ok,
            metric_stats: vec![
                (MetricKey::PowerP50Final, stat(power)),
                (MetricKey::GoldPerPlayer, stat(gold)),
            ],
            target_outcomes: (0..hard_pass)
                .map(|_| crate::sweep::TargetOutcome {
                    metric: "churn_rate".into(),
                    kind: TargetKind::Hard,
                    min: Some(0.0),
                    max: Some(0.3),
                    stats: stat(0.1),
                    verdict: ConstraintVerdict::Pass,
                })
                .collect(),
        }
    }

    #[test]
    fn pareto_支配与非支配层级() {
        // maximize power(折算原值)/ minimize gold(折算取负)
        let objs = pareto_spec().objectives;
        // A(1500, 800) 与 B(1600, 900) 互不支配(power↑gold↓同涨,折算后
        // B 在两维都占优?不——minimize gold 折算后 B 是 −900 < −800 劣)
        let a = cand2(1, 1500.0, 800.0); // 折算 (1500, −800)
        let b = cand2(1, 1600.0, 900.0); // 折算 (1600, −900):power 优 gold 劣,非支配
        let c = cand2(1, 1400.0, 900.0); // 折算 (1400, −900):被 A 与 B 双支配
        let results = vec![a, b, c];
        let fits = rank_and_crowd(&results, &objs);
        assert_eq!(fits[0].rank, 0);
        assert_eq!(fits[1].rank, 0);
        assert_eq!(fits[2].rank, 1, "c 被 a、b 双支配,落在前沿 1");
    }

    #[test]
    fn pareto_层内排序_硬约束分层优先() {
        let objs = pareto_spec().objectives;
        // hard_pass 0 但目标值全优,仍不得压过 hard_pass 1
        let great_infeasible = cand2(0, 5000.0, 10.0);
        let poor_feasible = cand2(1, 100.0, 9999.0);
        let results = vec![great_infeasible, poor_feasible];
        let fits = rank_and_crowd(&results, &objs);
        assert_eq!(fits[0].hard_pass, 0);
        assert_eq!(fits[1].hard_pass, 1);
        assert!(
            cmp_pareto(&fits[1], &fits[0]) == std::cmp::Ordering::Less,
            "hard_pass 1 严格优于 hard_pass 0"
        );
    }

    #[test]
    fn pareto_拥挤距离_边界无穷() {
        let objs = pareto_spec().objectives;
        // 三点单层:两个边界(∞)夹一个内部点(有限)
        let results = vec![
            cand2(1, 100.0, 100.0),
            cand2(1, 200.0, 200.0),
            cand2(1, 150.0, 150.0),
        ];
        let fits = rank_and_crowd(&results, &objs);
        assert_eq!(fits[0].rank, 0);
        assert_eq!(fits[1].rank, 0);
        assert_eq!(fits[2].rank, 0, "三点都非支配(同涨,折算后 power/gold 反向)");
        let finite: Vec<f64> = fits
            .iter()
            .map(|f| f.crowding)
            .filter(|c| c.is_finite())
            .collect();
        assert_eq!(finite.len(), 1, "恰一个内部点:{:?}", fits);
        assert!(fits.iter().any(|f| f.crowding == f64::INFINITY));
    }

    #[test]
    fn pareto_寻优_末代前沿与确定性() {
        let base = base();
        let s = pareto_spec();
        let a = optimize(&base, &s).unwrap();
        let b = optimize(&base, &s).unwrap();
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap(),
            "同种子同前沿"
        );
        assert_eq!(a.evaluated, 6 + 3 * 4);
        assert!(a.history.len() == 4, "初始 + 3 代");
        assert!(a.history[0].front0 >= 1, "初始层前沿非空");
        assert!(!a.front0.is_empty(), "末代前沿 0 应有解");
        // 前沿内部互不支配
        for i in 0..a.front0.len() {
            for j in (i + 1)..a.front0.len() {
                let vi = ParetoFit::objective_values(&a.front0[i], &s.objectives);
                let vj = ParetoFit::objective_values(&a.front0[j], &s.objectives);
                assert!(
                    !dominates(&vi, &vj) && !dominates(&vj, &vi),
                    "前沿 0 内互不支配:{vi:?} vs {vj:?}"
                );
            }
        }
        // best = 代表点(前沿 0 拥挤距离最大者 = front0 首个)
        let rep = a.best.expect("代表点存在");
        assert_eq!(rep.values, a.front0[0].values);
        // best_fitness.score = 代表点首目标折算值(maximize power → 原值)
        let bf = a.best_fitness.unwrap();
        let power = rep
            .metric_stats
            .iter()
            .find(|(k, _)| *k == MetricKey::PowerP50Final)
            .map(|(_, s)| s.mean)
            .unwrap();
        assert_eq!(bf.score, power);
    }

    #[test]
    fn pareto_寻优_配置错误候选不进前沿() {
        let base = base();
        let mut s = pareto_spec();
        s.parameters.push(ParamRange {
            path: "model.dungeon.reward_gold".into(),
            min: -100.0,
            max: 100.0,
            step: 10.0,
        });
        let r = optimize(&base, &s).unwrap();
        assert!(r.best.is_some(), "配置错误不崩溃");
        for c in &r.front0 {
            assert!(
                matches!(c.status, CandidateStatus::Ok),
                "前沿 0 不含配置错误候选"
            );
        }
    }

    #[test]
    fn 寻优定义校验_模式与目标互斥() {
        let mut s = pareto_spec();
        s.objectives = vec![s.objectives[0].clone()];
        assert!(s.validate().is_err(), "pareto 至少 2 个目标");
        let mut s = pareto_spec();
        s.objective = Some(Objective {
            metric: MetricKey::WinRate,
            direction: Direction::Maximize,
        });
        assert!(s.validate().is_err(), "pareto 不收 objective");
        let mut s = spec();
        s.objectives = vec![
            Objective {
                metric: MetricKey::WinRate,
                direction: Direction::Maximize,
            },
            Objective {
                metric: MetricKey::ChurnRate,
                direction: Direction::Minimize,
            },
        ];
        assert!(s.validate().is_err(), "evolutionary 不收 objectives");
        let mut s = spec();
        s.targets.clear();
        s.objective = None;
        s.objectives.clear();
        assert!(s.validate().is_err(), "targets 与排序目标不能同时为空");
        assert!(pareto_spec().validate().is_ok());
        assert!(spec().validate().is_ok());
    }

    #[test]
    fn pareto_yaml_加载() {
        let yaml = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 200, duration: '10d'}\n",
            "model:\n",
            "  warrior: {attack: 100, defense: 80, hp: 1000}\n",
            "optimize:\n",
            "  mode: pareto\n",
            "  population: 4\n",
            "  generations: 2\n",
            "  replicates: 1\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 60, max: 160}\n",
            "  targets:\n",
            "    - {metric: churn_rate, min: 0.0, max: 0.3, kind: hard}\n",
            "  objectives:\n",
            "    - {metric: power_p50, direction: maximize}\n",
            "    - {metric: gold_per_player, direction: minimize}\n",
        );
        let (cfg, spec) = crate::scenario::load_optimize_str(yaml).unwrap();
        assert_eq!(spec.mode, OptimMode::Pareto);
        assert_eq!(spec.objectives.len(), 2);
        assert_eq!(spec.objectives[0].metric, MetricKey::PowerP50Final);
        assert_eq!(spec.objectives[1].direction, Direction::Minimize);
        assert!(spec.objective.is_none());
        assert_eq!(cfg.players, 200);

        // evolutionary + objectives → 拦截
        let bad = yaml.replace("mode: pareto", "mode: evolutionary");
        assert!(crate::scenario::load_optimize_str(&bad).is_err());
        // pareto + objective → 拦截
        let bad = yaml.replace(
            "  objectives:\n",
            "  objective: {metric: win_rate}\n  objectives:\n",
        );
        assert!(crate::scenario::load_optimize_str(&bad).is_err());
    }
}
