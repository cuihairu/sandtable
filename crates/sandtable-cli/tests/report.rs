//! `sandtable report` 端到端(文档 9/10 章):已落盘产物 → 单文件 HTML,
//! 无外部资源;无源报错退出码 2。

use std::fs;
use std::process::Command;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-report-{tag}-{}-{nanos}", std::process::id()))
}

fn bin(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn 报告_多源合并单文件_无外部资源() {
    let dir = temp_dir("multi");
    fs::create_dir_all(&dir).unwrap();
    let scenario = dir.join("scenario.yaml");
    fs::write(
        &scenario,
        "schema_version: \"1\"\nscenario: {population: 30, duration: \"7d\"}\n",
    )
    .unwrap();
    // 1) 单次仿真 → report.json + days.csv
    let sim_out = dir.join("sim");
    let st = bin(&[
        "simulate",
        scenario.to_str().unwrap(),
        "--out",
        sim_out.to_str().unwrap(),
    ]);
    assert!(
        st.status.success(),
        "{}",
        String::from_utf8_lossy(&st.stderr)
    );

    // 2) 扫描 → sweep.json
    let exp = dir.join("experiment.yaml");
    fs::write(
        &exp,
        concat!(
            "schema_version: \"1\"\n",
            "scenario: {population: 30, duration: \"7d\"}\n",
            "sweep:\n",
            "  replicates: 1\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
            "  targets:\n",
            "    - metric: win_rate\n",
            "      min: 0.0\n",
            "      max: 1.0\n",
            "      kind: hard\n",
        ),
    )
    .unwrap();
    let sweep_out = dir.join("sweep-out");
    let st = bin(&[
        "sweep",
        exp.to_str().unwrap(),
        "--out",
        sweep_out.to_str().unwrap(),
    ]);
    assert!(
        st.status.success(),
        "{}",
        String::from_utf8_lossy(&st.stderr)
    );

    // 3) 推荐 → rec.json
    let rec_json = dir.join("rec.json");
    let st = bin(&[
        "recommend",
        exp.to_str().unwrap(),
        sweep_out.to_str().unwrap(),
        "--out",
        rec_json.to_str().unwrap(),
    ]);
    assert!(
        st.status.success(),
        "{}",
        String::from_utf8_lossy(&st.stderr)
    );

    // 4) 报告:三源合并
    let html_path = dir.join("report.html");
    let st = bin(&[
        "report",
        sim_out.to_str().unwrap(),
        sweep_out.to_str().unwrap(),
        rec_json.to_str().unwrap(),
        "--out",
        html_path.to_str().unwrap(),
    ]);
    assert!(
        st.status.success(),
        "{}",
        String::from_utf8_lossy(&st.stderr)
    );

    let html = fs::read_to_string(&html_path).unwrap();
    assert!(html.starts_with("<!DOCTYPE html>"), "单文件 HTML 头");
    // 各板块(发现什么渲染什么)
    assert!(html.contains("总览"), "总览板块(原计划 Phase 7:Dashboard)");
    assert!(html.contains("KPI 汇总"), "report.json 板块");
    assert!(
        html.contains("分群画像"),
        "分群画像板块(原计划 Phase 7:Population)"
    );
    assert!(html.contains("casual"), "分群行(三分群键)");
    assert!(html.contains("参数扫描"), "sweep.json 板块");
    assert!(html.contains("敏感性与推荐"), "rec.json 板块");
    assert!(html.contains("按天指标"), "days.csv 板块");
    assert!(html.contains("Confidence"), "推荐块");
    assert!(html.contains("<svg"), "内联 SVG 图");
    assert!(html.contains("PASS"), "约束判定列");
    // 自包含:无外部资源、占位符已替换
    assert!(
        !html.contains("http://") && !html.contains("https://"),
        "无外链"
    );
    assert!(
        !html.contains("{body}") && !html.contains("{sources}"),
        "占位符已替换"
    );
}

#[test]
fn 报告_无源_退出码2() {
    let dir = temp_dir("empty");
    fs::create_dir_all(&dir).unwrap();
    let out = bin(&["report", dir.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2), "无报告源应退出码 2");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("报告源"), "{stderr}");
}
