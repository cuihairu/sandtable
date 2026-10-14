//! 性能粗粒度守卫(docs 19 章「性能守卫」,补齐计划落地):
//! 10,000 玩家 × 30 天全流程(simulate + 导出)debug 构建时长必须低于
//! 预算。预算取实测基线(2.4s,2026-10-15)数十倍余量——只拦数量级
//! 退化,共享 runner 抖动不进判定。criterion 细基准未建(见该章)。

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

/// 时长预算:实测基线的约 50 倍,拦的是架构级退化不是快慢抖动。
const BUDGET: Duration = Duration::from_secs(120);

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-perf-{tag}-{}-{nanos}", std::process::id()))
}

#[test]
fn full_pipeline_10k_x_30d_within_budget() {
    let dir = temp_dir("smoke");
    fs::create_dir_all(&dir).unwrap();
    let yaml = dir.join("perf.yaml");
    fs::write(
        &yaml,
        r#"schema_version: "1"
scenario: {population: 10000, duration: "30d"}
"#,
    )
    .unwrap();
    let out = dir.join("out");

    let t0 = Instant::now();
    let st = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "simulate",
            yaml.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
        ])
        .status()
        .unwrap();
    let elapsed = t0.elapsed();

    assert!(st.success(), "simulate 失败");
    assert!(
        elapsed < BUDGET,
        "全流程 {:.1}s 超预算 {:.0}s(数量级退化:排查架构级性能回退)",
        elapsed.as_secs_f64(),
        BUDGET.as_secs_f64()
    );

    let _ = fs::remove_dir_all(&dir);
}
