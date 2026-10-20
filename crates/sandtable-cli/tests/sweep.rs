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
fn sweep_end_to_end_candidates_and_summary() {
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
fn sweep_failed_candidates_annotated() {
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
fn sweep_config_error_exit2() {
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

/// WB-10.04 · Grid / Random / LHS 三种扫描分别端到端,对照四件事:
/// 计划(spec 的模式/采样数/replicates)、参数组合(Grid 精确笛卡尔积、
/// Random 每维落在 [min,max)、LHS 每维排序后每层恰一点)、实际任务数
/// (每候选的 replicate 数都齐,合计 = 候选数 × replicates)、复现(同 YAML
/// 两个独立进程跑,candidates/summary 逐字节一致,sweep.json 的 results/spec
/// 一致——Random/LHS 的采样流与 base_seed 绑定,与线程数无关)。
#[test]
fn sweep_modes_grid_random_lhs_plan_combos_tasks_reproduce() {
    // 两维参数:Grid 3×3=9 候选;Random/LHS 用 samples 采样
    let exp = |mode: &str, samples: usize| {
        let s = if samples > 0 {
            format!("  samples: {samples}\n")
        } else {
            String::new()
        };
        format!(
            "schema_version: \"1\"\nscenario: {{population: 100, duration: \"5d\"}}\n\
             sweep:\n  mode: {mode}\n{s}  replicates: 2\n  parameters:\n    \
             model.warrior.attack: {{min: 90, max: 110, step: 10}}\n    \
             model.dungeon.m_attack: {{min: 10, max: 30, step: 10}}\n"
        )
    };
    let run_sweep = |exp: &std::path::Path, out: &std::path::Path| {
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
    };

    for (mode, samples, expected) in [
        ("grid", 0usize, 9usize),
        ("random", 5, 5),
        ("latin_hypercube", 6, 6),
    ] {
        let dir = temp_dir(mode);
        fs::create_dir_all(&dir).unwrap();
        let yaml_path = dir.join("exp.yaml");
        fs::write(&yaml_path, exp(mode, samples)).unwrap();
        run_sweep(&yaml_path, &dir.join("run1"));
        run_sweep(&yaml_path, &dir.join("run2"));

        // 复现:两个独立进程,计划与逐候选统计一致(采样流绑定 base_seed)
        let cand1 = fs::read_to_string(dir.join("run1/candidates.csv")).unwrap();
        let cand2 = fs::read_to_string(dir.join("run2/candidates.csv")).unwrap();
        assert_eq!(cand1, cand2, "{mode}: candidates.csv 复现");
        let sum1 = fs::read_to_string(dir.join("run1/summary.csv")).unwrap();
        let sum2 = fs::read_to_string(dir.join("run2/summary.csv")).unwrap();
        assert_eq!(sum1, sum2, "{mode}: summary.csv 复现");
        let j1: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("run1/sweep.json")).unwrap())
                .unwrap();
        let j2: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(dir.join("run2/sweep.json")).unwrap())
                .unwrap();
        assert_eq!(
            j1["results"], j2["results"],
            "{mode}: sweep.json results 复现"
        );
        assert_eq!(j1["spec"], j2["spec"], "{mode}: sweep.json spec 复现");

        // 计划:模式/采样数/replicates 如 YAML 所写
        assert_eq!(j1["spec"]["mode"], mode);
        assert_eq!(j1["spec"]["replicates"], 2);
        if samples > 0 {
            assert_eq!(j1["spec"]["samples"], samples);
        }

        // 参数组合:candidates.csv 表头后一行一候选;parameters 是 BTreeMap,
        // 列序按路径字母序而非声明序——按表头查列,不假设位置
        let header: Vec<&str> = cand1.lines().next().unwrap().split(',').collect();
        let col = |path: &str| header.iter().position(|h| *h == path).unwrap();
        let rows: Vec<&str> = cand1.lines().skip(1).collect();
        assert_eq!(rows.len(), expected, "{mode}: 候选数");
        let cell =
            |r: &str, path: &str| r.split(',').nth(col(path)).unwrap().parse::<f64>().unwrap();
        let attacks: Vec<f64> = rows
            .iter()
            .map(|r| cell(r, "model.warrior.attack"))
            .collect();
        let m_attacks: Vec<f64> = rows
            .iter()
            .map(|r| cell(r, "model.dungeon.m_attack"))
            .collect();
        match mode {
            "grid" => {
                // 组合全集 = 两维等步长点的笛卡尔积(f64 无序,排序后比)
                let mut got: Vec<(f64, f64)> = attacks
                    .iter()
                    .zip(m_attacks.iter())
                    .map(|(a, m)| (*a, *m))
                    .collect();
                got.sort_by(|x, y| x.partial_cmp(y).unwrap());
                let mut want: Vec<(f64, f64)> = [90.0, 100.0, 110.0]
                    .iter()
                    .flat_map(|a| [10.0, 20.0, 30.0].iter().map(move |m| (*a, *m)))
                    .collect();
                want.sort_by(|x, y| x.partial_cmp(y).unwrap());
                assert_eq!(got, want, "{mode}: 组合全集 = 笛卡尔积");
                // 展开序跟随 parameters 的 BTreeMap 序(路径字母序):m_attack 为外层
                let got_order: Vec<(f64, f64)> = attacks
                    .iter()
                    .zip(m_attacks.iter())
                    .map(|(a, m)| (*a, *m))
                    .collect();
                let mut want_order: Vec<(f64, f64)> = Vec::new();
                for m in [10.0, 20.0, 30.0] {
                    for a in [90.0, 100.0, 110.0] {
                        want_order.push((a, m));
                    }
                }
                assert_eq!(got_order, want_order, "{mode}: 候选展开序");
            }
            "random" => {
                for (i, (a, m)) in attacks.iter().zip(m_attacks).enumerate() {
                    assert!(
                        (90.0..110.0).contains(a) && (10.0..30.0).contains(&m),
                        "{mode}: 候选 {i} 出范围 ({a},{m})"
                    );
                }
            }
            "latin_hypercube" => {
                // 每维排序后第 i 个值落在第 i 层 [min+i·w, min+(i+1)·w)
                let n = expected as f64;
                for (vals, lo, hi) in [
                    (
                        &{
                            let mut v = attacks.clone();
                            v.sort_by(|x, y| x.partial_cmp(y).unwrap());
                            v
                        },
                        90.0,
                        110.0,
                    ),
                    (
                        &{
                            let mut v = m_attacks.clone();
                            v.sort_by(|x, y| x.partial_cmp(y).unwrap());
                            v
                        },
                        10.0,
                        30.0,
                    ),
                ] {
                    let w = (hi - lo) / n;
                    for (i, v) in vals.iter().enumerate() {
                        let slo = lo + i as f64 * w;
                        assert!(
                            *v >= slo && *v < slo + w,
                            "{mode}: 第 {i} 层应落 [{slo},{{}}) 实际 {v}"
                        );
                    }
                }
            }
            _ => unreachable!(),
        }

        // 实际任务数:每个成功候选的每个指标都拿满 2 个 replicate
        let results = j1["results"].as_array().unwrap();
        assert_eq!(results.len(), expected);
        let tasks: usize = results
            .iter()
            .map(|r| {
                assert_eq!(r["status"], "ok", "{mode}: 候选全部成功");
                let stats = r["metric_stats"].as_array().unwrap();
                assert!(!stats.is_empty(), "{mode}: 有指标统计");
                let n = stats[0][1]["n"].as_u64().unwrap();
                assert!(
                    stats.iter().all(|s| s[1]["n"].as_u64().unwrap() == n),
                    "{mode}: 同候选各指标 replicate 数一致"
                );
                n as usize
            })
            .sum();
        assert_eq!(
            tasks,
            expected * 2,
            "{mode}: 实际任务数 = 候选数 × replicates"
        );
    }
}
