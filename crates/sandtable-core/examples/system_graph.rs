//! 系统图生成器(文档 04 章数据源,方向项定义草案 §2 方案 A)。
//!
//! 从真实调度面探测:对每个注册系统逐事件真实调用 `subscribed`
//! (`system_registry` 与 `run_impl` 共用同一系统构造,订阅矩阵与代码同源),
//! 输出 SVG 到 `docs/assets/systems/`。图内英文(不依赖 CJK 字形,同
//! formula_curves 纪律);产物确定性,可 diff。
//!
//! 底部注记来自源码实况(核法:按 sim.rs 内 `impl System ... for <系统>` 分段
//! 统计 `systems::` 调用):player_day 内调 behavior / churn / combat /
//! progression,gacha_roll 内调 gacha 保底状态机,day_open / day_close 无
//! 游戏模块调用。改系统归属后重跑本例子前先重核该分段。
//!
//! 运行(仓库根):`cargo run -p sandtable-core --example system_graph`
//! 写盘只发生在本例子二进制,不进 lib / wasm 构建(04 章平台边界不变)。

use std::fs;
use std::path::PathBuf;

use sandtable_core::config::SimConfig;
use sandtable_core::sim::system_registry;

/// SVG 调色(同 formula_curves,按系统序取色)。
const PALETTE: &[&str] = &["#4c78a8", "#f58518", "#54a24b", "#b279a2"];

const EVENT_X: f32 = 70.0;
const EVENT_W: f32 = 170.0;
const SYSTEM_X: f32 = 560.0;
const SYSTEM_W: f32 = 190.0;
const BOX_H: f32 = 46.0;
const ROW_PITCH: f32 = 64.0;
const TOP: f32 = 104.0;

fn main() {
    let registry = system_registry(&SimConfig::default(), 0);
    assert!(!registry.is_empty(), "调度面为空:build_systems 返回空集?");

    // 事件清单取注册输出的并集(过滤保序 = EventKind 声明序)
    let mut events: Vec<&str> = Vec::new();
    for (_, evs) in &registry {
        for e in evs {
            if !events.contains(e) {
                events.push(e);
            }
        }
    }
    let systems: Vec<&str> = registry.iter().map(|(n, _)| n.as_str()).collect();
    let rows = events.len().max(systems.len()) as f32;
    let height = TOP + rows * ROW_PITCH + 84.0;
    let width = 840.0;

    let mut svg = String::new();
    svg.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" \
         viewBox=\"0 0 {width} {height}\" font-family=\"sans-serif\">\n"
    ));
    svg.push_str(
        "  <defs><marker id=\"arr\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" \
         markerWidth=\"7\" markerHeight=\"7\" orient=\"auto-start-reverse\">\
         <path d=\"M 0 0 L 10 5 L 0 10 z\" fill=\"#6b7280\"/></marker></defs>\n",
    );
    svg.push_str(&format!(
        "  <text x=\"{EVENT_X}\" y=\"40\" font-size=\"20\" font-weight=\"bold\" \
         fill=\"#111827\">Simulation kernel: event dispatch to systems</text>\n"
    ));
    svg.push_str(&format!(
        "  <text x=\"{EVENT_X}\" y=\"64\" font-size=\"12\" \
         fill=\"#6b7280\">probed from the live dispatcher (system_registry), not hand-drawn</text>\n"
    ));
    svg.push_str(&format!(
        "  <text x=\"{EVENT_X}\" y=\"{}\" font-size=\"13\" fill=\"#374151\">event</text>\n",
        TOP - 14.0
    ));
    svg.push_str(&format!(
        "  <text x=\"{SYSTEM_X}\" y=\"{}\" font-size=\"13\" fill=\"#374151\">system</text>\n",
        TOP - 14.0
    ));

    // 事件框(左列)
    for (i, ev) in events.iter().enumerate() {
        let y = TOP + i as f32 * ROW_PITCH;
        svg.push_str(&box_svg(EVENT_X, y, EVENT_W, "#6b7280", ev));
    }
    // 系统框(右列,带注册序配色)+ 订阅边
    for (j, (name, evs)) in registry.iter().enumerate() {
        let y = TOP + j as f32 * ROW_PITCH;
        let color = PALETTE[j % PALETTE.len()];
        svg.push_str(&box_svg(SYSTEM_X, y, SYSTEM_W, color, name));
        for ev in evs {
            let Some(i) = events.iter().position(|e| e == ev) else {
                panic!("系统 {name} 订阅了未登记事件 {ev}");
            };
            let ey = TOP + i as f32 * ROW_PITCH + BOX_H / 2.0;
            let sy = y + BOX_H / 2.0;
            svg.push_str(&format!(
                "  <line x1=\"{}\" y1=\"{ey}\" x2=\"{SYSTEM_X}\" y2=\"{sy}\" \
                 stroke=\"#6b7280\" stroke-width=\"1.6\" marker-end=\"url(#arr)\"/>\n",
                EVENT_X + EVENT_W
            ));
        }
    }
    // 底部注记(源码实况,核法见文件头)
    let fy = TOP + rows * ROW_PITCH + 28.0;
    svg.push_str(&format!(
        "  <text x=\"{EVENT_X}\" y=\"{fy}\" font-size=\"12\" fill=\"#374151\">\
         inside player_day: behavior / churn / combat / progression (crate::systems)</text>\n"
    ));
    svg.push_str(&format!(
        "  <text x=\"{EVENT_X}\" y=\"{}\" font-size=\"12\" fill=\"#374151\">\
         inside gacha_roll: gacha pity state machine (systems::gacha)</text>\n",
        fy + 18.0
    ));
    svg.push_str("</svg>\n");

    let out_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/assets/systems");
    fs::create_dir_all(&out_dir).expect("create docs/assets/systems");
    fs::write(out_dir.join("system-graph.svg"), &svg).expect("write system-graph.svg");
    println!("system graph written: docs/assets/systems/system-graph.svg");
    for (name, evs) in &registry {
        println!("  {name} <- {evs:?}");
    }
}

/// 圆角矩形 + 居中标签。
fn box_svg(x: f32, y: f32, w: f32, stroke: &str, label: &str) -> String {
    let cx = x + w / 2.0;
    let cy = y + BOX_H / 2.0 + 5.0;
    format!(
        "  <rect x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{BOX_H}\" rx=\"8\" \
         fill=\"#f9fafb\" stroke=\"{stroke}\" stroke-width=\"1.6\"/>\n  \
         <text x=\"{cx}\" y=\"{cy}\" font-size=\"15\" text-anchor=\"middle\" \
         fill=\"#111827\">{label}</text>\n"
    )
}
