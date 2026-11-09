//! `sandtable optimize` 端到端(文档 12 章自动寻优):寻优实验文件 →
//! 最优解 + 逐代统计落盘;确定性(同种子同最优);配置错误退出码 2。

use std::fs;
use std::process::Command;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-opt-{tag}-{}-{nanos}", std::process::id()))
}

fn run(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .args(args)
        .output()
        .unwrap()
}

fn exp_yaml() -> String {
    r#"schema_version: "1"
scenario: {population: 100, duration: "10d"}
optimize:
  mode: evolutionary
  population: 4
  generations: 3
  elite: 1
  mutation_rate: 0.5
  mutation_scale: 0.3
  replicates: 2
  parameters:
    model.warrior.attack: {min: 100, max: 180, step: 20}
  targets:
    - metric: win_rate
      min: 0.3
  objective:
    metric: power_p50
    direction: maximize
"#
    .into()
}

#[test]
fn optimize_end_to_end_best_and_generations() {
    let dir = temp_dir("e2e");
    fs::create_dir_all(&dir).unwrap();
    let exp = dir.join("exp.yaml");
    fs::write(&exp, exp_yaml()).unwrap();
    let out = dir.join("out");
    let st = run(&[
        "optimize",
        exp.to_str().unwrap(),
        "--out",
        out.to_str().unwrap(),
    ]);
    assert!(
        st.status.success(),
        "{}",
        String::from_utf8_lossy(&st.stderr)
    );

    let v: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out.join("opt.json")).unwrap()).unwrap();
    // 评估账:population + generations × (population − elite) = 4 + 3×3 = 13
    assert_eq!(v["evaluated"], 13);
    assert_eq!(v["total_sims"], 26);
    assert_eq!(v["history"].as_array().unwrap().len(), 4, "初始 + 3 代");
    // 最优在域内且可行(hard pass = 1)
    let best_atk = v["best"]["values"]["model.warrior.attack"]
        .as_f64()
        .unwrap();
    assert!((100.0..=180.0).contains(&best_atk), "{best_atk}");
    assert_eq!(v["best_fitness"]["hard_pass"], 1);
    assert_eq!(v["best"]["status"], "ok");

    // 候选清单 = 表头 + 13 行(全历史,精英不重评不重复)
    let candidates = fs::read_to_string(out.join("candidates.csv")).unwrap();
    assert_eq!(candidates.lines().count(), 14, "{candidates}");

    // 确定性:同种子再跑,最优参数与逐代统计一致(meta 时间戳除外)
    let out2 = dir.join("out2");
    let st = run(&[
        "optimize",
        exp.to_str().unwrap(),
        "--out",
        out2.to_str().unwrap(),
    ]);
    assert!(st.status.success());
    let v2: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(out2.join("opt.json")).unwrap()).unwrap();
    assert_eq!(v["best"], v2["best"], "同种子同最优");
    assert_eq!(v["history"], v2["history"], "同种子同逐代统计");
}

#[test]
fn optimize_sweep_sections_exclusive_exit2() {
    let dir = temp_dir("mutex");
    fs::create_dir_all(&dir).unwrap();
    let exp = dir.join("exp.yaml");
    fs::write(
        &exp,
        r#"schema_version: "1"
sweep:
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
optimize:
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
"#,
    )
    .unwrap();
    let st = run(&["optimize", exp.to_str().unwrap()]);
    assert_eq!(st.status.code(), Some(2));
    assert!(
        String::from_utf8_lossy(&st.stderr).contains("互斥"),
        "错误应说明互斥"
    );
}

#[test]
fn optimize_missing_section_exit2() {
    let dir = temp_dir("nosec");
    fs::create_dir_all(&dir).unwrap();
    let exp = dir.join("exp.yaml");
    fs::write(
        &exp,
        r#"schema_version: "1"
scenario: {population: 100, duration: "10d"}
"#,
    )
    .unwrap();
    let st = run(&["optimize", exp.to_str().unwrap()]);
    assert_eq!(st.status.code(), Some(2));
    assert!(
        String::from_utf8_lossy(&st.stderr).contains("optimize"),
        "错误应指向 optimize 节"
    );
}

/// ST-AUD-17/19 / I-017/I-019:寻优同样收紧规模 / 总工作量门(桌面路径此前
/// 无门),超限退出码 2 并点名超限维度;规模内仍放行。
#[test]
fn optimize_enforces_scale_and_work_budgets() {
    let dir = temp_dir("budget");
    fs::create_dir_all(&dir).unwrap();

    // 规模门:100 万 × 1d > 40 万
    let exp = dir.join("big-scale.yaml");
    fs::write(
        &exp,
        r#"schema_version: "1"
scenario: {population: 1000000, duration: "1d"}
optimize:
  mode: evolutionary
  population: 4
  generations: 3
  elite: 1
  mutation_rate: 0.5
  mutation_scale: 0.3
  replicates: 2
  parameters:
    model.warrior.attack: {min: 100, max: 180, step: 20}
  targets:
    - metric: win_rate
      min: 0.3
"#,
    )
    .unwrap();
    let out = run(&["optimize", exp.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("players"), "{stderr}");

    // 总工作量门:种群 × (代+1) = 候选 ≤ 上限,但 × replicates × players × days
    // 超限(100×100 候选 = 1e4 ≤ MAX_CANDIDATES,×100 R×100 players×30d = 3e9 > 1e9)
    let exp = dir.join("big-work.yaml");
    fs::write(
        &exp,
        r#"schema_version: "1"
scenario: {population: 100, duration: "30d"}
optimize:
  mode: evolutionary
  population: 100
  generations: 99
  elite: 1
  mutation_rate: 0.5
  mutation_scale: 0.3
  replicates: 100
  parameters:
    model.warrior.attack: {min: 100, max: 180, step: 20}
  targets:
    - metric: win_rate
      min: 0.3
"#,
    )
    .unwrap();
    let out = run(&["optimize", exp.to_str().unwrap()]);
    assert_eq!(out.status.code(), Some(2));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stderr.contains("总仿真工作量"), "{stderr}");

    // 规模内仍放行(exp_yaml 基线写盘,--out 指向临时目录防污染仓库)
    let exp = dir.join("ok.yaml");
    fs::write(&exp, exp_yaml()).unwrap();
    let out = dir.join("out");
    let st = run(&[
        "optimize",
        exp.to_str().unwrap(),
        "--out",
        out.to_str().unwrap(),
    ]);
    assert!(
        st.status.success(),
        "{:?}",
        String::from_utf8_lossy(&st.stderr)
    );
}
