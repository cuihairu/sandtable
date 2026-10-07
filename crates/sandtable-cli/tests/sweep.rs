//! `sandtable sweep` 端到端(文档 10/12 章):实验文件 → 候选清单与汇总表
//! 落盘;失败候选标注不静默;配置错误退出码 2。

use std::fs;
use std::process::Command;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-sweep-{tag}-{}-{nanos}", std::process::id()))
}

#[test]
fn sweep_端到端_候选与汇总落盘() {
    let dir = temp_dir("e2e");
    fs::create_dir_all(&dir).unwrap();
    let exp = dir.join("exp.yaml");
    fs::write(
        &exp,
        r#"schema_version: "1"
scenario: {population: 100, duration: "10d"}
sweep:
  replicates: 2
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
  targets:
    - metric: win_rate
      min: 0.0
      max: 1.0
"#,
    )
    .unwrap();
    let out = dir.join("out");
    let st = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "sweep",
            exp.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
        ])
        .status()
        .unwrap();
    assert!(st.success());

    let candidates = fs::read_to_string(out.join("candidates.csv")).unwrap();
    assert_eq!(candidates.lines().count(), 4, "表头 + 3 候选:{candidates}");
    assert!(candidates.contains("0,ok,90"));

    let summary = fs::read_to_string(out.join("summary.csv")).unwrap();
    assert_eq!(summary.lines().count(), 4);
    let header = summary.lines().next().unwrap();
    assert!(
        header.starts_with("candidate,status,error,model.warrior.attack,"),
        "{header}"
    );
    assert!(header.ends_with("t1_win_rate"));
    // 每个成功候选都有判定(2 replicates 下 CI 宽,PASS/BORDERLINE 均可能)
    for row in summary.lines().skip(1) {
        let last = row.rsplit(',').next().unwrap();
        assert!(["PASS", "BORDERLINE", "FAIL"].contains(&last), "{row}");
    }

    let j: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out.join("sweep.json")).unwrap()).unwrap();
    assert_eq!(j["counts"]["candidates"], 3);
    assert_eq!(j["counts"]["ok"], 3);
    let v = &j["counts"]["verdicts"];
    let total: i64 = ["pass", "borderline", "fail"]
        .iter()
        .map(|k| v[*k].as_i64().unwrap())
        .sum();
    assert_eq!(total, 3, "判定数应等于候选数:{v}");
    assert_eq!(j["spec"]["replicates"], 2);
}

#[test]
fn sweep_失败候选标注_不静默() {
    let dir = temp_dir("bad-cand");
    fs::create_dir_all(&dir).unwrap();
    let exp = dir.join("bad.yaml");
    // p_hit 网格走出 [0,1]:该候选配置错误,但命令整体成功(错误是数据)
    fs::write(
        &exp,
        r#"schema_version: "1"
scenario: {population: 100, duration: "5d"}
sweep:
  replicates: 1
  parameters:
    model.combat.p_hit: {min: 0.8, max: 1.2, step: 0.2}
"#,
    )
    .unwrap();
    let out = dir.join("out");
    let st = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "sweep",
            exp.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
        ])
        .status()
        .unwrap();
    assert!(st.success(), "失败候选是数据不是命令失败");

    let summary = fs::read_to_string(out.join("summary.csv")).unwrap();
    let bad_row = summary.lines().nth(3).unwrap();
    assert!(bad_row.contains("config_error"), "{bad_row}");
    assert!(bad_row.contains("命中概率"), "error 列应标注原因:{bad_row}");
}

#[test]
fn sweep_实验文件配置错误_退出码2() {
    let dir = temp_dir("cfg-err");
    fs::create_dir_all(&dir).unwrap();
    let exp = dir.join("no-sweep.yaml");
    fs::write(&exp, "schema_version: \"1\"\nscenario: {population: 100}\n").unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "sweep",
            exp.to_str().unwrap(),
            "--out",
            dir.join("o").to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("sweep"), "{stderr}");
}
