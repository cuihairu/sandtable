//! 内置系统实现(文档 05 章):日初 / 玩家日 / 抽卡 / 日结四个系统,
//! 以及调度面注册构造 [`build_systems`](run_impl 与 system_registry 共用)。
use crate::config::{Cohort, SimConfig};
use crate::kernel::System;
use crate::metrics::{cohort_slice, SNAPSHOT_DAYS};
use crate::rng::{DayRng, Purpose};
use crate::systems::{
    behavior::{self, Action},
    churn, combat, gacha, progression,
};
use crate::world::World;

use super::event::SimEvent;

/// 调度面注册(run_impl 与 [`system_registry`] 共用同一构造,快照不可能与实况漂移)。
pub(super) fn build_systems<'a>(
    cfg: &'a SimConfig,
    seed: u64,
    xp_formula: &'a crate::formula::Formula,
) -> Vec<Box<dyn System<World, SimEvent> + 'a>> {
    vec![
        Box::new(DayOpenSystem),
        Box::new(PlayerDaySystem {
            cfg,
            seed,
            xp_formula,
            loot_table: cfg.loot.as_ref().map(|loot| {
                let t = &loot.tables[&loot.on_victory];
                let weights: Vec<(String, f64)> =
                    t.weights.iter().map(|(k, v)| (k.clone(), *v)).collect();
                crate::rng::WeightedTable::from_weights(&weights)
                    .expect("validate 已保证 on_victory 表可编译")
            }),
        }),
        Box::new(DayCloseSystem { cfg }),
        Box::new(GachaRollSystem { cfg, seed }),
    ]
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
    /// 掉落结算(docs/loot-settlement-design.md):on_victory 指名表的
    /// 加载期编译产物;validate 已保证该表存在且可编译,此处不再容错
    loot_table: Option<crate::rng::WeightedTable>,
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
                        // 产出乘鲸鱼倍率可超 i64(两个因子各自 ≤ MAX_ECONOMY_VALUE
                        // 但乘积 1e30):饱和运算兜底,调试 / 发布构建都不 panic
                        // 不回绕(ST-AUD-15)
                        let gold_gain = t.gold.saturating_mul(mult);
                        let xp_gain = t.xp.saturating_mul(mult);
                        actor.gold = actor.gold.saturating_add(gold_gain);
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
                        // 战斗产出 × 鲸鱼倍率同上:saturating(ST-AUD-15 实测
                        // debug 构建在 1e15 × 1e15 处 panic)
                        let mut gold_gain = out.gold.saturating_mul(mult);
                        let mut xp_gain = out.xp.saturating_mul(mult);
                        // 掉落结算(docs/loot-settlement-design.md):胜利时从绑定
                        // 的表抽一次——独立键维度 Purpose::Loot,不扰动战斗流;
                        // 数额乘 rate_mult 四舍五入,金币随战斗金币同口径乘鲸鱼
                        // 倍率,经验走 gain_xp 级联
                        if let (Some(wt), Some(loot)) = (&self.loot_table, &cfg.loot) {
                            let idx = rng.weighted(crate::rng::Purpose::Loot, wt);
                            if let Some(name) = wt.names().get(idx) {
                                if let Some(r) = loot.rewards.get(name) {
                                    // rate_mult 只有「有限正数」门没有上界:乘积
                                    // 可为 inf(NaN → as i64 = 0,inf → 饱和转
                                    // i64::MAX),再 saturating_mul 兜底(ST-AUD-15)
                                    let g = ((r.gold as f64) * loot.rate_mult).round() as i64;
                                    let x = ((r.xp as f64) * loot.rate_mult).round() as i64;
                                    let g = g.saturating_mul(mult);
                                    let x = x.saturating_mul(mult);
                                    gold_gain = gold_gain.saturating_add(g);
                                    xp_gain = xp_gain.saturating_add(x);
                                    if g > 0 {
                                        agg.record_loot(g as u64);
                                    }
                                }
                            }
                        }
                        actor.gold = actor.gold.saturating_add(gold_gain);
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

/// 抽卡会话系统(文档 24 章 R2,2026-11-01 升级定轨层):每个玩家一次
/// "抽到所定目标"会话(`pull_until_featured`)——逐抽消耗 Purpose::Gacha
/// 直到 5★ 命中,再消耗 Purpose::GachaFeatured 判定是否为所定目标;
/// 连续非目标达 featured_guarantee 后下一次 5★ 必为目标,可能多次 5★。
/// 命中数按会话前后 gacha_hits 差值计入 E[T] 分母。
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
        let hits_before = actor.gacha_hits;
        // validate 已保证 base_rate 下限/保底,正常配置不会触达 MAX_GACHA_PULLS;
        // 若配置异常(防御纵深)仍触达,按会话超限记为该玩家本次未命中,
        // 不中断整次仿真(与「配置错误静默丢弃」相反:这是运行时不可能路径)。
        match gacha::pull_until_featured(&mut rng, actor, gc) {
            Ok(pulls) => {
                world
                    .agg
                    .record_gacha(pulls, actor.gacha_hits - hits_before);
            }
            Err(e) => {
                // 防御:记录一次超限并终止该玩家会话,避免单玩家拖垮全局。
                world.agg.record_gacha(
                    crate::config::MAX_GACHA_PULLS,
                    actor.gacha_hits - hits_before,
                );
                debug_assert!(false, "抽卡会话超限(应为 validate 前置拦截): {e}");
            }
        }
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
            // 金币存量逐玩家可达 i64::MAX(产出饱和,ST-AUD-15),合计再饱和
            supply = supply.saturating_add(a.gold);
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
