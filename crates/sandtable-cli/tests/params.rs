//! `sandtable params` 端到端(文档 9/10 章):扁平 CSV 模板导出、改值回导、
//! 合并场景可直接仿真;坏行逐行标注退出码 2。

use std::fs;
use std::process::Command;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-params-{tag}-{}-{nanos}", std::process::id()))
}

fn bin(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn 导出_改值_回导_合并可直接仿真() {
    let dir = temp_dir("roundtrip");
    fs::create_dir_all(&dir).unwrap();

    // 1) 导出模板(默认配置)
    let tpl = dir.join("params.csv");
    let out = bin(&["params", "export", "--out", tpl.to_str().unwrap()]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let csv = fs::read_to_string(&tpl).unwrap();
    assert!(csv.starts_with("path,value\n"), "表头:{csv}");
    assert!(
        csv.contains("model.warrior.attack,100\n"),
        "含默认攻击力:{csv}"
    );
    assert!(!csv.contains("xp_needed"), "公式槽不进参数表:{csv}");
    assert!(!csv.contains("duration"), "时长不经参数表:{csv}");

    // 2) 改两行值
    let edited = csv
        .replacen("model.warrior.attack,100", "model.warrior.attack,77", 1)
        .replacen("model.combat.p_hit,0.85", "model.combat.p_hit,0.9", 1);
    assert_ne!(edited, csv, "两处替换都应命中");
    fs::write(&tpl, edited).unwrap();

    // 3) 回导 + 合并落盘
    let merged = dir.join("merged.yaml");
    let out = bin(&[
        "params",
        "import",
        tpl.to_str().unwrap(),
        "--out",
        merged.to_str().unwrap(),
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("53 项"), "{stdout}");
    let imported_hash = stdout
        .split("config_hash = ")
        .nth(1)
        .and_then(|s| s.lines().next())
        .map(|s| s.trim().to_string())
        .unwrap();

    // 4) 合并产物:改动到位、可校验、可仿真;hash 与导入报告一致
    let text = fs::read_to_string(&merged).unwrap();
    assert!(text.contains("attack: 77"), "{text}");
    assert!(text.contains("p_hit: 0.9"), "{text}");
    assert!(text.contains("duration: 30d"), "时长随基线:{text}");
    let out = bin(&["validate", merged.to_str().unwrap()]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let vstdout = String::from_utf8_lossy(&out.stdout);
    let validated_hash = vstdout
        .split("config_hash = ")
        .nth(1)
        .map(|s| s.trim().to_string());
    assert_eq!(
        Some(imported_hash.as_str()),
        validated_hash.as_deref(),
        "hash 应一致"
    );
    let out = bin(&[
        "simulate",
        merged.to_str().unwrap(),
        "--players",
        "50",
        "--days",
        "3",
    ]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
}

#[test]
fn 导入_坏行逐行标注_退出码2() {
    let dir = temp_dir("bad");
    fs::create_dir_all(&dir).unwrap();
    let bad = dir.join("bad.csv");
    fs::write(
        &bad,
        concat!(
            "path,value\n",
            "model.warrior.atcak,5\n",  // 未知路径(应带建议)
            "model.combat.p_hit,abc\n", // 非数值
            "model.warrior.attack,7\n", // 合法行
            "model.warrior.attack,8\n", // 重复
            "model.dungeon.tiers,-1\n", // 越界
        ),
    )
    .unwrap();
    let out = bin(&["params", "import", bad.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    // 坏行全部报完,不静默跳过
    assert!(stderr.contains("4 处错误"), "{stderr}");
    assert!(stderr.contains("你是否想写"), "未知路径带建议:{stderr}");
    assert!(stderr.contains("不是数值"), "{stderr}");
    assert!(stderr.contains("重复"), "{stderr}");
    assert!(stderr.contains("不能为负"), "{stderr}");
}

#[test]
fn 导入_表头错误_退出码2() {
    let dir = temp_dir("header");
    fs::create_dir_all(&dir).unwrap();
    let bad = dir.join("bad.csv");
    fs::write(&bad, "param,val\nmodel.warrior.attack,5\n").unwrap();
    let out = bin(&["params", "import", bad.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("path,value"), "{stderr}");
}

#[test]
fn 注释与空行跳过() {
    let dir = temp_dir("comments");
    fs::create_dir_all(&dir).unwrap();
    let csv = dir.join("params.csv");
    fs::write(
        &csv,
        concat!(
            "path,value\n",
            "\n",
            "# 策划备注:提高攻击\n",
            "model.warrior.attack,66\n",
        ),
    )
    .unwrap();
    let out = bin(&["params", "import", csv.to_str().unwrap()]);
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(stdout.contains("已导入 1 项"), "{stdout}");
}
