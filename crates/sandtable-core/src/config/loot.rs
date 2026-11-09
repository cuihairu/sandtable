//! 掉落配置域(文档 24 章 R1):加权表 + 结算数额,加载期双向对账。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::SimConfig;

/// 掉落加权表(文档 24 章 R1):项名 → 权重。
///
/// 权重是形状参数:加载期编译为 CDF 前缀和(`crate::rng::WeightedTable`),
/// 不进数值通道(同 [`DungeonConfig::tier_table`] 先例,改形态走 YAML 编辑)。
/// 表名与项名走 `BTreeMap`——键序确定,config_hash 稳定。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LootTableConfig {
    pub weights: BTreeMap<String, f64>,
}

/// 掉落条目结算数额(docs/loot-settlement-design.md):条目名 → 产出的
/// 金币 / 经验,数额乘 `rate_mult` 后取整发放。结构性参数(tier_table 先例),
/// 不进数值通道。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LootReward {
    #[serde(default)]
    pub gold: i64,
    #[serde(default)]
    pub xp: i64,
}

/// 掉落配置面(文档 24 章 R1;结算语义见 docs/loot-settlement-design.md)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LootConfig {
    /// 全局掉率倍率:**乘到掉落产出的量**(金币 / 经验数额),不改变表形状,
    /// 故分布检验不涉及它;数值槽,可 sweep
    pub rate_mult: f64,
    /// 每次战斗胜利抽取的表名(必须指向 `tables` 中的既有表)
    pub on_victory: String,
    /// 表名 → 权重表
    pub tables: BTreeMap<String, LootTableConfig>,
    /// 条目名 → 结算数额;每张表的每个权重条目都必须有定义,且无死条目
    pub rewards: BTreeMap<String, LootReward>,
}

impl Default for LootConfig {
    fn default() -> Self {
        Self {
            rate_mult: 1.0,
            on_victory: String::new(),
            tables: BTreeMap::new(),
            rewards: BTreeMap::new(),
        }
    }
}

impl LootConfig {
    /// 是否存在**可抽取**的金币型掉落奖励。`loot_gold_per_player` 只测
    /// 金币切片:有金币奖励时 0 也是实测值;纯经验/未配置时该口径不可用。
    /// 只计入 `on_victory` 指名表——掉落仅从该表抽取(sim.rs),金币奖励
    /// 放在非胜利表(从未抽取)不是可测口径,纯结构零不得冒充实测值。
    pub fn has_gold_reward(&self) -> bool {
        self.tables.get(&self.on_victory).is_some_and(|table| {
            table.weights.iter().any(|(name, w)| {
                // 权重 0 的条目恒不可抽(抽取层按权重抽样):金币奖励挂在
                // 权重 0 条目上从未产出,不是可测口径(2026-11-05 审核)。
                *w > 0.0 && self.rewards.get(name).is_some_and(|r| r.gold > 0)
            })
        })
    }
}

impl SimConfig {
    /// `loot_gold_per_player` 是否可测:存在金币型掉落奖励(不是只看
    /// loot 节是否在场——纯经验掉落 gold 全 0 时该 KPI 无金币口径)。
    pub fn loot_gold_measurable(&self) -> bool {
        self.loot.as_ref().is_some_and(LootConfig::has_gold_reward)
    }
}
