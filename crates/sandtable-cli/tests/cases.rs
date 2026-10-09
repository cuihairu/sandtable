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
fn 宝可梦案例_校验仿真与分层梯度() {
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
