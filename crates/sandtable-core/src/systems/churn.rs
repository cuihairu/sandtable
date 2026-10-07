//! 流失系统(文档 13 章):进度停滞 → 流失概率上升。
//!
//! Phase 1 用行为化流失:每个活跃日做一次伯努利判定,停滞日概率抬升。
//! 文档中"连续 K 天不活跃即流失"的统计口径适用于无行为模型的场景,
//! 这里以行为标志为准(两者在报告中区分)。

use crate::config::ChurnConfig;

/// 当前停滞状态下的流失概率。
pub fn churn_probability(idle_streak: u32, c: &ChurnConfig) -> f64 {
    if idle_streak >= c.stall_days {
        c.p_stall
    } else {
        c.p_base
    }
}
