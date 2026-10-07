//! 成长系统:经验 / 升级 / 强化 / 战力(文档 16 章闭环的成长环节)。

use crate::config::ProgressionConfig;
use crate::world::Actor;

/// 升到 level+1 所需经验:floor(xp_base * level^xp_pow)。
pub fn xp_needed(level: u32, p: &ProgressionConfig) -> i64 {
    (p.xp_base as f64 * (level as f64).powf(p.xp_pow)) as i64
}

/// 发放经验并结算升级(可连升)。返回升级次数。
pub fn gain_xp(actor: &mut Actor, amount: i64, p: &ProgressionConfig) -> u32 {
    actor.xp_into_level += amount;
    let mut levelups = 0;
    while actor.xp_into_level >= xp_needed(actor.level, p) {
        actor.xp_into_level -= xp_needed(actor.level, p);
        actor.level += 1;
        actor.attack += p.level_attack_gain;
        actor.defense += p.level_defense_gain;
        actor.hp += p.level_hp_gain;
        levelups += 1;
    }
    levelups
}

/// 强化一次:扣成本、加攻击、推进整数成本链 cost = cost * num / den。
/// 调用前先用 `can_afford` 判断。
pub fn upgrade_cost(actor: &Actor) -> i64 {
    actor.upgrade_cost_next
}

pub fn can_afford(actor: &Actor) -> bool {
    actor.gold >= actor.upgrade_cost_next
}

pub fn apply_upgrade(actor: &mut Actor, p: &ProgressionConfig) {
    actor.gold -= actor.upgrade_cost_next;
    actor.attack += p.upgrade_attack_gain;
    actor.upgrades += 1;
    actor.upgrade_cost_next = actor.upgrade_cost_next * p.upgrade_cost_num / p.upgrade_cost_den;
}
