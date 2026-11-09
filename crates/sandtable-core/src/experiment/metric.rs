//! 指标键:RunMetrics 可提取的比较主指标 + 序列化走 name/parse。
use serde::{Deserialize, Deserializer, Serialize, Serializer};

///
/// 序列化走 [`MetricKey::name`] / [`MetricKey::parse`](snake_case,如
/// `win_rate`),与 CSV 列名、sweep.json 里的约束指标名一致;反序列化
/// 接受 parse 的全部别名。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MetricKey {
    /// D7 留存(默认主指标)
    RetentionD7,
    /// D3 留存
    RetentionD3,
    /// 全程胜率
    WinRate,
    /// 人均金币产出(全程 / 玩家数)
    GoldPerPlayer,
    /// 期末快照 P50 Power
    PowerP50Final,
    /// 累计流失率
    ChurnRate,
    /// 抽卡期望抽数 E[T](gacha 未配置时为 None,不进比较)
    GachaPullsToHit,
    /// 人均掉落金币(docs/loot-settlement-design.md;loot 未配置时为
    /// None,不进比较)
    LootGoldPerPlayer,
}

impl MetricKey {
    pub const ALL: [MetricKey; 8] = [
        MetricKey::RetentionD7,
        MetricKey::RetentionD3,
        MetricKey::WinRate,
        MetricKey::GoldPerPlayer,
        MetricKey::PowerP50Final,
        MetricKey::ChurnRate,
        MetricKey::GachaPullsToHit,
        MetricKey::LootGoldPerPlayer,
    ];

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "retention_d7" | "d7" => MetricKey::RetentionD7,
            "retention_d3" | "d3" => MetricKey::RetentionD3,
            "win_rate" => MetricKey::WinRate,
            "gold_per_player" => MetricKey::GoldPerPlayer,
            "power_p50" => MetricKey::PowerP50Final,
            "churn_rate" => MetricKey::ChurnRate,
            "gacha_pulls_to_hit" => MetricKey::GachaPullsToHit,
            "loot_gold_per_player" => MetricKey::LootGoldPerPlayer,
            _ => return None,
        })
    }

    pub fn name(self) -> &'static str {
        match self {
            MetricKey::RetentionD7 => "retention_d7",
            MetricKey::RetentionD3 => "retention_d3",
            MetricKey::WinRate => "win_rate",
            MetricKey::GoldPerPlayer => "gold_per_player",
            MetricKey::PowerP50Final => "power_p50",
            MetricKey::ChurnRate => "churn_rate",
            MetricKey::GachaPullsToHit => "gacha_pulls_to_hit",
            MetricKey::LootGoldPerPlayer => "loot_gold_per_player",
        }
    }

    pub fn extract(self, m: &crate::metrics::RunMetrics) -> Option<f64> {
        match self {
            MetricKey::RetentionD7 => m.retention_d7,
            MetricKey::RetentionD3 => m.retention_d3,
            MetricKey::WinRate => Some(m.win_rate),
            MetricKey::GoldPerPlayer => Some(m.gold_earned_total as f64 / m.players.max(1) as f64),
            MetricKey::PowerP50Final => m.power_snapshots.last().map(|s| s.p50),
            MetricKey::ChurnRate => Some(m.churn_rate_total),
            MetricKey::GachaPullsToHit => m.gacha_pulls_to_hit,
            MetricKey::LootGoldPerPlayer => m.loot_gold_per_player,
        }
    }

    /// 可用性预检(审核整改 P1):对给定配置,该指标是否一定有值。
    /// 返回不可用原因;None = 可用。此前不可用指标在 run_candidate 里被
    /// 静默跳过(约束跟着消失、候选照常显示成功),现在在加载实验时
    /// 显式报错。
    pub fn unavailable_reason(self, cfg: &crate::config::SimConfig) -> Option<&'static str> {
        match self {
            MetricKey::RetentionD3 if cfg.days < 3 => {
                Some("retention_d3 需要 days ≥ 3,当前配置不足")
            }
            MetricKey::RetentionD7 if cfg.days < 7 => {
                Some("retention_d7 需要 days ≥ 7,当前配置不足")
            }
            MetricKey::GachaPullsToHit if cfg.gacha.is_none() => {
                Some("gacha_pulls_to_hit 需要 model.gacha 配置,当前未配置")
            }
            MetricKey::LootGoldPerPlayer if cfg.loot.is_none() => {
                Some("loot_gold_per_player 需要 model.loot 配置,当前未配置")
            }
            MetricKey::LootGoldPerPlayer if !cfg.loot_gold_measurable() => {
                Some("loot_gold_per_player 需要 model.loot 存在金币型奖励,当前无金币掉落")
            }
            _ => None,
        }
    }
}

impl Serialize for MetricKey {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.name())
    }
}

impl<'de> Deserialize<'de> for MetricKey {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        MetricKey::parse(&s).ok_or_else(|| {
            serde::de::Error::custom(format!(
                "未知指标 {s}(可选:{})",
                MetricKey::ALL
                    .iter()
                    .map(|k| k.name())
                    .collect::<Vec<_>>()
                    .join(", ")
            ))
        })
    }
}
