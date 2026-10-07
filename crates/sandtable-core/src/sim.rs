//! 执行循环(文档 05 章分层时间模型的宏观层):以"天"为粒度的离散事件推进。
//!
//! 每个玩家每天的事件序列:
//! 会话数抽样 → 逐会话动作选择(副本 / 强化 / 闲逛)→ 战斗解析结算 →
//! 奖励入账与成长 → 日结战力 → 停滞计数 → 流失伯努利。
//!
//! 确定性:玩家按 id 升序处理(顺序不影响结果——随机数全按键派生,
//! 这里只是让执行序固定);第 r 个 replicate 的种子为 base_seed + r,
//! 分群也按 replicate 种子派生,replicate 间独立,A/B 臂间同键可比(CRN)。

use crate::config::{Cohort, SimConfig};
use crate::metrics::{cohort_slice, RunAggregator, RunMetrics, SNAPSHOT_DAYS};
use crate::rng::{DayRng, Purpose};
use crate::systems::{
    behavior::{self, Action},
    churn, combat, progression,
};
use crate::world::World;

/// 运行第 `replicate` 个 replicate(0 起),返回该次运行的完整指标。
pub fn run(cfg: &SimConfig, replicate: u32) -> RunMetrics {
    let seed = crate::config::replicate_seed(cfg.base_seed, replicate);
    // 公式槽在 run 开始编译一次(文档 07 章加载期编译);非法公式已在
    // config::validate 拦截,这里直接假定可编译。
    let xp_needed_formula =
        crate::formula::compile(&cfg.formulas.xp_needed, crate::formula::XP_NEEDED_VARS)
            .expect("formulas.xp_needed 编译失败:SimConfig 未经 config::validate");
    // 分群派生也用 replicate 种子:replicate 间独立,同 r 的 A/B 臂分群相同
    let mut run_cfg = cfg.clone();
    run_cfg.base_seed = seed;
    let mut world = World::new(run_cfg);
    let mut agg = RunAggregator::new(cfg);

    for day in 1..=cfg.days {
        let alive_at_start = world.actors.iter().filter(|a| !a.churned).count() as u64;

        for actor in world.actors.iter_mut() {
            if actor.churned {
                continue;
            }
            let mut rng = DayRng::new(seed, actor.id, day);
            let sessions = behavior::n_sessions(&mut rng, actor.cohort, cfg);
            if sessions == 0 {
                // 当日不活跃:不计留存,不推进停滞计数(连续"活跃日"无增长才停滞)
                actor.active = false;
                continue;
            }
            actor.active = true;
            let is_whale = actor.cohort == Cohort::Whale;
            let mult = if is_whale { cfg.whale_gain_mult } else { 1 };
            agg.mark_active(day, actor.in_day1_cohort);
            if day == 1 {
                actor.in_day1_cohort = true;
            }

            let power_before = actor.power;
            let mut battle_index = 0u32;
            for _ in 0..sessions {
                let affordable = progression::can_afford(actor);
                match behavior::choose_action(&mut rng, actor.cohort, cfg, affordable) {
                    Action::Upgrade => {
                        let cost = progression::upgrade_cost(actor);
                        progression::apply_upgrade(actor, &cfg.progression);
                        agg.record_upgrade(cost);
                    }
                    action @ (Action::Dungeon | Action::Explore) => {
                        let mut tier =
                            combat::pick_tier(actor.attack, actor.defense, actor.hp, cfg);
                        if action == Action::Explore {
                            tier = tier.saturating_sub(1);
                        }
                        let monster = combat::monster_of(cfg, tier);
                        let out = combat::settle_battle(
                            actor.attack,
                            actor.defense,
                            actor.hp,
                            &monster,
                            &mut rng,
                            battle_index,
                            cfg,
                        );
                        battle_index += 1;
                        if out.win {
                            let gold_gain = out.gold * mult;
                            let xp_gain = out.xp * mult;
                            actor.gold += gold_gain;
                            let levelups = progression::gain_xp(
                                actor,
                                xp_gain,
                                &cfg.progression,
                                &xp_needed_formula,
                            );
                            agg.record_levelup(levelups);
                            agg.record_battle(true, gold_gain as u64, is_whale);
                        } else {
                            agg.record_battle(false, 0, is_whale);
                        }
                    }
                }
            }
            actor.recompute_power();

            // 停滞计数:活跃日无战力增长 +1,有增长清零
            if actor.power > power_before {
                actor.idle_streak = 0;
            } else {
                actor.idle_streak += 1;
            }

            // 流失判定:每日一次伯努利,停滞抬升概率
            let p_churn = churn::churn_probability(actor.idle_streak, &cfg.churn);
            if rng.chance(Purpose::Churn, p_churn) {
                actor.churned = true;
                agg.record_churn();
            }
        }

        // 日结:存续玩家的存量 G(d)、Power 观测、快照日分布
        let is_snapshot = SNAPSHOT_DAYS.contains(&day);
        let mut supply = 0i64;
        let mut snapshot_powers = Vec::new();
        for a in &world.actors {
            if a.churned {
                continue;
            }
            supply += a.gold;
            agg.observe_power(a.power);
            if is_snapshot {
                snapshot_powers.push(a.power);
            }
        }
        let cohort_final = if day == cfg.days {
            Some(cohort_slice(&world.actors))
        } else {
            None
        };
        agg.end_day(
            day,
            alive_at_start,
            supply,
            &snapshot_powers,
            cohort_final.as_deref(),
        );
    }

    agg.finish(cfg, replicate, seed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rng::DayRng;
    use crate::systems::combat::{monster_of, settle_battle};

    /// 固定伤害、必中、怪物不还手的解析战斗有闭式解:
    /// 轮数 = ceil(hp / (attack − defense)),伤害 = 轮数 × (attack − defense)。
    #[test]
    fn 解析战斗_闭式解() {
        let mut cfg = SimConfig::default();
        cfg.combat.p_hit = 1.0;
        cfg.combat.p_hit_monster = 0.0;
        cfg.combat.dmg_var = 0;
        cfg.combat.max_rounds = 32;
        let m = monster_of(&cfg, 0); // hp 300, defense 20
        let mut rng = DayRng::new(1, 1, 1);
        let out = settle_battle(120, 80, 1000, &m, &mut rng, 0, &cfg);
        // dmg = 120 - 20 = 100/轮 → 3 轮打完 300
        assert!(out.win);
        assert_eq!(out.rounds, 3);
        assert_eq!(out.damage_dealt, 300);
        assert_eq!(out.gold, cfg.dungeon.reward_gold);
        assert_eq!(out.xp, cfg.dungeon.reward_xp);
    }

    /// 超时判负:磨不死 = 战败。
    #[test]
    fn 解析战斗_超时判负() {
        let mut cfg = SimConfig::default();
        cfg.combat.p_hit = 1.0;
        cfg.combat.p_hit_monster = 0.0;
        cfg.combat.dmg_var = 0;
        cfg.combat.max_rounds = 4;
        let m = monster_of(&cfg, 0); // hp 300
        let mut rng = DayRng::new(1, 1, 1);
        // 每轮只造成 1 点(攻击不破防,max(1, ...) 兜底)
        let out = settle_battle(10, 80, 1000, &m, &mut rng, 0, &cfg);
        assert!(!out.win);
        assert_eq!(out.rounds, 4);
        assert_eq!(out.damage_dealt, 4);
    }

    /// 确定收入:必中、零浮动、全分群只打副本,单日金币收入 = 会话数 ×
    /// 对应层产出,与种子无关(随机性被关掉后逐玩家可手算)。
    #[test]
    fn 确定收入_单日() {
        let mut cfg = SimConfig {
            players: 1,
            days: 1,
            base_seed: 7,
            combat: crate::config::CombatConfig {
                p_hit: 1.0,
                p_hit_monster: 0.0,
                dmg_var: 0,
                ..SimConfig::default().combat
            },
            ..SimConfig::default()
        };
        // 全分群只打副本、会话数固定 1(随机性被关掉后逐玩家可手算)
        for c in crate::config::Cohort::ALL {
            let b = cfg.behavior.for_cohort_mut(c);
            b.sessions_int = 1;
            b.sessions_frac = 0.0;
            b.p_dungeon = 1.0;
            b.p_upgrade = 0.0;
        }
        let m = run(&cfg, 0);
        assert_eq!(m.day1_cohort, 1);
        // 选层:第 3 层需 31 轮(> 20 预算)被跳过,选到第 2 层
        let day1 = &m.day_stats[0];
        assert_eq!(day1.battles, 1);
        assert_eq!(day1.gold_earned, 78); // 40 * 1.4^2 = 78.4 → 78
        assert_eq!(day1.win_rate, 1.0);
        assert_eq!(m.win_rate, 1.0);
    }

    /// 流失机制:把流失概率拉满,第 1 天全活跃、第 2 天全流失。
    #[test]
    fn 流失_拉满概率() {
        let cfg = SimConfig {
            players: 50,
            days: 5,
            churn: crate::config::ChurnConfig {
                p_base: 1.0,
                p_stall: 1.0,
                ..SimConfig::default().churn
            },
            ..SimConfig::default()
        };
        let m = run(&cfg, 0);
        assert_eq!(m.day1_cohort, 50);
        assert_eq!(m.churn_total, 50);
        assert_eq!(m.retention_d1, Some(1.0));
        assert_eq!(m.retention_d3, Some(0.0));
    }

    /// 确定性:同配置同 replicate 两次运行,指标完全一致。
    #[test]
    fn 确定性_两次运行一致() {
        let cfg = SimConfig {
            players: 200,
            days: 10,
            ..SimConfig::default()
        };
        let a = run(&cfg, 0);
        let b = run(&cfg, 0);
        assert_eq!(a.config_hash, b.config_hash);
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
    }

    /// CRN:A/B 两臂同 replicate 的种子与分群一致(配对比较的前提)。
    #[test]
    fn crn_两臂同键() {
        let base = SimConfig {
            players: 100,
            days: 5,
            ..SimConfig::default()
        };
        let mut arm_b = base.clone();
        arm_b.warrior.attack = 105;
        let a = run(&base, 3);
        let b = run(&arm_b, 3);
        assert_eq!(a.seed, b.seed);
        assert_eq!(a.day1_cohort, b.day1_cohort);
        assert_ne!(a.config_hash, b.config_hash);
    }

    /// A/B 方向:攻击大幅提升 → 金币产出严格增加(CRN 配对下逐 replicate 同向)。
    #[test]
    fn ab_攻击提升收益增加() {
        let base = SimConfig {
            players: 300,
            days: 10,
            ..SimConfig::default()
        };
        let mut arm_b = base.clone();
        arm_b.warrior.attack = 400;
        for r in 0..3 {
            let a = run(&base, r);
            let b = run(&arm_b, r);
            assert!(
                b.gold_earned_total > a.gold_earned_total,
                "replicate {r}: B 产出 {} 应大于 A 产出 {}",
                b.gold_earned_total,
                a.gold_earned_total
            );
        }
    }

    /// 公式槽接入执行循环(文档 07 章):只改配置里的公式、不改代码,
    /// 实验行为随之改变——升级更便宜 → 升级数严格更多、期末等级更高。
    #[test]
    fn 自定义公式_改配置改变行为() {
        let base = SimConfig {
            players: 200,
            days: 10,
            ..SimConfig::default()
        };
        let mut fast = base.clone();
        fast.formulas.xp_needed = "level * 5".into();
        let a = run(&base, 0);
        let b = run(&fast, 0);
        let total_levelups =
            |m: &crate::metrics::RunMetrics| m.day_stats.iter().map(|d| d.levelups).sum::<u64>();
        assert_ne!(a.config_hash, b.config_hash);
        assert!(
            total_levelups(&b) > total_levelups(&a),
            "更便宜的升级公式应产生更多升级:{} vs {}",
            total_levelups(&b),
            total_levelups(&a)
        );
        let mean_level = |m: &crate::metrics::RunMetrics| {
            m.cohort_stats
                .iter()
                .map(|c| c.mean_level * c.count as f64)
                .sum::<f64>()
                / m.cohort_stats.iter().map(|c| c.count as f64).sum::<f64>()
        };
        assert!(mean_level(&b) > mean_level(&a));
    }
}
