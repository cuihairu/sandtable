// Windows 发布版按 GUI 子系统启动,根除启动时带出的控制台黑窗(debug 保留控制台便于看日志)
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
// 薄壳:逻辑在 lib.rs(桌面壳 Phase 7,core path 直连不经 wasm 边界)
fn main() {
    sandtable_desktop_lib::run()
}
