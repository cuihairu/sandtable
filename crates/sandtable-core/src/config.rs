//! 仿真配置(文档 03/07 章:Model 与 Scenario 分离,YAML 面见 [`crate::scenario`])。
//!
//! 部分覆盖语义:各配置节容器级 `#[serde(default)]`,缺省字段回退到本结构体
//! 的 `Default`(领域默认值,非零值);因此默认值集中在各 `impl Default`,
//! YAML 省略任何节 / 字段都得到一致的领域默认。

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
    pub fn from_name(s: &str) -> Option<Self> {
        Some(match s {
            "casual" => Cohort::Casual,
            "core" => Cohort::Core,
            "whale" => Cohort::Whale,
            _ => return None,
        })
    }
}

/// 初始角色数值(文档 03 章 Model 示例的 warrior 实体;attack 即 A/B 的被扫参数)。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct WarriorConfig {
    pub attack: i64,
    pub defense: i64,
    pub hp: i64,
}

/// 战斗数值常量(本档不随参数变化)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
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

impl Default for CombatConfig {
    fn default() -> Self {
        Self {
            p_hit: 0.85,
            p_hit_monster: 0.85,
            dmg_var: 10,
            max_rounds: crate::rng::MAX_ROUND_SLOTS,
        }
    }
}

/// 怪物 / 副本层数常量。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
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

impl Default for DungeonConfig {
    fn default() -> Self {
        Self {
            tiers: 8,
            m_hp: 300,
            // 基础怪物攻击接近玩家初始防御,深层构成真实威胁
            m_attack: 45,
            m_defense: 20,
            tier_growth: 1.5,
            reward_gold: 40,
            reward_xp: 45,
            reward_growth: 1.4,
        }
    }
}

/// 单个分群的行为概率(文档 03 章 Actor 行为模型,MVP 形态)。
///
/// `Default` 为 casual 档默认;core / whale 的默认在 [`BehaviorConfig::default`]
/// 里显式给出——部分覆盖某分群时,缺省字段按该分群默认回退。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ActorBehaviorConfig {
    /// 每日会话数:整数部分
    pub sessions_int: u32,
    /// 小数部分作为概率补 1
    pub sessions_frac: f64,
    /// 每次会话动作概率:副本 / 升级 / 其余为闲逛(打低一层)
    pub p_dungeon: f64,
    pub p_upgrade: f64,
}

impl Default for ActorBehaviorConfig {
    fn default() -> Self {
        Self {
            sessions_int: 1,
            sessions_frac: 0.5,
            p_dungeon: 0.7,
            p_upgrade: 0.2,
        }
    }
}

/// 行为概率(按分群命名,文档 03 章 behavior.casual/core/whale)。
///
/// 手写反序列化:每个分群的部分字段按**该分群**的默认值合并(而非类型零值),
/// 即 `behavior: {whale: {sessions_int: 8}}` 只改 whale 的会话数,whale 其余
/// 字段回退 whale 默认,casual / core 完全不动。
#[derive(Debug, Clone, Serialize)]
pub struct BehaviorConfig {
    pub casual: ActorBehaviorConfig,
    pub core: ActorBehaviorConfig,
    pub whale: ActorBehaviorConfig,
}

/// 部分字段(缺省 = 覆盖时回退基线)。
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct PartialActorBehavior {
    sessions_int: Option<u32>,
    sessions_frac: Option<f64>,
    p_dungeon: Option<f64>,
    p_upgrade: Option<f64>,
}

impl PartialActorBehavior {
    fn merge(self, base: ActorBehaviorConfig) -> ActorBehaviorConfig {
        ActorBehaviorConfig {
            sessions_int: self.sessions_int.unwrap_or(base.sessions_int),
            sessions_frac: self.sessions_frac.unwrap_or(base.sessions_frac),
            p_dungeon: self.p_dungeon.unwrap_or(base.p_dungeon),
            p_upgrade: self.p_upgrade.unwrap_or(base.p_upgrade),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct PartialBehavior {
    casual: Option<PartialActorBehavior>,
    core: Option<PartialActorBehavior>,
    whale: Option<PartialActorBehavior>,
}

impl<'de> Deserialize<'de> for BehaviorConfig {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let p = PartialBehavior::deserialize(d)?;
        let base = BehaviorConfig::default();
        Ok(BehaviorConfig {
            casual: match p.casual {
                Some(x) => x.merge(base.casual),
                None => base.casual,
            },
            core: match p.core {
                Some(x) => x.merge(base.core),
                None => base.core,
            },
            whale: match p.whale {
                Some(x) => x.merge(base.whale),
                None => base.whale,
            },
        })
    }
}

impl Default for BehaviorConfig {
    fn default() -> Self {
        Self {
            casual: ActorBehaviorConfig::default(),
            core: ActorBehaviorConfig {
                sessions_int: 2,
                sessions_frac: 0.5,
                p_dungeon: 0.6,
                p_upgrade: 0.3,
            },
            whale: ActorBehaviorConfig {
                sessions_int: 5,
                sessions_frac: 0.0,
                p_dungeon: 0.65,
                p_upgrade: 0.3,
            },
        }
    }
}

impl BehaviorConfig {
    pub fn for_cohort(&self, c: Cohort) -> &ActorBehaviorConfig {
        match c {
            Cohort::Casual => &self.casual,
            Cohort::Core => &self.core,
            Cohort::Whale => &self.whale,
        }
    }

    pub fn for_cohort_mut(&mut self, c: Cohort) -> &mut ActorBehaviorConfig {
        match c {
            Cohort::Casual => &mut self.casual,
            Cohort::Core => &mut self.core,
            Cohort::Whale => &mut self.whale,
        }
    }
}

/// 成长常量。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
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

impl Default for ProgressionConfig {
    fn default() -> Self {
        Self {
            xp_base: 60,
            xp_pow: 1.3,
            level_attack_gain: 5,
            level_defense_gain: 3,
            level_hp_gain: 50,
            upgrade_cost_base: 50,
            upgrade_cost_num: 5,
            upgrade_cost_den: 4,
            upgrade_attack_gain: 2,
        }
    }
}

/// 流失机制(文档 13 章:停滞 → 流失概率上升)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ChurnConfig {
    /// 正常日流失概率
    pub p_base: f64,
    /// 停滞日流失概率(> p_base)
    pub p_stall: f64,
    /// 连续多少个活跃日无战力增长判为停滞
    pub stall_days: u32,
}

impl Default for ChurnConfig {
    fn default() -> Self {
        Self {
            p_base: 0.003,
            p_stall: 0.05,
            stall_days: 2,
        }
    }
}

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
            warrior: WarriorConfig {
                attack: 100,
                defense: 80,
                hp: 1000,
            },
            whale_gain_mult: 2,
            combat: CombatConfig::default(),
            dungeon: DungeonConfig::default(),
            behavior: BehaviorConfig::default(),
            progression: ProgressionConfig::default(),
            churn: ChurnConfig::default(),
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
    if cfg.cohort_weights.iter().sum::<f64>() <= 0.0 {
        return Err(Error::Config("cohort_weights 之和必须大于 0".into()));
    }
    for c in Cohort::ALL {
        let b = cfg.behavior.for_cohort(c);
        if b.p_dungeon < 0.0 || b.p_upgrade < 0.0 || b.p_dungeon + b.p_upgrade > 1.0 {
            return Err(Error::Config(format!(
                "behavior.{}: p_dungeon + p_upgrade 必须在 [0, 1]",
                c.name()
            )));
        }
    }
    if !(0.0..=1.0).contains(&cfg.combat.p_hit) || !(0.0..=1.0).contains(&cfg.combat.p_hit_monster)
    {
        return Err(Error::Config("命中概率必须在 [0, 1]".into()));
    }
    Ok(())
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
