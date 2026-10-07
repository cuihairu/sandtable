#![cfg(feature = "duckdb")]

//! `sandtable query` 端到端(文档 09/10 章):落盘数据集 → SQL 事后探索,
//! 仿真路径不经过数据库。

use std::fs;
use std::process::Command;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-query-{tag}-{}-{nanos}", std::process::id()))
}

#[test]
fn query_csv_过滤与表格输出() {
    let dir = temp_dir("csv");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("summary.csv"),
        "candidate,status,win_rate_mean\n0,ok,0.5\n1,config_error,\n2,ok,0.9\n",
    )
    .unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "query",
            dir.join("summary.csv").to_str().unwrap(),
            "--sql",
            "SELECT candidate, win_rate_mean FROM summary WHERE status = 'ok' ORDER BY candidate",
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    assert!(text.contains("0.5") && text.contains("0.9"), "{text}");
    assert!(text.contains("2 行"), "{text}");
    assert!(!text.contains("config_error"), "过滤行不应出现:{text}");
}

#[test]
fn query_结果以_csv_落盘() {
    let dir = temp_dir("out-csv");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("summary.csv"),
        "candidate,status,win_rate_mean\n0,ok,0.5\n1,ok,0.9\n",
    )
    .unwrap();
    let dst = dir.join("filtered.csv");
    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "query",
            dir.join("summary.csv").to_str().unwrap(),
            "--sql",
            "SELECT candidate, status, win_rate_mean FROM summary WHERE win_rate_mean > 0.6",
            "--out",
            dst.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let csv = fs::read_to_string(&dst).unwrap();
    assert_eq!(csv.lines().count(), 2, "表头 + 1 行:{csv}");
    assert!(
        csv.starts_with("candidate,status,win_rate_mean\n1,ok,0.9"),
        "{csv}"
    );
}

#[test]
fn query_非法视图名_退出非零() {
    let dir = temp_dir("bad-view");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("bad-name.csv"), "a\n1\n").unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "query",
            dir.join("bad-name.csv").to_str().unwrap(),
            "--sql",
            "SELECT * FROM x",
        ])
        .output()
        .unwrap();
    assert_ne!(out.status.code(), Some(0));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("视图名"), "{stderr}");
}

/// CSV → Parquet → SQL 全链: simulate --parquet 落盘后直接 SQL 探索
/// (文档 09 章数据流:Simulation → 结果数据集 → DuckDB)。
#[cfg(feature = "parquet")]
#[test]
fn query_parquet_仿真到分析全链() {
    let dir = temp_dir("parquet");
    fs::create_dir_all(&dir).unwrap();
    let yaml = dir.join("s.yaml");
    fs::write(
        &yaml,
        "schema_version: \"1\"\nscenario: {population: 100, duration: \"10d\"}\n",
    )
    .unwrap();
    let sim_out = dir.join("sim");
    let st = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "simulate",
            yaml.to_str().unwrap(),
            "--out",
            sim_out.to_str().unwrap(),
            "--parquet",
        ])
        .status()
        .unwrap();
    assert!(st.success());

    let q = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "query",
            sim_out.join("day_stats.parquet").to_str().unwrap(),
            "--sql",
            "SELECT count(*) AS n FROM day_stats",
        ])
        .output()
        .unwrap();
    assert!(q.status.success(), "{}", String::from_utf8_lossy(&q.stderr));
    let text = String::from_utf8_lossy(&q.stdout);
    assert!(text.contains("10"), "10 天应得 10 行:{text}");
}
