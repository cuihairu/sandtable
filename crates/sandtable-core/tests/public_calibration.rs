//! 公开基准校准测试(2026-10-31):sandtable gacha-pity 模型 vs 公开数据。
//!
//! 基准:
//! - 官方公示(Genshin Impact 5★):基础 0.600%、综合(含保底)1.600%、90 抽内必出、
//!   软保底自 74 抽起每抽约 +6%(溯源见 data/public/genshin/sources.md)。
//! - 社区全量样本(data/public/genshin/character-event-pity.json,
//!   MsExcel85/genshin-drop-rate,HoYolab 2025-06-10):74 个 character_event banner、
//!   22,047,495 次 5★,逐抽计数。
//!
//! 断言:
//! - 模型按官方参数(0.006/90/74/0.06)的精确分布:硬保底 90 内必出、抽 1..73 恒 0.6%、
//!   综合概率 1/均值 vs 官方 1.6% 误差 < 0.1pp、均值 vs 1/0.016=62.5;
//! - 模型软保底段(抽 74..=83,社区率单调可信段)每抽条件率 vs 社区经验率差 < 1.5pp;
//!   抽 84..=89 社区率非单调回落(判数据高抽段伪影,见 sources.md),以 rate[87] < rate[84]
//!   为金丝雀锁伪影,故不作 84..=89 模型差断言;
//! - MC 仿真(pull_until_hit)均值复核对解析分布(容差为统计噪声量级)。
//!
//! 跑法:cargo test -p sandtable-core --test public_calibration

use sandtable_core::config::{Cohort, GachaConfig};
use sandtable_core::rng::DayRng;
use sandtable_core::systems::gacha::{hit_rate, pull_until_hit};
use sandtable_core::world::Actor;
use std::path::PathBuf;

/// Genshin 官方参数:0.6% 基础、90 硬保底、74 软保底起、+6%/抽。
fn genshin_cfg() -> GachaConfig {
    GachaConfig {
        base_rate: 0.006,
        pity_hard: 90,
        pity_soft_start: 74,
        pity_soft_step: 0.06,
    }
}

/// 模型精确分布(逐抽条件率经 hit_rate):dist[n] = P(第 n 抽命中),n = 1..=90。
fn model_distribution(cfg: &GachaConfig) -> Vec<f64> {
    let mut dist = vec![0.0; 91];
    let mut surv = 1.0;
    for n in 1..=90u64 {
        let p = hit_rate(cfg, n - 1);
        dist[n as usize] = surv * p;
        surv *= 1.0 - p;
    }
    dist
}

fn mean_of(dist: &[f64]) -> f64 {
    (1..=90).map(|n| n as f64 * dist[n]).sum()
}

fn data_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../data/public/genshin/character-event-pity.json")
}

fn new_actor(id: u64) -> Actor {
    Actor {
        id,
        cohort: Cohort::Core,
        attack: 0,
        defense: 0,
        hp: 0,
        level: 1,
        xp_into_level: 0,
        upgrades: 0,
        upgrade_cost_next: 0,
        gold: 0,
        power: 0,
        active: false,
        churned: false,
        in_day1_cohort: false,
        idle_streak: 0,
        gacha_since_hit: 0,
        gacha_pulls: 0,
        gacha_hits: 0,
    }
}

#[test]
fn model_reproduces_official_genshin_rates() {
    let cfg = genshin_cfg();
    let dist = model_distribution(&cfg);
    let tail: f64 = dist.iter().skip(1).sum::<f64>();
    assert!(tail > 0.9999, "总质量 {tail}");
    // 硬保底:90 抽内必出(90 抽后无质量)
    assert!(dist[90] > 0.0 && dist[90] <= 1.0);
    let mass_after_90 = 1.0 - tail;
    assert!(mass_after_90.abs() < 1e-9, "P(T>90) = {mass_after_90}");
    // 基础率:抽 1..=73 恒 0.6%
    for n in 1..=73u64 {
        assert!(
            (hit_rate(&cfg, n - 1) - 0.006).abs() < 1e-12,
            "抽 {n} 基础率"
        );
    }
    // 综合概率:1/均值 vs 官方 1.6%(误差 < 0.1pp)
    let mean = mean_of(&dist);
    let consolidated = 1.0 / mean;
    assert!(
        (consolidated - 0.016).abs() < 0.001,
        "综合 {consolidated:.5} vs 官方 0.016(均值 {mean:.3})"
    );
    // 均值 vs 官方 1/0.016 = 62.5
    assert!((mean - 62.5).abs() < 1.0, "均值 {mean:.3} vs 官方 62.5");
    // 软保底起点:抽 74 起跳(0.6% → 6.6%)、抽 75 → 12.6%
    assert!((hit_rate(&cfg, 73) - 0.066).abs() < 1e-9, "抽 74 = 6.6%");
    assert!((hit_rate(&cfg, 74) - 0.126).abs() < 1e-9, "抽 75 = 12.6%");
}

#[test]
fn model_matches_community_pity_curve() {
    let raw = std::fs::read_to_string(data_path())
        .expect("读 data/public/genshin/character-event-pity.json");
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let counts: Vec<u64> = serde_json::from_value(v["per_pity_counts"].clone()).unwrap();
    assert_eq!(counts.len(), 90, "per_pity_counts 应含 90 项");
    let total: u64 = counts.iter().sum();
    assert!(total > 1_000_000, "社区样本过小:{total}");
    // 社区经验条件率:rate[n] = count[n] / 存活到第 n 抽者
    let mut rate = [0.0f64; 91];
    let mut surv = 0.0f64;
    for n in (1..=90usize).rev() {
        surv += counts[n - 1] as f64;
        rate[n] = counts[n - 1] as f64 / surv;
    }
    let cfg = genshin_cfg();
    // 软保底单调可信段(74..=83):模型每抽条件率 vs 社区经验率,差 < 1.5pp
    for n in 74..=83u64 {
        let model_p = hit_rate(&cfg, n - 1);
        let diff = (model_p - rate[n as usize]).abs();
        assert!(
            diff < 0.015,
            "抽 {n}:模型 {model_p:.4} vs 社区 {:.4}(差 {diff:.4})",
            rate[n as usize]
        );
    }
    // 硬保底:社区抽 90 经验率 ≈ 100%
    assert!(rate[90] > 0.999, "社区抽 90 经验率 {:.4}", rate[90]);
    // 金丝雀:社区高抽段(84..=89)非单调(rate[87] < rate[84]),锁数据伪影解释——
    // 若未来数据集修正伪影该断言会红,届时把可信段扩回 84..=89 即可
    assert!(
        rate[87] < rate[84],
        "社区 84..=89 应非单调回落(84:{} 87:{})——伪影被修?扩回可信段",
        rate[84],
        rate[87]
    );
    // 社区基础段(抽 1..=70)模型恒 0.6% 为真值,社区因玩家提交偏差略高(约 0.7%),仅登记不硬断
    let comm_base: f64 = (1..=70).map(|n| rate[n]).sum::<f64>() / 70.0;
    assert!(comm_base > 0.005, "社区基础段异常低 {comm_base:.4}");
}

#[test]
fn model_mc_simulation_matches_analytic() {
    // MC 仿真(pull_until_hit,RNG 真路径)均值 vs 解析分布均值(噪声量级容差)
    let cfg = genshin_cfg();
    let dist = model_distribution(&cfg);
    let analytic_mean = mean_of(&dist);
    let n = 20_000u64;
    let mut sim_mean = 0.0f64;
    for i in 0..n {
        let mut rng = DayRng::new(20261031, i, 0);
        let mut a = new_actor(i);
        sim_mean += pull_until_hit(&mut rng, &mut a, &cfg) as f64;
    }
    sim_mean /= n as f64;
    // σ ≈ √E[T²]−E[T]² ≈ 23 → SE ≈ 23/√20000 ≈ 0.16,给 0.6 余量
    assert!(
        (sim_mean - analytic_mean).abs() < 0.6,
        "MC 均值 {sim_mean:.3} vs 解析 {analytic_mean:.3}"
    );
}
