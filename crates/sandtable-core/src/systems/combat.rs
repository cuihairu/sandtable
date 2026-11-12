//! 战斗系统:解析结算(文档 05 章)。
//!
//! 一场战斗是一个事件:内部按回合推进,但不是 Fixed Tick——没有时间轴,
//! 只有回合序号;MVP 不需要帧级机制,结算一次得出胜负与产出。
//!
//! 随机键约定:第 k 场战斗(k = battle_index)第 r 轮,玩家侧键为
//! `k * ROUND_STRIDE + r`,怪物侧键为 `k * ROUND_STRIDE + MAX_ROUND_SLOTS + r`
//! (hit 与 damage 是不同 purpose)。因此前面战斗的回合数变化不会错位后续
//! 战斗的随机路径,玩家与怪物的键空间互不重叠(文档 06 章)。

use crate::config::{DamageModel, SimConfig};
use crate::rng::{DayRng, Purpose, MAX_ROUND_SLOTS};

/// 一场战斗占用的键空间:玩家与怪物各 MAX_ROUND_SLOTS。
const ROUND_STRIDE: u32 = 2 * MAX_ROUND_SLOTS;

/// 单击伤害(文档 21 阻力 #1 两口径):差值 = attack − defense + var;
/// 比值 = ratio_k·attack/(attack + defense) + var。同下限 1、浮动同叠加点,
/// 比值口径先按 f64 合成再取整(两次截断会系统性偏低)。
fn strike_damage(cfg: &SimConfig, attack: i64, defense: i64, var: i64) -> i64 {
    let c = &cfg.combat;
    match c.damage_model {
        Some(DamageModel::Ratio) => {
            // 加法留在 f64 域:极端派生值(attack 逼近 i64::MAX)在 i64 域相加
            // 会溢出,f64 域不溢出且口径不变(ST-AUD-15)
            ((c.ratio_k * attack as f64 / (attack as f64 + defense as f64) + var as f64) as i64)
                .max(1)
        }
        // 差值口径同口径饱和:减法/加法都可能触界
        _ => attack.saturating_sub(defense).saturating_add(var).max(1),
    }
}

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
///
/// 数值形状二选一(文档 21 章):`tier_table` 给出时按层取值,行内产出缺省
/// 回退几何;否则按第 0 层 × 增长率几何推导。表模式下 tier 越界(tier ≥ 表长)
/// 同样回退几何,供 `validate` 之外的调用兜底。
pub fn monster_of(cfg: &SimConfig, tier: u32) -> Monster {
    let d = &cfg.dungeon;
    if let Some(rows) = &d.tier_table {
        if let Some(r) = rows.get(tier as usize) {
            let rg = d.reward_gold_growth.powi(tier as i32);
            let rx = d.reward_xp_growth.powi(tier as i32);
            return Monster {
                tier,
                hp: r.hp,
                attack: r.attack,
                defense: r.defense,
                gold: r.gold.unwrap_or((d.reward_gold as f64 * rg) as i64),
                xp: r.xp.unwrap_or((d.reward_xp as f64 * rx) as i64),
            };
        }
    }
    let g = d.tier_growth.powi(tier as i32);
    let rg = d.reward_gold_growth.powi(tier as i32);
    let rx = d.reward_xp_growth.powi(tier as i32);
    Monster {
        tier,
        hp: (d.m_hp as f64 * g) as i64,
        attack: (d.m_attack as f64 * g) as i64,
        defense: (d.m_defense as f64 * g) as i64,
        gold: (d.reward_gold as f64 * rg) as i64,
        xp: (d.reward_xp as f64 * rx) as i64,
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
    let ratio = matches!(cfg.combat.damage_model, Some(DamageModel::Ratio));
    for t in (0..cfg.dungeon.tiers).rev() {
        let m = monster_of(cfg, t);
        // 期望口径(必中、零浮动)与 settle_battle 同式:比值口径下限同样取 1
        // (弱打强仍有少量伤害,轮数有限);差值口径承伤下限 0(打不穿 = 零承伤)
        let dmg_out = if ratio {
            // 估算式全程饱和(2026-11-12 审核复核):练级增益累加走饱和后
            // attack/defense/hp 可达 i64 边界,入口门不含 level_*_gain,
            // 裸 i64 和/积在 debug 构建 panic、release 回绕使选层失真——
            // 与 strike_damage 同口径
            ((cfg.combat.ratio_k * attack as f64 / attack.saturating_add(m.defense) as f64) as i64)
                .max(1)
        } else {
            attack.saturating_sub(m.defense).max(1)
        };
        let rounds = ceil_div(m.hp, dmg_out);
        if rounds > CLEAR_BUDGET_ROUNDS {
            continue;
        }
        let dmg_in = if ratio {
            ((cfg.combat.ratio_k * m.attack as f64 / m.attack.saturating_add(defense) as f64)
                as i64)
                .max(1)
        } else {
            m.attack.saturating_sub(defense).max(0)
        };
        if dmg_in > 0 {
            let incoming = (rounds as f64 * cfg.combat.p_hit_monster * dmg_in as f64) as i64;
            if incoming > hp.saturating_mul(8).saturating_div(10) {
                continue;
            }
        }
        return t;
    }
    0
}

/// 选层的清剿轮数预算(远小于 max_rounds,留命中波动的余量)。
pub const CLEAR_BUDGET_ROUNDS: u32 = 20;

/// 向上取整除法。先除后补余(不用 `a + b - 1`:巨值 a/b 在求和处溢出
/// i64),商超 u32::MAX 时饱和——上层按「轮数过大 → 弃层」处理,而非
/// 回绕成小轮数使选层失真(2026-11-12 审核修复批 P1)。
fn ceil_div(a: i64, b: i64) -> u32 {
    debug_assert!(b > 0);
    let q = a / b;
    if q >= u32::MAX as i64 {
        u32::MAX
    } else {
        (q + (a % b > 0) as i64) as u32
    }
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
            let dmg = strike_damage(cfg, attack, monster.defense, var);
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
            a_hp -= strike_damage(cfg, monster.attack, defense, var);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{
        CombatConfig, DamageModel, DungeonConfig, SimConfig, TierRow, MAX_ECONOMY_VALUE,
    };

    /// 2026-11-12 审核修复批 P1:ceil_div 先除后补余,巨值被除数不再经
    /// `a + b - 1` 溢出 i64(debug panic);商超 u32::MAX 饱和,上层按
    /// 「轮数过大 → 弃层」处理而非回绕成小轮数使选层失真。
    #[test]
    fn ceil_div_saturates_instead_of_overflowing() {
        assert_eq!(ceil_div(10, 3), 4);
        assert_eq!(ceil_div(9, 3), 3);
        assert_eq!(ceil_div(0, 1), 0);
        // 旧实现 (i64::MAX + 0) 直接溢出:debug panic / release 回绕为负
        assert_eq!(ceil_div(i64::MAX, 1), u32::MAX);
        assert_eq!(ceil_div(MAX_ECONOMY_VALUE, 1), u32::MAX);
    }

    /// 巨 hp 最高层进选层:估算轮数饱和 → 弃层落回可达层,debug/release
    /// 同结果(pokemon 等真实案例的层表量级不受影响)。
    #[test]
    fn pick_tier_skips_overflow_sized_tier() {
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 2,
                tier_table: Some(vec![
                    TierRow {
                        hp: 10,
                        attack: 1,
                        defense: 1,
                        gold: None,
                        xp: None,
                    },
                    TierRow {
                        hp: MAX_ECONOMY_VALUE,
                        attack: 1,
                        defense: 1,
                        gold: None,
                        xp: None,
                    },
                ]),
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        let w = &cfg.warrior;
        assert_eq!(pick_tier(w.attack, w.defense, w.hp, &cfg), 0);
    }

    /// 2026-11-12 审核复核:练级增益累加走饱和(`level_*_gain` 无入口门)后,
    /// attack/defense/hp 可到达 i64 边界;选层估算式此前裸做 i64 和/积——
    /// `hp * 8` 在 debug 构建 panic、release 回绕为负使承伤守卫永假(最高层
    /// 被误弃),比值式在 `attack + m.defense` 处 overflow panic。
    #[test]
    fn pick_tier_tolerates_saturated_actor_stats() {
        let mk = |model: Option<DamageModel>| SimConfig {
            dungeon: DungeonConfig {
                tiers: 2,
                tier_table: Some(vec![
                    TierRow {
                        hp: 10,
                        attack: 1,
                        defense: 1,
                        gold: None,
                        xp: None,
                    },
                    TierRow {
                        hp: 1_000_000,
                        attack: 2,
                        defense: 2,
                        gold: None,
                        xp: None,
                    },
                ]),
                ..DungeonConfig::default()
            },
            combat: CombatConfig {
                damage_model: model,
                ..CombatConfig::default()
            },
            ..SimConfig::default()
        };
        // hp 饱和到 i64 上界(练级 hp 增益饱和所致):承伤守卫 `hp * 8 / 10`
        // 须与普通大 hp 同判,不 panic、不回绕成负
        let diff = mk(None);
        assert_eq!(
            pick_tier(100, 1, i64::MAX, &diff),
            pick_tier(100, 1, 1_000_000, &diff)
        );
        // 比值口径:两条估算式的分母此前裸加 i64,attack/defense 触界即溢出
        let ratio = mk(Some(DamageModel::Ratio));
        assert!(pick_tier(i64::MAX, i64::MAX, i64::MAX, &ratio) < ratio.dungeon.tiers);
        // 差值口径同值边界
        assert!(pick_tier(i64::MAX, i64::MIN, i64::MAX, &diff) < diff.dungeon.tiers);
    }
}
