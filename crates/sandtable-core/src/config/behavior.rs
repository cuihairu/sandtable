//! 行为画像配置域(文档 03 章):分群行为概率与练级带。
//!
//! [`BehaviorConfig`] 手写 `Deserialize`:部分覆盖某分群时按该分群默认逐字段
//! 合并(`PartialActorBehavior` / `PartialBehavior` 为模块私有 serde 中间态)。

use serde::{Deserialize, Serialize};

use super::Cohort;

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
