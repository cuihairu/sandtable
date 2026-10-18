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
    run_impl(cfg, replicate, None)
}

/// 日粒度批量观测钩子(脚本层阶段 3,实测依据 scripts/scripting-perf-report.md):
/// 每日 [`SimEvent::DayClose`] 记账完成后调用一次,拿到当天日结的世界状态。
/// **只读契约**——实现不得改动 World,同配置同 seed 结果与 [`run`] 逐位一致
/// (测试锁死)。粒度红线(设计稿 §4):本通道 = 每天一次,事件级 Python
/// 回调仍禁止(10⁷ 事件 × ns 级调用即超基线,实测报告有数据)。
pub trait DayHook {
    fn on_day(&mut self, world: &World, day: u32);
}

/// 带日观测钩子的运行:除逐日回调外,语义与 [`run`] 完全一致。
pub fn run_with_day_hook(cfg: &SimConfig, replicate: u32, hook: &mut dyn DayHook) -> RunMetrics {
    run_impl(cfg, replicate, Some(hook))
}

fn run_impl(cfg: &SimConfig, replicate: u32, mut hook: Option<&mut dyn DayHook>) -> RunMetrics {
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

    // 按日滚动调度(审核整改 P1:一次性排入 players×days 事件会让队列
    // 随规模线性膨胀,10 万人 × 90 天 ≈ 900 万事件)。第 1 日先入队,
    // 此后每个 DayClose{d} 处理完再排入 d+1 日。出队序与一次性预排逐位
    // 一致:(tick, seq) 全序下,同 tick 内 seq 升序(DayOpen → 玩家日 →
    // DayClose 的入队序不变),跨 tick 由 tick 定序,滚动入队不改变任何
    // 相对次序。抽卡会话排在 tick 0(Clock 起点,先于第 1 天):开号
    // 行为,不属于任何一天。
    let mut queue = EventQueue::new();
    if cfg.gacha.is_some() {
        for id in 0..u64::from(cfg.players) {
            queue.push(0, SimEvent::GachaRoll { actor_id: id });
        }
    }
    schedule_day(&mut queue, 1, cfg.players);

    let mut systems = build_systems(cfg, seed, &xp_needed_formula);

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
        // 日粒度观测钩子:DayClose 系统记账完成后的世界状态,只读(阶段 3;
        // None 时零分支成本路径外的纯检查,黄金快照不受影响)
        if let (SimEvent::DayClose { day }, Some(h)) = (event, hook.as_deref_mut()) {
            h.on_day(&world, day);
        }
        // 滚动调度:当日关闭后排队次日(最后一天不再排,队列自然排空)
        if let SimEvent::DayClose { day } = event {
            if day < cfg.days {
                schedule_day(&mut queue, day + 1, cfg.players);
            }
        }
    }

    // finish 的 config_hash 输入必须是外层 cfg(base_seed 未被 replicate 覆盖)
    world.agg.finish(cfg, replicate, seed)
}

/// 排入一个日粒度的事件组(DayOpen → 全部玩家日 → DayClose;同 tick 内
/// 按入队 seq 定序)。滚动调度用,见 run_impl 注释。
fn schedule_day(queue: &mut EventQueue<SimEvent>, day: u32, players: u32) {
    queue.push(u64::from(day), SimEvent::DayOpen { day });
    for id in 0..u64::from(players) {
        queue.push(u64::from(day), SimEvent::PlayerDay { actor_id: id, day });
    }
    queue.push(u64::from(day), SimEvent::DayClose { day });
}

/// 调度面注册(run_impl 与 [`system_registry`] 共用同一构造,快照不可能与实况漂移)。
fn build_systems<'a>(
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

/// 事件种类(调度面快照用)。[`probe_event`] 的 match **无通配符**:
/// 新增 SimEvent 变体必须在此补臂,否则编译失败——事件清单漏登记不可能静默。
#[derive(Debug, Clone, Copy)]
pub enum EventKind {
    DayOpen,
    PlayerDay,
    DayClose,
    GachaRoll,
}

impl EventKind {
    /// 图与日志展示名(与 SimEvent 变体同名)。
    pub fn name(self) -> &'static str {
        match self {
            EventKind::DayOpen => "DayOpen",
            EventKind::PlayerDay => "PlayerDay",
            EventKind::DayClose => "DayClose",
            EventKind::GachaRoll => "GachaRoll",
        }
    }
}

const ALL_EVENT_KINDS: &[EventKind] = &[
    EventKind::DayOpen,
    EventKind::PlayerDay,
    EventKind::DayClose,
    EventKind::GachaRoll,
];

fn probe_event(kind: EventKind) -> SimEvent {
    match kind {
        EventKind::DayOpen => SimEvent::DayOpen { day: 0 },
        EventKind::PlayerDay => SimEvent::PlayerDay {
            actor_id: 0,
            day: 0,
        },
        EventKind::DayClose => SimEvent::DayClose { day: 0 },
        EventKind::GachaRoll => SimEvent::GachaRoll { actor_id: 0 },
    }
}

/// 调度面快照:`(系统名, 订阅事件名列表)`,按注册序(= 派发序)。
///
/// 供文档系统图生成器(`examples/system_graph.rs`)使用:对每个注册系统
/// 逐事件真实调用 `subscribed`,订阅矩阵与代码同源。入参须为经 validate 的
/// 配置(默认配置恒合法);`seed` 仅参与系统构造,不影响订阅面。
pub fn system_registry(cfg: &SimConfig, seed: u64) -> Vec<(String, Vec<&'static str>)> {
    // 与 run_impl 同法局部 clone:系统与公式同域,借期可统一
    let cfg = cfg.clone();
    let xp_needed_formula =
        crate::formula::compile(&cfg.formulas.xp_needed, crate::formula::XP_NEEDED_VARS)
            .expect("formulas.xp_needed 编译失败:SimConfig 未经 config::validate");
    let systems = build_systems(&cfg, seed, &xp_needed_formula);
    systems
        .iter()
        .map(|sys| {
            let events: Vec<&'static str> = ALL_EVENT_KINDS
                .iter()
                .filter(|k| sys.subscribed(&probe_event(**k)))
                .map(|k| k.name())
                .collect();
            (sys.name().to_string(), events)
        })
        .collect()
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
                        let mut gold_gain = out.gold * mult;
                        let mut xp_gain = out.xp * mult;
                        // 掉落结算(docs/loot-settlement-design.md):胜利时从绑定
                        // 的表抽一次——独立键维度 Purpose::Loot,不扰动战斗流;
                        // 数额乘 rate_mult 四舍五入,金币随战斗金币同口径乘鲸鱼
                        // 倍率,经验走 gain_xp 级联
                        if let (Some(wt), Some(loot)) = (&self.loot_table, &cfg.loot) {
                            let idx = rng.weighted(crate::rng::Purpose::Loot, wt);
                            if let Some(name) = wt.names().get(idx) {
                                if let Some(r) = loot.rewards.get(name) {
                                    let g =
                                        ((r.gold as f64) * loot.rate_mult).round() as i64 * mult;
                                    let x = ((r.xp as f64) * loot.rate_mult).round() as i64 * mult;
                                    gold_gain += g;
                                    xp_gain += x;
                                    if g > 0 {
                                        agg.record_loot(g as u64);
                                    }
                                }
                            }
                        }
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

    /// 日粒度观测钩子(阶段 3 通道):收集逐日 {存活数, 非流失金币存量,
    /// 流失数},与 DayClose 记账对账。
    struct CollectHook {
        days: Vec<(u64, i64, u64)>,
    }

    impl DayHook for CollectHook {
        fn on_day(&mut self, world: &World, day: u32) {
            let mut alive = 0u64;
            let mut gold = 0i64;
            let mut churned = 0u64;
            for a in &world.actors {
                if a.churned {
                    churned += 1;
                } else {
                    alive += 1;
                    gold += a.gold;
                }
            }
            self.days.push((u64::from(day), gold, churned));
            let _ = alive;
        }
    }

    /// 钩子只读:带钩子与不带钩子同配置同 seed 逐位一致(零行为变化);
    /// 逐日观测的金币存量与 DayClose 记账的 gold_supply 同源;天序 1..=days。
    #[test]
    fn day_hook_readonly_and_matches_day_stats() {
        let cfg = SimConfig {
            players: 60,
            days: 8,
            ..SimConfig::default()
        };
        let baseline = run(&cfg, 3);
        let mut hook = CollectHook { days: Vec::new() };
        let with_hook = run_with_day_hook(&cfg, 3, &mut hook);
        assert_eq!(
            serde_json::to_string(&baseline).unwrap(),
            serde_json::to_string(&with_hook).unwrap(),
            "只读钩子不得改变任何结果"
        );
        assert_eq!(hook.days.len(), usize::try_from(cfg.days).unwrap());
        for (i, d) in with_hook.day_stats.iter().enumerate() {
            let (day, gold, _churned) = hook.days[i];
            assert_eq!(day, u64::from(d.day), "钩子按天序 1..=days 回调");
            assert_eq!(
                gold, d.gold_supply,
                "day {}: 钩子看到的非流失金币存量应与 DayClose 记账同源",
                d.day
            );
        }
    }

    /// 固定伤害、必中、怪物不还手的解析战斗有闭式解:
    /// 轮数 = ceil(hp / (attack − defense)),伤害 = 轮数 × (attack − defense)。
    #[test]
    fn analytic_battle_closed_form() {
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
    fn analytic_battle_timeout_losses() {
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
    fn ratio_battle_closed_form() {
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
    fn ratio_battle_no_floor_clamp() {
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
    fn training_income_booked_not_in_battle() {
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
    fn deterministic_income_single_day() {
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
    fn churn_max_probability() {
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
    fn determinism_two_runs_identical() {
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
    fn crn_both_arms_same_keys() {
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
    fn gacha_pulls_match_closed_form() {
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
    fn gacha_hard_pity_reduces_pulls() {
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
    fn gacha_pity_change_keeps_keys() {
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
    fn ab_attack_up_income_up() {
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
    fn custom_formula_changes_behavior() {
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

    /// 金币守恒(文档 19 章测试面补强):经济面恰好三个流——战斗产出、
    /// 练级产出、升级消耗,每处记账与 actor.gold 增减同源(world 初始化
    /// gold = 0,期初存量为 0)。零流失下逐日闭合:
    /// supply(d) − supply(d−1) = earned(d) − spent(d)。
    /// 流失携金离场不记账,守恒式以 new_churned == 0 为前提;未来若要求
    /// 流失口径入账,先给 DayStat 加字段再放宽本测试。
    #[test]
    fn gold_conservation_zero_churn_daily() {
        let mut cfg = SimConfig {
            players: 200,
            days: 10,
            ..SimConfig::default()
        };
        cfg.churn.p_base = 0.0;
        cfg.churn.p_stall = 0.0;
        let m = run(&cfg, 0);

        let mut prev = 0i64; // 期初存量
        for d in &m.day_stats {
            assert_eq!(d.new_churned, 0, "day {}: 前提是零流失", d.day);
            assert_eq!(
                d.gold_supply - prev,
                d.gold_earned as i64 - d.gold_spent as i64,
                "day {}: 期末 {} − 前日 {} 应等于产出 {} − 消耗 {}",
                d.day,
                d.gold_supply,
                prev,
                d.gold_earned,
                d.gold_spent
            );
            prev = d.gold_supply;
        }
        // 汇总面同闭合
        let earned: u64 = m.day_stats.iter().map(|d| d.gold_earned).sum();
        let spent: u64 = m.day_stats.iter().map(|d| d.gold_spent).sum();
        assert_eq!(earned, m.gold_earned_total);
        assert_eq!(spent, m.gold_spent_total);
        // 两个方向都真实发生,防止恒等式在全 0 下空转
        assert!(m.gold_earned_total > 0);
        assert!(m.gold_spent_total > 0);
    }

    /// 调度面快照契约(方向项定义草案 §2 方案 A 的代码侧锚):
    /// 每类事件恰好一个订阅系统,且事件全集无遗漏(sim.rs:102 调度不变量)。
    #[test]
    fn system_registry_matches_dispatch_contract() {
        let reg = system_registry(&SimConfig::default(), 0);
        let names: Vec<&str> = reg.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            vec!["day_open", "player_day", "day_close", "gacha_roll"]
        );
        for (name, events) in &reg {
            assert_eq!(
                events.len(),
                1,
                "MVP 中每类事件恰好有一个订阅系统:{name} 订阅了 {events:?}"
            );
        }
        // 事件全集恰好被覆盖一次:漏登记或重复订阅都会在这里红
        let mut subscribed: Vec<&str> = reg.iter().flat_map(|(_, e)| e.iter().copied()).collect();
        subscribed.sort_unstable();
        subscribed.dedup();
        assert_eq!(
            subscribed.len(),
            ALL_EVENT_KINDS.len(),
            "事件与订阅矩阵不再双射:{subscribed:?} vs {ALL_EVENT_KINDS:?}"
        );
    }

    /// 掉落结算(docs/loot-settlement-design.md):`Purpose::Loot` 是独立键
    /// 维度——仅 loot 配置不同的 A/B 两臂,金币 / 战斗路径逐位相同(经验型
    /// 掉落只抬战力);金币型掉落按预期抬高产出并给出 `loot_gold_per_player`
    /// 切片指标,未配置时无值且可用性预检报「未配置」。
    #[test]
    fn loot_settlement_crn_isolation() {
        fn loot_cfg(gold: i64, xp: i64) -> crate::config::LootConfig {
            crate::config::LootConfig {
                rate_mult: 1.0,
                on_victory: "chest".to_string(),
                tables: [(
                    "chest".to_string(),
                    crate::config::LootTableConfig {
                        weights: [("drop".to_string(), 1.0)].into_iter().collect(),
                    },
                )]
                .into_iter()
                .collect(),
                rewards: [("drop".to_string(), crate::config::LootReward { gold, xp })]
                    .into_iter()
                    .collect(),
            }
        }
        let base = SimConfig {
            players: 200,
            days: 5,
            ..SimConfig::default()
        };
        let a = run(&base, 0);

        // 键维度隔离(rng 层,逐位):插入 Purpose::Loot 抽取不得扰动任何
        // 其他 purpose 的取值序列——计数器按 purpose 分立(counters 数组),
        // 这是 CRN 成立的机制本体。端到端面允许合法发散:经验抬升战力 →
        // 同键随机数下胜负阈值位移 → 金币随之变化,是玩法反馈环而非串扰。
        {
            let mut r0 = crate::rng::DayRng::new(7, 1, 1);
            let combat_before: Vec<u64> = (0..3)
                .map(|_| r0.draw(crate::rng::Purpose::CombatHit).u64())
                .collect();
            let churn_before = r0.draw(crate::rng::Purpose::Churn).u64();
            let mut r1 = crate::rng::DayRng::new(7, 1, 1);
            let _ = r1.draw(crate::rng::Purpose::Loot).u64();
            let combat_after: Vec<u64> = (0..3)
                .map(|_| r1.draw(crate::rng::Purpose::CombatHit).u64())
                .collect();
            let churn_after = r1.draw(crate::rng::Purpose::Churn).u64();
            assert_eq!(combat_before, combat_after, "Loot 抽取不得扰动战斗流");
            assert_eq!(churn_before, churn_after, "Loot 抽取不得扰动流失流");
        }

        // 经验型掉落:战力抬升、升级与产出同向(确定性种子下恒成立)
        let mut armed_xp = base.clone();
        armed_xp.loot = Some(loot_cfg(0, 50));
        let b = run(&armed_xp, 0);
        assert!(
            b.power_snapshots.last().unwrap().p50 > a.power_snapshots.last().unwrap().p50,
            "经验掉落应抬升期末战力"
        );
        // 直接机械效应:更多经验严格更多升级(确定性种子下恒成立)
        let levelups =
            |m: &crate::metrics::RunMetrics| m.day_stats.iter().map(|d| d.levelups).sum::<u64>();
        assert!(levelups(&b) > levelups(&a), "经验掉落应产生更多升级");
        // 胜率不设方向断言:pick_tier 按战力自选更高层,变强后打更难的怪,
        // 胜率可升可降(本种子下微降);人均产出随单胜金币抬层不减
        assert!(
            b.gold_earned_total >= a.gold_earned_total,
            "更高层的胜利金币不应降低产出"
        );
        // 金币切片只计金币掉落:纯经验奖励下指标不出现(切片口径非战斗口径)
        assert!(
            b.loot_gold_per_player.is_none(),
            "纯经验掉落不得产生金币切片:{:?}",
            b.loot_gold_per_player
        );

        // 金币型掉落:产出抬高 + 切片指标有值
        let mut armed_gold = base.clone();
        armed_gold.loot = Some(loot_cfg(10, 0));
        let c = run(&armed_gold, 0);
        assert!(
            c.gold_earned_total > a.gold_earned_total,
            "金币掉落应抬高产出"
        );
        let per_player = c.loot_gold_per_player.expect("配置了 loot 应有切片指标");
        assert!(per_player > 0.0, "人均掉落金币应非负:{per_player}");
        assert!(a.loot_gold_per_player.is_none(), "未配置不得有该指标");

        // 指标可用性预检(审核整改 P1-5 机制)+ extract 链
        let key = crate::experiment::MetricKey::LootGoldPerPlayer;
        assert!(key.unavailable_reason(&armed_gold).is_none());
        assert!(
            key.unavailable_reason(&base).is_some(),
            "未配置时预检应报不可用"
        );
        assert!(key.extract(&c).is_some());
        assert!(key.extract(&a).is_none());
    }
}
