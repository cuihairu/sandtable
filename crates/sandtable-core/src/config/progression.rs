//! 成长与留存配置域:升级曲线、公式槽、流失参数、练级产出。

use serde::{Deserialize, Serialize};

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
