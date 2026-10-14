//! 并行确定性守卫(docs 19 章「并行确定性测试」,补齐计划落地):
//! 同一 sweep 实验在 rayon 线程数 1 / 4 / 满核下,`candidates.csv` 与
//! `summary.csv` 必须逐位一致——候选间 par_iter 并行只影响调度不影响结果
//! (run_candidate 纯函数、collect 保序、采样流绑 base_seed 与线程无关)。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn temp_dir(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("st-par-{tag}-{}-{nanos}", std::process::id()))
}

/// 11 候选 × 2 replicates:足以让 rayon 池真实并行调度,debug 构建秒级。
fn write_experiment(dir: &Path) -> PathBuf {
    let exp = dir.join("exp.yaml");
    fs::write(
        &exp,
        r#"schema_version: "1"
scenario: {population: 120, duration: "10d"}
sweep:
  replicates: 2
  parameters:
    model.warrior.attack: {min: 80, max: 130, step: 5}
  targets:
    - metric: win_rate
      min: 0.0
      max: 1.0
"#,
    )
    .unwrap();
    exp
}

fn run_sweep(exp: &Path, threads: &str, out: &Path) {
    let st = Command::new(env!("CARGO_BIN_EXE_sandtable"))
        .env("RAYON_NUM_THREADS", threads)
        .args([
            "sweep",
            exp.to_str().unwrap(),
            "--out",
            out.to_str().unwrap(),
        ])
        .status()
        .unwrap();
    assert!(st.success(), "RAYON_NUM_THREADS={threads}: sweep 失败");
}

#[test]
fn sweep_tables_bitwise_identical_across_thread_counts() {
    let dir = temp_dir("guard");
    fs::create_dir_all(&dir).unwrap();
    let exp = write_experiment(&dir);

    let full = std::thread::available_parallelism().map_or(4, |n| n.get());
    let threads = ["1".to_string(), "4".to_string(), full.to_string()];
    let mut tables: Vec<(String, String)> = Vec::new();
    for t in &threads {
        let out = dir.join(format!("out-{t}"));
        run_sweep(&exp, t, &out);
        tables.push((
            fs::read_to_string(out.join("candidates.csv")).unwrap(),
            fs::read_to_string(out.join("summary.csv")).unwrap(),
        ));
    }

    let (base_c, base_s) = &tables[0];
    for (t, (c, s)) in threads.iter().zip(tables.iter()).skip(1) {
        assert_eq!(c, base_c, "candidates.csv 随线程数漂移(1 vs {t})");
        assert_eq!(s, base_s, "summary.csv 随线程数漂移(1 vs {t})");
    }

    let _ = fs::remove_dir_all(&dir);
}
