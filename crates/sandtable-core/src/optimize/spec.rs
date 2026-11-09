//! 寻优定义面(文档 12 章):Direction / Objective / OptimMode / OptimSpec + spec 自身校验(路径合法性、范围、预算账、模式与目标形状)。

use crate::experiment::MetricKey;
use crate::sweep::{ParamRange, SweepMode, SweepSpec, Target, TargetKind, MAX_CANDIDATES};
use crate::Error;
use serde::{Deserialize, Serialize};

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
        if self.replicates < 2 {
            return Err(Error::Config(
                "optimize.replicates 必须 ≥ 2(单点无法给出置信区间)".into(),
            ));
        }
        if self.replicates > crate::config::MAX_SWEEP_REPLICATES {
            return Err(Error::Config(format!(
                "optimize.replicates 不能超过 {}(核心 replicates 上界)",
                crate::config::MAX_SWEEP_REPLICATES
            )));
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
        // 成本账(文档 12 章):初始种群 + 每代子代,精英不重评。候选数
        // 本身 ≤ MAX_CANDIDATES;ST-AUD-17 / I-017 补 ×replicates 的**总仿真
        // 工作量**账(原实现只按候选数封顶,未乘 R——wasm 做了、core 没做)。
        // 核心上界为两条既有上限的复合(候选 ≤ MAX_CANDIDATES ∧ R ≤
        // MAX_SWEEP_REPLICATES → 总仿真 ≤ 复合值),恒可达的保守兜底;
        // 有效收紧由各壳层以 [`crate::sweep::sim_work`] 按自身预算常量判定。
        let total_candidates = self.population as usize * (self.generations as usize + 1);
        if total_candidates > MAX_CANDIDATES {
            return Err(Error::Config(format!(
                "寻优候选数 {total_candidates}(population × (generations + 1))超上限 {MAX_CANDIDATES}(文档 12 章:先算成本账)"
            )));
        }
        let total_sims = (total_candidates as u64).saturating_mul(self.replicates as u64);
        let core_sims_cap =
            (MAX_CANDIDATES as u64).saturating_mul(crate::config::MAX_SWEEP_REPLICATES as u64);
        if total_sims > core_sims_cap {
            return Err(Error::Config(format!(
                "寻优总仿真 {total_sims}(候选 × replicates)超核心上界 {core_sims_cap}(文档 12 章:先算成本账)"
            )));
        }
        Ok(())
    }

    /// 评估用的扫描 spec(run_candidate 的复用面):参数与约束原样搬运。
    pub(super) fn eval_spec(&self) -> SweepSpec {
        SweepSpec {
            mode: SweepMode::Grid,
            parameters: self.parameters.clone(),
            replicates: self.replicates,
            samples: 0,
            targets: self.targets.clone(),
        }
    }
}
