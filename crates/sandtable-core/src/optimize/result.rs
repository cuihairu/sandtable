//! 结果面:逐代统计 GenerationStats 与整体 OptimResult(含前沿代表点)。

use super::fitness::Fitness;
use super::spec::OptimSpec;
use crate::sweep::CandidateResult;
use serde::Serialize;

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
