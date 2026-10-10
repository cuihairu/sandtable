//! 执行循环(文档 05 章分层时间模型的宏观层):以"天"为粒度的离散事件推进,
//! 由通用内核([`crate::kernel`] 的 Clock / EventQueue / System)驱动。
//!
//! 事件调度(与 Phase 1 的双层 for 循环逐位对应):第 d 天依次入队
//! `DayOpen(d)` → 每个玩家一个 `PlayerDay`(id 升序)→ `DayClose(d)`;
//! 事件按 (tick, seq) 全序出队,出队序即入队序——重构不改行为,
//! 黄金快照逐字节一致是验收线。
//!
//! 每个玩家每天的事件序列:
//! 会话数抽样 → 逐会话动作选择(副本 / 强化 / 闲逛)→ 战斗解析结算 →
//! 奖励入账与成长 → 日结战力 → 停滞计数 → 流失伯努利。
//!
//! 确定性:玩家按 id 升序处理(顺序不影响结果——随机数全按键派生,
//! 这里只是让执行序固定);第 r 个 replicate 的种子为 base_seed + r,
//! 分群也按 replicate 种子派生,replicate 间独立,A/B 臂间同键可比(CRN)。

use crate::config::{Cohort, SimConfig};
use crate::kernel::{Clock, EventQueue, System};
use crate::metrics::{cohort_slice, RunMetrics, SNAPSHOT_DAYS};
use crate::rng::{DayRng, Purpose};
use crate::systems::{
    behavior::{self, Action},
    churn, combat, gacha, progression,
};
use crate::world::World;

/// 仿真事件(宏观层)。三类事件各有唯一订阅系统。
#[derive(Debug, Clone, Copy)]
enum SimEvent {
    /// 日初:记录期初存活数(当日流失不影响当日 churn_rate 分母)
    DayOpen { day: u32 },
    /// 玩家日:一个玩家一天的全部行为与状态变更
    PlayerDay { actor_id: u64, day: u32 },
    /// 日结:存量 G(d)、Power 观测、快照日分布
    DayClose { day: u32 },
    /// 抽卡会话(文档 24 章 R2):开号"出到即止",tick 0(第 1 天之前)
    GachaRoll { actor_id: u64 },
}

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

    // 一次性调度全部事件;(tick, seq) 全序保证出队序 = 逐日 id 升序的
    // 老双层循环序(浮点聚合顺序不变,指标逐位一致)。抽卡会话排在 tick 0
    // (Clock 起点,先于第 1 天):开号行为,不属于任何一天。
    let mut queue = EventQueue::new();
    if cfg.gacha.is_some() {
        for id in 0..u64::from(cfg.players) {
            queue.push(0, SimEvent::GachaRoll { actor_id: id });
        }
    }
    for day in 1..=cfg.days {
        queue.push(u64::from(day), SimEvent::DayOpen { day });
        for id in 0..u64::from(cfg.players) {
            queue.push(u64::from(day), SimEvent::PlayerDay { actor_id: id, day });
        }
        queue.push(u64::from(day), SimEvent::DayClose { day });
    }

    let mut systems: Vec<Box<dyn System<World, SimEvent> + '_>> = vec![
        Box::new(DayOpenSystem),
        Box::new(PlayerDaySystem {
            cfg,
            seed,
            xp_formula: &xp_needed_formula,
        }),
        Box::new(DayCloseSystem { cfg }),
        Box::new(GachaRollSystem { cfg, seed }),
    ];

    let mut clock = Clock::start();
    while let Some((tick, event)) = queue.pop() {
        clock.advance_to(tick);
        // MVP 中每类事件恰好有一个订阅系统:命中即派发
        for sys in &mut systems {
            if sys.subscribed(&event) {
                sys.update(&mut world, tick, event);
                break;
            }
        }
    }

    // finish 的 config_hash 输入必须是外层 cfg(base_seed 未被 replicate 覆盖)
    world.agg.finish(cfg, replicate, seed)
}

/// 日初系统:记录期初存活数,供日结的 churn_rate 分母使用。
struct DayOpenSystem;

impl System<World, SimEvent> for DayOpenSystem {
    fn name(&self) -> &'static str {
        "day_open"
    }

    fn subscribed(&self, event: &SimEvent) -> bool {
        matches!(event, SimEvent::DayOpen { .. })
    }

    fn update(&mut self, world: &mut World, _tick: u64, event: SimEvent) {
        let SimEvent::DayOpen { day } = event else {
            unreachable!("subscribed 已过滤非 DayOpen 事件")
        };
        let alive = world.actors.iter().filter(|a| !a.churned).count() as u64;
        world.alive_at_start[day as usize] = alive;
    }
}

/// 玩家日系统:一个玩家一天的全部行为(会话 → 动作 → 战斗 → 成长 → 流失)。
struct PlayerDaySystem<'a> {
    cfg: &'a SimConfig,
    seed: u64,
    xp_formula: &'a crate::formula::Formula,
}

impl System<World, SimEvent> for PlayerDaySystem<'_> {
    fn name(&self) -> &'static str {
        "player_day"
    }

    fn subscribed(&self, event: &SimEvent) -> bool {
        matches!(event, SimEvent::PlayerDay { .. })
    }

    fn update(&mut self, world: &mut World, _tick: u64, event: SimEvent) {
        let SimEvent::PlayerDay { actor_id, day } = event else {
            unreachable!("subscribed 已过滤非 PlayerDay 事件")
        };
        let cfg = self.cfg;
        let actor = &mut world.actors[actor_id as usize];
        if actor.churned {
            return;
        }
        let mut rng = DayRng::new(self.seed, actor.id, day);
        let sessions = behavior::n_sessions(&mut rng, actor.cohort, cfg);
        if sessions == 0 {
            // 当日不活跃:不计留存,不推进停滞计数(连续"活跃日"无增长才停滞)
            actor.active = false;
            return;
        }
        actor.active = true;
        let is_whale = actor.cohort == Cohort::Whale;
        let mult = if is_whale { cfg.whale_gain_mult } else { 1 };
        let agg = &mut world.agg;
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
                Action::Training => {
                    // 练级产出面(阻力 #4):金币经验入账、升级推进,不进战斗统计
                    if let Some(t) = cfg.training {
                        let gold_gain = t.gold * mult;
                        let xp_gain = t.xp * mult;
                        actor.gold += gold_gain;
                        let levelups =
                            progression::gain_xp(actor, xp_gain, &cfg.progression, self.xp_formula);
                        agg.record_levelup(levelups);
                        agg.record_training(gold_gain as u64);
                    }
                }
                action @ (Action::Dungeon | Action::Explore) => {
                    let mut tier = combat::pick_tier(actor.attack, actor.defense, actor.hp, cfg);
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
                        let levelups =
                            progression::gain_xp(actor, xp_gain, &cfg.progression, self.xp_formula);
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
}

/// 抽卡会话系统(文档 24 章 R2):每个玩家一次"出到即止"会话,逐抽
/// 消耗 Purpose::Gacha 事件直到命中;命中数计入 E[T] 分母。
struct GachaRollSystem<'a> {
    cfg: &'a SimConfig,
    seed: u64,
}

impl System<World, SimEvent> for GachaRollSystem<'_> {
    fn name(&self) -> &'static str {
        "gacha_roll"
    }

    fn subscribed(&self, event: &SimEvent) -> bool {
        matches!(event, SimEvent::GachaRoll { .. })
    }

    fn update(&mut self, world: &mut World, _tick: u64, event: SimEvent) {
        let SimEvent::GachaRoll { actor_id } = event else {
            unreachable!("subscribed 已过滤非 GachaRoll 事件")
        };
        let Some(gc) = self.cfg.gacha.as_ref() else {
            return; // 未配置抽卡不会调度本事件,防御性跳过
        };
        let seed = self.seed;
        let actor = &mut world.actors[actor_id as usize];
        let mut rng = DayRng::new(seed, actor_id, 0);
        let pulls = gacha::pull_until_hit(&mut rng, actor, gc);
        world.agg.record_gacha(pulls, 1);
    }
}

/// 日结系统:存续玩家的存量 G(d)、Power 观测、快照日分布、期末分群切片。
struct DayCloseSystem<'a> {
    cfg: &'a SimConfig,
}

impl System<World, SimEvent> for DayCloseSystem<'_> {
    fn name(&self) -> &'static str {
        "day_close"
    }

    fn subscribed(&self, event: &SimEvent) -> bool {
        matches!(event, SimEvent::DayClose { .. })
    }

    fn update(&mut self, world: &mut World, _tick: u64, event: SimEvent) {
        let SimEvent::DayClose { day } = event else {
            unreachable!("subscribed 已过滤非 DayClose 事件")
        };
        let is_snapshot = SNAPSHOT_DAYS.contains(&day);
        let alive_at_start = world.alive_at_start[day as usize];
        let mut supply = 0i64;
        let mut snapshot_powers = Vec::new();
        let agg = &mut world.agg;
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
        let cohort_final = if day == self.cfg.days {
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

    /// 比值口径闭式解(文档 21 阻力 #1):必中零浮动下
    /// dmg = floor(k·attack/(attack+defense)),轮数 = ceil(hp / dmg)。
    #[test]
    fn 比值战斗_闭式解() {
        let mut cfg = SimConfig::default();
        cfg.combat.p_hit = 1.0;
        cfg.combat.p_hit_monster = 0.0;
        cfg.combat.dmg_var = 0;
        cfg.combat.max_rounds = 32;
        cfg.combat.damage_model = Some(crate::config::DamageModel::Ratio);
        cfg.combat.ratio_k = 200.0;
        let m = monster_of(&cfg, 0); // hp 300, defense 20
        let mut rng = DayRng::new(1, 1, 1);
        // dmg = floor(200·120/140) = 171/轮 → 2 轮打完 300
        let out = settle_battle(120, 80, 1000, &m, &mut rng, 0, &cfg);
        assert!(out.win);
        assert_eq!(out.rounds, 2);
        assert_eq!(out.damage_dealt, 342);
    }

    /// 比值口径的平滑性(阻力 #1 根因):attack ≪ defense 时差值口径钳到 1
    /// 磨不死(见超时判负测试),比值口径按比例仍有伤害、有限轮内可胜。
    #[test]
    fn 比值战斗_弱打强不钳底() {
        let mut cfg = SimConfig::default();
        cfg.combat.p_hit = 1.0;
        cfg.combat.p_hit_monster = 0.0;
        cfg.combat.dmg_var = 0;
        cfg.combat.max_rounds = 32;
        cfg.combat.damage_model = Some(crate::config::DamageModel::Ratio);
        cfg.combat.ratio_k = 200.0;
        let m = monster_of(&cfg, 0); // hp 300, defense 20
        let mut rng = DayRng::new(1, 1, 1);
        // dmg = floor(200·10/30) = 66/轮 → 5 轮打完(差值口径同输入只有 1/轮,超时判负)
        let out = settle_battle(10, 80, 1000, &m, &mut rng, 0, &cfg);
        assert!(out.win);
        assert_eq!(out.rounds, 5);
    }

    /// 练级产出面(阻力 #4):p_training 满概率时全分群只练级——金币经验
    /// 入账、升级推进;战斗计数与胜率不动(练级不是战斗,不虚增胜率)。
    #[test]
    fn 练级产出_入账且不进战斗统计() {
        let mut cfg = SimConfig {
            players: 1,
            days: 1,
            base_seed: 7,
            ..SimConfig::default()
        };
        cfg.cohort_weights = [1.0, 0.0, 0.0]; // 全 casual,产出无 whale 倍率,可手算
        cfg.training = Some(crate::config::TrainingConfig { xp: 200, gold: 30 });
        for c in crate::config::Cohort::ALL {
            let b = cfg.behavior.for_cohort_mut(c);
            b.sessions_int = 1;
            b.sessions_frac = 0.0;
            b.p_dungeon = 0.0;
            b.p_upgrade = 0.0;
            b.p_training = 1.0;
        }
        let m = run(&cfg, 0);
        let day1 = &m.day_stats[0];
        assert_eq!(day1.battles, 0);
        assert_eq!(day1.win_rate, 0.0);
        assert_eq!(day1.gold_earned, 30);
        // 200 xp:升 1 级(60)后余 140 < xp_needed(2) = floor(60·2^1.3) = 147
        assert_eq!(day1.levelups, 1);
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

    /// 抽卡 KPI(文档 24 章 R2):2%/50 硬保底下 E[T] 对齐解析解
    /// Σ t·0.98^(t−1)·0.02 + 50·0.98^49 ≈ 31.79;未配置 gacha 时
    /// gacha_pulls_to_hit 为 None(不进 JSON,黄金快照不变)。
    #[test]
    fn 抽卡_期望抽数对齐解析解() {
        let cfg = SimConfig {
            players: 2000,
            days: 1,
            gacha: Some(crate::config::GachaConfig {
                base_rate: 0.02,
                pity_hard: 50,
                pity_soft_start: 0,
                pity_soft_step: 0.0,
            }),
            ..SimConfig::default()
        };
        let m = run(&cfg, 0);
        let et = m.gacha_pulls_to_hit.expect("配置了 gacha 应有 E[T]");
        let p: f64 = 0.02;
        let analytic: f64 = (1..=49)
            .map(|t| t as f64 * (1.0 - p).powi(t - 1) * p)
            .sum::<f64>()
            + 50.0 * (1.0 - p).powi(49);
        assert!(
            (et - analytic).abs() < 1.0,
            "E[T] 解析 {analytic} vs 实测 {et}"
        );

        let plain = SimConfig {
            players: 10,
            days: 1,
            ..SimConfig::default()
        };
        assert!(run(&plain, 0).gacha_pulls_to_hit.is_none());
    }

    /// 硬保底方向:保底越近 E[T] 越小(10 抽保底 ≈ 9.15 < 50 抽保底 ≈ 31.79)。
    #[test]
    fn 抽卡_硬保底越近抽数越少() {
        let base = SimConfig {
            players: 2000,
            days: 1,
            gacha: Some(crate::config::GachaConfig {
                base_rate: 0.02,
                pity_hard: 50,
                pity_soft_start: 0,
                pity_soft_step: 0.0,
            }),
            ..SimConfig::default()
        };
        let mut near = base.clone();
        near.gacha.as_mut().unwrap().pity_hard = 10;
        let a = run(&base, 0);
        let b = run(&near, 0);
        let ea = a.gacha_pulls_to_hit.unwrap();
        let eb = b.gacha_pulls_to_hit.unwrap();
        assert!(eb < ea, "10 抽保底 E[T]={eb} 应 < 50 抽保底 E[T]={ea}");
        assert!((eb - 9.15).abs() < 1.0, "10 抽保底 E[T] ≈ 9.15,实测 {eb}");
    }

    /// 保底参数不进 RNG 键(CRN):只改 pity_hard 的 A/B 臂,日统计与
    /// 分群逐位一致(键未挪),仅抽卡 KPI 不同。
    #[test]
    fn 抽卡_改保底不挪键() {
        let base = SimConfig {
            players: 300,
            days: 5,
            gacha: Some(crate::config::GachaConfig {
                base_rate: 0.02,
                pity_hard: 50,
                pity_soft_start: 0,
                pity_soft_step: 0.0,
            }),
            ..SimConfig::default()
        };
        let mut arm_b = base.clone();
        arm_b.gacha.as_mut().unwrap().pity_hard = 10;
        let a = run(&base, 2);
        let b = run(&arm_b, 2);
        assert_eq!(a.seed, b.seed);
        assert_eq!(a.day1_cohort, b.day1_cohort);
        assert_eq!(
            serde_json::to_string(&a.day_stats).unwrap(),
            serde_json::to_string(&b.day_stats).unwrap(),
            "保底参数不挪键:日统计应逐位一致"
        );
        assert_ne!(a.config_hash, b.config_hash);
        assert!(
            b.gacha_pulls_to_hit.unwrap() < a.gacha_pulls_to_hit.unwrap(),
            "B 臂保底更近,E[T] 应更小"
        );
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
