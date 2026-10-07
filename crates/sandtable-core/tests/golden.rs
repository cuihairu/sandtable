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
fn 黄金快照_字节级一致() {
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
