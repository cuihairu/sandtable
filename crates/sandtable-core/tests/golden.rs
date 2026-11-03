//! 黄金快照(文档 19 章):确定性回归的最低保障。
//!
//! 同配置同种子重跑,完整报告必须逐字节一致。快照文件由
//! `SANDTABLE_WRITE_GOLDEN=1 cargo test -p sandtable-core --test golden`
//! 显式生成——模型语义变化时快照 diff 就是最直观的变更审查材料。

use std::path::PathBuf;

use sandtable_core::config::SimConfig;
use sandtable_core::{export, sim};

fn render_golden() -> String {
    let cfg = SimConfig {
        players: 200,
        days: 14,
        base_seed: 2024,
        ..SimConfig::default()
    };
    let m0 = sim::run(&cfg, 0);
    let m1 = sim::run(&cfg, 1);
    format!(
        "# players=200 days=14 seed=2024 replicates=2\n{}{}",
        export::to_json(&m0),
        export::to_json(&m1)
    )
}

#[test]
fn golden_snapshot_byte_identical() {
    let json = render_golden();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/golden_report.json");
    if std::env::var_os("SANDTABLE_WRITE_GOLDEN").is_some() {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &json).unwrap();
        println!("已重写快照 {}", path.display());
        return;
    }
    let expected = std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "缺少快照文件 {},先运行 SANDTABLE_WRITE_GOLDEN=1 cargo test -p sandtable-core --test golden",
            path.display()
        )
    });
    assert_eq!(json, expected, "输出与黄金快照不一致:模型语义发生了变化");
}

/// 记录值机器核验(审核发现 2026-11-04):94a7d40 闭环记录曾把新默认快照
/// 误记为「win_rate 0.986、casual mean_level 7.04」,实际快照为
/// 0.0649/0.0386、3.598/3.585。本测试把 todo.md 记录值与快照绑定,任何
/// 一侧漂移即红——防止再次出现「记录与快照不符」且掩盖默认平衡变化。
/// 该变化本身是有意的(config.rs:172-177 注释「低练度打不过、练级成长后
/// 逐层解锁——胜率呈上升→平台→饱和梯度」,非 0/100 双峰)。
#[test]
fn golden_recorded_balance_values_match_snapshot() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/golden_report.json");
    let raw = std::fs::read_to_string(&path).expect("golden_report.json 应在");
    let json: String = raw.lines().filter(|line| !line.starts_with('#')).collect();
    let values = parse_concatenated_json(&json);
    let wins: Vec<f64> = values
        .iter()
        .map(|o| o["win_rate"].as_f64().expect("win_rate 应为数"))
        .collect();
    let casual_levels: Vec<f64> = values
        .iter()
        .map(|o| {
            o["cohort_stats"]
                .as_array()
                .expect("cohort_stats 应为数组")
                .iter()
                .find(|c| c["cohort"] == "casual")
                .and_then(|c| c["mean_level"].as_f64())
                .expect("casual mean_level 应为数")
        })
        .collect();
    assert_eq!(
        wins,
        vec![0.06489827453000258, 0.03859306301905227],
        "默认 SimConfig 快照 win_rate 应为 0.0649/0.0386(旧记录 0.986 是误记)"
    );
    assert_eq!(
        casual_levels,
        vec![3.5984848484848486, 3.5853658536585367],
        "默认 SimConfig 快照 casual mean_level 应为 3.598/3.585(旧记录 7.04 是误记)"
    );
}

/// 把相邻拼接的多个 JSON 对象解析为数组(serde_json 流式读多个值)。
fn parse_concatenated_json(raw: &str) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    let mut stream = serde_json::Deserializer::from_str(raw).into_iter::<serde_json::Value>();
    while let Some(v) = stream.next() {
        out.push(v.unwrap());
    }
    out
}
