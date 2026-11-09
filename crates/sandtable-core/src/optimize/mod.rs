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

mod engine;
mod fitness;
mod ranking;
mod result;
mod spec;

pub use engine::optimize;
pub use fitness::{Fitness, ParetoFit};
pub use result::{GenerationStats, OptimResult};
pub use spec::{Direction, Objective, OptimMode, OptimSpec};

#[cfg(test)]
mod tests;
