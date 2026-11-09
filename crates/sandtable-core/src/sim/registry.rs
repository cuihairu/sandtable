//! 调度面快照:对每个注册系统逐事件真实调用 `subscribed`,订阅矩阵与代码同源。
use crate::config::SimConfig;

use super::event::{probe_event, ALL_EVENT_KINDS};
use super::system::build_systems;
pub fn system_registry(cfg: &SimConfig, seed: u64) -> Vec<(String, Vec<&'static str>)> {
    // 与 run_impl 同法局部 clone:系统与公式同域,借期可统一
    let cfg = cfg.clone();
    let xp_needed_formula =
        crate::formula::compile(&cfg.formulas.xp_needed, crate::formula::XP_NEEDED_VARS)
            .expect("formulas.xp_needed 编译失败:SimConfig 未经 config::validate");
    let systems = build_systems(&cfg, seed, &xp_needed_formula);
    systems
        .iter()
        .map(|sys| {
            let events: Vec<&'static str> = ALL_EVENT_KINDS
                .iter()
                .filter(|k| sys.subscribed(&probe_event(**k)))
                .map(|k| k.name())
                .collect();
            (sys.name().to_string(), events)
        })
        .collect()
}
