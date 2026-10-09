//! 参数寻优(文档 12 章自动寻优节,Phase 8 点火):从扫描"人选方向,机器
//! 验证"升级到"机器在多维空间里找可行点"——平衡推荐遗留的"多参数联合
//! 可行域需要代理模型或优化器"由此接上。
//!
//! 首期交付**进化算法**(evolutionary):初始种群均匀采样 → 锦标赛选择 ×
//! 逐维均匀交叉 × 均匀变异 × 精英保留。适应度是**字典序**(hard 约束 pass
//! 数主键,objective 指标次键),不是加权分——可解释性优先(文档 15 章
//! 排名与评分的同一条纪律)。
//!
//! 确定性:采样 / 选择 / 交叉 / 变异全部绑 `base_seed` 派生流,同配置同
//! 结果,线程数无关(文档 12 章纪律)。代间串行是算法语义,不是性能欠账;
//! 变异用均匀扰动而非高斯——正态随机属随机函数 R3 分期,寻优不越界抢依赖。
//!
//! Bayesian(需代理模型选型)与 Pareto / 多目标(支配排序)待拍板,不预埋。

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

/// 寻优模式。首期只有进化算法;Bayesian / Pareto 待拍板(docs 12),不预埋。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OptimMode {
    #[default]
    Evolutionary,
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
}

impl OptimSpec {
    /// 校验寻优定义本身(路径合法性、范围、预算账)。
    pub fn validate(&self) -> Result<(), Error> {
        if self.replicates == 0 {
            return Err(Error::Config("optimize.replicates 必须 ≥ 1".into()));
        }
        if self.parameters.is_empty() {
            return Err(Error::Config("optimize.parameters 不能为空".into()));
        }
        if self.targets.is_empty() && self.objective.is_none() {
            return Err(Error::Config(
                "optimize.targets 与 optimize.objective 不能同时为空(至少给出 hard 约束或排序目标)"
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
}

/// 寻优结果:全历史最优 + 逐代统计 + 成本账。
#[derive(Debug, Clone, Serialize)]
pub struct OptimResult {
    pub spec: OptimSpec,
    /// 全历史最优候选(适应度同分保先到);None 仅当全部候选配置错误
    pub best: Option<CandidateResult>,
    pub best_fitness: Option<Fitness>,
    pub history: Vec<GenerationStats>,
    /// 全历史评估候选(按评估序:初始种群 + 各代子代;精英不重评不重复)
    pub all: Vec<CandidateResult>,
    /// 实际评估的候选数(= population + generations × (population − elite))
    pub evaluated: usize,
    /// 总仿真数 = evaluated × replicates(成本账回显)
    pub total_sims: usize,
}

/// 运行进化寻优(纯内核、单线程、逐代依赖;文档 12 章)。
pub fn optimize(base: &SimConfig, spec: &OptimSpec) -> Result<OptimResult, Error> {
    spec.validate()?;
    let eval_spec = spec.eval_spec();

    // 寻优流与扫描流分立:同 base_seed 的扫描与寻优不共享采样序列
    let mut rng = SweepRng::new(base.base_seed ^ 0x9E37_79B9_7F4A_7C15);
    let pop_n = spec.population as usize;
    let offspring_n = pop_n - spec.elite as usize;
    let hard_total = spec.targets.len() as u32;

    // 初始种群:各维 [min, max] 均匀
    let pop: Vec<BTreeMap<String, f64>> = (0..pop_n)
        .map(|_| sample_uniform(&spec.parameters, &mut rng))
        .collect();
    let mut results: Vec<CandidateResult> = pop
        .iter()
        .map(|v| run_candidate(base, &eval_spec, v))
        .collect();
    let mut fits: Vec<Fitness> = results
        .iter()
        .map(|r| Fitness::of(r, spec.objective.as_ref()))
        .collect();

    let mut evaluated = pop_n;
    let mut history = vec![gen_stats(0, &fits, hard_total, pop_n)];
    let mut all: Vec<CandidateResult> = results.clone();
    let mut best: Option<(Fitness, CandidateResult)> = None;
    track_best(&mut best, &fits, &results);

    for gen in 1..=spec.generations {
        // 精英:适应度降序前 elite 个(稳定排序,同分先到先得)
        let mut order: Vec<usize> = (0..pop_n).collect();
        order.sort_by(|&a, &b| {
            fits[b]
                .partial_cmp(&fits[a])
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        let elites: Vec<usize> = order[..spec.elite as usize].to_vec();

        // 子代:锦标赛(size 2)× 逐维均匀交叉 × 均匀变异
        let mut offspring = Vec::with_capacity(offspring_n);
        while offspring.len() < offspring_n {
            let pa = tournament(&fits, &mut rng);
            let pb = tournament(&fits, &mut rng);
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
        let off_fits: Vec<Fitness> = off_results
            .iter()
            .map(|r| Fitness::of(r, spec.objective.as_ref()))
            .collect();
        evaluated += offspring_n;
        all.extend(off_results.iter().cloned());

        // 合并:精英原样 + 子代
        let mut next_results = Vec::with_capacity(pop_n);
        let mut next_fits = Vec::with_capacity(pop_n);
        for &e in &elites {
            next_results.push(results[e].clone());
            next_fits.push(fits[e]);
        }
        next_results.extend(off_results);
        next_fits.extend(off_fits);
        results = next_results;
        fits = next_fits;

        history.push(gen_stats(gen, &fits, hard_total, offspring_n));
        track_best(&mut best, &fits, &results);
    }

    let (best_fitness, best) = match best {
        Some((f, r)) => (Some(f), Some(r)),
        None => (None, None),
    };
    Ok(OptimResult {
        spec: spec.clone(),
        best,
        best_fitness,
        history,
        all,
        evaluated,
        total_sims: evaluated * spec.replicates as usize,
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

/// 锦标赛选择(size 2):随机抽两个索引,适应度高者胜。
fn tournament(fits: &[Fitness], rng: &mut SweepRng) -> usize {
    let n = fits.len();
    let a = (rng.next_f64() * n as f64) as usize % n;
    let b = (rng.next_f64() * n as f64) as usize % n;
    if fits[b].better(fits[a]) {
        b
    } else {
        a
    }
}

fn gen_stats(
    generation: u32,
    fits: &[Fitness],
    hard_total: u32,
    evaluated: usize,
) -> GenerationStats {
    let feasible = fits.iter().filter(|f| f.hard_pass == hard_total).count();
    let best = fits
        .iter()
        .copied()
        .max_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal))
        .unwrap_or(Fitness {
            hard_pass: 0,
            score: f64::NEG_INFINITY,
        });
    GenerationStats {
        generation,
        evaluated,
        feasible,
        best,
    }
}

fn track_best(
    best: &mut Option<(Fitness, CandidateResult)>,
    fits: &[Fitness],
    results: &[CandidateResult],
) {
    for (f, r) in fits.iter().zip(results) {
        match best {
            None => *best = Some((*f, r.clone())),
            Some((bf, _)) if f.better(*bf) => *best = Some((*f, r.clone())),
            _ => {}
        }
    }
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
}
