//! 生成物新鲜度守卫(巡检 FIRE1015R3 连续推进项)。
//!
//! `docs/assets/systems/system-graph.svg` 与 `docs/assets/formulas/*.svg` 都是
//! 程序生成产物,但「程序生成」只保证**生成器**与实况同源,不保证**提交进仓的
//! 那一份**被重新生成过:加了 System / 改了订阅矩阵却忘了跑 example,图会静默
//! 过期,而 04 章仍写着「与代码同源」。本测试把这条缝隙变成 CI 红。
//!
//! 覆盖面的诚实边界:系统图能逐边反解(布局行栅格 → 事件/系统行号),故断言的是
//! **完整订阅矩阵**;公式曲线图的坐标映射逻辑只存在于 example 内,此处不复制一份
//! 反解实现(两份实现必然互相漂移),它的新鲜度仍靠生成器 panic + 人工重绘。
//!
//! 失效时的修法(不是修测试):重跑
//! `cargo run -p sandtable-core --example system_graph` 并把产物一并提交。

use std::collections::BTreeSet;
use std::path::PathBuf;

use sandtable_core::config::SimConfig;
use sandtable_core::sim::system_registry;

/// 布局常量与 `examples/system_graph.rs` 同源;两边任一改动即失配,
/// 此时本测试报的仍是真问题(该重跑 example),故不在此做自动同步。
const TOP: f32 = 104.0;
const BOX_H: f32 = 46.0;
const ROW_PITCH: f32 = 64.0;

fn svg_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/assets/systems/system-graph.svg")
}

fn svg() -> String {
    std::fs::read_to_string(svg_path())
        .expect("系统图产物缺失:跑 cargo run -p sandtable-core --example system_graph")
}

/// 事件登记序 = example 的取法(按注册序取并集、保序);行号反解依赖同一顺序。
fn live_dispatcher() -> (Vec<String>, Vec<(String, Vec<String>)>) {
    let reg: Vec<(String, Vec<String>)> = system_registry(&SimConfig::default(), 0)
        .into_iter()
        .map(|(name, evs)| (name, evs.into_iter().map(str::to_string).collect()))
        .collect();
    let mut events: Vec<String> = Vec::new();
    for (_, evs) in &reg {
        for e in evs {
            if !events.contains(e) {
                events.push(e.clone());
            }
        }
    }
    (events, reg)
}

/// 边的 y 坐标落在行栅格上,y 反解出行号;偏出栅格即布局变了(真问题)。
fn row_of(y: f32) -> usize {
    let off = y - (TOP + BOX_H / 2.0);
    let idx = (off / ROW_PITCH).round();
    assert!(
        (off - idx * ROW_PITCH).abs() < 0.01,
        "边 y={y} 不落在行栅格上(example 布局已变:先重跑生成器,再更新本测试常量)"
    );
    assert!(idx >= 0.0, "边 y={y} 落在首行之上");
    idx as usize
}

fn attr(tag: &str, name: &str) -> f32 {
    let key = format!("{name}=\"");
    let start = tag
        .find(&key)
        .unwrap_or_else(|| panic!("<line> 标签缺 {name} 属性:{tag}"))
        + key.len();
    let rest = &tag[start..];
    let end = rest.find('"').expect("<line> 属性未闭合");
    rest[..end]
        .parse()
        .unwrap_or_else(|e| panic!("{name} 解析失败:{e}"))
}

/// (事件行号, 系统行号) 边集;顺序不保证(set 语义)。
fn edges(svg: &str) -> Vec<(usize, usize)> {
    svg.split("<line ")
        .skip(1)
        .map(|chunk| {
            let tag = &chunk[..chunk.find('>').expect("<line> 标签未闭合")];
            (row_of(attr(tag, "y1")), row_of(attr(tag, "y2")))
        })
        .collect()
}

#[test]
fn committed_system_graph_matches_live_dispatcher() {
    let (events, systems) = live_dispatcher();
    let svg = svg();

    for name in &events {
        assert!(
            svg.contains(&format!(">{name}</text>")),
            "事件 {name} 在提交进仓的图里没有框:重跑 cargo run -p sandtable-core --example system_graph"
        );
    }
    for (name, _) in &systems {
        assert!(
            svg.contains(&format!(">{name}</text>")),
            "系统 {name} 在提交进仓的图里没有框:重跑 cargo run -p sandtable-core --example system_graph"
        );
    }

    let got = edges(&svg);
    let mut want: BTreeSet<(usize, usize)> = BTreeSet::new();
    for (si, (_, evs)) in systems.iter().enumerate() {
        for e in evs {
            let ei = events
                .iter()
                .position(|x| x == e)
                .unwrap_or_else(|| panic!("系统订阅了未登记事件 {e}"));
            want.insert((ei, si));
        }
    }
    assert_eq!(
        got.len(),
        want.len(),
        "提交进仓的图有 {} 条订阅边,真实调度面是 {} 条(重复边或漏边):重跑 example",
        got.len(),
        want.len()
    );
    let got: BTreeSet<(usize, usize)> = got.into_iter().collect();
    assert_eq!(
        got, want,
        "提交进仓的订阅矩阵与真实调度面不符(改了系统/订阅却忘了重生成):\
         重跑 cargo run -p sandtable-core --example system_graph"
    );
}

/// 底部注记里的模块名必须真实存在——注记本身是人工核过的(sim.rs 内
/// `impl System ... for <系统>` 分段统计 `systems::` 调用),此处只兜住
/// 「注记引用的模块被改名/删除」这一类漂移。
#[test]
fn footer_annotation_names_real_modules() {
    let svg = svg();
    let systems_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src/systems");
    let exists = |m: &str| {
        let p = systems_dir.join(format!("{m}.rs"));
        assert!(
            p.is_file(),
            "图注记引用了不存在的模块 {m}(应删注记或改回真实模块名)"
        );
    };

    let line = svg
        .lines()
        .find(|l| l.contains("(crate::systems)"))
        .expect("图底部注记缺失(inside player_day: ... (crate::systems))");
    let list = line
        .split_once("(crate::systems)")
        .expect("注记格式已变")
        .0
        .rsplit_once(": ")
        .expect("注记格式已变")
        .1;
    let named: Vec<&str> = list.split('/').map(str::trim).collect();
    assert!(
        !named.is_empty(),
        "注记未列出任何模块名:守卫失去意义,人工核过后补齐"
    );
    for m in named {
        exists(m);
    }

    assert!(
        svg.contains("systems::gacha"),
        "图注记缺 gacha 保底状态机一行(生成器 footer 变了就同步重生成)"
    );
    exists("gacha");
}
