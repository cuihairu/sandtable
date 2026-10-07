//! Web 等价验收(文档 18 章 Phase 6):同一配置同一 seed,wasm 绑定
//! `run_simulation_native` 的 results 与 CLI `simulate` 的 report.json
//! 逐值一致——浏览器与 CLI 是同一内核的两个入口。

use std::fs;
use std::process::Command;

#[test]
fn web绑定与cli同配置同seed逐值一致() {
    let dir = std::env::temp_dir().join(format!(
        "st-parity-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();

    // 用宝可梦案例配置(非默认值,覆盖 dungeon/progression 真实形状)
    let yaml = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/pokemon.yaml");

    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "simulate",
            yaml,
            "--replicates",
            "2",
            "--out",
            dir.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );

    let cli: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(dir.join("report.json")).unwrap()).unwrap();
    let web = sandtable_wasm::run_simulation_native(&fs::read_to_string(yaml).unwrap(), 2).unwrap();

    assert_eq!(cli["results"], web["results"], "results 逐值一致");
    assert_eq!(
        cli["results"][0]["config_hash"], web["config_hash"],
        "config_hash 一致"
    );

    // 文档 09 章契约:绑定输出附带的 days_csv 与 CLI --out 写盘产物逐字节
    // 一致——浏览器下载的 days.csv 可直接被 sandtable report / query 继续分析
    let cli_days = fs::read_to_string(dir.join("days.csv")).unwrap();
    assert_eq!(
        cli_days,
        web["days_csv"].as_str().unwrap(),
        "days.csv 与 CLI --out 产物逐字节一致"
    );
}
