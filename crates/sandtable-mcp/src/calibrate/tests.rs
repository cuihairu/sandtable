//! 校准工具链测试:数据驱动、路径与错误语义、内核统计复用。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;

const SCENARIO: &str =
    "schema_version: \"1\"\nscenario: {population: 100, duration: \"7d\", seed: 7}\n";

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-mcp-cal-{tag}-{}-{nanos}", std::process::id()))
}

fn input(dir: &Path, mapping: &str) -> CalibrationInput {
    CalibrationInput {
        yaml: SCENARIO.to_string(),
        data_dir: dir.to_string_lossy().to_string(),
        mapping: mapping.to_string(),
        replicates: 2,
    }
}

#[test]
fn calibrate_aggregates_and_compares_kernel_kpis() {
    let dir = temp_dir("aggregate");
    fs::create_dir_all(&dir).unwrap();
    let run = core::sim::run(&load(SCENARIO).unwrap(), 0);
    fs::write(
        dir.join("daily.csv"),
        "date,cohort_day,retained,active\nA,3,98,100\nB,3,99,100\n",
    )
    .unwrap();
    let mapping = format!(
        "anchors:\n  win_rate: {{observed: {}}}\n  retention_d3: {{observed: 0.985}}\nseries:\n  win_rate:\n    file: daily.csv\n    day_column: cohort_day\n    value_column: retained\n    denominator_column: active\n    aggregation: ratio\n",
        run.win_rate
    );
    let output = calibrate_native(&input(&dir, &mapping)).unwrap();

    let win = output["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["anchor"] == "win_rate" && row["day"].is_null())
        .unwrap();
    assert_eq!(win["verdict"], "PASS", "{win}");
    assert_eq!(win["replicates"], 2);
    let daily = output["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["anchor"] == "win_rate" && row["day"] == 3)
        .unwrap();
    assert!(daily["sim_ci95"].is_array(), "{daily}");
    assert_eq!(output["summary"]["series_anchors"], 1);
    assert_eq!(output["meta"]["data_source"], "local_readonly");
}

#[test]
fn calibrate_reports_unmapped_without_substitution() {
    let dir = temp_dir("unmapped");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("daily.csv"), "cohort_day,active\n3,100\n").unwrap();
    let mapping = "series:\n  gacha_pulls_to_hit:\n    file: daily.csv\n    day_column: cohort_day\n    value_column: active\n    aggregation: sum\n";
    let output = calibrate_native(&input(&dir, mapping)).unwrap();
    let row = output["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["reason"] == "该指标当前只做运行级锚点,不提供逐日内核序列")
        .unwrap();
    assert_eq!(row["verdict"], "UNMAPPED", "{row}");
    assert_eq!(row["reason"], "该指标当前只做运行级锚点,不提供逐日内核序列");
}

#[test]
fn calibrate_rejects_bad_mapping_zero_and_path_escape() {
    let dir = temp_dir("reject");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("ok.csv"), "cohort_day,v\n3,1\n").unwrap();

    let unknown = "anchors:\n  not_real: {observed: 1}\n";
    let err = calibrate_native(&input(&dir, unknown)).unwrap_err();
    assert!(err.contains("未知内核指标 not_real"), "{err}");

    let zero = "anchors:\n  win_rate: {observed: 0}\n";
    let err = calibrate_native(&input(&dir, zero)).unwrap_err();
    assert!(err.contains("必须是正的有限数值"), "{err}");

    let escape = "series:\n  win_rate:\n    file: ../ok.csv\n    day_column: cohort_day\n    value_column: v\n    aggregation: sum\n";
    let err = calibrate_native(&input(&dir, escape)).unwrap_err();
    assert!(err.contains("路径必须留在数据目录内"), "{err}");
}

#[test]
fn calibrate_rejects_ratio_zero_denominator_and_over_budget() {
    let dir = temp_dir("ratio");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("daily.csv"), "cohort_day,v,active\n3,1,0\n").unwrap();
    let mapping = "series:\n  win_rate:\n    file: daily.csv\n    day_column: cohort_day\n    value_column: v\n    denominator_column: active\n    aggregation: ratio\n";
    let err = calibrate_native(&input(&dir, mapping)).unwrap_err();
    assert!(err.contains("分母为 0"), "{err}");

    let mut over = input(&dir, "anchors: {win_rate: {observed: 0.5}}\n");
    over.replicates = MAX_CALIBRATION_REPLICATES + 1;
    let err = calibrate_native(&over).unwrap_err();
    assert!(err.contains("超出 calibrate 预算"), "{err}");
}
