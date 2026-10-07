//! 内置游戏系统(文档 03/16 章)。Phase 1 为硬编码实现,Phase 2 迁入
//! 配置驱动并定义 System trait。
//!
//! 确定性约束:所有随机消费经 [`crate::rng::DayRng`] 带键派生;战斗轮次
//! 用显式序号键,与前面的战斗打了多少轮无关。

pub mod behavior;
pub mod churn;
pub mod combat;
pub mod progression;
