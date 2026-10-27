//! `sandtable scaffold` 端到端:四件套生成、生成即自检、模板可运行、
//! 非法名与重复目录拒载。

use std::fs;
use std::process::Command;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-scaffold-{tag}-{}-{nanos}", std::process::id()))
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

#[test]
fn scaffold_packages_four_pieces_and_runs() {
    let dir = temp_dir("four");
    fs::create_dir_all(&dir).unwrap();

    must_run(bin(&["scaffold", "demo", "--out", dir.to_str().unwrap()]));
    let base = dir.join("demo");
    for name in [
        "scenario.yaml",
        "params.csv",
        "experiment.yaml",
        "README.md",
    ] {
        assert!(base.join(name).is_file(), "缺四件套 {name}");
    }

    // 场景模板须过内核校验(独立于生成内自检)。
    must_run(bin(&[
        "validate",
        base.join("scenario.yaml").to_str().unwrap(),
    ]));

    // 基线参数表非空且首行为双列表头。
    let params = fs::read_to_string(base.join("params.csv")).unwrap();
    assert!(
        params.starts_with("path,value\n"),
        "基线参数表应为 path,value 表头"
    );

    // 实验草稿须可真跑:3 候选单轴扫描全成功。
    let sweep_out = dir.join("sweep");
    must_run(bin(&[
        "sweep",
        base.join("experiment.yaml").to_str().unwrap(),
        "--out",
        sweep_out.to_str().unwrap(),
    ]));
    let summary = fs::read_to_string(sweep_out.join("summary.csv")).unwrap();
    assert!(
        summary.contains("model.warrior.attack"),
        "summary 应含扫描轴列"
    );
    assert!(summary.matches("\n").count() >= 4, "3 候选 + 表头");
}

#[test]
fn scaffold_rejects_bad_name() {
    let out = bin(&["scaffold", "../evil"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("非法"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn scaffold_rejects_existing_dir() {
    let dir = temp_dir("dup");
    fs::create_dir_all(dir.join("demo")).unwrap();
    let out = bin(&["scaffold", "demo", "--out", dir.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("不覆盖"),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}
