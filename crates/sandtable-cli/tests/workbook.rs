//! `sandtable workbook` 端到端(文档 9 章):产物目录 → 多工作表 .xlsx。
//! 验证部件清单与顺序、manifest 自描述(含自己与缺席记录)、表头在 r=1、
//! 数值走真数值单元格、缺席产物不出空表、同输入字节一致。

use std::fs;
use std::io::Read as _;
use std::process::Command;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-workbook-{tag}-{}-{nanos}", std::process::id()))
}

fn bin(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args(args)
        .output()
        .unwrap()
}

fn must_run(out: std::process::Output) {
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

/// .xlsx 部件名(按归档内顺序)。
fn part_names(path: &std::path::Path) -> Vec<String> {
    let f = fs::File::open(path).unwrap();
    let mut ar = zip::ZipArchive::new(f).unwrap();
    (0..ar.len())
        .map(|i| ar.by_index(i).unwrap().name().to_string())
        .collect()
}

/// 读 .xlsx 部件文本。
fn part_text(path: &std::path::Path, name: &str) -> String {
    let f = fs::File::open(path).unwrap();
    let mut ar = zip::ZipArchive::new(f).unwrap();
    let mut zr = ar.by_name(name).unwrap();
    let mut s = String::new();
    zr.read_to_string(&mut s).unwrap();
    s
}

#[test]
fn workbook_packages_artifacts_into_sheets() {
    let dir = temp_dir("full");
    fs::create_dir_all(&dir).unwrap();
    let scenario = dir.join("scenario.yaml");
    fs::write(
        &scenario,
        "schema_version: \"1\"\nscenario: {population: 30, duration: \"7d\"}\n",
    )
    .unwrap();

    // 1) 真产物:simulate(days.csv / report.json)+ compare(comparison.json)
    let sim_out = dir.join("sim");
    must_run(bin(&[
        "simulate",
        scenario.to_str().unwrap(),
        "--out",
        sim_out.to_str().unwrap(),
    ]));
    let cmp_out = dir.join("cmp");
    must_run(bin(&[
        "compare",
        scenario.to_str().unwrap(),
        "--replicates",
        "6",
        "--metric",
        "win_rate",
        "--out",
        cmp_out.to_str().unwrap(),
    ]));

    // 2) 聚合目录:params.csv + days.csv + comparison.json(candidates/summary 缺席)
    let agg = dir.join("agg");
    fs::create_dir_all(&agg).unwrap();
    must_run(bin(&[
        "params",
        "export",
        scenario.to_str().unwrap(),
        "--out",
        agg.join("params.csv").to_str().unwrap(),
    ]));
    fs::copy(sim_out.join("days.csv"), agg.join("days.csv")).unwrap();
    fs::copy(cmp_out.join("comparison.json"), agg.join("comparison.json")).unwrap();

    let dst = dir.join("pkg.xlsx");
    must_run(bin(&[
        "workbook",
        agg.to_str().unwrap(),
        "--out",
        dst.to_str().unwrap(),
    ]));
    assert!(dst.exists());

    // 3) 部件清单与顺序:4 个包层部件 + 每表一个 worksheet,编号连续
    let parts = part_names(&dst);
    let mut expected = vec![
        String::from("[Content_Types].xml"),
        String::from("_rels/.rels"),
        String::from("xl/workbook.xml"),
        String::from("xl/_rels/workbook.xml.rels"),
    ];
    expected.extend((1..=5).map(|i| format!("xl/worksheets/sheet{i}.xml")));
    assert_eq!(parts, expected);

    // 4) workbook.xml:表名与 sheetId/rId 一一对应,顺序 = manifest 在最前
    let wb = part_text(&dst, "xl/workbook.xml");
    let names = [
        "manifest",
        "parameters",
        "comparison",
        "daily",
        "metric_dictionary",
    ];
    for (i, name) in names.iter().enumerate() {
        let frag = format!(
            "<sheet name=\"{}\" sheetId=\"{}\" r:id=\"rId{}\"/>",
            name,
            i + 1,
            i + 1
        );
        assert!(wb.contains(&frag), "缺 {frag};workbook.xml = {wb}");
    }

    // 5) manifest(sheet1):版本行、自指行、各表行、缺席行
    let manifest = part_text(&dst, "xl/worksheets/sheet1.xml");
    assert!(
        manifest.contains(&format!(
            "<t xml:space=\"preserve\">{}</t>",
            sandtable_core::MODEL_VERSION
        )),
        "manifest 应记录 model_version"
    );
    assert!(
        manifest.contains(&format!(
            "<t xml:space=\"preserve\">{}</t>",
            sandtable_core::kpi_dict::METRIC_DICT_VERSION
        )),
        "manifest 应记录 metric_dict_version"
    );
    for row in [
        "this workbook",
        "params.csv",
        "comparison.json",
        "days.csv",
        "core::kpi_dict",
    ] {
        assert!(
            manifest.contains(&format!("<t xml:space=\"preserve\">{row}</t>")),
            "manifest 缺来源 {row}"
        );
    }
    for artifact in ["candidates.csv", "summary.csv"] {
        assert!(
            manifest.contains(&format!("<t xml:space=\"preserve\">{artifact}</t>")),
            "manifest 应记录缺席产物 {artifact}"
        );
    }

    // 6) parameters(sheet2):表头在 r=1,参数值为真数值单元格
    let parameters = part_text(&dst, "xl/worksheets/sheet2.xml");
    assert!(parameters.starts_with("<?xml"));
    assert!(
        parameters.contains("<row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t xml:space=\"preserve\">path</t></is></c>"),
        "表头须是第 1 行文本单元格\n{parameters}"
    );
    assert!(parameters.contains("<row r=\"2\">"));
    assert!(
        parameters.contains("<c r=\"B2\"><v>"),
        "参数值须是真数值单元格(无 t 属性)\n{parameters}"
    );

    // 7) comparison(sheet3):字段名与 comparison.json 同名,verdict 保持 JSON 形态
    let comparison = part_text(&dst, "xl/worksheets/sheet3.xml");
    let json = fs::read_to_string(agg.join("comparison.json")).unwrap();
    let value = serde_json::from_str::<serde_json::Value>(&json).unwrap();
    let verdict = value
        .get("comparison")
        .and_then(|v| v.get("verdict"))
        .and_then(|v| v.as_str())
        .unwrap();
    for field in [
        "metric",
        "arm_a_mean",
        "arm_b_ci95_hi",
        "diff_mean",
        "effect_size_d",
        "verdict",
    ] {
        assert!(
            comparison.contains(&format!("<t xml:space=\"preserve\">{field}</t>")),
            "comparison 表头缺 {field}"
        );
    }
    assert!(
        comparison.contains(&format!("<t xml:space=\"preserve\">{verdict}</t>")),
        "verdict 应与 comparison.json 同形({verdict})\n{comparison}"
    );
    assert!(
        comparison.contains("<c r=\"B2\"><v>"),
        "均值须是真数值单元格\n{comparison}"
    );

    // 8) daily(sheet4):表头沿用 days.csv 的列序与列名,首列文本、末列数值
    let daily = part_text(&dst, "xl/worksheets/sheet4.xml");
    let days_csv = fs::read_to_string(agg.join("days.csv")).unwrap();
    let header_line = days_csv.lines().next().unwrap();
    let cols = header_line.split(',').count();
    assert!(
        daily.contains("<t xml:space=\"preserve\">day</t>"),
        "daily 表首列应为 day\n{daily}"
    );
    assert!(
        daily.contains("<t xml:space=\"preserve\">upgrades</t>"),
        "daily 表末列应为 upgrades(days.csv 列序)\n{daily}"
    );
    let header_cells = daily
        .split("<row r=\"2\">")
        .next()
        .unwrap()
        .matches("<c r=")
        .count();
    assert_eq!(header_cells, cols, "表头列数应与 days.csv 一致");
    assert!(
        daily.contains("<row r=\"2\"><c r=\"A2\"><v>"),
        "day 列应是真数值单元格\n{daily}"
    );

    // 9) metric_dictionary(sheet5):条数 = 内核字典条目
    let dict_sheet = part_text(&dst, "xl/worksheets/sheet5.xml");
    let expected = sandtable_core::kpi_dict::metric_definitions().len();
    let actual = dict_sheet.matches("<row r=").count() - 1;
    assert_eq!(actual, expected, "字典表行数须与内核条目一致");
    assert!(dict_sheet.contains("<t xml:space=\"preserve\">retention_d7</t>"));

    // 10) 字节确定性:同一目录两次打包完全一致
    let dst2 = dir.join("pkg2.xlsx");
    must_run(bin(&[
        "workbook",
        agg.to_str().unwrap(),
        "--out",
        dst2.to_str().unwrap(),
    ]));
    assert_eq!(
        fs::read(&dst).unwrap(),
        fs::read(&dst2).unwrap(),
        "固定时间戳下同输入须同字节"
    );
}

#[test]
fn workbook_rejects_empty_dir() {
    let dir = temp_dir("empty");
    fs::create_dir_all(&dir).unwrap();
    let out = bin(&["workbook", dir.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("没有任何已知产物"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(!dir.join("sandbox.xlsx").exists());
}

#[test]
fn workbook_rejects_missing_dir() {
    let out = bin(&["workbook", "/no/such/sandtable-dir"]);
    assert_eq!(out.status.code(), Some(2));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("不是目录"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}
