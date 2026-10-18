//! examples/ 案例冒烟(docs 21 章):宝可梦外部配置可校验、可仿真、
//! 分群进度有梯度(whale > core > casual)。防止案例随模型演进悄悄退化。

use std::process::Command;

fn bin(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn pokemon_case_validate_simulate_and_tiers() {
    let yaml = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/pokemon.yaml");

    let out = bin(&["validate", yaml]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let dir = std::env::temp_dir().join(format!(
        "st-case-pokemon-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    // 30 天口径(docs 21 基线):练级环落地后,短窗口的等级梯度会被
    // 行为带份额扰动(casual 练级带份额最高,10 天内反而领先)。
    let out = bin(&[
        "simulate",
        yaml,
        "--players",
        "200",
        "--days",
        "30",
        "--replicates",
        "1",
        "--out",
        dir.to_str().unwrap(),
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let report = std::fs::read_to_string(dir.join("report.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&report).unwrap();
    let lv = |name: &str| -> f64 {
        v["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                r["cohort_stats"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|c| c["cohort"] == name)
                    .expect("三群都在")["mean_level"]
                    .as_f64()
                    .unwrap()
            })
            .sum::<f64>()
            / v["results"].as_array().unwrap().len() as f64
    };
    let (casual, core, whale) = (lv("casual"), lv("core"), lv("whale"));
    assert!(
        whale > core && core > casual,
        "进度应随分群递增:whale {whale} > core {core} > casual {casual}"
    );
    assert!(casual > 1.0, "casual 不该全员卡 1 级:{casual}");
}

/// 平衡水平回归(docs/方向项定义草案.md §1,巡检代决方案 B):
/// 黄金快照锁「内核行为变」,本测试锁「案例平衡水平变」——案例数值被改时,
/// KPI 绝对水平的漂移不再只靠人工 review 兜底。
///
/// 锚定 200 玩家 × 30 天 × 1 replicate(配置 seed,确定性)的实测值,
/// 容差 ±10%(决策点 2)。**改案例数值 = 有意变更**:须同步更新本表锚值,
/// 并在评审里看到 KPI 位移。
#[test]
fn pokemon_case_kpi_levels_within_band() {
    let yaml = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/pokemon.yaml");
    let dir = std::env::temp_dir().join(format!(
        "st-case-kpi-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let out = bin(&[
        "simulate",
        yaml,
        "--players",
        "200",
        "--days",
        "30",
        "--replicates",
        "1",
        "--out",
        dir.to_str().unwrap(),
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let report = std::fs::read_to_string(dir.join("report.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&report).unwrap();
    let r = &v["results"][0];

    let band = |name: &str, anchor: f64, actual: f64| {
        assert!(
            (0.9 * anchor..=1.1 * anchor).contains(&actual),
            "{name} = {actual:.4} 越出锚值 {anchor:.4} ±10% 区间 [{:.4}, {:.4}]\
             (案例数值或模型平衡面变了:有意变更请更新锚值,否则排查回归)",
            0.9 * anchor,
            1.1 * anchor
        );
    };

    // 锚值(2026-10-15 实测,与 docs 21 基线口径一致):
    // churn casual 10/121=0.0826,core 5/58=0.0862,whale 2/21=0.0952,总 0.085
    let cohort = |name: &str| -> serde_json::Value {
        r["cohort_stats"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["cohort"] == name)
            .expect("三群都在")
            .clone()
    };
    for (name, churned, count) in [("casual", 10, 121), ("core", 5, 58), ("whale", 2, 21)] {
        let c = cohort(name);
        let actual = c["churned"].as_f64().unwrap() / c["count"].as_f64().unwrap();
        band(
            &format!("churn_rate[{name}]"),
            churned as f64 / count as f64,
            actual,
        );
    }
    band(
        "churn_rate_total",
        0.085,
        r["churn_rate_total"].as_f64().unwrap(),
    );

    // retention_d7:docs 21 扫描硬约束线 0.9(取下限锚而非 ±10% 带——
    // 0.985 的 ±10% 下探会越过文档健康线)
    let ret7 = r["retention_d7"].as_f64().unwrap();
    assert!(
        ret7 >= 0.9,
        "retention_d7 = {ret7} 跌破 docs 21 硬约束线 0.9(平衡面回归)"
    );

    // win_rate 0.4437:聚合口径含练级期败仗,docs 21 明示不做硬约束,这里只锚水平
    band("win_rate", 0.4437, r["win_rate"].as_f64().unwrap());

    // 成长节奏(锚 docs 21:12.7 / 14.5 / 36.7;本口径 200×1 实测 12.76/14.79/37.43)
    let level = |name: &str| -> f64 { cohort(name)["mean_level"].as_f64().unwrap() };
    band("mean_level[casual]", 12.76, level("casual"));
    band("mean_level[core]", 14.79, level("core"));
    band("mean_level[whale]", 37.43, level("whale"));

    let _ = std::fs::remove_dir_all(&dir);
}

/// 掉落结算案例冒烟(docs 24 章 §3 交付记录):loot 配置可校验、可仿真,
/// 结算确实在跑——KPI `loot_gold_per_player` 出现且为正,切片不超过总产出
/// (切片 ⊆ 全额,gacha 无此约束故单独锁)。案例数值与 24 章 §3 示例逐字一致。
#[test]
fn loot_case_settlement_wired() {
    let yaml = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../examples/loot-settlement.yaml"
    );

    let out = bin(&["validate", yaml]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let dir = std::env::temp_dir().join(format!(
        "st-case-loot-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let out = bin(&[
        "simulate",
        yaml,
        "--players",
        "200",
        "--days",
        "30",
        "--replicates",
        "1",
        "--out",
        dir.to_str().unwrap(),
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let report = std::fs::read_to_string(dir.join("report.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&report).unwrap();
    let r = &v["results"][0];
    let loot = r["loot_gold_per_player"]
        .as_f64()
        .expect("配置 loot 后切片指标应出现(结算已接入)");
    assert!(loot > 0.0, "人均掉落金币应为正:{loot}");
    let players = r["players"].as_f64().unwrap();
    let earned = r["gold_earned_total"].as_f64().unwrap();
    assert!(
        loot * players <= earned,
        "掉落切片 {loot}×{players} 不得超过总产出 {earned}(切片口径)"
    );
    let _ = std::fs::remove_dir_all(&dir);
}
