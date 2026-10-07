//! `sandtable recommend` 端到端(文档 14/15 章):sweep 产物 → 敏感性矩阵
//! + 单轴推荐区间;配置错误退出码 2。

use std::fs;
use std::process::Command;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-recommend-{tag}-{}-{nanos}", std::process::id()))
}

fn run_sweep(dir: &std::path::Path, yaml: &std::path::Path) {
    let st = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "sweep",
            yaml.to_str().unwrap(),
            "--out",
            dir.join("sweep-out").to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        st.status.success(),
        "{}",
        String::from_utf8_lossy(&st.stderr)
    );
}

#[test]
fn 推荐_单轴矩阵与推荐块() {
    let dir = temp_dir("1d");
    fs::create_dir_all(&dir).unwrap();
    let yaml = dir.join("experiment.yaml");
    fs::write(
        &yaml,
        concat!(
            "schema_version: \"1\"\n",
            "scenario: {population: 40, duration: \"10d\"}\n",
            "sweep:\n",
            "  replicates: 2\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 80, max: 120, step: 20}\n",
            "  targets:\n",
            "    - metric: win_rate\n",
            "      min: 0.0\n",
            "      max: 1.0\n",
            "      kind: hard\n",
        ),
    )
    .unwrap();
    run_sweep(&dir, &yaml);

    let rec_json = dir.join("rec.json");
    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "recommend",
            yaml.to_str().unwrap(),
            dir.join("sweep-out").to_str().unwrap(),
            "--out",
            rec_json.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let text = String::from_utf8_lossy(&out.stdout);
    // 敏感性矩阵:轴 × 指标逐条,弹性带区间
    assert!(text.contains("敏感性矩阵"), "{text}");
    assert!(text.contains("win_rate"), "{text}");
    assert!(text.contains("E ="), "{text}");
    // 推荐块按文档 15 章形态
    assert!(
        text.contains("Current:") && text.contains("model.warrior.attack"),
        "{text}"
    );
    assert!(text.contains("Recommended:"), "{text}");
    assert!(text.contains("Reason:"), "{text}");
    assert!(text.contains("Confidence:"), "{text}");

    let json = fs::read_to_string(&rec_json).unwrap();
    assert!(json.contains("\"elasticities\""), "{json}");
    assert!(json.contains("\"recommendation\""), "{json}");
    assert!(
        json.contains("\"confidence\": \"high\"")
            || json.contains("\"confidence\": \"medium\"")
            || json.contains("\"confidence\": \"low\""),
        "{json}"
    );
}

#[test]
fn 推荐_多参数轴_退出码2() {
    let dir = temp_dir("2d");
    fs::create_dir_all(&dir).unwrap();
    let yaml = dir.join("experiment.yaml");
    fs::write(
        &yaml,
        concat!(
            "schema_version: \"1\"\n",
            "scenario: {population: 20, duration: \"3d\"}\n",
            "sweep:\n",
            "  replicates: 1\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
            "    model.warrior.defense: {min: 70, max: 90, step: 10}\n",
            "  targets:\n",
            "    - metric: win_rate\n",
            "      min: 0.0\n",
            "      max: 1.0\n",
            "      kind: hard\n",
        ),
    )
    .unwrap();
    run_sweep(&dir, &yaml);

    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "recommend",
            yaml.to_str().unwrap(),
            dir.join("sweep-out").to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2), "多参数轴应退出码 2");
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("单参数轴"), "{stderr}");
}

#[test]
fn 推荐_sweep产物缺失_退出码2() {
    let dir = temp_dir("missing");
    fs::create_dir_all(&dir).unwrap();
    let yaml = dir.join("experiment.yaml");
    fs::write(
        &yaml,
        concat!(
            "schema_version: \"1\"\n",
            "scenario: {population: 20, duration: \"3d\"}\n",
            "sweep:\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
            "  targets:\n",
            "    - metric: win_rate\n",
            "      min: 0.0\n",
            "      max: 1.0\n",
        ),
    )
    .unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args([
            "recommend",
            yaml.to_str().unwrap(),
            dir.join("no-such-dir").to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("读取"), "{stderr}");
}
