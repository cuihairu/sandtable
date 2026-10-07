//! 仿真配置(Phase 1:硬编码默认值的结构化配置)。
//!
//! Phase 1 的"硬编码"指默认值写在代码里、CLI 只暴露少量实验开关;配置本身
//! 是结构化的,字段即[参数注册表](Phase 2)的雏形。config_hash 对规范化后的
//! 配置计算(serde 序列化字段序稳定 + SHA-256),文档 07 章。

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::Error;

/// 玩家分群。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cohort {
    Casual,
    Core,
    Whale,
}

pub const COHORT_COUNT: usize = 3;

impl Cohort {
    pub const ALL: [Cohort; COHORT_COUNT] = [Cohort::Casual, Cohort::Core, Cohort::Whale];
    pub fn index(self) -> usize {
        match self {
            Cohort::Casual => 0,
            Cohort::Core => 1,
            Cohort::Whale => 2,
        }
    }
    pub fn name(self) -> &'static str {
        match self {
            Cohort::Casual => "casual",
            Cohort::Core => "core",
            Cohort::Whale => "whale",
        }
    }
}

/// 战斗数值常量(本档不随参数变化)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CombatConfig {
    /// 玩家命中概率
    pub p_hit: f64,
    /// 怪物命中概率
    pub p_hit_monster: f64,
    /// 伤害浮动半宽:damage ± dmg_var
    pub dmg_var: i64,
    /// 最大轮数(超过判负;对应 rng::MAX_ROUND_SLOTS)
    pub max_rounds: u32,
}

/// 怪物 / 副本层数常量。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DungeonConfig {
    /// 层数(0 起)
    pub tiers: u32,
    /// 第 0 层怪物:hp / attack / defense
    pub m_hp: i64,
    pub m_attack: i64,
    pub m_defense: i64,
    /// 每层成长倍率(hp / attack / defense 同倍率)
    pub tier_growth: f64,
    /// 第 0 层产出:gold / xp(随层数按 reward_growth 增长)
    pub reward_gold: i64,
    pub reward_xp: i64,
    pub reward_growth: f64,
}

/// 行为概率(按分群)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorConfig {
    /// 每日会话数:整数部分 + [小数部分作为概率补 1]
    pub sessions_int: [u32; COHORT_COUNT],
    pub sessions_frac: [f64; COHORT_COUNT],
    /// 每次会话动作概率:副本 / 升级 / 其余为闲逛(打低一层)
    pub p_dungeon: [f64; COHORT_COUNT],
    pub p_upgrade: [f64; COHORT_COUNT],
}

/// 成长常量。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressionConfig {
    /// 升到 level+1 所需 xp:floor(xp_base * level^xp_pow)
    pub xp_base: i64,
    pub xp_pow: f64,
    /// 每次升级:attack / defense / hp 增量
    pub level_attack_gain: i64,
    pub level_defense_gain: i64,
    pub level_hp_gain: i64,
    /// 首次强化的金币成本;之后 cost *= cost_num / cost_den(整数链,确定)
    pub upgrade_cost_base: i64,
    pub upgrade_cost_num: i64,
    pub upgrade_cost_den: i64,
    /// 每次强化 attack 增量
    pub upgrade_attack_gain: i64,
}

/// 流失机制(文档 13 章:停滞 → 流失概率上升)。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChurnConfig {
    /// 正常日流失概率
    pub p_base: f64,
    /// 停滞日流失概率(> p_base)
    pub p_stall: f64,
    /// 连续多少个活跃日无战力增长判为停滞
    pub stall_days: u32,
}

/// 仿真配置。数值含义见各字段;默认值即 MVP 最小 RPG 的硬编码数值。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimConfig {
    pub players: u32,
    pub days: u32,
    /// 基础种子(第 r 个 replicate 的种子 = base_seed + r)
    pub base_seed: u64,
    /// 分群占比(依次 casual/core/whale,无需严格归一,内部按累计比例切)
    pub cohort_weights: [f64; COHORT_COUNT],
    /// 初始角色数值(warrior.attack 即 A/B 实验的被扫参数)
    pub init_attack: i64,
    pub init_defense: i64,
    pub init_hp: i64,
    /// Whale 成长倍率(金币 / 经验获取 ×N);无付费语义(文档 13 章)
    pub whale_gain_mult: i64,
    pub combat: CombatConfig,
    pub dungeon: DungeonConfig,
    pub behavior: BehaviorConfig,
    pub progression: ProgressionConfig,
    pub churn: ChurnConfig,
}

impl Default for SimConfig {
    fn default() -> Self {
        Self {
            players: 10_000,
            days: 30,
            base_seed: 12345,
            cohort_weights: [0.60, 0.30, 0.10],
            init_attack: 100,
            init_defense: 80,
            init_hp: 1000,
            whale_gain_mult: 2,
            combat: CombatConfig {
                p_hit: 0.85,
                p_hit_monster: 0.85,
                dmg_var: 10,
                max_rounds: crate::rng::MAX_ROUND_SLOTS,
            },
            dungeon: DungeonConfig {
                tiers: 8,
                m_hp: 300,
                // 基础怪物攻击接近玩家初始防御,深层构成真实威胁
                m_attack: 45,
                m_defense: 20,
                tier_growth: 1.5,
                reward_gold: 40,
                reward_xp: 45,
                reward_growth: 1.4,
            },
            behavior: BehaviorConfig {
                // casual / core / whale
                sessions_int: [1, 2, 5],
                sessions_frac: [0.5, 0.5, 0.0],
                p_dungeon: [0.7, 0.6, 0.65],
                p_upgrade: [0.2, 0.3, 0.3],
            },
            progression: ProgressionConfig {
                xp_base: 60,
                xp_pow: 1.3,
                level_attack_gain: 5,
                level_defense_gain: 3,
                level_hp_gain: 50,
                upgrade_cost_base: 50,
                upgrade_cost_num: 5,
                upgrade_cost_den: 4,
                upgrade_attack_gain: 2,
            },
            churn: ChurnConfig {
                p_base: 0.003,
                p_stall: 0.05,
                stall_days: 2,
            },
        }
    }
}

/// 校验(文档 10 章:配置错误返回具体原因,退出码 2)。
pub fn validate(cfg: &SimConfig) -> crate::Result<()> {
    if cfg.players == 0 {
        return Err(Error::Config("players 必须大于 0".into()));
    }
    if cfg.days == 0 {
        return Err(Error::Config("days 必须大于 0".into()));
    }
    if cfg.combat.max_rounds > crate::rng::MAX_ROUND_SLOTS {
        return Err(Error::Config(format!(
            "max_rounds 不能超过 {}(战斗键的槽位约束)",
            crate::rng::MAX_ROUND_SLOTS
        )));
    }
    if cfg.dungeon.tiers == 0 || cfg.dungeon.tiers > 64 {
        return Err(Error::Config("tiers 必须在 1..=64".into()));
    }
    if cfg.churn.p_stall < cfg.churn.p_base {
        return Err(Error::Config("p_stall 必须不小于 p_base".into()));
    }
    if cfg.progression.upgrade_cost_num == 0 || cfg.progression.upgrade_cost_den == 0 {
        return Err(Error::Config("强化成本比率不能为 0".into()));
    }
    if cfg.cohort_weights.iter().any(|&w| !(w.is_finite())) {
        return Err(Error::Config("cohort_weights 含非有限值".into()));
    }
    Ok(())
}

/// 规范化 config_hash:serde 序列化字段序稳定 → SHA-256 hex。
/// 同一配置(含键序无关的语义)得到同一 hash; Phase 2 起 YAML 键序 /
/// 注释差异在此处被消除(文档 07 章)。
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
