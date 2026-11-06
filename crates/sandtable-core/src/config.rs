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

/// 仿真规模预算(I-002 / ST-AUD-02):单次仿真的 `players × days` 上界。
/// 五壳层共用同一常量——Web 已用 40 万作为 players×days 预算,本仓把该
/// 口径上提到 core,让 CLI / 桌面 / MCP / Python / WASM 在任何壳层都先
/// 过同一道硬门,避免单壳层漏配(恶意 YAML `population: 4294967295` 或
/// `duration: "4294967295d"` 会预分配 4e9 Actor + 32GB Vec,进程 abort)。
/// 桌面 / CLI 定位大型实验,但「规模 × 输入上限」这道红线仍须显式,
/// 超限返回结构化 ConfigError 而非 OOM。
pub const MAX_SIM_SCALE: u64 = 400_000;

/// 单维上界(I-002):players / days 各自的上限。40 万预算下取 `MAX_SIM_SCALE`
/// 作为单维上界(另一维为 1 时即达预算),防 32 位溢出预分配与数十亿次空转。
pub const MAX_SIM_DIM: u32 = MAX_SIM_SCALE as u32;

/// 抽卡最小基础命中率(I-003 / ST-AUD-03):base_rate 无下限时,`1e-300`
/// 这类合法值使 `pull_until_hit` 期望 1e300 抽,实质死循环。设下限保证
/// 单抽会话在有限期望步内终止(软/硬保底可再提前)。取 1e-4(期望 1 万抽),
/// 与真实卡池量级(2% 起)相比已极度保守,仍杜绝天文数字循环。
pub const MIN_GACHA_BASE_RATE: f64 = 1e-4;

/// 抽卡会话最大抽数(I-003 / ST-AUD-03):防御纵深,即使 `pity_hard`/软保底
/// 都因配置异常失效,单会话也不会无限循环。超出返回结构化错误。
pub const MAX_GACHA_PULLS: u64 = 1_000_000;

/// 无定轨 featured 层的组合概率下界(2026-11-06 审核发现):目标判定退化
/// 为每 5★ 独立几何(概率 `featured_rate`),5★ 本身又是每抽独立几何
/// (概率 `base_rate`)。无保底时抽到所定目标的总概率 = `base_rate ×
/// featured_rate`,期望抽数 = `1/(base_rate × featured_rate)`。两个各取
/// `MIN_GACHA_BASE_RATE=1e-4` 时乘积 `1e-8`,期望 `1e8` 抽,远超
/// `MAX_GACHA_PULLS=1e6`。取乘积下限 `1e-6`(期望 1e6 抽,恰在上限内),
/// 与真实卡池(≥0.375×≥0.02=7.5e-3)相比仍极度保守。
pub const MIN_GACHA_TARGET_RATE: f64 = 1e-6;

/// 扫描/寻优 replicates 核心上界(I-011 / ST-AUD-11):壳层可再收紧
/// (Web 64、MCP 4096、桌面 64),core 统一兜底避免 u32::MAX 级分配。
/// 取 10_000——真实实验量级(2–400)的 25 倍余量,仍杜绝 4e9 级分配。
pub const MAX_SWEEP_REPLICATES: u32 = 10_000;

/// 经济面 i64 统一上界(ST-AUD-04 / I-004):远超当前 400k×64 仿真规模
/// 下的单次产出,但足以避免乘以 whale 倍率后溢出或 `as u64` 回绕。
pub const MAX_ECONOMY_VALUE: i64 = 1_000_000_000_000_000;

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
            p_training: 0.1,
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
                p_training: 0.1,
            },
            whale: ActorBehaviorConfig {
                sessions_int: 5,
                sessions_frac: 0.0,
                p_dungeon: 0.65,
                p_upgrade: 0.3,
                p_training: 0.05,
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
            level_attack_gain: 8,
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

/// 校验(文档 10 章:配置错误返回具体原因,退出码 2)。
pub fn validate(cfg: &SimConfig) -> crate::Result<()> {
    if cfg.players == 0 {
        return Err(Error::Config("players 必须大于 0".into()));
    }
    if cfg.days == 0 {
        return Err(Error::Config("days 必须大于 0".into()));
    }
    if cfg.players > MAX_SIM_DIM {
        return Err(Error::Config(format!(
            "players 不能超过 {MAX_SIM_DIM}(仿真规模预算 {MAX_SIM_SCALE} 的上界)"
        )));
    }
    if cfg.days > MAX_SIM_DIM {
        return Err(Error::Config(format!(
            "days 不能超过 {MAX_SIM_DIM}(仿真规模预算 {MAX_SIM_SCALE} 的上界)"
        )));
    }
    let scale = cfg.players as u64 * cfg.days as u64;
    if scale > MAX_SIM_SCALE {
        return Err(Error::Config(format!(
            "players × days = {scale} 超出仿真规模预算 {MAX_SIM_SCALE}(调小 population / duration)"
        )));
    }
    if cfg.combat.max_rounds > crate::rng::MAX_ROUND_SLOTS {
        return Err(Error::Config(format!(
            "max_rounds 不能超过 {}(战斗键的槽位约束)",
            crate::rng::MAX_ROUND_SLOTS
        )));
    }
    if cfg.combat.max_rounds == 0 {
        return Err(Error::Config(
            "combat.max_rounds 不能为 0(0 会让全部战斗判负)".into(),
        ));
    }
    if !cfg.combat.ratio_k.is_finite() || cfg.combat.ratio_k <= 0.0 {
        return Err(Error::Config(
            "combat.ratio_k 必须为有限正数(仅 ratio 口径生效)".into(),
        ));
    }
    if cfg.churn.stall_days == 0 {
        return Err(Error::Config(
            "churn.stall_days 不能为 0(0 会让 idle_streak >= 0 恒真,流失率失真)".into(),
        ));
    }
    if cfg.warrior.attack <= 0 || cfg.warrior.defense <= 0 || cfg.warrior.hp <= 0 {
        return Err(Error::Config(
            "warrior.attack/defense/hp 必须为正(战力与存活需正数)".into(),
        ));
    }
    if cfg.warrior.attack > MAX_ECONOMY_VALUE
        || cfg.warrior.defense > MAX_ECONOMY_VALUE
        || cfg.warrior.hp > MAX_ECONOMY_VALUE
    {
        return Err(Error::Config(format!(
            "warrior.attack/defense/hp 不能超过 {MAX_ECONOMY_VALUE}(战力运算上界)"
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
    // I-014:怪物数值与成长倍率必须有限为正,否则 powi/乘积会塌成 NaN/Inf
    // 再经 as i64 洗成有限值(战力/掉落/分位数全错)。逐字段显式拦截。
    let d = &cfg.dungeon;
    for (name, v) in [
        ("m_hp", d.m_hp),
        ("m_attack", d.m_attack),
        ("m_defense", d.m_defense),
    ] {
        if v <= 0 || v > MAX_ECONOMY_VALUE {
            return Err(Error::Config(format!(
                "dungeon.{name} 必须在 (0, {MAX_ECONOMY_VALUE}] 区间(正数且有上界)"
            )));
        }
    }
    for (name, v) in [
        ("tier_growth", d.tier_growth),
        ("reward_gold_growth", d.reward_gold_growth),
        ("reward_xp_growth", d.reward_xp_growth),
    ] {
        if !v.is_finite() || v <= 0.0 {
            return Err(Error::Config(format!(
                "dungeon.{name} 必须为有限正数(负/零/NaN 会让逐层数值塌陷)"
            )));
        }
    }
    // 2026-11-06 审核发现:有限正增长率 alone 不够——`1e308.powi(63)` 会
    // 溢出为 Inf,再经 `as i64` 饱和为 `i64::MAX`。按最高使用层校验派生值,
    // 确保几何曲线本身保持在经济数值上界内,而不是只看增长率字面值。
    let highest_tier = cfg.dungeon.tiers - 1;
    if cfg.dungeon.tier_table.is_none() {
        for (name, base) in [
            ("m_hp", d.m_hp),
            ("m_attack", d.m_attack),
            ("m_defense", d.m_defense),
        ] {
            let highest = base as f64 * d.tier_growth.powi(highest_tier as i32);
            if !highest.is_finite() || highest > MAX_ECONOMY_VALUE as f64 {
                return Err(Error::Config(format!(
                    "dungeon.{name} × tier_growth^{highest_tier} 必须不超过 {MAX_ECONOMY_VALUE}(最高层派生值溢出会饱和为 i64::MAX)"
                )));
            }
        }
    }
    // 2026-11-07 复审整改:显式层表全行给定 gold/xp 时,几何回退值不被使用
    // (combat::monster_of 按行内显式值取数),此时不按派生值拒绝——回退兜底
    // 仅服务表外越界层,不在本守卫范围。部分行缺省时回退仍参与行为,照常校验。
    let explicit_rewards = cfg.dungeon.tier_table.as_ref().is_some_and(|rows| {
        !rows.is_empty() && rows.iter().all(|r| r.gold.is_some() && r.xp.is_some())
    });
    if !explicit_rewards {
        for (name, base, growth) in [
            ("reward_gold", d.reward_gold, d.reward_gold_growth),
            ("reward_xp", d.reward_xp, d.reward_xp_growth),
        ] {
            if base == 0 {
                continue;
            }
            let highest = base as f64 * growth.powi(highest_tier as i32);
            if !highest.is_finite() || highest > MAX_ECONOMY_VALUE as f64 {
                return Err(Error::Config(format!(
                    "dungeon.{name} × {}_growth^{highest_tier} 必须不超过 {MAX_ECONOMY_VALUE}(最高层派生值溢出会饱和为 i64::MAX)",
                    name
                )));
            }
        }
    }
    if cfg.whale_gain_mult <= 0 || cfg.whale_gain_mult > MAX_ECONOMY_VALUE {
        return Err(Error::Config(format!(
            "model.whale_gain_mult 必须在 (0, {MAX_ECONOMY_VALUE}] 区间(负数或溢出量级会污染经济指标)"
        )));
    }
    if let Some(training) = &cfg.training {
        if training.xp < 0 || training.gold < 0 {
            return Err(Error::Config(
                "training.xp / training.gold 不能为负(负产出会让经济面 u64 回绕)".into(),
            ));
        }
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
        // 胜利绑定:必须指名一张既有表(显式性——不猜默认表,漏配即报错)
        if loot.on_victory.is_empty() {
            return Err(Error::Config(
                "model.loot.on_victory: 必须指名掉落表名(tables 中的键)".into(),
            ));
        }
        if !loot.tables.contains_key(&loot.on_victory) {
            return Err(Error::Config(format!(
                "model.loot.on_victory: 表 {} 不存在(tables 中无此键)",
                loot.on_victory
            )));
        }
        // 结算数额:非负、不得全零(全零条目抽到了也不产出,是死配置)
        for (name, r) in &loot.rewards {
            if r.gold < 0 || r.xp < 0 {
                return Err(Error::Config(format!(
                    "model.loot.rewards.{name}: 数额不能为负"
                )));
            }
            if r.gold == 0 && r.xp == 0 {
                return Err(Error::Config(format!(
                    "model.loot.rewards.{name}: 数额不能全为零(至少一项 > 0)"
                )));
            }
        }
        // 表条目 ↔ rewards 双向对账:抽到却没有数额是死掉落,
        // 定义了却无人抽取是死配置——两种都拒载(同 ratio_k 口径显式性)
        for (name, table) in &loot.tables {
            for item in table.weights.keys() {
                if !loot.rewards.contains_key(item) {
                    return Err(Error::Config(format!(
                        "model.loot.tables.{name}: 条目 {item} 缺少 rewards 定义"
                    )));
                }
            }
        }
        for item in loot.rewards.keys() {
            if !loot.tables.values().any(|t| t.weights.contains_key(item)) {
                return Err(Error::Config(format!(
                    "model.loot.rewards.{item}: 无表引用(死配置)"
                )));
            }
        }
    }
    if let Some(gacha) = &cfg.gacha {
        if !gacha.base_rate.is_finite()
            || gacha.base_rate < MIN_GACHA_BASE_RATE
            || gacha.base_rate > 1.0
        {
            return Err(Error::Config(
                format!(
                    "model.gacha.base_rate 必须在 [{MIN_GACHA_BASE_RATE}, 1] 区间(低于下限会让抽卡会话期望抽数失控)"
                ),
            ));
        }
        if gacha.pity_hard > MAX_GACHA_PULLS {
            return Err(Error::Config(format!(
                "model.gacha.pity_hard 不能超过 {MAX_GACHA_PULLS}(抽卡会话最大抽数)"
            )));
        }
        if !gacha.pity_soft_step.is_finite() || gacha.pity_soft_step < 0.0 {
            return Err(Error::Config(
                "model.gacha.pity_soft_step 必须为非负有限数".into(),
            ));
        }
        if !gacha.featured_rate.is_finite() || !(0.0..=1.0).contains(&gacha.featured_rate) {
            return Err(Error::Config(
                "model.gacha.featured_rate 必须在 [0, 1] 内的有限数".into(),
            ));
        }
        // 无定轨 featured 层(featured_guarantee == 0):目标判定退化为每 5★
        // 独立几何,下限守卫按硬保底分派(2026-11-07 复审整改):
        // - 无硬保底(pity_hard == 0):期望抽数 = 1/(base_rate × featured_rate),
        //   组合概率低于 MIN_GACHA_TARGET_RATE 即期望超出 MAX_GACHA_PULLS,
        //   拒绝。这是期望口径的配置体检——尾部随机波动仍可能触限,由运行时
        //   会话上限兜底报错,validate 不承诺逐会话不触限;
        // - 有硬保底:每 pity_hard 抽必出一个 5★(pulls-per-5★ ≤ pity_hard),
        //   目标命中期望抽数 ≤ pity_hard / featured_rate。此时 base_rate 不
        //   进入目标判定面,按乘积下限拒绝会误伤「低 base_rate 不影响行为」
        //   的合法配置,改按 pity_hard / featured_rate ≤ MAX_GACHA_PULLS 校验。
        //   (2026-11-06 审核发现的原始动机不变:无硬保底时两个各取下限
        //   1e-4 的因子乘积 1e-8,期望 1e8 抽仍超上限,单一 featured_rate
        //   下限不足以拦截,必须看组合。)
        if gacha.featured_rate > 0.0 && gacha.featured_guarantee == 0 {
            if gacha.pity_hard == 0 {
                if gacha.base_rate * gacha.featured_rate < MIN_GACHA_TARGET_RATE {
                    return Err(Error::Config(format!(
                        "model.gacha.base_rate × featured_rate 不能低于 {MIN_GACHA_TARGET_RATE}(无硬保底时目标判定为每 5★ 独立几何,组合概率过低会让单会话期望抽数超出 {MAX_GACHA_PULLS})"
                    )));
                }
            } else if (gacha.pity_hard as f64) / gacha.featured_rate > MAX_GACHA_PULLS as f64 {
                return Err(Error::Config(format!(
                    "model.gacha.featured_rate 过低:pity_hard {} 下目标期望抽数 pity_hard/featured_rate 超出 {MAX_GACHA_PULLS}(有硬保底时目标判定按 pity_hard/featured_rate 估界,base_rate 不参与)",
                    gacha.pity_hard
                )));
            }
        }
    }
    // 概率面统一有限性与区间校验(审核整改 P1):NaN 与越界概率会静默改写
    // 行为——NaN 比较恒假恰好越过下面的范围检查,> 1 的流失概率变成必然
    // 触发,负值变成永不触发。逐字段显式拦截,与命中概率同一口径。
    if !(cfg.churn.p_base.is_finite() && (0.0..=1.0).contains(&cfg.churn.p_base)) {
        return Err(Error::Config(
            "churn.p_base 必须为 [0, 1] 内的有限数".into(),
        ));
    }
    if !(cfg.churn.p_stall.is_finite() && (0.0..=1.0).contains(&cfg.churn.p_stall)) {
        return Err(Error::Config(
            "churn.p_stall 必须为 [0, 1] 内的有限数".into(),
        ));
    }
    if cfg.churn.p_stall < cfg.churn.p_base {
        return Err(Error::Config("p_stall 必须不小于 p_base".into()));
    }
    if cfg.progression.upgrade_cost_num == 0 || cfg.progression.upgrade_cost_den == 0 {
        return Err(Error::Config("强化成本比率不能为 0".into()));
    }
    if cfg.progression.upgrade_cost_base <= 0
        || cfg.progression.upgrade_cost_num <= 0
        || cfg.progression.upgrade_cost_den <= 0
    {
        return Err(Error::Config(
            "progression.upgrade_cost_base/num/den 必须为正(负成本会把扣费变成加钱并回绕 u64)"
                .into(),
        ));
    }
    if cfg.cohort_weights.iter().any(|&w| !(w.is_finite())) {
        return Err(Error::Config("cohort_weights 含非有限值".into()));
    }
    if cfg.cohort_weights.iter().any(|&w| w < 0.0) {
        return Err(Error::Config(
            "cohort_weights 不能为负(负占比会反向分群)".into(),
        ));
    }
    let cohort_sum = cfg.cohort_weights.iter().sum::<f64>();
    if cohort_sum <= 0.0 {
        return Err(Error::Config("cohort_weights 之和必须大于 0".into()));
    }
    // 2026-11-06 审核发现:分群配比必须归一。world::new 按 `roll < w0` /
    // `roll < w0+w1` / else 三分,`roll ∈ [0,1)`;和 > 1 时 whale 桶
    // `roll ≥ w0+w1` 可能为空(如 [0.5,0.5,0.5] 和 1.5,whale 恒 0 玩家),
    // 和 < 1 时尾段无人——配比与仿真不符。须显式要求和 = 1(容差取
    // 1e-9,容纳默认 [0.60,0.30,0.10] 的 f64 求和误差 1.1e-16)。
    if (cohort_sum - 1.0).abs() > 1e-9 {
        return Err(Error::Config(
            "cohort_weights 之和必须等于 1(归一化占比,当前和 != 1 会令分群桶失真)".into(),
        ));
    }
    for c in Cohort::ALL {
        let b = cfg.behavior.for_cohort(c);
        if !(b.p_dungeon.is_finite() && b.p_upgrade.is_finite() && b.p_training.is_finite()) {
            return Err(Error::Config(format!(
                "behavior.{}: 行为概率必须为有限数",
                c.name()
            )));
        }
        if !(b.sessions_frac.is_finite() && (0.0..=1.0).contains(&b.sessions_frac)) {
            return Err(Error::Config(format!(
                "behavior.{}.sessions_frac 必须为 [0, 1] 内的有限数",
                c.name()
            )));
        }
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
    let xp_needed_formula =
        crate::formula::compile(&cfg.formulas.xp_needed, crate::formula::XP_NEEDED_VARS)
            .map_err(|e| Error::Config(format!("formulas.xp_needed: {e}")))?;
    // 公式求值安全边界(审核整改 P1):编译通过 ≠ 求值安全,xp_needed
    // 求值 ≤ 0(含 (0,1) 区间截断为 0)会让 progression::gain_xp 的升级环
    // 无法终止。加载期在 1..=512 逐级求值(远超 30 天仿真的可达等级;
    // 探针区间外的退化由 gain_xp 的运行时防护兜底)。
    for level in 1..=512u32 {
        let v = xp_needed_formula.eval(&[
            f64::from(level),
            cfg.progression.xp_base as f64,
            cfg.progression.xp_pow,
        ]);
        if !v.is_finite() || v as i64 <= 0 {
            return Err(Error::Config(format!(
                "formulas.xp_needed 在 level={level} 求值为 {v},必须始终为正的有限值(求值 ≤ 0 会让升级环不终止)"
            )));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// 公式槽在 validate 编译(文档 07 章:加载期编译):语法 / 白名单
    /// 错误报出槽名与原因,默认公式必须通过。
    #[test]
    fn validate_formula_slot_compile_error() {
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

    /// ST-AUD-02 / I-002:players / days 上界与 players×days 预算。
    /// 单维超限与规模超预算都返回结构化 ConfigError,不得放行到 OOM。
    #[test]
    fn validate_sim_scale_budget_bounds() {
        // 单维超上界(预算本身)
        let cfg = SimConfig {
            players: MAX_SIM_DIM + 1,
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("players"), "{msg}");

        let cfg = SimConfig {
            days: MAX_SIM_DIM + 1,
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("days"), "{msg}");

        // players×days 超预算但单维未超:10000×30=30万 合法,20000×30=60万 超
        let cfg = SimConfig {
            players: 20_000,
            days: 30,
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("players × days"), "{msg}");

        // 恰在预算内:400000 合法
        let cfg = SimConfig {
            players: 20_000,
            days: 20,
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_ok());
    }

    /// 比值口径约束(阻力 #1 显式性):ratio_k 只在 damage_model: ratio 下
    /// 生效;口径未切时给出即报错,k 非正报错;缺省配置保持合法。
    #[test]
    fn validate_ratio_model_constraint() {
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

    #[test]
    fn validate_gacha_featured_rate_bounds() {
        let mut cfg = SimConfig {
            gacha: Some(Default::default()),
            ..SimConfig::default()
        };
        // 无定轨组合约束按 base_rate × featured_rate 下界校验,把 base_rate
        // 钉在下限,确保 featured_rate 侧单独触发(默认 base_rate=0.02 会
        // 掩盖组合越界)。
        cfg.gacha.as_mut().unwrap().base_rate = MIN_GACHA_BASE_RATE;

        assert!(validate(&cfg).is_ok());

        cfg.gacha.as_mut().unwrap().featured_rate =
            MIN_GACHA_TARGET_RATE / MIN_GACHA_BASE_RATE * 0.5;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("featured_rate"), "{msg}");

        cfg.gacha.as_mut().unwrap().featured_rate = f64::INFINITY;
        assert!(validate(&cfg)
            .unwrap_err()
            .to_string()
            .contains("featured_rate"));

        cfg.gacha.as_mut().unwrap().featured_rate = -0.1;
        assert!(validate(&cfg)
            .unwrap_err()
            .to_string()
            .contains("featured_rate"));

        cfg.gacha.as_mut().unwrap().featured_rate = 1.1;
        assert!(validate(&cfg)
            .unwrap_err()
            .to_string()
            .contains("featured_rate"));

        cfg.gacha.as_mut().unwrap().featured_rate = 1.0;
        assert!(validate(&cfg).is_ok());

        // 2026-11-06 审核发现:无定轨时目标命中概率为
        // base_rate × featured_rate;两个下限相乘仅 1e-8,期望 1e8 抽
        // 仍会超出单会话上限。组合概率低于 1e-6 必须拒绝。
        cfg.gacha.as_mut().unwrap().featured_guarantee = 0;
        cfg.gacha.as_mut().unwrap().base_rate = MIN_GACHA_BASE_RATE;
        cfg.gacha.as_mut().unwrap().featured_rate =
            MIN_GACHA_TARGET_RATE / MIN_GACHA_BASE_RATE * 0.5;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("base_rate × featured_rate"), "{msg}");

        cfg.gacha.as_mut().unwrap().featured_rate =
            MIN_GACHA_TARGET_RATE / MIN_GACHA_BASE_RATE * 1.01;
        assert!(validate(&cfg).is_ok());

        cfg.gacha.as_mut().unwrap().featured_rate =
            MIN_GACHA_TARGET_RATE / MIN_GACHA_BASE_RATE * 0.5;
        cfg.gacha.as_mut().unwrap().featured_guarantee = 1;
        match validate(&cfg) {
            Ok(()) => {}
            Err(err) => panic!("有定轨时不受无定轨下限约束: {err}"),
        }
    }

    /// 练级环耦合(阻力 #4 显式性):产出面与行为带互相咬合,单边给出报错。
    #[test]
    fn validate_training_loop_coupling() {
        // 62e1185 起缺省已带训练产出(Some{xp:400,gold:150})且各分群 p_training=0.1,
        // 默认行为带已满足耦合;要构造「产出面有、行为带无」须显式把三群 p_training 清零。
        let mut cfg = SimConfig {
            training: Some(TrainingConfig { xp: 100, gold: 10 }),
            ..SimConfig::default()
        };
        cfg.behavior.casual.p_training = 0.0;
        cfg.behavior.core.p_training = 0.0;
        cfg.behavior.whale.p_training = 0.0;
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

        // 62e1185 起缺省已带训练产出,要构造「行为带有、产出面无」须显式 training: None。
        let cfg2 = SimConfig {
            training: None,
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
    fn config_hash_stable_when_optional_absent() {
        let legacy = SimConfig::default();
        assert!(legacy.combat.damage_model.is_none());
        assert_eq!(legacy.combat.ratio_k, 1.0);
        let mut switched = SimConfig::default();
        switched.combat.damage_model = Some(DamageModel::Ratio);
        assert_ne!(config_hash(&switched), config_hash(&legacy));
    }

    /// 掉落面校验(文档 24 章 R1):rate_mult 非正、空表名、全零权重、
    /// 非有限负数逐项报错;合法表因结算未接入仿真被整体拒绝加载
    /// (审核整改 P1);loot 缺省(None)不进 canonical JSON。
    #[test]
    fn validate_loot_section() {
        fn loot(
            rate_mult: f64,
            on_victory: &str,
            tables: BTreeMap<String, LootTableConfig>,
            rewards: BTreeMap<String, LootReward>,
        ) -> SimConfig {
            SimConfig {
                loot: Some(LootConfig {
                    rate_mult,
                    on_victory: on_victory.to_string(),
                    tables,
                    rewards,
                }),
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
        fn rw(pairs: &[(&str, (i64, i64))]) -> BTreeMap<String, LootReward> {
            pairs
                .iter()
                .map(|(k, (g, x))| (k.to_string(), LootReward { gold: *g, xp: *x }))
                .collect()
        }

        // rate_mult 非正
        for rm in [0.0, -1.0] {
            let msg = validate(&loot(rm, "", Default::default(), Default::default()))
                .unwrap_err()
                .to_string();
            assert!(msg.contains("rate_mult"), "{msg}");
        }
        // 空表名
        let cfg = loot(
            1.0,
            "",
            [(
                "".to_string(),
                LootTableConfig {
                    weights: w(&[("a", 1.0)]),
                },
            )]
            .into_iter()
            .collect(),
            Default::default(),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("表名"), "{msg}");
        // 空表(无权重)
        let cfg = loot(1.0, "", table(BTreeMap::new()), Default::default());
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("chest"), "{msg}");
        // 全零权重
        let cfg = loot(
            1.0,
            "",
            table(w(&[("a", 0.0), ("b", 0.0)])),
            Default::default(),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("权重"), "{msg}");
        // 非有限权重
        let cfg = loot(
            1.0,
            "",
            table(w(&[("a", 70.0), ("b", f64::NAN)])),
            Default::default(),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("权重"), "{msg}");
        // on_victory 缺失(空串)
        let cfg = loot(1.0, "", table(w(&[("a", 1.0)])), rw(&[("a", (1, 0))]));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("on_victory"), "{msg}");
        // on_victory 指向不存在的表
        let cfg = loot(1.0, "nope", table(w(&[("a", 1.0)])), rw(&[("a", (1, 0))]));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("on_victory") && msg.contains("nope"), "{msg}");
        // 权重条目缺 rewards 定义
        let cfg = loot(
            1.0,
            "chest",
            table(w(&[("a", 1.0), ("b", 1.0)])),
            rw(&[("a", (1, 0))]),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("rewards") && msg.contains("b"), "{msg}");
        // rewards 条目无表引用(死配置)
        let cfg = loot(
            1.0,
            "chest",
            table(w(&[("a", 1.0)])),
            rw(&[("a", (1, 0)), ("dead", (1, 0))]),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("dead"), "{msg}");
        // 数额为负
        let cfg = loot(1.0, "chest", table(w(&[("a", 1.0)])), rw(&[("a", (-1, 0))]));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("负"), "{msg}");
        // 数额全零
        let cfg = loot(1.0, "chest", table(w(&[("a", 1.0)])), rw(&[("a", (0, 0))]));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("全为零"), "{msg}");
        // 合法配置:结算已接入,加载通过(docs/loot-settlement-design.md)
        let cfg = loot(
            1.5,
            "chest",
            table(w(&[
                ("gold_small", 70.0),
                ("gold_mid", 25.0),
                ("xp_charm", 5.0),
            ])),
            rw(&[
                ("gold_small", (10, 0)),
                ("gold_mid", (50, 0)),
                ("xp_charm", (0, 20)),
            ]),
        );
        assert!(validate(&cfg).is_ok(), "{:?}", validate(&cfg).err());

        // loot = None 缺省不进 canonical JSON(训练字段先例)
        assert!(SimConfig::default().loot.is_none());
    }

    /// 概率面边界(审核整改 P1):流失概率与行为概率的 NaN/越界逐字段拦截。
    /// NaN 此前的行为是比较恒假,恰好越过 `< 0.0 || > 1.0` 形态的检查。
    #[test]
    fn validate_probability_bounds() {
        fn churn_err(p_base: f64, p_stall: f64) -> String {
            let mut cfg = SimConfig::default();
            cfg.churn.p_base = p_base;
            cfg.churn.p_stall = p_stall;
            validate(&cfg).unwrap_err().to_string()
        }
        assert!(churn_err(f64::NAN, 0.05).contains("p_base"));
        assert!(churn_err(0.003, f64::NAN).contains("p_stall"));
        assert!(churn_err(0.003, 1.5).contains("p_stall"));
        assert!(churn_err(-0.1, 0.05).contains("p_base"));
        // 合法边界:p_base=0 / p_stall=1 通过(流失概率允许闭区间)
        assert!(validate(&{
            let mut cfg = SimConfig::default();
            cfg.churn.p_base = 0.0;
            cfg
        })
        .is_ok());

        for c in Cohort::ALL {
            let mut cfg = SimConfig::default();
            cfg.behavior.for_cohort_mut(c).p_dungeon = f64::NAN;
            let msg = validate(&cfg).unwrap_err().to_string();
            assert!(msg.contains("有限数"), "{c:?}: {msg}");

            let mut cfg = SimConfig::default();
            cfg.behavior.for_cohort_mut(c).sessions_frac = 1.2;
            let msg = validate(&cfg).unwrap_err().to_string();
            assert!(msg.contains("sessions_frac"), "{c:?}: {msg}");

            let mut cfg = SimConfig::default();
            cfg.behavior.for_cohort_mut(c).sessions_frac = f64::NAN;
            assert!(validate(&cfg)
                .unwrap_err()
                .to_string()
                .contains("sessions_frac"));
        }
        // sessions_frac 合法边界 0.0 / 1.0 通过(缺省即 0.5)
        assert!(validate(&SimConfig::default()).is_ok());
    }

    /// 公式求值安全边界(审核整改 P1):xp_needed 求值 ≤ 0(含 (0,1) 截断
    /// 为 0)或非有限时,validate 拒绝;默认公式必须通过。
    #[test]
    fn validate_xp_needed_evaluation_positive() {
        let mut cfg = SimConfig::default();
        cfg.formulas.xp_needed = "0".into();
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("升级环不终止"), "{msg}");

        let mut cfg = SimConfig::default();
        cfg.formulas.xp_needed = "0.5".into();
        assert!(validate(&cfg)
            .unwrap_err()
            .to_string()
            .contains("升级环不终止"));

        let mut cfg = SimConfig::default();
        cfg.formulas.xp_needed = "0 * xp_base".into();
        assert!(validate(&cfg).is_err());

        let mut cfg = SimConfig::default();
        cfg.formulas.xp_needed = "xp_base * level ^ xp_pow".into();
        assert!(validate(&cfg).is_ok());
    }

    /// 抽卡面校验(文档 24 章 R2):base_rate 必须在 (0, 1](≤ 0 永不终止、
    /// > 1 概率非法);pity_soft_step 非负有限;gacha 缺省(None)不进 canonical JSON。
    #[test]
    fn validate_gacha_section() {
        fn gacha(base_rate: f64, pity_soft_step: f64) -> SimConfig {
            SimConfig {
                gacha: Some(GachaConfig {
                    base_rate,
                    pity_hard: 50,
                    pity_soft_start: 0,
                    pity_soft_step,
                    featured_rate: 0.0,
                    featured_guarantee: 0,
                }),
                ..SimConfig::default()
            }
        }

        // base_rate 越界:0 / 负数 / > 1 / NaN 逐项报错
        for br in [0.0, -0.5, 1.5, f64::NAN] {
            let msg = validate(&gacha(br, 0.0)).unwrap_err().to_string();
            assert!(msg.contains("base_rate"), "{msg}");
        }
        // ST-AUD-03:base_rate 低于下限(如 1e-300)不再放行——期望 1e300 抽
        // 的实质死循环,必须显式拒绝。
        for br in [MIN_GACHA_BASE_RATE * 0.5, 1e-300] {
            let msg = validate(&gacha(br, 0.0)).unwrap_err().to_string();
            assert!(msg.contains("base_rate"), "{msg}");
        }
        // ST-AUD-03:pity_hard 超过会话最大抽数拒绝(防御纵深)。
        let mut cfg = gacha(0.02, 0.0);
        cfg.gacha.as_mut().unwrap().pity_hard = MAX_GACHA_PULLS + 1;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("pity_hard"), "{msg}");
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

    /// 审核发现 2026-11-04:`has_gold_reward` 须只计入 `on_victory` 指名表
    /// 的金币奖励——掉落仅从该表抽取,金币放在非胜利表(从未抽取)不是可测
    /// 口径,纯结构零不得冒充实测值;奖励名含点(如 `gold.pouch`)也须能识别。
    #[test]
    fn has_gold_reward_only_counts_on_victory_table() {
        use std::collections::BTreeMap;

        fn loot_cfg(
            on_victory: &str,
            tables: BTreeMap<String, LootTableConfig>,
            rewards: BTreeMap<String, LootReward>,
        ) -> LootConfig {
            LootConfig {
                rate_mult: 1.0,
                on_victory: on_victory.to_string(),
                tables,
                rewards,
            }
        }
        fn table(weights: BTreeMap<String, f64>) -> LootTableConfig {
            LootTableConfig { weights }
        }

        // 金币奖励只在 on_victory 表 → 可测
        let mut tables = BTreeMap::new();
        tables.insert(
            "chest".to_string(),
            table([("gold.pouch".to_string(), 1.0)].into()),
        );
        let mut rewards = BTreeMap::new();
        rewards.insert("gold.pouch".to_string(), LootReward { gold: 5, xp: 0 });
        let cfg = loot_cfg("chest", tables, rewards);
        assert!(
            cfg.has_gold_reward(),
            "on_victory 表的金币奖励(名含点)应可测"
        );

        // 金币奖励挂权重 0 条目(恒不可抽):可测口径不成立(2026-11-05)
        let mut tables = BTreeMap::new();
        tables.insert(
            "chest".to_string(),
            table([("gold".to_string(), 0.0), ("potion".to_string(), 1.0)].into()),
        );
        let mut rewards = BTreeMap::new();
        rewards.insert("gold".to_string(), LootReward { gold: 5, xp: 0 });
        rewards.insert("potion".to_string(), LootReward { gold: 0, xp: 10 });
        let cfg = loot_cfg("chest", tables, rewards);
        assert!(
            !cfg.has_gold_reward(),
            "金币奖励挂权重 0 条目(不可抽)不得判可测"
        );

        // 金币奖励只放在非 on_victory 表(从未抽取)→ 不可测
        let mut tables = BTreeMap::new();
        tables.insert(
            "chest".to_string(),
            table([("potion".to_string(), 1.0)].into()),
        );
        tables.insert(
            "spare".to_string(),
            table([("gold_pouch".to_string(), 1.0)].into()),
        );
        let mut rewards = BTreeMap::new();
        rewards.insert("potion".to_string(), LootReward { gold: 0, xp: 10 });
        rewards.insert("gold_pouch".to_string(), LootReward { gold: 5, xp: 0 });
        let cfg = loot_cfg("chest", tables, rewards);
        assert!(
            !cfg.has_gold_reward(),
            "金币奖励不在 on_victory 表 → 不可测"
        );

        // on_victory 表缺失(未指向既有表)→ 不可测
        let mut tables = BTreeMap::new();
        tables.insert(
            "spare".to_string(),
            table([("gold_pouch".to_string(), 1.0)].into()),
        );
        let mut rewards = BTreeMap::new();
        rewards.insert("gold_pouch".to_string(), LootReward { gold: 5, xp: 0 });
        let cfg = loot_cfg("missing", tables, rewards);
        assert!(!cfg.has_gold_reward(), "on_victory 指向不存在的表 → 不可测");
    }

    /// ST-AUD-04 / I-004:经济面 i64 符号/范围门。负或溢出量级的
    /// `whale_gain_mult` 会经 `as u64` 回绕污染全部经济指标;负强化成本
    /// 会把扣费变成加钱并回绕。全部返回结构化 ConfigError,不放行到仿真。
    #[test]
    fn validate_economy_signed_fields_gated() {
        // whale_gain_mult:负值 / 0 / 溢出量级均拒(正值有限才放行)
        for mult in [-1, 0, i64::MAX] {
            let cfg = SimConfig {
                whale_gain_mult: mult,
                ..SimConfig::default()
            };
            let msg = validate(&cfg).unwrap_err().to_string();
            assert!(msg.contains("whale_gain_mult"), "{mult}: {msg}");
        }
        let cfg = SimConfig {
            whale_gain_mult: MAX_ECONOMY_VALUE,
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_ok(), "上界内正值应放行");

        // 强化成本三件套:负值 / 0 均拒(正数才放行)。num/den=0 由旧门
        // 「强化成本比率不能为 0」先拦,base=0 由新门拦截。
        let cfg = SimConfig {
            progression: ProgressionConfig {
                upgrade_cost_base: -1,
                ..ProgressionConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("upgrade_cost"), "{msg}");

        // training 产出负值拒(与 reward_gold 同一防线口径)
        for (xp, gold) in [(-1, 0), (0, -1)] {
            let cfg = SimConfig {
                training: Some(TrainingConfig { xp, gold }),
                ..SimConfig::default()
            };
            let msg = validate(&cfg).unwrap_err().to_string();
            assert!(msg.contains("training"), "{xp}/{gold}: {msg}");
        }

        // 默认配置仍合法
        assert!(validate(&SimConfig::default()).is_ok());
    }

    /// ST-AUD-14 / I-014:数值槽统一有限 + 区间门。怪物/成长倍率/战斗/
    /// 流失/分群占比/角色三维的 NaN、Inf、负值、零值、上界越界全部
    /// 返回结构化 ConfigError,不放行到仿真(防 powi/乘积塌成 NaN/Inf
    /// 再经 as i64 洗成有限值,或 cohort 反向/失真)。
    #[test]
    fn validate_numeric_slots_unified_gates() {
        // dungeon 怪物三维:零/负/上界越界均拒
        for v in [0, -1] {
            let cfg = SimConfig {
                dungeon: DungeonConfig {
                    m_hp: v,
                    ..DungeonConfig::default()
                },
                ..SimConfig::default()
            };
            let msg = validate(&cfg).unwrap_err().to_string();
            assert!(msg.contains("m_hp"), "{msg}");
        }
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                m_hp: MAX_ECONOMY_VALUE + 1,
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_err(), "m_hp 上界越界应拒");

        // dungeon 成长倍率:NaN / Inf / 0 / 负均拒(有限正数才放行)
        for (name, v) in [
            ("tier_growth", f64::NAN),
            ("tier_growth", f64::INFINITY),
            ("tier_growth", 0.0),
            ("tier_growth", -1.3),
            ("reward_gold_growth", f64::NAN),
            ("reward_xp_growth", f64::NEG_INFINITY),
        ] {
            let cfg = SimConfig {
                dungeon: DungeonConfig {
                    tier_growth: if name == "tier_growth" { v } else { 1.3 },
                    reward_gold_growth: if name == "reward_gold_growth" { v } else { 1.4 },
                    reward_xp_growth: if name == "reward_xp_growth" { v } else { 1.4 },
                    ..DungeonConfig::default()
                },
                ..SimConfig::default()
            };
            assert!(validate(&cfg).is_err(), "{name}={v} 应拒");
        }

        // combat.max_rounds:0 拒;churn.stall_days:0 拒
        let cfg = SimConfig {
            combat: CombatConfig {
                max_rounds: 0,
                ..CombatConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("max_rounds"), "{msg}");
        let cfg = SimConfig {
            churn: ChurnConfig {
                stall_days: 0,
                ..ChurnConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("stall_days"), "{msg}");

        // cohort_weights:负占比拒([-0.5,1.0,0.5] 原合法但分群失真)
        let cfg = SimConfig {
            cohort_weights: [-0.5, 1.0, 0.5],
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("cohort_weights"), "{msg}");

        // warrior 三维:零/上界越界拒(正且有限才放行)
        let cfg = SimConfig {
            warrior: WarriorConfig {
                attack: 0,
                ..WarriorConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("warrior"), "{msg}");
        let cfg = SimConfig {
            warrior: WarriorConfig {
                hp: MAX_ECONOMY_VALUE + 1,
                ..WarriorConfig::default()
            },
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_err(), "warrior hp 上界越界应拒");

        // 默认配置仍合法
        assert!(validate(&SimConfig::default()).is_ok());
    }

    /// 2026-11-06 审核发现:有限正增长率 alone 不够——`tier_growth=1e308`
    /// 与 `tiers=64` 时 `1e308.powi(63)` 溢出为 Inf,怪物三维经 `as i64`
    /// 饱和为 `i64::MAX`。必须按最高层派生值拒载。
    #[test]
    fn validate_tier_growth_derived_overflow() {
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 64,
                tier_growth: 1e308,
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("tier_growth^63"), "{msg}");

        // 增长率有限但派生值刚过经济上界也拒
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 64,
                tier_growth: 2.0,
                m_hp: MAX_ECONOMY_VALUE,
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_err());

        // reward 面同口径:增长派生值溢出拒
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 64,
                reward_gold: 1,
                reward_gold_growth: 1e308,
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_err());
    }

    /// 2026-11-07 复审整改:硬保底下的无定轨目标下限按 pity_hard/featured_rate
    /// 估界,base_rate 不参与——乘积口径会误伤「低 base_rate 不影响目标判定」
    /// 的合法配置(硬保底已把 pulls-per-5★ 钉在 pity_hard 内)。
    #[test]
    fn validate_gacha_hard_pity_featured_bound() {
        let mut cfg = SimConfig {
            gacha: Some(Default::default()),
            ..SimConfig::default()
        };
        cfg.gacha.as_mut().unwrap().base_rate = 0.6;
        cfg.gacha.as_mut().unwrap().featured_rate = 1e-6;
        cfg.gacha.as_mut().unwrap().pity_hard = 1;
        // 乘积 6e-7 < 1e-6,但硬保底估界 1/1e-6 = 1e6 ≤ MAX_GACHA_PULLS:放行。
        assert!(validate(&cfg).is_ok());

        // featured_rate 再降一个量级:期望 1e7 抽超上限,拒绝。
        cfg.gacha.as_mut().unwrap().featured_rate = 1e-7;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("featured_rate"), "{msg}");

        // 无硬保底时同配置仍按乘积口径拒绝(组合约束不放松)。
        cfg.gacha.as_mut().unwrap().pity_hard = 0;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("base_rate × featured_rate"), "{msg}");
    }

    /// 2026-11-07 复审整改:显式层表全行给定 gold/xp 时几何回退值不被使用
    /// (combat::monster_of 按行内显式值取数),不按派生值拒绝合法配置;
    /// 部分行缺省时回退仍参与行为,照常校验。
    #[test]
    fn validate_explicit_tier_table_skips_derived_reward_check() {
        let rows = |gold: Option<i64>, xp: Option<i64>| -> Vec<TierRow> {
            (0..64)
                .map(|_| TierRow {
                    hp: 10,
                    attack: 1,
                    defense: 1,
                    gold,
                    xp,
                })
                .collect()
        };
        // 全行显式产出:即便增长率荒谬(回退值不被使用)也放行。
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 64,
                reward_gold_growth: 1e308,
                tier_table: Some(rows(Some(100), Some(50))),
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_ok());

        // 有一行缺省产出:几何回退参与行为,荒谬增长率照常拒绝。
        let mut partial = rows(Some(100), Some(50));
        partial[10].gold = None;
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 64,
                reward_gold_growth: 1e308,
                tier_table: Some(partial),
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("reward_gold"), "{msg}");
    }

    /// 2026-11-06 审核发现:分群权重和必须归一。`[0.5,0.5,0.5]` 和 1.5
    /// 会让 whale 桶恒空;和 < 1 时尾段无人。显式要求和 = 1。
    #[test]
    fn validate_cohort_weights_normalized() {
        let cfg = SimConfig {
            cohort_weights: [0.5, 0.5, 0.5],
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("等于 1"), "{msg}");

        let cfg = SimConfig {
            cohort_weights: [0.3, 0.3, 0.3],
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_err());

        // 默认 [0.60, 0.30, 0.10] 精确归一,放行
        assert!(validate(&SimConfig::default()).is_ok());
    }
}
