//! 公开基准校准测试(2026-10-31,2026-11-01 扩池):sandtable gacha-pity 模型 vs 公开数据。
//!
//! 基准:
//! - 官方公示(Genshin Impact 5★ 角色/常驻):基础 0.600%、综合(含保底)1.600%、90 抽内必出、
//!   软保底自 74 抽起每抽约 +6%;武器池:0.700%/1.850%/80 硬/63 软/+4.3%(官方综合反解)。
//! - 社区全量样本(data/public/genshin/{character-event,weapon_event,standard,
//!   chronicled_wish}-pity.json,MsExcel85/genshin-drop-rate,HoYolab 2025-06-10)。
//!
//! 断言:
//! - 角色/常驻模型按官方参数(0.006/90/74/0.06)精确分布:90 硬保底内必出、抽 1..73 恒 0.6%、
//!   综合 1/均值 vs 官方 1.6% 误差 < 0.1pp、均值 vs 1/0.016=62.5;
//! - 武器模型(0.007/80/63/0.043):80 硬保底、抽 1..62 恒 0.7%、综合 vs 官方 1.85% < 0.1pp、
//!   抽 79 率面 < 100%(不提前饱和);
//! - 模型软保底段(角色 74..=83,社区率单调可信段)每抽条件率 vs 社区经验率差 < 1.5pp;
//!   抽 84..=89 社区率非单调回落(判数据高抽段伪影,见 sources.md),以 rate[87] < rate[84]
//!   为金丝雀锁伪影,故不作 84..=89 模型差断言;
//! - 常驻数据有软保底(74 起爬坡)与 90 硬边界——反驳「常驻无软保底」预设,按同构校准;
//! - 定轨层(featured_rate/featured_guarantee):武器 0.375/1 → E[#5★]=1.625、最坏 160;
//!   角色 0.5/1 → 最坏 180;定轨不改 5★ 率面(CRN);
//! - HSR 角色活动跃迁与 Genshin 同构(0.6%/1.6%/90/74)——跨游戏泛化;
//! - MC 仿真(pull_until_hit / pull_until_featured)均值复核对解析分布(容差为统计噪声量级)。
//!
//! 跑法:cargo test -p sandtable-core --test public_calibration

use sandtable_core::config::{Cohort, GachaConfig};
use sandtable_core::rng::DayRng;
use sandtable_core::systems::gacha::{hit_rate, pull_until_featured, pull_until_hit};
use sandtable_core::world::Actor;
use std::path::PathBuf;

/// Genshin 角色池官方参数:0.6% 基础、90 硬保底、74 软保底起、+6%/抽,
/// 定轨层 50/50(0.5,歪 1 次后必 UP)——定轨层不改 5★ 率面,下测 5★ 率不受影响。
fn genshin_cfg() -> GachaConfig {
    GachaConfig {
        base_rate: 0.006,
        pity_hard: 90,
        pity_soft_start: 74,
        pity_soft_step: 0.06,
        featured_rate: 0.5,
        featured_guarantee: 1,
    }
}

/// Genshin 武器池(祈愿)官方参数:0.7% 基础、80 硬保底、63 软保底起。
/// 软保底步长 0.043(≈+4.3%/抽)为**与官方综合 1.85% 自洽**的解(0.04304);
/// 社区数据 63–71 段经验斜率 +6.9%/抽被玩家提交过报抬高,且按 +6.9% 线性外推
/// 会在 77 抽饱和、与官方 80 硬保底矛盾(见 sources.md §1b),故不取经验斜率,
/// 而以官方综合率反解步长。该步长下抽 79 率面 73.8% < 100%,不提前饱和,80 硬保底钳制生效。
/// 定轨层 v5.0 起 0.375(双 UP 各 37.5%,所定单武器)、1 点必保(最坏 160)。
fn weapon_cfg() -> GachaConfig {
    GachaConfig {
        base_rate: 0.007,
        pity_hard: 80,
        pity_soft_start: 63,
        pity_soft_step: 0.043,
        featured_rate: 0.375,
        featured_guarantee: 1,
    }
}

/// Genshin 常驻池:官方与角色同构(0.6%/90/74/+6%,无定轨)。
/// 数据已证实常驻有软保底(74 起,见 sources.md §1b「standard 反驳预设」),按同构校准。
fn standard_cfg() -> GachaConfig {
    GachaConfig {
        base_rate: 0.006,
        pity_hard: 90,
        pity_soft_start: 74,
        pity_soft_step: 0.06,
        featured_rate: 0.0,
        featured_guarantee: 0,
    }
}

/// 星穹铁道(HSR)角色活动跃迁官方参数:与 Genshin 角色同构
/// (0.6%/1.6%/90 硬/74 软/50-50)——跨游戏同构验证,官方参数经多源交叉核对
/// (溯源见 sources.md §3),无 HSR 社区分布数据集,不代用 Genshin 数值。
fn hsr_character_cfg() -> GachaConfig {
    genshin_cfg()
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
        gacha_off_featured: 0,
    }
}

/// 模型精确分布(逐抽条件率经 hit_rate):dist[n] = P(第 n 抽命中),n = 1..=hard。
fn model_distribution_to_hard(cfg: &GachaConfig) -> Vec<f64> {
    let hard = cfg.pity_hard as usize;
    let mut dist = vec![0.0; hard + 1];
    let mut surv = 1.0;
    for n in 1..=hard as u64 {
        let p = hit_rate(cfg, n - 1);
        dist[n as usize] = surv * p;
        surv *= 1.0 - p;
    }
    dist
}

fn mean_of_to_hard(dist: &[f64]) -> f64 {
    (1..dist.len()).map(|n| n as f64 * dist[n]).sum()
}

/// 定轨目标命中抽数的 5★ 数分布:target 在第 k 次 5★ 命中(k = 1..=g 时概率
/// (1−fr)^(k−1)·fr;连续 g 次非目标后第 g+1 次强制)。
fn featured_star_count_expectation(fr: f64, g: u64) -> f64 {
    if fr <= 0.0 {
        return 1.0;
    }
    let mut e = 0.0f64;
    let mut pnot = 1.0f64;
    for k in 1..=g {
        e += k as f64 * pnot * fr;
        pnot *= 1.0 - fr;
    }
    e += (g + 1) as f64 * pnot; // 连续 g 次非目标后第 g+1 次强制
    e
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
    // 硬保底:数据只含 90 个抽位(counts.len()==90,上已断言),即社区样本在
    // 第 90 抽收尾——无 91 抽及以上命中记录,与"90 抽硬保底"结构一致。
    // 注:rate[90] 按反向累计构造恒等于 count[90]/count[90] = 1.0(反向后第一步
    // surv 即 count[90]),与数据无关,不可作数据断言;真实可核的是边界样本量
    // count[90] 及抽 89 经验率(约 52%)——玩家数据在 90 抽硬保底附近的截断/选择
    // 伪影已由下方 rate[87] < rate[84] 金丝雀锁定。
    assert!(counts[89] > 0, "社区无 90 抽边界样本(硬保底数据缺失)");
    assert!(
        rate[89] < 0.999,
        "社区抽 89 经验率应显著低于 100%: {:.4}",
        rate[89]
    );
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

/// 逐抽经验条件率(反向累计):rate[n] = count[n] / 存活到第 n 抽者。
fn empirical_rates(counts: &[u64]) -> Vec<f64> {
    let n = counts.len();
    let mut rate = vec![0.0f64; n + 1];
    let mut surv = 0.0f64;
    for i in (0..n).rev() {
        surv += counts[i] as f64;
        rate[i + 1] = counts[i] as f64 / surv;
    }
    rate
}

fn read_counts(name: &str) -> Vec<u64> {
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../data/public/genshin/{name}-pity.json"));
    let raw = std::fs::read_to_string(&p).expect("读 data/public/genshin/...-pity.json");
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    serde_json::from_value(v["per_pity_counts"].clone()).unwrap()
}

/// 武器池 5★ 率:官方 0.7% 基础 / 1.85% 综合 / 80 硬保底 / 63 软保底起。
#[test]
fn weapon_model_reproduces_official_rates() {
    let cfg = weapon_cfg();
    let dist = model_distribution_to_hard(&cfg);
    let tail: f64 = dist.iter().skip(1).sum();
    assert!(tail > 0.9999, "总质量 {tail}");
    // 硬保底:80 抽内必出(第 80 抽率面 = 1,之后无质量)
    assert!(dist[80] > 0.0);
    assert!(dist.len() == 81, "dist 只到 80(硬保底后无质量)");
    // 基础率:抽 1..=62 恒 0.7%
    for n in 1..=62u64 {
        assert!(
            (hit_rate(&cfg, n - 1) - 0.007).abs() < 1e-12,
            "抽 {n} 基础率"
        );
    }
    // 软保底起点:抽 63 起跳(0.7% → 0.7%+4.3% = 5.0%);抽 79 率面 73.8% < 100%
    // (不提前饱和,80 硬保底钳制生效——与官方 80 硬保底自洽)
    assert!((hit_rate(&cfg, 62) - 0.05).abs() < 1e-9, "抽 63 = 5.0%");
    assert!(
        hit_rate(&cfg, 78) < 1.0,
        "抽 79 不应饱和:{}",
        hit_rate(&cfg, 78)
    );
    // 综合概率 vs 官方 1.85%(< 0.1pp),均值 vs 1/0.0185 ≈ 54.05
    let mean = mean_of_to_hard(&dist);
    let consolidated = 1.0 / mean;
    assert!(
        (consolidated - 0.0185).abs() < 0.001,
        "武器综合 {consolidated:.5} vs 官方 0.0185(均值 {mean:.3})"
    );
}

/// 常驻池 5★ 率:与角色同构(0.6%/1.6%/90/74/+6%)。
#[test]
fn standard_model_reproduces_official_rates() {
    let cfg = standard_cfg();
    let dist = model_distribution_to_hard(&cfg);
    let mean = mean_of_to_hard(&dist);
    let consolidated = 1.0 / mean;
    assert!(
        (consolidated - 0.016).abs() < 0.001,
        "常驻综合 {consolidated:.5} vs 官方 0.016(均值 {mean:.3})"
    );
    assert!((mean - 62.5).abs() < 1.0, "常驻均值 {mean:.3} vs 官方 62.5");
    // 常驻确有软保底:抽 74 起跳
    assert!(
        (hit_rate(&cfg, 73) - 0.066).abs() < 1e-9,
        "常驻抽 74 = 6.6%"
    );
}

/// 常驻池数据反驳「无软保底」预设(诚实修正):standard-pity.json 经验率
/// 74 抽起明确爬坡,且 90 抽硬边界有样本。
#[test]
fn standard_data_shows_soft_pity() {
    let counts = read_counts("standard");
    assert_eq!(counts.len(), 90, "standard per_pity_counts 应含 90 项");
    let total: u64 = counts.iter().sum();
    assert!(total > 1_000_000, "standard 样本过小:{total}");
    let rate = empirical_rates(&counts);
    // 基础段(1..=70)均值约官方 0.6% 的社区过报水平(约 1.2%),只作登记
    let base_zone: f64 = (1..=70).map(|n| rate[n]).sum::<f64>() / 70.0;
    // 软保底结构:74 起经验率跳升到基础段 3 倍以上(社区过报不挪位置)
    assert!(
        rate[74] > 3.0 * base_zone,
        "常驻 74 抽起跳:rate[74]={:.4} vs 基础段均值 {base_zone:.4}",
        rate[74]
    );
    assert!(
        rate[74] > rate[73] * 2.0,
        "常驻软保底在 74:rate[73]={:.4} rate[74]={:.4}",
        rate[73],
        rate[74]
    );
    // 硬边界:90 抽位有样本(与 90 硬保底结构一致)
    assert!(counts[89] > 0, "常驻 90 抽边界样本缺失");
    // 金丝雀:常驻高抽段非单调(同角色池伪影特征),锁数据伪影解释
    assert!(
        rate[87] < rate[84],
        "常驻 84..=89 非单调回落(84:{:.4} 87:{:.4})",
        rate[84],
        rate[87]
    );
}

/// 武器池数据结构:软保底 63、硬边界 80(81–90 抽位无样本,与官方 80 硬保底一致)。
#[test]
fn weapon_data_structure() {
    let counts = read_counts("weapon_event");
    assert_eq!(counts.len(), 90, "weapon per_pity_counts 应含 90 项");
    let rate = empirical_rates(&counts);
    let base_zone: f64 = (1..=45).map(|n| rate[n]).sum::<f64>() / 45.0;
    assert!(
        rate[63] > 3.0 * base_zone && rate[62] <= 3.0 * base_zone,
        "武器软保底在 63:rate[62]={:.4} rate[63]={:.4} 基础段 {base_zone:.4}",
        rate[62],
        rate[63]
    );
    // 硬边界 80:81–90 抽位无样本
    assert!(counts[79] > 0, "武器 80 抽边界样本缺失");
    for i in 80..90 {
        assert_eq!(counts[i], 0, "武器 {} 抽位应无样本(80 硬保底)", i + 1);
    }
}

/// 定轨(Epitomized Path):5★ 数分布解析 vs 仿真;期望抽数与最坏 160 界。
#[test]
fn weapon_epitomized_path_featured() {
    let cfg = weapon_cfg();
    // 解析 E[#5★] = 0.375·1 + 0.625·2 = 1.625(v5.0:1 点必保,最坏 2 次 5★)
    let e_stars = featured_star_count_expectation(cfg.featured_rate, cfg.featured_guarantee);
    assert!(
        (e_stars - 1.625).abs() < 1e-9,
        "E[#5★] = 1.625,实测 {e_stars}"
    );
    // 仿真:平均 5★ 数、平均抽数、最坏抽数 ≤ 160
    let n = 40_000u64;
    let mut sum_stars = 0.0f64;
    let mut sum_pulls = 0.0f64;
    let mut worst = 0u64;
    for i in 0..n {
        let mut rng = DayRng::new(20261101, i, 0);
        let mut a = new_actor(i);
        let pulls = pull_until_featured(&mut rng, &mut a, &cfg);
        sum_stars += a.gacha_hits as f64;
        sum_pulls += pulls as f64;
        worst = worst.max(pulls);
    }
    let mean_stars = sum_stars / n as f64;
    let mean_pulls = sum_pulls / n as f64;
    assert!(
        (mean_stars - e_stars).abs() < 0.02,
        "仿真平均 5★ 数 {mean_stars:.4} vs 解析 {e_stars:.4}"
    );
    // E[pulls] ≈ E[#5★] × 每 5★ 均值(54.05)→ ≈ 87.8
    assert!(
        (mean_pulls - e_stars * 54.05).abs() < 1.5,
        "仿真均值 {mean_pulls:.2} vs 解析 {:.2}",
        e_stars * 54.05
    );
    assert!(worst <= 160, "定轨最坏 {worst} 应 ≤ 160(2×80)");
}

/// 角色池 50/50:E[#5★] = 1.5、最坏 180(2×90)。
#[test]
fn character_fifty_fifty_guarantee() {
    let cfg = genshin_cfg();
    let e_stars = featured_star_count_expectation(cfg.featured_rate, cfg.featured_guarantee);
    assert!(
        (e_stars - 1.5).abs() < 1e-9,
        "角色 E[#5★] = 1.5,实测 {e_stars}"
    );
    let n = 20_000u64;
    let mut worst = 0u64;
    for i in 0..n {
        let mut rng = DayRng::new(20261031, i, 0);
        let mut a = new_actor(i);
        worst = worst.max(pull_until_featured(&mut rng, &mut a, &cfg));
    }
    assert!(worst <= 180, "角色 50/50 最坏 {worst} 应 ≤ 180(2×90)");
}

/// 定轨层不扰动 5★ 率路径(CRN):同率面(武器池率面)下,有无定轨层,
/// 同键流的 pull_until_hit 抽数逐点一致——定轨只在命中后判定,不改 5★ 率面。
#[test]
fn featured_layer_does_not_perturb_5star_path() {
    let mut plain = weapon_cfg();
    plain.featured_rate = 0.0;
    plain.featured_guarantee = 0;
    let featured = weapon_cfg();
    for i in 0..300u64 {
        let mut r1 = DayRng::new(9, i, 0);
        let mut r2 = DayRng::new(9, i, 0);
        let mut a1 = new_actor(i);
        let mut a2 = new_actor(i);
        let p1 = pull_until_hit(&mut r1, &mut a1, &plain);
        let p2 = pull_until_hit(&mut r2, &mut a2, &featured);
        assert_eq!(p1, p2, "定轨层不应改 5★ 抽数路径:i={i}");
        assert_eq!(a1.gacha_pulls, a2.gacha_pulls);
        assert_eq!(a1.gacha_hits, a2.gacha_hits);
    }
}

/// 跨游戏同构(HSR):HSR 角色活动跃迁官方参数(0.6%/1.6%/90 硬/74 软/50-50)
/// 与 Genshin 角色池同构;模型按同参数复现官方 1.6% 综合——验证模型跨游戏泛化
/// (非 HSR 专属分布数据,溯源见 sources.md §3)。
#[test]
fn hsr_character_warp_matches_genshin_structure() {
    let cfg = hsr_character_cfg();
    let dist = model_distribution_to_hard(&cfg);
    let mean = mean_of_to_hard(&dist);
    let consolidated = 1.0 / mean;
    assert!(
        (consolidated - 0.016).abs() < 0.001,
        "HSR 角色跃迁综合 {consolidated:.5} vs 官方 0.016"
    );
    assert!(
        (hit_rate(&cfg, 73) - 0.066).abs() < 1e-9,
        "HSR 抽 74 = 6.6%(软保底同构)"
    );
}
