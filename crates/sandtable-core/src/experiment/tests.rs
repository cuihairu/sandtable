use super::*;

#[test]
fn t_table_lookup() {
    assert_eq!(t_critical_975(1), 12.706);
    assert_eq!(t_critical_975(30), 2.042);
    assert_eq!(t_critical_975(100), 1.96);
    assert!(t_critical_975(0).is_infinite());
}

#[test]
fn summary_constant_series_point_interval() {
    let s = summarize(&[5.0; 8]);
    assert_eq!(s.mean, 5.0);
    assert_eq!(s.sd, 0.0);
    assert_eq!(s.ci95_lo, 5.0);
    assert_eq!(s.ci95_hi, 5.0);
}

#[test]
fn summary_larger_sample_narrower_interval() {
    let w1 = summarize(&[1.0, 3.0, 2.0, 4.0, 2.5, 3.5]);
    let w2 = summarize(&[
        1.0, 3.0, 2.0, 4.0, 2.5, 3.5, 2.2, 3.1, 2.8, 3.3, 1.9, 3.7, 2.6, 3.0, 2.4, 3.2,
    ]);
    assert!(w2.ci95_hi - w2.ci95_lo < w1.ci95_hi - w1.ci95_lo);
}

#[test]
#[allow(non_snake_case)]
fn compare_b_wins_all_verdict_bhigher() {
    // ST-AUD-01:配对差须有方差——旧夹具 b=a+2.0 使差值零方差,
    // 新口径下正确地标 InsufficientEvidence,不再冒充 BHigher。
    let a = [10.0, 10.5, 9.8, 10.2];
    let b = [12.0, 11.5, 12.5, 11.9];
    let c = compare("m", &a, &b);
    assert!(!c.degraded);
    assert_eq!(c.verdict, Verdict::BHigher);
    assert_eq!(c.diff_mean, 1.85);
    assert!(c.effect_size_d > 0.0);
}

#[test]
fn compare_crossing_noise_no_difference() {
    let a = [10.0, 12.0, 9.0, 13.0, 11.0, 10.5, 12.5, 9.5];
    let b = [10.5, 11.5, 9.5, 12.5, 10.8, 11.0, 12.0, 10.0];
    let c = compare("m", &a, &b);
    assert_eq!(c.verdict, Verdict::NoDifference);
}

/// I-005 / ST-AUD-05:CRN 配对设计的效应量必须用 d_z = Δ/s_d,
/// 与配对差 CI 同源;不得再用独立双样本 pooled_sd(口径分叉)。
#[test]
fn compare_effect_size_is_paired_dz() {
    // 构造配对差 d = b - a = {1,2,3,4},mean=2.5,sd≈1.291 → d_z≈1.936
    let a = [10.0, 10.0, 10.0, 10.0];
    let b = [11.0, 12.0, 13.0, 14.0];
    let c = compare("m", &a, &b);
    let expected = 2.5 / c.arm_b.sd; // d_z = Δ/s_d(because a sd=0)
    assert!(
        (c.effect_size_d - expected).abs() < 1e-12,
        "effect_size_d 应等于 d_z=Δ/s_d,got {} expected {}",
        c.effect_size_d,
        expected
    );
    assert!(c.effect_size_d.is_finite());
}

#[test]
fn metric_key_parse_and_extract() {
    assert_eq!(MetricKey::parse("d7"), Some(MetricKey::RetentionD7));
    assert_eq!(MetricKey::parse("nope"), None);
    let m = crate::metrics::RunMetrics {
        schema_version: "1".to_string(),
        model_version: "0.1.0".to_string(),
        config_hash: "x".into(),
        replicate: 0,
        seed: 0,
        players: 100,
        days: 30,
        day1_cohort: 100,
        retention_d1: Some(1.0),
        retention_d3: Some(0.9),
        retention_d7: Some(0.8),
        retention_d14: None,
        retention_d30: None,
        churn_total: 20,
        churn_rate_total: 0.2,
        win_rate: 0.9,
        gold_earned_total: 500_000,
        gold_spent_total: 0,
        whale_gold_share: 0.3,
        inflation_daily_mean: 0.0,
        inflation_last: None,
        sink_ratio_mean: 0.0,
        gacha_pulls_to_hit: Some(31.0),
        loot_gold_per_player: Some(12.5),
        power_snapshots: vec![],
        cohort_stats: vec![],
        day_stats: vec![],
    };
    assert_eq!(MetricKey::RetentionD7.extract(&m), Some(0.8));
    assert_eq!(MetricKey::GoldPerPlayer.extract(&m), Some(5000.0));
    assert_eq!(MetricKey::GachaPullsToHit.extract(&m), Some(31.0));
    assert_eq!(MetricKey::LootGoldPerPlayer.extract(&m), Some(12.5));
    assert_eq!(
        MetricKey::parse("gacha_pulls_to_hit"),
        Some(MetricKey::GachaPullsToHit)
    );
    assert_eq!(
        MetricKey::parse("loot_gold_per_player"),
        Some(MetricKey::LootGoldPerPlayer)
    );
}

/// 单 replicate:CI 退化为点估计(df=0 的 t 值是 ∞,须绕开 ∞·0 = NaN)
#[test]
fn single_replicate_ci_point_estimate() {
    let s = summarize(&[0.7]);
    assert_eq!(s.n, 1);
    assert_eq!(s.sd, 0.0);
    assert_eq!((s.ci95_lo, s.ci95_hi), (0.7, 0.7));
    assert!(s.ci_degraded(), "n==1 的 CI 应标记为零宽退化");
}

/// ST-AUD-01:n==1 时配对差 CI 零宽,不得按符号判「显著」,
/// verdict 必须显式标证据不足且 degraded=true。
#[test]
fn compare_single_replicate_verdict_insufficient_evidence() {
    let c = compare("win_rate", &[0.6], &[0.9]);
    assert!(c.degraded);
    assert_eq!(c.verdict, Verdict::InsufficientEvidence);
    assert!((c.diff_ci95_lo - 0.3).abs() < 1e-12 && (c.diff_ci95_hi - 0.3).abs() < 1e-12);
    // 伪显著旧口径会在此给出 BHigher(CI=[0.3,0.3] 完全在 0 上)——禁止
    assert_ne!(c.verdict, Verdict::BHigher);
}

/// ST-AUD-01:replicates≥2 但配对差零方差(ss=0)同样零宽 CI,
/// 同样不得判「显著」。
#[test]
fn compare_paired_zero_variance_verdict_insufficient_evidence() {
    // 差值序列全为 1.5:sd=0,CI=[1.5,1.5],旧口径必判 BHigher
    let a = [10.0, 12.0, 9.0, 13.0, 11.0];
    let b = [11.5, 13.5, 10.5, 14.5, 12.5];
    let c = compare("win_rate", &a, &b);
    assert!(c.degraded);
    assert_eq!(c.verdict, Verdict::InsufficientEvidence);
    assert_eq!(c.diff_mean, 1.5);
    assert_eq!((c.diff_ci95_lo, c.diff_ci95_hi), (1.5, 1.5));
}

/// ST-AUD-01 回归:R≥3 且配对差有方差时行为不变——verdict 三态照旧、
/// degraded=false、JSON 含 degraded 字段;旧版无该字段的
/// comparison.json 仍可读回,且按 diff CI 零宽重推导 degraded。
#[test]
fn compare_normal_replicates_no_regression_and_degraded_flag_serde() {
    let a = [10.0, 10.5, 9.8, 10.2];
    let b = [12.0, 11.5, 12.5, 11.9];
    let c = compare("win_rate", &a, &b);
    assert!(!c.degraded);
    assert_eq!(c.verdict, Verdict::BHigher);

    let json = serde_json::to_value(&c).unwrap();
    assert_eq!(
        json["degraded"],
        serde_json::Value::Bool(false),
        "报告 JSON 应带 degraded 字段"
    );
    let back: Comparison = serde_json::from_value(json).unwrap();
    assert_eq!(back, c);

    let legacy = serde_json::json!({
        "metric": "win_rate",
        "arm_a": {"n": 4, "mean": 10.0, "sd": 0.3, "ci95_lo": 9.5, "ci95_hi": 10.5},
        "arm_b": {"n": 4, "mean": 12.0, "sd": 0.3, "ci95_lo": 11.5, "ci95_hi": 12.5},
        "diff_mean": 2.0, "diff_ci95_lo": 1.5, "diff_ci95_hi": 2.5,
        "effect_size_d": 4.0, "verdict": "BHigher"
    });
    let old: Comparison = serde_json::from_value(legacy).unwrap();
    assert!(
        !old.degraded,
        "旧 comparison.json 缺 degraded 且 diff CI 非零宽 → 按 false 读回"
    );
}

/// 2026-11-05 审核发现 7:旧 comparison.json 已按旧口径(sd==0 代理)对
/// 退化数据(n<2 或零方差)写出 verdict=BHigher 且无 degraded 字段,读回
/// 必须按 diff CI 零宽重推导 degraded=true,不再让「单点当置信区间」
/// 误判冒充显著。
#[test]
fn legacy_degraded_json_re_derives_degraded_from_zero_width_ci() {
    // 零宽 diff CI(diff_ci95_lo == diff_ci95_hi)但无 degraded 字段
    let legacy = serde_json::json!({
        "metric": "win_rate",
        "arm_a": {"n": 4, "mean": 10.0, "sd": 0.3, "ci95_lo": 9.5, "ci95_hi": 10.5},
        "arm_b": {"n": 4, "mean": 12.0, "sd": 0.3, "ci95_lo": 11.5, "ci95_hi": 12.5},
        "diff_mean": 1.5, "diff_ci95_lo": 1.5, "diff_ci95_hi": 1.5,
        "effect_size_d": 0.0, "verdict": "BHigher"
    });
    let old: Comparison = serde_json::from_value(legacy).unwrap();
    assert!(old.degraded, "零宽 diff CI 必须重推导 degraded=true");
    assert_eq!(
        old.verdict,
        Verdict::InsufficientEvidence,
        "退化时旧 BHigher verdict 必须一并重标证据不足"
    );
}

/// 2026-11-05 审核发现 6:sd 极小但非零、均值很大使 mean±t·sd/√n 舍入
/// 塌缩成零宽 CI 时,ci_degraded 必须按 ci95_lo==ci95_hi 判真(旧的
/// sd==0 代理会漏判);verdict 不得把零宽 CI 判成「显著」。
#[test]
fn zero_width_ci_from_rounding_collapse_is_degraded() {
    // n=100,配对差在 1e16 与 1e16+2 间交替(arm_a=0):sd≈1.42 非零,
    // 但 t·sd/√n≈0.28 在 1e16 量级 ULP=2 下舍入塌缩,ci95_lo == ci95_hi。
    let base = 1e16;
    let a: Vec<f64> = (0..100).map(|_| 0.0).collect();
    let b: Vec<f64> = (0..100)
        .map(|i| base + if i % 2 == 0 { 2.0 } else { 0.0 })
        .collect();
    let c = compare("m", &a, &b);
    assert!(c.diff_ci95_lo == c.diff_ci95_hi, "舍入塌缩应产生零宽 CI");
    assert!(c.diff_ci95_lo > 0.0, "零宽 CI 完全在 0 以上(旧口径伪显著)");
    assert!(c.degraded, "零宽 CI 必须标 degraded(旧 sd==0 代理漏判)");
    assert_eq!(c.verdict, Verdict::InsufficientEvidence);
}

// —— compare_arms(WB-03.10:A/B 桥的内核入口)——

fn test_cfg(days: u32, attack: i64) -> crate::config::SimConfig {
    crate::config::SimConfig {
        players: 40,
        days,
        base_seed: 7,
        warrior: crate::config::WarriorConfig {
            attack,
            ..crate::config::WarriorConfig::default()
        },
        ..crate::config::SimConfig::default()
    }
}

fn kernel_arm(cfg: &crate::config::SimConfig, reps: u32) -> Vec<crate::metrics::RunMetrics> {
    (0..reps).map(|r| crate::sim::run(cfg, r)).collect()
}

/// 双臂同种子、指标可用:结论与手工 extract + compare 逐字段一致
/// (桥接层契约 = 内核 compare 语义,不另立统计口径)。
#[test]
fn compare_arms_matches_manual_extract_and_compare() {
    let cfg_a = test_cfg(7, 100);
    let cfg_b = test_cfg(7, 140);
    let arm_a = kernel_arm(&cfg_a, 8);
    let arm_b = kernel_arm(&cfg_b, 8);
    let out = compare_arms(&cfg_a, &cfg_b, MetricKey::WinRate, &arm_a, &arm_b).unwrap();
    let manual: Vec<f64> = arm_a.iter().map(|m| m.win_rate).collect();
    let manual_b: Vec<f64> = arm_b.iter().map(|m| m.win_rate).collect();
    let expected = compare("win_rate", &manual, &manual_b);
    assert_eq!(out, expected);
    assert_eq!(out.metric, "win_rate");
    assert_eq!(out.arm_a.n, 8);
    assert_eq!(out.arm_b.n, 8);
}

/// 种子错位:CRN 成对前提破坏,显式拒绝。
#[test]
fn compare_arms_rejects_seed_mismatch() {
    let cfg_a = test_cfg(7, 100);
    let mut cfg_b = test_cfg(7, 140);
    cfg_b.base_seed = 99;
    let arm_a = kernel_arm(&cfg_a, 4);
    let arm_b = kernel_arm(&cfg_b, 4);
    let err = compare_arms(&cfg_a, &cfg_b, MetricKey::WinRate, &arm_a, &arm_b)
        .unwrap_err()
        .to_string();
    assert!(err.contains("base_seed 不一致"), "{err}");
}

/// 任一臂指标不可用(天数不足)→ 显式报错,不单臂跳过。
#[test]
fn compare_arms_rejects_unavailable_metric() {
    let cfg_a = test_cfg(2, 100);
    let cfg_b = test_cfg(2, 140);
    let arm_a = kernel_arm(&cfg_a, 4);
    let arm_b = kernel_arm(&cfg_b, 4);
    let err = compare_arms(&cfg_a, &cfg_b, MetricKey::RetentionD7, &arm_a, &arm_b)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("retention_d7") && err.contains("不可用"),
        "{err}"
    );
}

/// 长度为 0 / 不等长:等长非零前提,显式拒绝。
#[test]
fn compare_arms_rejects_length_mismatch_or_empty() {
    let cfg_a = test_cfg(7, 100);
    let cfg_b = test_cfg(7, 140);
    let arm_a = kernel_arm(&cfg_a, 4);
    let arm_b = kernel_arm(&cfg_b, 4);
    let err = compare_arms(&cfg_a, &cfg_b, MetricKey::WinRate, &arm_a[..3], &arm_b)
        .unwrap_err()
        .to_string();
    assert!(err.contains("replicate 数不一致或为 0"), "{err}");
    let err = compare_arms(&cfg_a, &cfg_b, MetricKey::WinRate, &[], &[])
        .unwrap_err()
        .to_string();
    assert!(err.contains("replicate 数不一致或为 0"), "{err}");
}

/// 某 replicate extract 为 None(此处:期末无 Power 快照,config 级
/// unavailable_reason 查不出)→ 显式报错,不 0 填充(WB-03.02)。
#[test]
fn compare_arms_rejects_extract_none() {
    let cfg_a = test_cfg(7, 100);
    let cfg_b = test_cfg(7, 140);
    let mut arm_a = kernel_arm(&cfg_a, 2);
    let arm_b = kernel_arm(&cfg_b, 2);
    arm_a[1].power_snapshots.clear();
    let err = compare_arms(&cfg_a, &cfg_b, MetricKey::PowerP50Final, &arm_a, &arm_b)
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("replicate 1") && err.contains("不用 0 填充"),
        "{err}"
    );
}

/// results JSON 回读契约(A/B 桥通道):kernel 序列化的结果数组原样
/// 反序列化回 Vec<RunMetrics>,版本/分群 String 字段与数值逐字段一致;
/// 序列化形状不因 owned 化改变。
#[test]
fn run_metrics_results_json_roundtrip() {
    let cfg = test_cfg(7, 100);
    let arm = kernel_arm(&cfg, 2);
    let json = serde_json::to_string(&arm).unwrap();
    let back: Vec<crate::metrics::RunMetrics> = serde_json::from_str(&json).unwrap();
    assert_eq!(back.len(), arm.len());
    for (orig, got) in arm.iter().zip(back.iter()) {
        assert_eq!(orig.schema_version, got.schema_version);
        assert_eq!(orig.model_version, got.model_version);
        assert_eq!(orig.win_rate, got.win_rate);
        assert_eq!(orig.day_stats.len(), got.day_stats.len());
        assert_eq!(orig.cohort_stats.len(), got.cohort_stats.len());
        assert_eq!(orig.cohort_stats[0].cohort, got.cohort_stats[0].cohort);
        assert_eq!(orig.power_snapshots.len(), got.power_snapshots.len());
    }
    assert_eq!(serde_json::to_string(&back).unwrap(), json);
}

// —— 逐日跨 replicate 聚合(P2 内核契约)——

fn synthetic_run(
    replicate: u32,
    days: u32,
    retention_d3: Option<f64>,
) -> crate::metrics::RunMetrics {
    crate::metrics::RunMetrics {
        schema_version: crate::SCHEMA_VERSION.to_string(),
        model_version: crate::MODEL_VERSION.to_string(),
        config_hash: format!("rep-{replicate}"),
        replicate,
        seed: replicate as u64,
        players: 40,
        days,
        day1_cohort: 40,
        retention_d1: Some(1.0),
        retention_d3,
        retention_d7: None,
        retention_d14: None,
        retention_d30: None,
        churn_total: 0,
        churn_rate_total: 0.0,
        win_rate: 1.0,
        gold_earned_total: 0,
        gold_spent_total: 0,
        whale_gold_share: 0.0,
        inflation_daily_mean: 0.0,
        inflation_last: None,
        sink_ratio_mean: 0.0,
        gacha_pulls_to_hit: None,
        loot_gold_per_player: None,
        power_snapshots: vec![],
        cohort_stats: vec![],
        day_stats: (1..=days)
            .map(|day| crate::metrics::DayStat {
                day,
                active: (((day - 1 + replicate) % 4) * 2) as u64,
                alive_at_start: 40,
                new_churned: 0,
                churn_rate: 0.0,
                battles: 4,
                wins: 3,
                win_rate: 0.75,
                gold_earned: 100,
                gold_spent: 50,
                sink_ratio: 0.5,
                gold_supply: 50,
                inflation: if day == 1 { None } else { Some(0.25) },
                income_per_active: 2.5,
                spending_per_active: 1.25,
                mean_power: 10.0 + day as f64,
                levelups: 1,
                upgrades: 1,
            })
            .collect(),
    }
}

/// replicates <2 明确拒绝:单次运行不得套置信带。
#[test]
fn daily_aggregate_rejects_single_replicate() {
    let err = daily_aggregate_metrics(&[]).unwrap_err().to_string();
    assert!(
        err.contains("至少需要 2 份") && err.contains("单次运行不得套置信带"),
        "{err}"
    );
    let err = daily_aggregate_metrics(&[synthetic_run(0, 4, Some(0.9))])
        .unwrap_err()
        .to_string();
    assert!(err.contains("当前 1 份"), "{err}");
}

/// 长度不一致按公共日集取交,交外天数显式报出且不补齐。
#[test]
fn daily_aggregate_uses_day_intersection_and_reports_trims() {
    let runs = [
        synthetic_run(0, 4, Some(0.9)),
        synthetic_run(1, 3, Some(0.8)),
        synthetic_run(2, 5, Some(0.7)),
    ];
    let out = daily_aggregate_metrics(&runs).unwrap();
    assert_eq!(out.replicates, 3);
    assert_eq!(out.common_days, 3);
    assert_eq!(out.trimmed_days, vec![4, 5]);
    assert!(out.trim_warning.contains("公共天数取交 3 天"), "{out:?}");
    assert!(out.trim_warning.contains("[4, 5]"), "{out:?}");
    assert_eq!(
        out.day_stats.iter().map(|d| d.day).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert!(
        out.day_stats
            .iter()
            .all(|d| d.active.as_ref().unwrap().n == 3),
        "每个公共日跨全部 replicate 聚合,不被天数长短影响"
    );
}

/// 可选 RunMetrics 字段真实 Some 才聚合;整组 None 时整键缺席,禁 0 填。
#[test]
fn daily_aggregate_keeps_optional_metrics_absent_when_unavailable() {
    let runs = [
        synthetic_run(0, 3, Some(0.9)),
        synthetic_run(1, 3, Some(0.7)),
    ];
    let json = serde_json::to_value(daily_aggregate_metrics(&runs).unwrap()).unwrap();
    assert_eq!(json["retention_d3"]["n"], 2);
    assert!(json.get("gacha_pulls_to_hit").is_none(), "{json}");
    assert!(json.get("loot_gold_per_player").is_none(), "{json}");
    assert!(json.get("retention_d30").is_none(), "{json}");
}

/// 审核发现 2026-11-04:纯经验掉落(gold 全 0)与未配置 loot 都不可用,
/// 但原因需区分——前者是「无金币型奖励」,不是「未配置」。
#[test]
fn loot_gold_unavailable_reason_distinguishes_pure_xp_from_unconfigured() {
    use crate::config::{LootConfig, LootReward, LootTableConfig};
    let mut tables = std::collections::BTreeMap::new();
    tables.insert(
        "chest".to_string(),
        LootTableConfig {
            weights: [("potion".to_string(), 1.0)].into(),
        },
    );
    let mut rewards = std::collections::BTreeMap::new();
    rewards.insert("potion".to_string(), LootReward { gold: 0, xp: 10 });
    let pure_xp = crate::config::SimConfig {
        loot: Some(LootConfig {
            rate_mult: 1.0,
            on_victory: "chest".to_string(),
            tables,
            rewards,
        }),
        ..crate::config::SimConfig::default()
    };
    let reason = MetricKey::LootGoldPerPlayer.unavailable_reason(&pure_xp);
    assert_eq!(
        reason,
        Some("loot_gold_per_player 需要 model.loot 存在金币型奖励,当前无金币掉落"),
        "纯经验掉落应报「无金币奖励」而非「未配置」"
    );
    let unconfigured = crate::config::SimConfig::default();
    assert_eq!(
        MetricKey::LootGoldPerPlayer.unavailable_reason(&unconfigured),
        Some("loot_gold_per_player 需要 model.loot 配置,当前未配置"),
        "未配置应报「未配置」"
    );
}

/// inflation 第 1 天无定义:该日整键缺席;其余字段 CI 与手算样本一致。
#[test]
fn daily_aggregate_matches_manual_sample_statistics() {
    let runs = (0..4)
        .map(|r| synthetic_run(r, 4, Some(0.5)))
        .collect::<Vec<_>>();
    let out = daily_aggregate_metrics(&runs).unwrap();
    let day1 = &out.day_stats[0];
    let day2 = &out.day_stats[1];
    assert!(
        day1.inflation.is_none(),
        "day1 inflation 无定义,须缺席而非 0 填"
    );
    assert!(day2.inflation.is_some(), "day2 inflation 有定义,须进统计");

    let active = day1.active.as_ref().unwrap();
    // replicate 0..4、day 1 的 active = ((day-1+replicate)%4)*2 → 值集 {0,2,4,6}
    // mean=3;Σ(x−mean)²=9+1+1+9=20;样本 sd = sqrt(20/(n-1=3)) ≈ 2.581988897471611
    let expected_sd = (20.0_f64 / 3.0).sqrt();
    let half = t_critical_975(3) * expected_sd / (4.0_f64.sqrt());
    assert_eq!(active.n, 4);
    assert_eq!(active.min, 0.0);
    assert_eq!(active.max, 6.0);
    assert!((active.mean - 3.0).abs() < 1e-12);
    assert!((active.sd - expected_sd).abs() < 1e-12);
    assert!((active.ci95_lo - (3.0 - half)).abs() < 1e-12);
    assert!((active.ci95_hi - (3.0 + half)).abs() < 1e-12);
    assert!(
        out.ci_method.contains("t(0.975,n-1)"),
        "{:?}",
        out.ci_method
    );
    assert!(out.sd_method.contains("/(n-1)"), "{:?}", out.sd_method);
}
