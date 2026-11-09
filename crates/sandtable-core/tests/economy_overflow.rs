//! ST-AUD-15 / I-015:合法配置的运算结果溢出。入口值各有上界门,但乘法
//! 合成结果不在门内:实测(2026-11-09,debug 构建)鲸鱼倍率与掉落
//! `rate_mult` 组合下 `sim.rs` 两处 panic("attempt to multiply with
//! overflow")。修复后产出乘法、经济累计全部饱和:不 panic、不回绕,
//! 饱和值如实入账(发布构建同语义,不依赖 overflow-checks)。

use sandtable_core::config::{
    LootConfig, LootReward, LootTableConfig, SimConfig, WarriorConfig, MAX_ECONOMY_VALUE,
};
use std::collections::BTreeMap;

/// 全鲸鱼 + 必胜配置:鲸鱼倍率(mult)与战斗产出路径都被踩到。
/// 缺省攻击打不穿 m_defense(战败 → gold=0 乘不出溢出),拉满攻击保证胜利。
fn whale_cfg() -> SimConfig {
    let base = SimConfig::default();
    let mut cfg = SimConfig {
        players: 2,
        days: 3,
        cohort_weights: [0.0, 0.0, 1.0],
        warrior: WarriorConfig {
            attack: MAX_ECONOMY_VALUE,
            ..base.warrior.clone()
        },
        ..base.clone()
    };
    cfg.behavior.whale.p_dungeon = 1.0;
    cfg.behavior.whale.p_upgrade = 0.0;
    cfg.behavior.whale.p_training = 0.0;
    cfg.behavior.whale.sessions_int = 2;
    cfg.behavior.whale.sessions_frac = 0.0;
    cfg
}

/// 战斗产出 × 鲸鱼倍率:两个因子都合法(= MAX_ECONOMY_VALUE 边界),
/// 乘积 1e30 > i64::MAX。修复前 debug 构建在 `out.gold × mult` panic;
/// 修复后单场产出饱和,总量为正且不回绕。
#[test]
fn battle_gold_times_whale_mult_saturates() {
    let mut cfg = whale_cfg();
    cfg.whale_gain_mult = MAX_ECONOMY_VALUE;
    cfg.dungeon.reward_gold = MAX_ECONOMY_VALUE;
    let m = sandtable_core::sim::run(&cfg, 1);
    assert!(m.gold_earned_total > 0, "胜利产出应入账:{m:?}");
    assert!(m.churn_rate_total.is_finite(), "指标应有限");
}

/// 掉落 rate_mult 无上界门(只查有限正数):1e300 × gold → inf →
/// 饱和转 i64::MAX → 再乘鲸鱼倍率。修复前 debug 构建在掉落 `× mult` panic;
/// 修复后饱和入账,掉落切片仍是有限值。
#[test]
fn loot_rate_mult_saturation_does_not_panic() {
    let mut cfg = whale_cfg();
    let mut weights = BTreeMap::new();
    weights.insert("r".to_string(), 1.0_f64);
    let mut tables = BTreeMap::new();
    tables.insert("t".to_string(), LootTableConfig { weights });
    let mut rewards = BTreeMap::new();
    rewards.insert("r".to_string(), LootReward { gold: 1, xp: 0 });
    cfg.loot = Some(LootConfig {
        rate_mult: 1e300,
        on_victory: "t".to_string(),
        tables,
        rewards,
    });
    let m = sandtable_core::sim::run(&cfg, 1);
    let loot = m.loot_gold_per_player.expect("掉落应入账");
    assert!(loot.is_finite(), "掉落切片应有限:{loot}");
    assert!(m.gold_earned_total > 0, "全额产出应入账");
}

/// 练级产出 × 鲸鱼倍率:金币路径 1e15 × 1e6 = 1e21 > i64::MAX(修复前
/// debug 构建在 `t.gold × mult` panic),经验路径取小值——i64::MAX 级经验
/// 会让升级循环跑 ~1e9 级(分钟级耗时),经验预算饱和改由 progression
/// 单元测试直接证明。
#[test]
fn training_gain_times_whale_mult_saturates() {
    let mut cfg = whale_cfg();
    cfg.whale_gain_mult = 1_000_000;
    cfg.training = Some(sandtable_core::config::TrainingConfig {
        xp: 100,
        gold: MAX_ECONOMY_VALUE,
    });
    cfg.behavior.whale.p_dungeon = 0.0;
    cfg.behavior.whale.p_training = 1.0;
    let m = sandtable_core::sim::run(&cfg, 1);
    assert!(m.gold_earned_total > 0, "练级产出应入账:{m:?}");
}
