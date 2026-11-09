//! 抽卡配置域(文档 24 章 R2):保底状态机参数(软 / 硬保底 + 定轨)。

use serde::{Deserialize, Serialize};

/// 抽卡保底配置面(文档 24 章 R2)。状态机语义:
/// 单抽成功率 `p' = min(1, base_rate + max(0, n − pity_soft_start + 1)·pity_soft_step)`,
/// 且 `n ≥ pity_hard > 0` 时 `p' = 1`(n = 抽数,1 起始)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GachaConfig {
    /// 单抽基础命中率(0, 1]
    pub base_rate: f64,
    /// 硬保底:第 pity_hard 抽必中(0 = 无)
    pub pity_hard: u64,
    /// 软保底起点:第 1 个获得概率加成的抽数(1 起始,抽 n 增量 = max(0, n − 起点 + 1)·step;
    /// 与官方公示「自第 N 抽起软保底」一致;pity_soft_step ≤ 0 时软保底整体不生效)
    pub pity_soft_start: u64,
    /// 起点后每抽概率增量(0 = 无软保底)
    pub pity_soft_step: f64,
    /// 5★ 命中时为「所定目标/UP 卡」的概率(0 = 无目标概念,如常驻池)。
    /// - 角色池 0.5(50/50,UP 单卡);武器池 0.375(双 UP 各 37.5%,所定单武器),
    ///   此时双 UP 合计 = 2 × featured_rate = 0.75(无 50/50);常驻池 0。
    /// - 仅影响「命中后是否为所定目标」的分层,不改 5★ 率面(定轨不挪 CRN 键,
    ///   同键流下 5★ 抽数分布与无定轨完全一致)。
    #[serde(default, skip_serializing_if = "featured_rate_is_default")]
    pub featured_rate: f64,
    /// 定轨:连续「非目标」5★ 达该次数后,下一次 5★ 必为所定目标(0 = 无定轨)。
    /// 角色池 1(50/50 歪后必 UP);武器池 Version 5.0 起 1(此前 2,最坏 240 抽);
    /// 常驻池 0。仅与 featured_rate > 0 一同生效。
    #[serde(default, skip_serializing_if = "featured_guarantee_is_default")]
    pub featured_guarantee: u64,
}

/// featured_rate 缺省值 0.0 不进 canonical JSON(旧配置 config_hash 不变)。
fn featured_rate_is_default(v: &f64) -> bool {
    *v == 0.0
}

/// featured_guarantee 缺省值 0 不进 canonical JSON(旧配置 config_hash 不变)。
fn featured_guarantee_is_default(v: &u64) -> bool {
    *v == 0
}

impl Default for GachaConfig {
    fn default() -> Self {
        Self {
            base_rate: 0.02,
            pity_hard: 0,
            pity_soft_start: 0,
            pity_soft_step: 0.0,
            featured_rate: 0.0,
            featured_guarantee: 0,
        }
    }
}
