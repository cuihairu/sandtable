//! 战斗与副本配置域:角色三维、伤害口径(difference / ratio)、怪物层表。

use serde::{Deserialize, Serialize};

/// 初始角色数值(文档 03 章 Model 示例的 warrior 实体;attack 即 A/B 的被扫参数)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct WarriorConfig {
    pub attack: i64,
    pub defense: i64,
    pub hp: i64,
}

impl Default for WarriorConfig {
    /// 必须与 `SimConfig::default()` 同源。derive(Default) 给的是全零,而本节按
    /// 「部分覆盖小节、其余字段回退默认」的契约加载——全零会让 YAML 只写
    /// `model.warrior.attack` 时 defense / hp 静默归零(单点无敌)。
    fn default() -> Self {
        Self {
            attack: 100,
            defense: 80,
            hp: 1000,
        }
    }
}

/// 战斗伤害口径(文档 21 阻力 #1)。
///
/// `difference`(缺省):`dmg = attack − defense + var`,下限 1——攻击远小于
/// 防御时钳到 1;`ratio`:`dmg = ratio_k·attack/(attack + defense) + var`,
/// 弱打强时伤害按比例平滑趋小、不钳底(外部比值公式可直抄,无需等效换算)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DamageModel {
    Difference,
    Ratio,
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
    /// 伤害口径:缺省 difference(旧配置不静默改语义,显式给出才切换)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub damage_model: Option<DamageModel>,
    /// 比值口径比例参数:dmg = ratio_k·attack/(attack+defense)。
    /// 注册表数值参数(可 sweep);仅 ratio 口径下生效,显式给出而口径未切
    /// 时 validate 报错(防扫死参数)
    #[serde(skip_serializing_if = "ratio_k_is_default")]
    pub ratio_k: f64,
}

/// ratio_k 缺省值 1.0 不进 canonical JSON(旧配置 config_hash 不变)。
fn ratio_k_is_default(v: &f64) -> bool {
    *v == 1.0
}

impl Default for CombatConfig {
    fn default() -> Self {
        Self {
            p_hit: 0.85,
            p_hit_monster: 0.85,
            dmg_var: 10,
            max_rounds: crate::rng::MAX_ROUND_SLOTS,
            damage_model: None,
            ratio_k: 1.0,
        }
    }
}

/// 逐层怪物数值一行(`tier_table` 模式,文档 21 章:逐层显式数组)。
///
/// `gold / xp` 缺省时该层产出回退几何阶梯(第 0 层 × 各自增长率),
/// 便于只显式表达三维数值形状、产出仍走锚点几何。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct TierRow {
    pub hp: i64,
    pub attack: i64,
    pub defense: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gold: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xp: Option<i64>,
}

/// 怪物 / 副本层数常量。
///
/// 数值形状二选一:逐层显式表(`tier_table`,给出时覆盖几何推导)或
/// 第 0 层 × 增长率几何推导;产出(gold / xp)增长率各自独立
/// (文档 21 阻力 #2/#3:奖金与经验曲线增速不同,三维形状可旋转)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(from = "DungeonConfigRaw")]
pub struct DungeonConfig {
    /// 层数(0 起)
    pub tiers: u32,
    /// 第 0 层怪物:hp / attack / defense
    pub m_hp: i64,
    pub m_attack: i64,
    pub m_defense: i64,
    /// 每层成长倍率(hp / attack / defense 同倍率)
    pub tier_growth: f64,
    /// 第 0 层产出:gold / xp(随层数按各自增长率增长)
    pub reward_gold: i64,
    pub reward_xp: i64,
    /// 金币逐层增长率
    pub reward_gold_growth: f64,
    /// 经验逐层增长率
    pub reward_xp_growth: f64,
    /// 逐层显式表(长度必须等于 tiers;`validate` 把关)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier_table: Option<Vec<TierRow>>,
}

impl Default for DungeonConfig {
    fn default() -> Self {
        Self {
            tiers: 8,
            m_hp: 250,
            // 怪物攻防显著高于玩家初始值:低练度打不过、练级成长后逐层解锁——
            // 胜率随初始攻击呈「上升→平台→饱和」梯度,而非 0/100 双峰
            m_attack: 160,
            m_defense: 150,
            tier_growth: 1.3,
            reward_gold: 40,
            reward_xp: 45,
            reward_gold_growth: 1.4,
            reward_xp_growth: 1.4,
            tier_table: None,
        }
    }
}

/// 反序列化中间形态:承接遗留字段 `reward_growth`(拆分前 gold / xp 共用
/// 一档增长率)。旧配置载入语义不变(同时作用于两个新字段);新字段显式
/// 给出时优先于遗留字段。
#[derive(Debug, Deserialize)]
#[serde(default)]
struct DungeonConfigRaw {
    tiers: u32,
    m_hp: i64,
    m_attack: i64,
    m_defense: i64,
    tier_growth: f64,
    reward_gold: i64,
    reward_xp: i64,
    reward_gold_growth: Option<f64>,
    reward_xp_growth: Option<f64>,
    reward_growth: Option<f64>,
    tier_table: Option<Vec<TierRow>>,
}

impl Default for DungeonConfigRaw {
    fn default() -> Self {
        let d = DungeonConfig::default();
        Self {
            tiers: d.tiers,
            m_hp: d.m_hp,
            m_attack: d.m_attack,
            m_defense: d.m_defense,
            tier_growth: d.tier_growth,
            reward_gold: d.reward_gold,
            reward_xp: d.reward_xp,
            reward_gold_growth: None,
            reward_xp_growth: None,
            reward_growth: None,
            tier_table: None,
        }
    }
}

impl From<DungeonConfigRaw> for DungeonConfig {
    fn from(r: DungeonConfigRaw) -> Self {
        let legacy = r.reward_growth;
        Self {
            tiers: r.tiers,
            m_hp: r.m_hp,
            m_attack: r.m_attack,
            m_defense: r.m_defense,
            tier_growth: r.tier_growth,
            reward_gold: r.reward_gold,
            reward_xp: r.reward_xp,
            reward_gold_growth: r.reward_gold_growth.or(legacy).unwrap_or(1.4),
            reward_xp_growth: r.reward_xp_growth.or(legacy).unwrap_or(1.4),
            tier_table: r.tier_table,
        }
    }
}
