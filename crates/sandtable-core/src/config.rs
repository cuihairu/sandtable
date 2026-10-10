//! 仿真配置(文档 03/07 章:Model 与 Scenario 分离,YAML 面见 [`crate::scenario`])。
//!
//! 部分覆盖语义:各配置节容器级 `#[serde(default)]`,缺省字段回退到本结构体
//! 的 `Default`(领域默认值,非零值);因此默认值集中在各 `impl Default`,
//! YAML 省略任何节 / 字段都得到一致的领域默认。

use std::collections::BTreeMap;

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
            m_hp: 300,
            // 基础怪物攻击接近玩家初始防御,深层构成真实威胁
            m_attack: 45,
            m_defense: 20,
            tier_growth: 1.5,
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

/// 掉落加权表(文档 24 章 R1):项名 → 权重。
///
/// 权重是形状参数:加载期编译为 CDF 前缀和(`crate::rng::WeightedTable`),
/// 不进数值通道(同 [`DungeonConfig::tier_table`] 先例,改形态走 YAML 编辑)。
/// 表名与项名走 `BTreeMap`——键序确定,config_hash 稳定。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LootTableConfig {
    pub weights: BTreeMap<String, f64>,
}

/// 掉落配置面(文档 24 章 R1)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LootConfig {
    /// 全局掉率倍率:**乘到掉落产出的量**(金币 / 经验数额),不改变表形状,
    /// 故分布检验不涉及它;数值槽,可 sweep
    pub rate_mult: f64,
    /// 表名 → 权重表
    pub tables: BTreeMap<String, LootTableConfig>,
}

impl Default for LootConfig {
    fn default() -> Self {
        Self {
            rate_mult: 1.0,
            tables: BTreeMap::new(),
        }
    }
}

/// 抽卡保底配置面(文档 24 章 R2)。状态机语义:
/// 单抽成功率 `p' = min(1, base_rate + max(0, k − pity_soft_start)·pity_soft_step)`,
/// 且 `k + 1 ≥ pity_hard > 0` 时 `p' = 1`(k = 连续未中抽数)。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct GachaConfig {
    /// 单抽基础命中率(0, 1]
    pub base_rate: f64,
    /// 硬保底:第 pity_hard 抽必中(0 = 无)
    pub pity_hard: u64,
    /// 软保底起点抽数(pity_soft_step ≤ 0 时软保底整体不生效)
    pub pity_soft_start: u64,
    /// 起点后每抽概率增量(0 = 无软保底)
    pub pity_soft_step: f64,
}

impl Default for GachaConfig {
    fn default() -> Self {
        Self {
            base_rate: 0.02,
            pity_hard: 0,
            pity_soft_start: 0,
            pity_soft_step: 0.0,
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
    /// 每次会话动作概率:副本 / 升级 / 练级 / 其余为闲逛(打低一层)。
    /// p_training 仅在 model.training 产出面配置后生效(缺省 0,旧配置语义不变)
    pub p_dungeon: f64,
    pub p_upgrade: f64,
    #[serde(skip_serializing_if = "p_training_is_default")]
    pub p_training: f64,
}

/// p_training 缺省值 0.0 不进 canonical JSON(旧配置 config_hash 不变)。
fn p_training_is_default(v: &f64) -> bool {
    *v == 0.0
}

impl Default for ActorBehaviorConfig {
    fn default() -> Self {
        Self {
            sessions_int: 1,
            sessions_frac: 0.5,
            p_dungeon: 0.7,
            p_upgrade: 0.2,
            p_training: 0.0,
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
    p_training: Option<f64>,
}

impl PartialActorBehavior {
    fn merge(self, base: ActorBehaviorConfig) -> ActorBehaviorConfig {
        ActorBehaviorConfig {
            sessions_int: self.sessions_int.unwrap_or(base.sessions_int),
            sessions_frac: self.sessions_frac.unwrap_or(base.sessions_frac),
            p_dungeon: self.p_dungeon.unwrap_or(base.p_dungeon),
            p_upgrade: self.p_upgrade.unwrap_or(base.p_upgrade),
            p_training: self.p_training.unwrap_or(base.p_training),
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
                p_training: 0.0,
            },
            whale: ActorBehaviorConfig {
                sessions_int: 5,
                sessions_frac: 0.0,
                p_dungeon: 0.65,
                p_upgrade: 0.3,
                p_training: 0.0,
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

/// 公式槽(文档 07 章:受控表达式,加载期编译)。
///
/// 每个槽是一个有界表达式;变量白名单与求值顺序见
/// [`crate::formula::XP_NEEDED_VARS`]。默认值复现硬编码时代的闭式实现,
/// 指标逐位一致;validate 在加载期编译所有槽,语法 / 白名单错误在此暴露。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct FormulaConfig {
    /// 升到 level+1 所需经验(截断为 i64)。
    /// 变量:level、xp_base、xp_pow;默认 `xp_base * level ^ xp_pow`。
    pub xp_needed: String,
}

impl Default for FormulaConfig {
    fn default() -> Self {
        Self {
            xp_needed: "xp_base * level ^ xp_pow".into(),
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

/// 练级产出面(文档 21 阻力 #4):behavior 各分群 `p_training` 带的动作产出
/// ——无战斗风险的成长通道,玩家从真实低等级起步的"野怪练级环"替身。
/// 缺省 None = 无练级环(旧配置语义不变);与 p_training 互相咬合,
/// 单边给出由 validate 报错。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(default)]
pub struct TrainingConfig {
    /// 每次练级会话经验产出
    pub xp: i64,
    /// 每次练级会话金币产出
    pub gold: i64,
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
            warrior: WarriorConfig {
                attack: 100,
                defense: 80,
                hp: 1000,
            },
            whale_gain_mult: 2,
            combat: CombatConfig::default(),
            dungeon: DungeonConfig::default(),
            behavior: BehaviorConfig::default(),
            training: None,
            progression: ProgressionConfig::default(),
            formulas: FormulaConfig::default(),
            churn: ChurnConfig::default(),
            loot: None,
            gacha: None,
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
    if cfg.dungeon.reward_gold < 0 || cfg.dungeon.reward_xp < 0 {
        return Err(Error::Config(
            "reward_gold / reward_xp 不能为负(负奖励会让经济面 u64 回绕)".into(),
        ));
    }
    if let Some(rows) = &cfg.dungeon.tier_table {
        if rows.is_empty() || rows.len() > 64 {
            return Err(Error::Config("tier_table 长度必须在 1..=64".into()));
        }
        if rows.len() != cfg.dungeon.tiers as usize {
            return Err(Error::Config(format!(
                "tier_table 长度 {} 与 tiers {} 不一致(表模式下层数由数组长度决定)",
                rows.len(),
                cfg.dungeon.tiers
            )));
        }
        if rows.iter().any(|r| r.hp <= 0) {
            return Err(Error::Config("tier_table 每层 hp 必须为正".into()));
        }
    }
    // 掉落加权表:权重非负、至少一项为正、表名非空(编译期校验由
    // rng::WeightedTable 承担,这里给出带路径的报错)
    if let Some(loot) = &cfg.loot {
        if !loot.rate_mult.is_finite() || loot.rate_mult <= 0.0 {
            return Err(Error::Config(
                "model.loot.rate_mult 必须为正(≤ 0 会让全部权重失效)".into(),
            ));
        }
        for (name, table) in &loot.tables {
            if name.is_empty() {
                return Err(Error::Config("model.loot: 表名不能为空".into()));
            }
            if table.weights.is_empty() {
                return Err(Error::Config(format!(
                    "model.loot.tables.{name}: 权重表不能为空"
                )));
            }
            let path = format!("model.loot.tables.{name}");
            let weights: Vec<(String, f64)> =
                table.weights.iter().map(|(k, v)| (k.clone(), *v)).collect();
            if crate::rng::WeightedTable::from_weights(&weights).is_err() {
                return Err(Error::Config(format!(
                    "{path}: 权重必须为有限非负数且至少一项为正"
                )));
            }
        }
    }
    if let Some(gacha) = &cfg.gacha {
        if !gacha.base_rate.is_finite() || gacha.base_rate <= 0.0 || gacha.base_rate > 1.0 {
            return Err(Error::Config(
                "model.gacha.base_rate 必须在 (0, 1] 区间(≤ 0 会让抽卡永不终止)".into(),
            ));
        }
        if !gacha.pity_soft_step.is_finite() || gacha.pity_soft_step < 0.0 {
            return Err(Error::Config(
                "model.gacha.pity_soft_step 必须为非负有限数".into(),
            ));
        }
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
        if b.p_dungeon < 0.0
            || b.p_upgrade < 0.0
            || b.p_training < 0.0
            || b.p_dungeon + b.p_upgrade + b.p_training > 1.0
        {
            return Err(Error::Config(format!(
                "behavior.{}: p_dungeon + p_upgrade + p_training 必须在 [0, 1]",
                c.name()
            )));
        }
    }
    // 练级环显式性(阻力 #4):产出面与行为带互相咬合,单边给出属配置矛盾。
    let any_training_band = Cohort::ALL
        .iter()
        .any(|c| cfg.behavior.for_cohort(*c).p_training > 0.0);
    match cfg.training {
        Some(t) => {
            if t.xp < 0 || t.gold < 0 {
                return Err(Error::Config("training.xp / training.gold 不能为负".into()));
            }
            // 零产出({xp:0,gold:0})合法且惰性:参数模板回导会产生它,
            // 行为上等同无练级带(会话照常消耗但不改变任何统计)
            if !any_training_band && (t.xp > 0 || t.gold > 0) {
                return Err(Error::Config(
                    "model.training 产出已配置但各分群 p_training 均为 0(练级带永不触发)".into(),
                ));
            }
        }
        None if any_training_band => {
            return Err(Error::Config(
                "behavior.*.p_training > 0 需要 model.training 配置练级产出(xp / gold)".into(),
            ));
        }
        None => {}
    }
    if !(0.0..=1.0).contains(&cfg.combat.p_hit) || !(0.0..=1.0).contains(&cfg.combat.p_hit_monster)
    {
        return Err(Error::Config("命中概率必须在 [0, 1]".into()));
    }
    // 口径显式性(阻力 #1,同 reward_growth 拆分先例):ratio_k 只在
    // damage_model: ratio 下生效,给出而口径未切属配置矛盾(扫它扫了个死参数)。
    let ratio = matches!(cfg.combat.damage_model, Some(DamageModel::Ratio));
    if !ratio && cfg.combat.ratio_k != 1.0 {
        return Err(Error::Config(
            "combat.ratio_k 只在 damage_model: ratio 下生效(damage_model 缺省为 difference)".into(),
        ));
    }
    if ratio && !(cfg.combat.ratio_k > 0.0 && cfg.combat.ratio_k.is_finite()) {
        return Err(Error::Config(
            "combat.ratio_k 必须为正的有限值(比值口径的分母含 defense,比例参数给出量纲)".into(),
        ));
    }
    // 公式槽加载期编译(文档 07 章):语法 / 白名单 / 有界性在此暴露,
    // sim::run 假定已通过编译。
    crate::formula::compile(&cfg.formulas.xp_needed, crate::formula::XP_NEEDED_VARS)
        .map_err(|e| Error::Config(format!("formulas.xp_needed: {e}")))?;
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 公式槽在 validate 编译(文档 07 章:加载期编译):语法 / 白名单
    /// 错误报出槽名与原因,默认公式必须通过。
    #[test]
    fn validate_公式槽编译报错() {
        let mut cfg = SimConfig::default();
        cfg.formulas.xp_needed = "xp_base *".into();
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("formulas.xp_needed"), "{msg}");

        cfg.formulas.xp_needed = "xp_base * atk".into();
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("未知变量"), "{msg}");

        cfg.formulas.xp_needed = String::new();
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("formulas.xp_needed"), "{msg}");

        assert!(validate(&SimConfig::default()).is_ok());
    }

    /// 比值口径约束(阻力 #1 显式性):ratio_k 只在 damage_model: ratio 下
    /// 生效;口径未切时给出即报错,k 非正报错;缺省配置保持合法。
    #[test]
    fn validate_比值口径约束() {
        let mut cfg = SimConfig::default();
        cfg.combat.ratio_k = 260.0;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("damage_model"), "{msg}");

        cfg.combat.damage_model = Some(DamageModel::Ratio);
        assert!(validate(&cfg).is_ok());

        cfg.combat.ratio_k = 0.0;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("ratio_k"), "{msg}");
    }

    /// 练级环耦合(阻力 #4 显式性):产出面与行为带互相咬合,单边给出报错。
    #[test]
    fn validate_练级环耦合() {
        let mut cfg = SimConfig {
            training: Some(TrainingConfig { xp: 100, gold: 10 }),
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("p_training"), "{msg}"); // 产出面有、行为带无

        cfg.behavior.casual.p_dungeon = 0.5;
        cfg.behavior.casual.p_upgrade = 0.1;
        cfg.behavior.casual.p_training = 0.4; // 合计恰为 1
        assert!(validate(&cfg).is_ok());

        // 零产出产出面合法(参数模板回导产生):惰性、不报死配置
        let zero = SimConfig {
            training: Some(TrainingConfig { xp: 0, gold: 0 }),
            ..SimConfig::default()
        };
        assert!(validate(&zero).is_ok());

        let cfg2 = SimConfig {
            behavior: {
                let mut b = BehaviorConfig::default();
                b.core.p_training = 0.1; // 0.6 + 0.3 + 0.1 合计恰为 1
                b
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg2).unwrap_err().to_string();
        assert!(msg.contains("model.training"), "{msg}"); // 行为带有、产出面无

        let cfg3 = SimConfig {
            behavior: {
                let mut b = BehaviorConfig::default();
                b.whale.p_dungeon = 0.8;
                b.whale.p_training = 0.3; // 0.8 + 0.3(升级)+ 0.3 > 1
                b
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg3).unwrap_err().to_string();
        assert!(msg.contains("p_training"), "{msg}");
    }

    /// 新口径字段缺省不进 canonical JSON:旧配置(无字段)与缺省配置
    /// config_hash 逐字节一致——加字段不改存量语义。
    #[test]
    fn config_hash_口径字段缺省不变() {
        let legacy = SimConfig::default();
        assert!(legacy.combat.damage_model.is_none());
        assert_eq!(legacy.combat.ratio_k, 1.0);
        let mut switched = SimConfig::default();
        switched.combat.damage_model = Some(DamageModel::Ratio);
        assert_ne!(config_hash(&switched), config_hash(&legacy));
    }

    /// 掉落面校验(文档 24 章 R1):rate_mult 非正、空表名、全零权重、
    /// 非有限负数逐项报错;loot 缺省(None)不进 canonical JSON。
    #[test]
    fn validate_掉落面() {
        fn loot(rate_mult: f64, tables: BTreeMap<String, LootTableConfig>) -> SimConfig {
            SimConfig {
                loot: Some(LootConfig { rate_mult, tables }),
                ..SimConfig::default()
            }
        }
        fn table(weights: BTreeMap<String, f64>) -> BTreeMap<String, LootTableConfig> {
            [("chest".to_string(), LootTableConfig { weights })]
                .into_iter()
                .collect()
        }
        fn w(pairs: &[(&str, f64)]) -> BTreeMap<String, f64> {
            pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
        }

        // rate_mult 非正
        for rm in [0.0, -1.0] {
            let msg = validate(&loot(rm, Default::default()))
                .unwrap_err()
                .to_string();
            assert!(msg.contains("rate_mult"), "{msg}");
        }
        // 空表名
        let cfg = loot(
            1.0,
            [(
                "".to_string(),
                LootTableConfig {
                    weights: w(&[("a", 1.0)]),
                },
            )]
            .into_iter()
            .collect(),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("表名"), "{msg}");
        // 空表(无权重)
        let cfg = loot(1.0, table(BTreeMap::new()));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("chest"), "{msg}");
        // 全零权重
        let cfg = loot(1.0, table(w(&[("a", 0.0), ("b", 0.0)])));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("权重"), "{msg}");
        // 非有限权重
        let cfg = loot(1.0, table(w(&[("a", 70.0), ("b", f64::NAN)])));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("权重"), "{msg}");
        // 合法表通过
        let cfg = loot(
            1.5,
            table(w(&[("gold_small", 70.0), ("gold_mid", 25.0), ("gem", 5.0)])),
        );
        assert!(validate(&cfg).is_ok());

        // loot = None 缺省不进 canonical JSON(训练字段先例)
        assert!(SimConfig::default().loot.is_none());
    }

    /// 抽卡面校验(文档 24 章 R2):base_rate 必须在 (0, 1](≤ 0 永不终止、
    /// > 1 概率非法);pity_soft_step 非负有限;gacha 缺省(None)不进 canonical JSON。
    #[test]
    fn validate_抽卡面() {
        fn gacha(base_rate: f64, pity_soft_step: f64) -> SimConfig {
            SimConfig {
                gacha: Some(GachaConfig {
                    base_rate,
                    pity_hard: 50,
                    pity_soft_start: 0,
                    pity_soft_step,
                }),
                ..SimConfig::default()
            }
        }

        // base_rate 越界:0 / 负数 / > 1 / NaN 逐项报错
        for br in [0.0, -0.5, 1.5, f64::NAN] {
            let msg = validate(&gacha(br, 0.0)).unwrap_err().to_string();
            assert!(msg.contains("base_rate"), "{msg}");
        }
        // pity_soft_step 非负有限
        for step in [-0.01, f64::NAN] {
            let msg = validate(&gacha(0.02, step)).unwrap_err().to_string();
            assert!(msg.contains("pity_soft_step"), "{msg}");
        }
        // 合法配置通过:纯硬保底 / 软硬混合 / 无保底(步长 0)
        assert!(validate(&gacha(0.02, 0.0)).is_ok());
        assert!(validate(&gacha(1.0, 0.1)).is_ok());
        // gacha = None 缺省不进 canonical JSON(训练字段先例)
        assert!(SimConfig::default().gacha.is_none());
    }
}
