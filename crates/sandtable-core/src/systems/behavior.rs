//! 行为系统:每日会话数与动作选择(文档 03 章 Actor 的概率行为模型)。

use crate::config::{ActorBehaviorConfig, Cohort, SimConfig};
use crate::rng::{DayRng, Purpose};

/// 一次会话中的动作。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// 打当前层副本
    Dungeon,
    /// 强化(金币足够时)
    Upgrade,
    /// 闲逛:打低一层
    Explore,
}

/// 当日会话数:整数部分 + 小数部分作为补 1 概率。
/// 消耗 1 个 Behavior 事件。
pub fn n_sessions(rng: &mut DayRng, cohort: Cohort, cfg: &SimConfig) -> u32 {
    let b: &ActorBehaviorConfig = cfg.behavior.for_cohort(cohort);
    if b.sessions_frac > 0.0 && rng.chance(Purpose::Behavior, b.sessions_frac) {
        b.sessions_int + 1
    } else {
        b.sessions_int
    }
}

/// 动作选择。消耗 1 个 Behavior 事件。
/// 选中升级但金币不足时回退为副本,保证动作总可执行。
pub fn choose_action(
    rng: &mut DayRng,
    cohort: Cohort,
    cfg: &SimConfig,
    can_afford: bool,
) -> Action {
    let b = cfg.behavior.for_cohort(cohort);
    let roll = rng.draw(Purpose::Behavior).f64();
    if roll < b.p_dungeon {
        Action::Dungeon
    } else if roll < b.p_dungeon + b.p_upgrade {
        if can_afford {
            Action::Upgrade
        } else {
            Action::Dungeon
        }
    } else {
        Action::Explore
    }
}
