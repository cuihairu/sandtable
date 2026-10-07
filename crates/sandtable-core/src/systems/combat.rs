//! 战斗系统:解析结算(文档 05 章)。
//!
//! 一场战斗是一个事件:内部按回合推进,但不是 Fixed Tick——没有时间轴,
//! 只有回合序号;MVP 不需要帧级机制,结算一次得出胜负与产出。
//!
//! 随机键约定:第 k 场战斗(k = battle_index)第 r 轮,玩家侧键为
//! `k * ROUND_STRIDE + r`,怪物侧键为 `k * ROUND_STRIDE + MAX_ROUND_SLOTS + r`
//! (hit 与 damage 是不同 purpose)。因此前面战斗的回合数变化不会错位后续
//! 战斗的随机路径,玩家与怪物的键空间互不重叠(文档 06 章)。

use crate::config::SimConfig;
use crate::rng::{DayRng, Purpose, MAX_ROUND_SLOTS};

/// 一场战斗占用的键空间:玩家与怪物各 MAX_ROUND_SLOTS。
const ROUND_STRIDE: u32 = 2 * MAX_ROUND_SLOTS;

/// 第 t 层怪物数值(由配置推导;t 从 0 起)。
#[derive(Debug, Clone)]
pub struct Monster {
    pub tier: u32,
    pub hp: i64,
    pub attack: i64,
    pub defense: i64,
    pub gold: i64,
    pub xp: i64,
}

/// 由配置计算第 tier 层怪物。
pub fn monster_of(cfg: &SimConfig, tier: u32) -> Monster {
    let d = &cfg.dungeon;
    let g = d.tier_growth.powi(tier as i32);
    let rg = d.reward_growth.powi(tier as i32);
    Monster {
        tier,
        hp: (d.m_hp as f64 * g) as i64,
        attack: (d.m_attack as f64 * g) as i64,
        defense: (d.m_defense as f64 * g) as i64,
        gold: (d.reward_gold as f64 * rg) as i64,
        xp: (d.reward_xp as f64 * rg) as i64,
    }
}

/// 怪物综合战力(与 Actor::power_of 同口径,供测试与后续系统参考)。
pub fn monster_power(m: &Monster) -> i64 {
    m.attack * 2 + m.defense + m.hp / 10
}

/// 玩家选层:从最高层往下,取第一个满足两个确定性估算条件的层:
/// ① 期望清剿轮数(必中口径)≤ [`CLEAR_BUDGET_ROUNDS`](不磨超时);
/// ② 期望承伤(计入怪物命中率)≤ 生命八成(不送死)。
/// 都不满足则退回第 0 层。估算用期望值、不消耗随机数,保持确定性。
pub fn pick_tier(attack: i64, defense: i64, hp: i64, cfg: &SimConfig) -> u32 {
    for t in (0..cfg.dungeon.tiers).rev() {
        let m = monster_of(cfg, t);
        let dmg_out = (attack - m.defense).max(1);
        let rounds = ceil_div(m.hp, dmg_out);
        if rounds > CLEAR_BUDGET_ROUNDS {
            continue;
        }
        let dmg_in = (m.attack - defense).max(0);
        if dmg_in > 0 {
            let incoming = (rounds as f64 * cfg.combat.p_hit_monster * dmg_in as f64) as i64;
            if incoming > hp * 8 / 10 {
                continue;
            }
        }
        return t;
    }
    0
}

/// 选层的清剿轮数预算(远小于 max_rounds,留命中波动的余量)。
pub const CLEAR_BUDGET_ROUNDS: u32 = 20;

fn ceil_div(a: i64, b: i64) -> u32 {
    ((a + b - 1) / b) as u32
}

/// 战斗结算结果。
#[derive(Debug, Clone, Copy)]
pub struct BattleOutcome {
    pub win: bool,
    pub rounds: u32,
    /// 玩家造成的总伤害
    pub damage_dealt: i64,
    pub gold: i64,
    pub xp: i64,
}

/// 解析结算一场战斗。攻击方数值由调用方传入(玩家或测试构造)。
pub fn settle_battle(
    attack: i64,
    defense: i64,
    hp: i64,
    monster: &Monster,
    rng: &mut DayRng,
    battle_index: u32,
    cfg: &SimConfig,
) -> BattleOutcome {
    let c = &cfg.combat;
    debug_assert!(c.max_rounds <= MAX_ROUND_SLOTS, "轮数超出键槽位");
    let mut m_hp = monster.hp;
    let mut a_hp = hp;
    let mut dealt = 0;
    let key_base = battle_index * ROUND_STRIDE;
    let m_base = key_base + MAX_ROUND_SLOTS;

    for r in 0..c.max_rounds {
        // 玩家先手
        if rng
            .draw_indexed(Purpose::CombatHit, key_base + r)
            .chance(c.p_hit)
        {
            let var = rng
                .draw_indexed(Purpose::CombatDamage, key_base + r)
                .range_i64(-c.dmg_var, c.dmg_var);
            let dmg = (attack - monster.defense + var).max(1);
            m_hp -= dmg;
            dealt += dmg;
        }
        if m_hp <= 0 {
            return BattleOutcome {
                win: true,
                rounds: r + 1,
                damage_dealt: dealt,
                gold: monster.gold,
                xp: monster.xp,
            };
        }
        // 怪物反击(键空间与玩家错开 MAX_ROUND_SLOTS)
        if rng
            .draw_indexed(Purpose::CombatHit, m_base + r)
            .chance(c.p_hit_monster)
        {
            let var = rng
                .draw_indexed(Purpose::CombatDamage, m_base + r)
                .range_i64(-c.dmg_var, c.dmg_var);
            a_hp -= (monster.attack - defense + var).max(1);
        }
        if a_hp <= 0 {
            return BattleOutcome {
                win: false,
                rounds: r + 1,
                damage_dealt: dealt,
                gold: 0,
                xp: 0,
            };
        }
    }
    // 超时判负(磨不死怪物)
    BattleOutcome {
        win: false,
        rounds: c.max_rounds,
        damage_dealt: dealt,
        gold: 0,
        xp: 0,
    }
}
