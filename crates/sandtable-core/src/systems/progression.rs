//! 成长系统:经验 / 升级 / 强化 / 战力(文档 16 章闭环的成长环节)。

use crate::config::ProgressionConfig;
use crate::formula::Formula;
use crate::world::Actor;

/// 升到 level+1 所需经验:公式槽 `formulas.xp_needed` 求值后截断为 i64。
/// 默认公式 `xp_base * level ^ xp_pow` 与硬编码时代的闭式实现逐位一致。
pub fn xp_needed(level: u32, p: &ProgressionConfig, f: &Formula) -> i64 {
    let env = [level as f64, p.xp_base as f64, p.xp_pow];
    f.eval(&env) as i64
}

/// 发放经验并结算升级(可连升)。返回升级次数。
pub fn gain_xp(actor: &mut Actor, amount: i64, p: &ProgressionConfig, f: &Formula) -> u32 {
    actor.xp_into_level += amount;
    let mut levelups = 0;
    loop {
        let need = xp_needed(actor.level, p, f);
        if actor.xp_into_level < need {
            break;
        }
        actor.xp_into_level -= need;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Cohort, SimConfig};
    use crate::formula;

    fn actor() -> Actor {
        let cfg = SimConfig::default();
        let mut a = Actor {
            id: 0,
            cohort: Cohort::Casual,
            attack: 100,
            defense: 80,
            hp: 1000,
            level: 1,
            xp_into_level: 0,
            upgrades: 0,
            upgrade_cost_next: cfg.progression.upgrade_cost_base,
            gold: 0,
            power: 0,
            active: false,
            churned: false,
            in_day1_cohort: false,
            idle_streak: 0,
        };
        a.recompute_power();
        a
    }

    /// 金线:默认公式必须复现硬编码时代的闭式实现(公式化不改结果)。
    #[test]
    fn 默认公式与闭式实现逐位一致() {
        let cfg = SimConfig::default();
        let f = formula::compile(&cfg.formulas.xp_needed, formula::XP_NEEDED_VARS).unwrap();
        for level in 1..200u32 {
            let want = (cfg.progression.xp_base as f64
                * (level as f64).powf(cfg.progression.xp_pow)) as i64;
            assert_eq!(
                xp_needed(level, &cfg.progression, &f),
                want,
                "level={level}"
            );
        }
    }

    /// 改公式不改代码即可改变成长节奏(文档 07 章公式引擎的动机)。
    #[test]
    fn 自定义公式改变升级节奏() {
        let cfg = SimConfig::default();
        let f = formula::compile("level * 10", formula::XP_NEEDED_VARS).unwrap();
        let mut a = actor();
        // need 链 10+20+30+40 = 100 → 连升 4 级
        let ups = gain_xp(&mut a, 100, &cfg.progression, &f);
        assert_eq!(ups, 4);
        assert_eq!(a.level, 5);
        assert_eq!(a.xp_into_level, 0);

        // 默认公式下 need(1)=60、need(2)=147,同样经验只升 1 级
        let fd = formula::compile(&cfg.formulas.xp_needed, formula::XP_NEEDED_VARS).unwrap();
        let mut b = actor();
        let ups2 = gain_xp(&mut b, 100, &cfg.progression, &fd);
        assert_eq!(ups2, 1);
        assert_eq!(b.level, 2);
        assert_eq!(b.xp_into_level, 40);
    }
}
