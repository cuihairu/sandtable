use super::event::ALL_EVENT_KINDS;
use super::*;
use crate::config::SimConfig;
use crate::rng::DayRng;
use crate::systems::combat::{monster_of, settle_battle};
use crate::world::World;

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
    // 62e1185 起缺省 m_hp 300→250、m_defense 20→150:原 attack 120 已破不了
    // 防(dmg=max(120-150,1)=1/轮,250 轮 > 32 超时判负),故把 attack 提到
    // 175 使伤害成为 hp 的干净约数,闭式解仍成立:
    let m = monster_of(&cfg, 0); // hp 250, defense 150
    let mut rng = DayRng::new(1, 1, 1);
    let out = settle_battle(175, 80, 1000, &m, &mut rng, 0, &cfg);
    // dmg = 175 - 150 = 25/轮 → 250/25 = 10 轮打完 250
    assert!(out.win);
    assert_eq!(out.rounds, 10);
    assert_eq!(out.damage_dealt, 250);
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
    let m = monster_of(&cfg, 0); // hp 250, defense 150
    let mut rng = DayRng::new(1, 1, 1);
    // dmg = floor(200·120/(120+150)) = floor(88.89) = 88/轮 → 250/88 上取 3 轮打完
    let out = settle_battle(120, 80, 1000, &m, &mut rng, 0, &cfg);
    assert!(out.win);
    assert_eq!(out.rounds, 3);
    assert_eq!(out.damage_dealt, 264);
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
    let m = monster_of(&cfg, 0); // hp 250, defense 150
    let mut rng = DayRng::new(1, 1, 1);
    // dmg = floor(200·10/(10+150)) = floor(12.5) = 12/轮 → 250/12 上取 21 轮打完
    // (差值口径同输入只有 1/轮,250 轮超时判负)
    let out = settle_battle(10, 80, 1000, &m, &mut rng, 0, &cfg);
    assert!(out.win);
    assert_eq!(out.rounds, 21);
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
    // 62e1185 起怪物面大幅上调(m_hp 250 / m_defense 150 / tier_growth 1.3):
    // 默认战士攻 100 在任何层都 dmg=max(100-150·1.3^t,1)=1/轮,清剿轮数
    // 远超预算,选层退到 0 层也磨不死(超时判负、零收入)。把战士攻提到 300
    // 恢复「随机性关掉后逐玩家可手算」的确定收入场景:
    // 选层:第 3 层 dmg=300-⌊150·1.3³⌋=300-329<0→1/轮(549 轮 > 20 预算)
    // 被跳过;第 2 层 dmg=300-253=47,⌈422/47⌉=9 轮 ≤ 预算,选到第 2 层。
    cfg.warrior.attack = 300;
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
    // 选层(攻 300 下):第 2 层 9 轮 ≤ 预算,第 3 层起破不了防被跳过
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
            featured_rate: 0.0,
            featured_guarantee: 0,
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
            featured_rate: 0.0,
            featured_guarantee: 0,
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
            featured_rate: 0.0,
            featured_guarantee: 0,
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

/// 定轨语义接入主仿真:featured 会话按「命中所定目标」结束,50/50 且
/// guarantee=1 时每会话平均约 2 次 5★(E[#5★]=1/0.5),故人均抽数与人均
/// 5★ 命中数相对无定轨臂同步翻倍;定轨臂最坏 2×50=100 抽。
#[test]
fn gacha_featured_layer_controls_main_sim() {
    struct Probe {
        pulls: u64,
        hits: u64,
    }
    impl DayHook for Probe {
        fn on_day(&mut self, world: &World, day: u32) {
            if day == 1 {
                self.pulls = world.actors.iter().map(|a| a.gacha_pulls).sum();
                self.hits = world.actors.iter().map(|a| a.gacha_hits).sum();
            }
        }
    }

    let base = SimConfig {
        players: 2000,
        days: 1,
        gacha: Some(crate::config::GachaConfig {
            base_rate: 0.02,
            pity_hard: 50,
            pity_soft_start: 0,
            pity_soft_step: 0.0,
            featured_rate: 0.0,
            featured_guarantee: 0,
        }),
        ..SimConfig::default()
    };
    let mut featured = base.clone();
    featured.gacha.as_mut().unwrap().featured_rate = 0.5;
    featured.gacha.as_mut().unwrap().featured_guarantee = 1;

    let mut plain_probe = Probe { pulls: 0, hits: 0 };
    run_with_day_hook(&base, 7, &mut plain_probe);
    let mut feat_probe = Probe { pulls: 0, hits: 0 };
    run_with_day_hook(&featured, 7, &mut feat_probe);

    // 无定轨臂:每会话恰 1 次 5★。
    assert_eq!(plain_probe.hits, 2000, "无定轨每会话恰 1 次 5★");

    // 定轨臂 50/50 + guarantee=1:E[#5★] = 0.5×1 + 0.5×2 = 1.5(首次命中
    // 即止,否则下一次必为目标),故抽数与命中数同约为无定轨臂的 1.5 倍。
    let hit_ratio = feat_probe.hits as f64 / plain_probe.hits as f64;
    assert!(
        (hit_ratio - 1.5).abs() < 0.1,
        "定轨臂 5★ 次数应为 1.5 倍,实测 {hit_ratio}"
    );
    let pull_ratio = feat_probe.pulls as f64 / plain_probe.pulls as f64;
    assert!(
        (pull_ratio - 1.5).abs() < 0.1,
        "定轨臂抽数应为 1.5 倍,实测 {pull_ratio}"
    );
    assert!(
        feat_probe.pulls <= 2000 * 100,
        "定轨最坏每玩家 2×50=100,总抽应 ≤ 200k,实测 {}",
        feat_probe.pulls
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
    // 62e1185 起怪物面大幅上调(m_hp 250 / m_defense 150 / tier_growth 1.3):
    // 默认战士攻 100 在任何层 dmg=max(100-150·1.3^t,1)=1/轮,清剿轮数远超
    // 预算,选层退到 0 层仍超时判负——战斗全负 → 掉落永不结算,XP 臂与基线
    // 逐位相同(「经验掉落应抬升战力」断言失效)。把战士攻提到 250 使基线
    // 落在「可胜、掉落会结算」档位:tier 1 dmg=250-195=55,⌈325/55⌉=6 轮 ≤
    // 预算,门②承伤 0.85·128·6≈653 ≤ 800 通过;tier 2 门② 0.85·190·9≈1454
    // > 800 被挡,基线选 tier 1;+50xp 臂战力抬升后选层更高(胜率本种子下
    // 微降 0.9841 vs 0.9861),整组方向断言成立。
    let base = SimConfig {
        players: 200,
        days: 5,
        warrior: crate::config::WarriorConfig {
            attack: 250,
            ..SimConfig::default().warrior
        },
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
