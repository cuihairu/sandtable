//! `sandtable project` 端到端(文档 9/10 章):打包 / 校验 / 展开往返,
//! 确定性(同目录两次打包字节一致),导入即全量校验(哈希不匹配、
//! 清单外条目、路径纪律、schema_version、目录约定逐项拒绝,退出码 2)。

use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-project-{tag}-{}-{nanos}", std::process::id()))
}

fn bin(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args(args)
        .output()
        .unwrap()
}

fn stderr(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

const SCENARIO: &str =
    "schema_version: '1'\nscenario:\n  population: 500\n  duration: 3d\n  seed: 7\n";
const EXPERIMENT: &str = "schema_version: '1'\nscenario:\n  population: 500\n  duration: 3d\n  seed: 7\nsweep:\n  replicates: 2\n  parameters:\n    model.warrior.attack: {min: 90, max: 110, step: 10}\n  targets:\n    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n";

/// 造一个符合约定的项目目录:1 scenario + 1 experiment + 1 result。
fn fixture(dir: &std::path::Path) {
    fs::create_dir_all(dir.join("scenarios")).unwrap();
    fs::create_dir_all(dir.join("experiments")).unwrap();
    fs::create_dir_all(dir.join("results")).unwrap();
    fs::write(dir.join("scenarios/base.yaml"), SCENARIO).unwrap();
    fs::write(dir.join("experiments/sw.yaml"), EXPERIMENT).unwrap();
    fs::write(dir.join("results/days.csv"), "day,win_rate\n1,0.99\n").unwrap();
}

/// 手工构造归档(篡改测试用):绕过打包器,直接写 zip 条目。
fn hand_zip(dst: &std::path::Path, entries: &[(&str, String)]) {
    let f = fs::File::create(dst).unwrap();
    let mut zw = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default();
    for (name, body) in entries {
        zw.start_file(*name, opts).unwrap();
        zw.write_all(body.as_bytes()).unwrap();
    }
    zw.finish().unwrap();
}

#[test]
fn 打包_校验_展开_往返与确定性() {
    let dir = temp_dir("roundtrip");
    let proj = dir.join("myproj");
    fixture(&proj);

    // 1) 打包 + 校验
    let arc = dir.join("myproj.sandtable");
    let out = bin(&[
        "project",
        "pack",
        proj.to_str().unwrap(),
        "--out",
        arc.to_str().unwrap(),
    ]);
    assert!(out.status.success(), "{}", stderr(&out));
    let out = bin(&["project", "check", arc.to_str().unwrap()]);
    assert!(out.status.success(), "{}", stderr(&out));
    assert!(String::from_utf8_lossy(&out.stdout).contains("归档有效"));

    // 2) 确定性:同目录两次打包字节一致
    let arc2 = dir.join("again.sandtable");
    let out = bin(&[
        "project",
        "pack",
        proj.to_str().unwrap(),
        "--out",
        arc2.to_str().unwrap(),
    ]);
    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(
        fs::read(&arc).unwrap(),
        fs::read(&arc2).unwrap(),
        "同内容打包须字节一致"
    );

    // 3) 展开:文件逐字节一致
    let restored = dir.join("restored");
    let out = bin(&[
        "project",
        "unpack",
        arc.to_str().unwrap(),
        "--out",
        restored.to_str().unwrap(),
    ]);
    assert!(out.status.success(), "{}", stderr(&out));
    assert_eq!(
        fs::read(restored.join("scenarios/base.yaml")).unwrap(),
        SCENARIO.as_bytes()
    );
    assert_eq!(
        fs::read(restored.join("experiments/sw.yaml")).unwrap(),
        EXPERIMENT.as_bytes()
    );

    // 4) 展开产物就是普通配置,直接可仿真(Project 不新增仿真语义)
    let out = bin(&[
        "simulate",
        restored.join("scenarios/base.yaml").to_str().unwrap(),
    ]);
    assert!(out.status.success(), "{}", stderr(&out));

    // 5) 展开进非空目录被拒(不覆盖既有文件)
    let out = bin(&[
        "project",
        "unpack",
        arc.to_str().unwrap(),
        "--out",
        restored.to_str().unwrap(),
    ]);
    assert_eq!(out.status.code(), Some(2), "{}", stderr(&out));
    assert!(stderr(&out).contains("非空"));

    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn 篡改哈希与清单外条目被拒() {
    let dir = temp_dir("tamper");
    fs::create_dir_all(&dir).unwrap();

    // 1) 哈希不匹配:清单写全零哈希
    let bad_hash = format!(
        "schema_version: '1'\nname: bad\nentries:\n  - path: scenarios/base.yaml\n    kind: scenario\n    sha256: {}\n",
        "0".repeat(64)
    );
    let arc = dir.join("badhash.sandtable");
    hand_zip(
        &arc,
        &[
            ("manifest.yaml", bad_hash),
            ("scenarios/base.yaml", SCENARIO.into()),
        ],
    );
    let out = bin(&["project", "check", arc.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2));
    assert!(stderr(&out).contains("sha256 不匹配"), "{}", stderr(&out));

    // 2) 归档里有清单未声明的条目(多一件都报错)
    let mf = "schema_version: '1'\nname: extra\nentries:\n  - path: scenarios/base.yaml\n    kind: scenario\n    sha256: 0\n".to_string();
    let arc = dir.join("extra.sandtable");
    hand_zip(
        &arc,
        &[
            ("manifest.yaml", mf),
            ("scenarios/base.yaml", SCENARIO.into()),
            ("results/x.bin", "\u{1}\u{2}\u{3}".into()),
        ],
    );
    let out = bin(&["project", "check", arc.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2));
    assert!(stderr(&out).contains("清单未声明"), "{}", stderr(&out));

    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn 路径纪律与schema_version被拒() {
    let dir = temp_dir("paths");
    fs::create_dir_all(&dir).unwrap();

    // 1) 路径越界 ..:先拒路径纪律(哈希校验之前)
    let mf = "schema_version: '1'\nname: evil\nentries:\n  - path: ../evil.yaml\n    kind: scenario\n    sha256: 0\n".to_string();
    let arc = dir.join("evil.sandtable");
    hand_zip(
        &arc,
        &[("manifest.yaml", mf), ("base.yaml", SCENARIO.into())],
    );
    let out = bin(&["project", "check", arc.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2));
    assert!(stderr(&out).contains("路径"), "{}", stderr(&out));

    // 2) schema_version 不支持
    let mf = "schema_version: '2'\nname: fut\nentries: []\n".to_string();
    let arc = dir.join("fut.sandtable");
    hand_zip(&arc, &[("manifest.yaml", mf)]);
    let out = bin(&["project", "check", arc.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2));
    assert!(stderr(&out).contains("schema_version"), "{}", stderr(&out));

    fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn 打包目录约定被拒() {
    let dir = temp_dir("convention");
    fs::create_dir_all(&dir).unwrap();

    // 1) 只有 results 没有任何配置:至少一个 scenario / experiment
    let proj = dir.join("empty");
    fs::create_dir_all(proj.join("results")).unwrap();
    fs::write(proj.join("results/days.csv"), "day\n").unwrap();
    let out = bin(&["project", "pack", proj.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2), "{}", stderr(&out));
    assert!(
        stderr(&out).contains("scenario 或 experiment"),
        "{}",
        stderr(&out)
    );

    // 2) 项目根出现约定外文件:不静默丢弃
    let proj = dir.join("stray");
    fixture(&proj);
    fs::write(proj.join("notes.txt"), "TODO").unwrap();
    let out = bin(&["project", "pack", proj.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2), "{}", stderr(&out));
    assert!(stderr(&out).contains("notes.txt"), "{}", stderr(&out));

    fs::remove_dir_all(&dir).unwrap();
}
