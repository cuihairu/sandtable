//! XLSX 数据源测试:与 CSV 夹具逐字段等价、mapping 边界、导出→改→回读往返。
//!
//! 等价口径:同一份观测数据分别以 .csv 与 .xlsx 进 `sandtable_calibrate`,
//! 输出 JSON 逐字段一致(serde_json 序列化字符串相等)——xlsx 只是载体,
//! 聚合 / 残差 / 判定语义零变化。CSV 既有行为不回归(tests.rs 覆盖)。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use sandtable_cli::workbook::{Sheet, Workbook};
use sandtable_cli::xlsx;

use super::tests::XLSX_SCENARIO;
use super::*;

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "st-mcp-cal-xlsx-{tag}-{}-{nanos}",
        std::process::id()
    ))
}

fn input(dir: &Path, mapping: &str) -> CalibrationInput {
    CalibrationInput {
        yaml: XLSX_SCENARIO.to_string(),
        data_dir: dir.to_string_lossy().to_string(),
        mapping: mapping.to_string(),
        replicates: 2,
    }
}

/// 单表工作簿夹具:与 CSV 同一份行列,数值推断交给写入端 from_table。
fn write_sheet(path: &Path, name: &str, header: &[&str], rows: &[&[&str]]) {
    let sheet = Sheet::from_table(
        name,
        header.iter().map(|s| s.to_string()).collect(),
        rows.iter()
            .map(|r| r.iter().map(|s| s.to_string()).collect())
            .collect(),
    );
    Workbook::from_sheets(vec![sheet]).write(path).unwrap();
}

const CSV_BYTES: &str = "date,cohort_day,retained,active\nA,3,98,100\nB,4,90,100\n";
const XLSX_HEADER: &[&str] = &["date", "cohort_day", "retained", "active"];
const XLSX_ROWS: &[&[&str]] = &[&["A", "3", "98", "100"], &["B", "4", "90", "100"]];

fn mapping(file: &str, sheet: Option<&str>) -> String {
    let sheet_line = match sheet {
        Some(name) => format!("    sheet: {name}\n"),
        None => String::new(),
    };
    format!(
        "anchors:\n  retention_d3: {{observed: 0.985}}\nseries:\n  win_rate:\n    file: {file}\n{sheet_line}    day_column: cohort_day\n    value_column: retained\n    denominator_column: active\n    aggregation: ratio\n"
    )
}

#[test]
fn xlsx_source_matches_csv_field_for_field() {
    let dir = temp_dir("equivalence");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("daily.csv"), CSV_BYTES).unwrap();
    write_sheet(&dir.join("daily.xlsx"), "daily", XLSX_HEADER, XLSX_ROWS);

    let from_csv = calibrate_native(&input(&dir, &mapping("daily.csv", None))).unwrap();
    let from_xlsx = calibrate_native(&input(&dir, &mapping("daily.xlsx", Some("daily")))).unwrap();
    assert_eq!(
        serde_json::to_string(&from_csv).unwrap(),
        serde_json::to_string(&from_xlsx).unwrap(),
    );
    // 两条入口都要真的产出 series 锚点(不是同生共死的空输出)。
    assert_eq!(from_xlsx["summary"]["series_anchors"], 2);
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn xlsx_sheet_defaults_to_first_and_missing_sheet_is_content_error() {
    let dir = temp_dir("sheet");
    fs::create_dir_all(&dir).unwrap();
    // 两表工作簿:无 sheet 字段 → 取第一张(alpha),不是报错也不是猜。
    let alpha = Sheet::from_table(
        "alpha",
        vec!["cohort_day".into(), "retained".into(), "active".into()],
        vec![vec!["3".into(), "98".into(), "100".into()]],
    );
    let beta = Sheet::from_table("beta", vec!["x".into()], vec![vec!["1".into()]]);
    Workbook::from_sheets(vec![alpha, beta])
        .write(&dir.join("book.xlsx"))
        .unwrap();
    let default_sheet = "series:\n  win_rate:\n    file: book.xlsx\n    day_column: cohort_day\n    value_column: retained\n    denominator_column: active\n    aggregation: ratio\n";
    let output = calibrate_native(&input(&dir, default_sheet)).unwrap();
    let row = output["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["anchor"] == "win_rate" && row["day"] == 3)
        .unwrap();
    assert_eq!(row["observed"], 0.98, "{row}");

    let missing = "series:\n  win_rate:\n    file: book.xlsx\n    sheet: gamma\n    day_column: cohort_day\n    value_column: retained\n    denominator_column: active\n    aggregation: ratio\n";
    let err = calibrate_native(&input(&dir, missing)).unwrap_err();
    assert!(err.contains("没有工作表「gamma」"), "{err}");
    assert!(err.contains("alpha、beta"), "{err}");
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn xlsx_mapping_boundaries_stay_inside_data_dir_and_known_carriers() {
    let dir = temp_dir("boundary");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("ok.csv"), "cohort_day,v\n3,1\n").unwrap();
    write_sheet(
        &dir.join("ok.xlsx"),
        "daily",
        &["cohort_day", "v"],
        &[&["3", "1"]],
    );

    // CSV + sheet:CSV 没有工作表概念,结构期即拒绝。
    let csv_sheet = "series:\n  win_rate:\n    file: ok.csv\n    sheet: daily\n    day_column: cohort_day\n    value_column: v\n    aggregation: sum\n";
    let err = calibrate_native(&input(&dir, csv_sheet)).unwrap_err();
    assert!(err.contains("只有 .xlsx 数据源才能指定 sheet"), "{err}");

    // 空 sheet 名与其它列名同一纪律。
    let empty_sheet = "series:\n  win_rate:\n    file: ok.xlsx\n    sheet: \"\"\n    day_column: cohort_day\n    value_column: v\n    aggregation: sum\n";
    let err = calibrate_native(&input(&dir, empty_sheet)).unwrap_err();
    assert!(err.contains("sheet 不可为空字符串"), "{err}");

    // 其它载体显式拒绝,不按扩展名猜。
    let json_file = "series:\n  win_rate:\n    file: ok.json\n    day_column: cohort_day\n    value_column: v\n    aggregation: sum\n";
    let err = calibrate_native(&input(&dir, json_file)).unwrap_err();
    assert!(err.contains("仅支持 .csv / .xlsx"), "{err}");

    // 穿越与盘符:XLSX 入口与 CSV 共用同一套路径边界。
    let escape = "series:\n  win_rate:\n    file: ../ok.xlsx\n    day_column: cohort_day\n    value_column: v\n    aggregation: sum\n";
    let err = calibrate_native(&input(&dir, escape)).unwrap_err();
    assert!(err.contains("路径必须留在数据目录内"), "{err}");

    // 垃圾 xlsx(非 zip):归「文件不可读」,不展开内部错误。
    fs::write(dir.join("junk.xlsx"), b"not a zip").unwrap();
    let junk = "series:\n  win_rate:\n    file: junk.xlsx\n    day_column: cohort_day\n    value_column: v\n    aggregation: sum\n";
    let err = calibrate_native(&input(&dir, junk)).unwrap_err();
    assert!(err.contains("mapping 文件不可读"), "{err}");
    fs::remove_dir_all(&dir).ok();
}

/// 往返闭环(calibration-design「Excel 数据源」):sandtable workbook 导出
/// → 用户在 Excel 里改 daily 的 win_rate 观测列(day 等系统列不动)
/// → 回读校准,残差逐行反映编辑后的观测值。
#[test]
fn workbook_export_edit_recalibrate_roundtrip() {
    let dir = temp_dir("roundtrip");
    fs::create_dir_all(&dir).unwrap();

    // ① 导出:产物目录(days.csv)→ sandbox.xlsx(manifest + daily +
    //    metric_dictionary),与 `sandtable workbook` 同一条装配路径。
    fs::write(
        dir.join("days.csv"),
        "day,win_rate,income_per_active\n1,0.50,121\n2,0.51,122\n3,0.52,123\n4,0.53,124\n5,0.54,125\n6,0.55,126\n7,0.56,127\n",
    )
    .unwrap();
    let package = sandtable_cli::workbook::build(&dir).unwrap();
    let xlsx_path = dir.join("sandbox.xlsx");
    package.workbook.write(&xlsx_path).unwrap();

    // ② 改:读回三张表,daily 的 win_rate 列换成真实观测(7 天),其余不动。
    let (manifest_header, manifest_rows) =
        xlsx::read_sheet(&xlsx_path, Some("manifest"), 1).unwrap();
    assert_eq!(manifest_header[0], "name");
    let (dict_header, dict_rows) =
        xlsx::read_sheet(&xlsx_path, Some("metric_dictionary"), 1).unwrap();
    assert_eq!(dict_header[0], "id");
    assert!(!dict_rows.is_empty());
    let (daily_header, mut daily_rows) = xlsx::read_sheet(&xlsx_path, Some("daily"), 1).unwrap();
    assert_eq!(daily_header, vec!["day", "win_rate", "income_per_active"]);
    let win_rate_col = daily_header.iter().position(|h| h == "win_rate").unwrap();
    let observed: [&str; 7] = ["0.42", "0.44", "0.40", "0.45", "0.43", "0.46", "0.41"];
    for (row, value) in daily_rows.iter_mut().zip(observed) {
        row[win_rate_col] = value.to_string();
    }
    let edited = Workbook::from_sheets(vec![
        Sheet::from_table("manifest", manifest_header, manifest_rows),
        Sheet::from_table("daily", daily_header, daily_rows),
        Sheet::from_table("metric_dictionary", dict_header, dict_rows),
    ]);
    let edited_path = dir.join("edited.xlsx");
    edited.write(&edited_path).unwrap();

    // ③ 回读校准:观测值逐日等于编辑后的值(sim 侧照常真跑)。
    let mapping = "series:\n  win_rate:\n    file: edited.xlsx\n    sheet: daily\n    day_column: day\n    value_column: win_rate\n    aggregation: sum\n";
    let output = calibrate_native(&input(&dir, mapping)).unwrap();
    let rows = output["rows"].as_array().unwrap();
    assert_eq!(output["summary"]["series_anchors"], 7);
    for (day, value) in observed.iter().enumerate() {
        let row = rows
            .iter()
            .find(|row| row["anchor"] == "win_rate" && row["day"] == (day as u64 + 1))
            .unwrap_or_else(|| panic!("缺 day {} 锚点行", day + 1));
        assert_eq!(
            row["observed"],
            serde_json::to_value(value.parse::<f64>().unwrap()).unwrap(),
            "{row}"
        );
    }
    fs::remove_dir_all(&dir).ok();
}
