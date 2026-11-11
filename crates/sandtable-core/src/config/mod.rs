//! 仿真配置(文档 03/07 章:Model 与 Scenario 分离,YAML 面见 [`crate::scenario`])。
//!
//! 部分覆盖语义:各配置节容器级 `#[serde(default)]`,缺省字段回退到本结构体
//! 的 `Default`(领域默认值,非零值);因此默认值集中在各 `impl Default`,
//! YAML 省略任何节 / 字段都得到一致的领域默认。
//!
//! 模块按域拆分:limits(分群与共享上界)/ combat / loot / gacha / behavior /
//! progression / validate(逐域校验);本文件只留编译产物 SimConfig 与
//! config_hash。全部公开类型经此处 `pub use` 再导出,`core::config::*` 路径不变。

mod behavior;
mod combat;
mod gacha;
mod limits;
mod loot;
mod progression;
mod validate;

#[cfg(test)]
#[path = "tests.rs"]
mod config_tests;

pub use behavior::{ActorBehaviorConfig, BehaviorConfig};
pub use combat::{CombatConfig, DamageModel, DungeonConfig, TierRow, WarriorConfig};
pub use gacha::GachaConfig;
pub use limits::{
    Cohort, COHORT_COUNT, MAX_ECONOMY_VALUE, MAX_GACHA_PULLS, MAX_SESSIONS_PER_DAY, MAX_SIM_DIM,
    MAX_SIM_SCALE, MAX_SWEEP_REPLICATES, MIN_GACHA_BASE_RATE, MIN_GACHA_TARGET_RATE,
};
pub use loot::{LootConfig, LootReward, LootTableConfig};
pub use progression::{ChurnConfig, FormulaConfig, ProgressionConfig, TrainingConfig};
pub use validate::validate;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// 仿真配置(内部编译产物)。YAML 的 scenario / model 两节都映射到这里。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SimConfig {
    // —— scenario 节(文档 03 章:实验环境)——
    pub players: u32,
    pub days: u32,
    /// 基础种子(第 r 个 replicate 的种子 = base_seed + r)
    pub base_seed: u64,
    /// 分群占比(依次 casual/core/whale;由 population_mix 而来)
    pub cohort_weights: [f64; COHORT_COUNT],
    // —— model 节(文档 03 章:游戏本身)——
    pub warrior: WarriorConfig,
    /// Whale 成长倍率(金币 / 经验获取 ×N);无付费语义(文档 13 章)
    pub whale_gain_mult: i64,
    pub combat: CombatConfig,
    pub dungeon: DungeonConfig,
    pub behavior: BehaviorConfig,
    /// 练级产出面(缺省 None = 无练级环)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub training: Option<TrainingConfig>,
    pub progression: ProgressionConfig,
    pub formulas: FormulaConfig,
    pub churn: ChurnConfig,
    /// 掉落加权表(文档 24 章 R1;缺省 None = 未配置掉落表)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loot: Option<LootConfig>,
    /// 抽卡保底(文档 24 章 R2;缺省 None = 无抽卡系统)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gacha: Option<GachaConfig>,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            players: 10_000,
            days: 30,
            base_seed: 12345,
            cohort_weights: [0.60, 0.30, 0.10],
            warrior: WarriorConfig::default(),
            whale_gain_mult: 2,
            combat: CombatConfig::default(),
            dungeon: DungeonConfig::default(),
            behavior: BehaviorConfig::default(),
            training: Some(TrainingConfig { xp: 400, gold: 150 }),
            progression: ProgressionConfig::default(),
            formulas: FormulaConfig::default(),
            churn: ChurnConfig::default(),
            loot: None,
            gacha: None,
        }
    }
}

/// 规范化 config_hash:serde 序列化字段序稳定 → SHA-256 hex。
/// 同一配置(含键序无关的语义)得到同一 hash;YAML 键序 / 注释差异在
/// 反序列化为结构体时被消除(文档 07 章)。
pub fn config_hash(cfg: &SimConfig) -> String {
    let json = serde_json::to_string(cfg).expect("SimConfig 序列化不会失败");
    let digest = Sha256::digest(json.as_bytes());
    let mut hex = String::with_capacity(64);
    for b in digest {
        hex.push_str(&format!("{b:02x}"));
    }
    hex
}

/// 第 r 个 replicate(0 起)的种子。
pub fn replicate_seed(base_seed: u64, replicate: u32) -> u64 {
    base_seed.wrapping_add(replicate as u64)
}
