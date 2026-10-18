//! 引擎无关 JSON 契约:结构定义与导出器。
//!
//! 契约面只承载沙盘**语义层**(设计文档 §3.1:数值表、公式 / 曲线、掉落表、
//! 抽卡配置、行为配置);UI / 布局 / 动画等引擎侧概念不导出。
//!
//! 导出纪律:
//! - **有效值导出**:缺省即语义明确的标量一律导出生效值(如 `damage_model`
//!   缺省 → `"difference"`、`ratio_k` 缺省 → `1.0`),消费方不必复制沙盘缺省表;
//! - **行内产出缺省回退几何**:逐层表行 `gold / xp` 缺省时按
//!   `reward_gold · reward_gold_growth^tier` 取整导出(与 core `monster_of`
//!   同公式),引擎侧拿到整数,无需复制公式;
//! - **确定性**:字段序 = 结构体声明序,BTreeMap 键序固定,与 core 确定性纪律一致。

use std::collections::BTreeMap;

use sandtable_core::config::{SimConfig, TierRow};
use serde::{Deserialize, Serialize};

use crate::error::Result;

/// 契约语义版本(设计文档 §3.2:语义变更走加法;删除 / 改义须升 major)。
pub const SCHEMA_VERSION: &str = "0.1.0";

/// 契约文件 kind 标记(与回流文件区分)。
pub const KIND_CONTRACT: &str = "sandtable-engine-contract";

/// 回流文件 kind 标记。
pub const KIND_BACKFLOW: &str = "sandtable-engine-backflow";

/// 契约 / 回流文件扩展名( `.engine.json` )。
pub const FILE_EXTENSION: &str = "engine.json";

/// 契约顶层。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EngineContract {
    /// 文件种类标记,恒为 [`KIND_CONTRACT`]。
    pub kind: String,
    /// 契约语义版本,当前 [`SCHEMA_VERSION`]。
    pub schema_version: String,
    /// 沙盘配置哈希(scenario + model 全量),供引擎侧回指沙盘运行结果。
    pub config_hash: String,
    /// 语义层模型。
    pub model: ModelContract,
}

/// 语义层模型(对应 `SimConfig` 的 model 节)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelContract {
    /// 玩家初始数值。
    pub warrior: WarriorContract,
    /// Whale 分群成长倍率(金币 / 经验获取 ×N)。
    pub whale_gain_mult: i64,
    /// 战斗数值。
    pub combat: CombatContract,
    /// 副本 / 怪物层数。
    pub dungeon: DungeonContract,
    /// 行为概率(按分群)。
    pub behavior: BehaviorContract,
    /// 练级产出面(缺省 None = 无练级环)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub training: Option<TrainingContract>,
    /// 成长 / 强化数值。
    pub progression: ProgressionContract,
    /// 公式槽(受控表达式原文)。
    pub formula: FormulaContract,
    /// 流失机制。
    pub churn: ChurnContract,
    /// 掉落加权表(缺省 None = 未配置掉落表)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loot: Option<LootContract>,
    /// 抽卡保底(缺省 None = 无抽卡系统)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gacha: Option<GachaContract>,
}

/// 玩家初始数值。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WarriorContract {
    pub attack: i64,
    pub defense: i64,
    pub hp: i64,
}

/// 战斗数值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CombatContract {
    /// 玩家命中概率。
    pub p_hit: f64,
    /// 怪物命中概率。
    pub p_hit_monster: f64,
    /// 伤害浮动半宽。
    pub dmg_var: i64,
    /// 最大轮数。
    pub max_rounds: u32,
    /// 伤害口径(有效值:`"difference"` | `"ratio"`)。
    pub damage_model: String,
    /// 比值口径比例参数(有效值;非 ratio 口径时为缺省 1.0)。
    pub ratio_k: f64,
}

/// 副本 / 怪物层数(几何参数恒导出;逐层表存在时附有效值行)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DungeonContract {
    /// 层数(0 起)。
    pub tiers: u32,
    /// 第 0 层怪物 hp。
    pub m_hp: i64,
    /// 第 0 层怪物 attack。
    pub m_attack: i64,
    /// 第 0 层怪物 defense。
    pub m_defense: i64,
    /// 每层成长倍率。
    pub tier_growth: f64,
    /// 第 0 层产出 gold。
    pub reward_gold: i64,
    /// 第 0 层产出 xp。
    pub reward_xp: i64,
    /// 金币逐层增长率。
    pub reward_gold_growth: f64,
    /// 经验逐层增长率。
    pub reward_xp_growth: f64,
    /// 逐层显式表(行内 gold / xp 已按几何回退取整为有效值)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier_table: Option<Vec<TierRowContract>>,
}

/// 逐层怪物数值一行(有效值)。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TierRowContract {
    pub hp: i64,
    pub attack: i64,
    pub defense: i64,
    /// 该层产出金币(有效值)。
    pub gold: i64,
    /// 该层产出经验(有效值)。
    pub xp: i64,
}

/// 行为概率(按分群)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BehaviorContract {
    pub casual: ActorBehaviorContract,
    pub core: ActorBehaviorContract,
    pub whale: ActorBehaviorContract,
}

/// 单个分群的行为概率。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActorBehaviorContract {
    pub sessions_int: u32,
    pub sessions_frac: f64,
    pub p_dungeon: f64,
    pub p_upgrade: f64,
    pub p_training: f64,
}

/// 练级产出面。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct TrainingContract {
    pub xp: i64,
    pub gold: i64,
}

/// 成长 / 强化数值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProgressionContract {
    pub xp_base: i64,
    pub xp_pow: f64,
    pub level_attack_gain: i64,
    pub level_defense_gain: i64,
    pub level_hp_gain: i64,
    pub upgrade_cost_base: i64,
    pub upgrade_cost_num: i64,
    pub upgrade_cost_den: i64,
    pub upgrade_attack_gain: i64,
}

/// 公式槽(受控表达式原文;变量白名单见沙盘 formula 节)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FormulaContract {
    pub xp_needed: String,
}

/// 流失机制。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ChurnContract {
    pub p_base: f64,
    pub p_stall: f64,
    pub stall_days: u32,
}

/// 掉落结算配置(表 + 胜利绑定 + 条目数额;键序固定)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LootContract {
    pub rate_mult: f64,
    pub on_victory: String,
    pub tables: BTreeMap<String, LootTableContract>,
    pub rewards: BTreeMap<String, LootRewardContract>,
}

/// 一张掉落表的项权重(项名 → 权重;键序固定)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LootTableContract {
    pub weights: BTreeMap<String, f64>,
}

/// 一个掉落条目的产出数额(表条目 → 数额;键序固定)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LootRewardContract {
    pub gold: i64,
    pub xp: i64,
}

/// 抽卡保底。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GachaContract {
    pub base_rate: f64,
    pub pity_hard: u64,
    pub pity_soft_start: u64,
    pub pity_soft_step: f64,
}

/// 几何回退取整(与 core `monster_of` 同公式:`base · growth^tier` 截断)。
fn tier_reward(base: i64, growth: f64, tier: usize) -> i64 {
    (base as f64 * growth.powi(tier as i32)) as i64
}

/// 导出契约(设计文档 §3.4:导出前走 `validate_config` 同源校验)。
///
/// 不产出「沙盘自己都跑不通」的契约;校验失败透传 `core::Error`。
pub fn export(cfg: &SimConfig) -> Result<EngineContract> {
    sandtable_core::config::validate(cfg)?;
    Ok(EngineContract {
        kind: KIND_CONTRACT.into(),
        schema_version: SCHEMA_VERSION.into(),
        config_hash: sandtable_core::config::config_hash(cfg),
        model: ModelContract::export(cfg),
    })
}

impl ModelContract {
    fn export(cfg: &SimConfig) -> Self {
        Self {
            warrior: WarriorContract {
                attack: cfg.warrior.attack,
                defense: cfg.warrior.defense,
                hp: cfg.warrior.hp,
            },
            whale_gain_mult: cfg.whale_gain_mult,
            combat: CombatContract {
                p_hit: cfg.combat.p_hit,
                p_hit_monster: cfg.combat.p_hit_monster,
                dmg_var: cfg.combat.dmg_var,
                max_rounds: cfg.combat.max_rounds,
                damage_model: match cfg.combat.damage_model {
                    Some(sandtable_core::config::DamageModel::Ratio) => "ratio",
                    _ => "difference",
                }
                .into(),
                ratio_k: cfg.combat.ratio_k,
            },
            dungeon: DungeonContract::export(cfg),
            behavior: BehaviorContract {
                casual: ActorBehaviorContract::export(&cfg.behavior.casual),
                core: ActorBehaviorContract::export(&cfg.behavior.core),
                whale: ActorBehaviorContract::export(&cfg.behavior.whale),
            },
            training: cfg.training.map(|t| TrainingContract {
                xp: t.xp,
                gold: t.gold,
            }),
            progression: ProgressionContract {
                xp_base: cfg.progression.xp_base,
                xp_pow: cfg.progression.xp_pow,
                level_attack_gain: cfg.progression.level_attack_gain,
                level_defense_gain: cfg.progression.level_defense_gain,
                level_hp_gain: cfg.progression.level_hp_gain,
                upgrade_cost_base: cfg.progression.upgrade_cost_base,
                upgrade_cost_num: cfg.progression.upgrade_cost_num,
                upgrade_cost_den: cfg.progression.upgrade_cost_den,
                upgrade_attack_gain: cfg.progression.upgrade_attack_gain,
            },
            formula: FormulaContract {
                xp_needed: cfg.formulas.xp_needed.clone(),
            },
            churn: ChurnContract {
                p_base: cfg.churn.p_base,
                p_stall: cfg.churn.p_stall,
                stall_days: cfg.churn.stall_days,
            },
            loot: cfg.loot.as_ref().map(|l| LootContract {
                rate_mult: l.rate_mult,
                on_victory: l.on_victory.clone(),
                tables: l
                    .tables
                    .iter()
                    .map(|(name, table)| {
                        (
                            name.clone(),
                            LootTableContract {
                                weights: table.weights.clone(),
                            },
                        )
                    })
                    .collect(),
                rewards: l
                    .rewards
                    .iter()
                    .map(|(name, r)| {
                        (
                            name.clone(),
                            LootRewardContract {
                                gold: r.gold,
                                xp: r.xp,
                            },
                        )
                    })
                    .collect(),
            }),
            gacha: cfg.gacha.as_ref().map(|g| GachaContract {
                base_rate: g.base_rate,
                pity_hard: g.pity_hard,
                pity_soft_start: g.pity_soft_start,
                pity_soft_step: g.pity_soft_step,
            }),
        }
    }
}

impl DungeonContract {
    fn export(cfg: &SimConfig) -> Self {
        let d = &cfg.dungeon;
        // 行内 gold / xp 缺省回退几何,取整为有效值(与 core monster_of 同公式)
        let tier_table = d.tier_table.as_ref().map(|rows| {
            rows.iter()
                .enumerate()
                .map(
                    |(
                        tier,
                        TierRow {
                            hp,
                            attack,
                            defense,
                            gold,
                            xp,
                        },
                    )| TierRowContract {
                        hp: *hp,
                        attack: *attack,
                        defense: *defense,
                        gold: gold.unwrap_or_else(|| {
                            tier_reward(d.reward_gold, d.reward_gold_growth, tier)
                        }),
                        xp: xp
                            .unwrap_or_else(|| tier_reward(d.reward_xp, d.reward_xp_growth, tier)),
                    },
                )
                .collect()
        });
        Self {
            tiers: d.tiers,
            m_hp: d.m_hp,
            m_attack: d.m_attack,
            m_defense: d.m_defense,
            tier_growth: d.tier_growth,
            reward_gold: d.reward_gold,
            reward_xp: d.reward_xp,
            reward_gold_growth: d.reward_gold_growth,
            reward_xp_growth: d.reward_xp_growth,
            tier_table,
        }
    }
}

impl ActorBehaviorContract {
    fn export(cfg: &sandtable_core::config::ActorBehaviorConfig) -> Self {
        Self {
            sessions_int: cfg.sessions_int,
            sessions_frac: cfg.sessions_frac,
            p_dungeon: cfg.p_dungeon,
            p_upgrade: cfg.p_upgrade,
            p_training: cfg.p_training,
        }
    }
}

/// 契约序列化(稳定字段序;消费方写盘用)。
impl EngineContract {
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("契约为纯数据结构,序列化不会失败")
    }
}

/// 供测试与脚本使用的便捷入口。
pub fn export_json(cfg: &SimConfig) -> Result<String> {
    Ok(export(cfg)?.to_json())
}

/// YAML 场景 → 契约(经 `core::scenario::load_str` 同源加载)。
pub fn export_from_yaml(yaml: &str) -> Result<EngineContract> {
    let cfg = sandtable_core::scenario::load_str(yaml)?;
    export(&cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_reward_matches_core_formula() {
        // core monster_of:reward_gold · reward_gold_growth^tier 截断
        assert_eq!(tier_reward(1400, 1.26, 0), 1400);
        assert_eq!(
            tier_reward(1400, 1.26, 7),
            (1400.0 * 1.26f64.powi(7)) as i64
        );
        assert_eq!(
            tier_reward(1080, 1.31, 7),
            (1080.0 * 1.31f64.powi(7)) as i64
        );
    }
}
