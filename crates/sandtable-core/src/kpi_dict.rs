//! 指标字典(todo「KPI 与模板」:指标字典、记录计算口径和版本)。
//!
//! 本表是**内置指标机器可判定口径的事实源**:量纲、显示收口小数位、
//! 是否有不可用情形、可用性门槛(天数 / 结构依赖)。显示名与译词留在
//! 前端 locale 显示层(中文不出内核);可用性原因原文仍走
//! [`crate::experiment::MetricKey::unavailable_reason`](内核中文,进错误
//! 通道原样透传),字典只给门槛参数,两套规则的一致性由测试锁定。

use serde::Serialize;

use crate::experiment::MetricKey;
use crate::metrics::SNAPSHOT_DAYS;

/// 指标字典契约版本。条目语义(量纲 / 小数位 / 门槛)变化时递增,
/// 随报告与导出记录(与 [`crate::MODEL_VERSION`] 并列)。
pub const METRIC_DICT_VERSION: &str = "1";

/// 量纲口径:`ratio` = 内核 0–1 比例(×100 只发生在显示层 fmtPercent,
/// 数据通道不换算);`value` = 绝对量(计数 / 额度,不换算)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MetricKind {
    /// 比例口径(0–1)
    Ratio,
    /// 绝对量口径
    Value,
}

/// 单条指标定义:机器可判定的口径事实。
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct MetricDefinition {
    /// 内核 ID(= [`MetricKey::name`],与 CSV 列名、sweep.json 约束名同口径)
    pub id: &'static str,
    /// 量纲口径(决定显示层是否 ×100)
    pub kind: MetricKind,
    /// 显示收口小数位(不改底层数值)
    pub decimals: u8,
    /// 存在不可用的运行情形(缺席不填 0,显示「不可用」)
    pub optional: bool,
    /// 可用性门槛:需要的最少运行天数(0 = 无天数门槛)
    pub days_required: u32,
    /// 可用性门槛:需要 `model.gacha` 配置
    pub requires_gacha: bool,
    /// 可用性门槛:需要 `model.loot` 配置
    pub requires_loot: bool,
}

/// 全量字典。顺序 = [`MetricKey::ALL`] 声明序,与 CSV 列序、白名单同序。
pub fn metric_definitions() -> Vec<MetricDefinition> {
    MetricKey::ALL.iter().map(|key| definition(*key)).collect()
}

/// 字典契约:每个 [`MetricKey`] 恰一条,门槛与
/// [`MetricKey::unavailable_reason`] 的 match 分支逐条对应。
fn definition(key: MetricKey) -> MetricDefinition {
    use MetricKind::{Ratio, Value};
    match key {
        MetricKey::RetentionD7 => MetricDefinition {
            id: "retention_d7",
            kind: Ratio,
            decimals: 1,
            optional: true,
            days_required: 7,
            requires_gacha: false,
            requires_loot: false,
        },
        MetricKey::RetentionD3 => MetricDefinition {
            id: "retention_d3",
            kind: Ratio,
            decimals: 1,
            optional: true,
            days_required: 3,
            requires_gacha: false,
            requires_loot: false,
        },
        MetricKey::WinRate => MetricDefinition {
            id: "win_rate",
            kind: Ratio,
            decimals: 1,
            optional: false,
            days_required: 0,
            requires_gacha: false,
            requires_loot: false,
        },
        MetricKey::GoldPerPlayer => MetricDefinition {
            id: "gold_per_player",
            kind: Value,
            decimals: 1,
            optional: false,
            days_required: 0,
            requires_gacha: false,
            requires_loot: false,
        },
        MetricKey::PowerP50Final => MetricDefinition {
            id: "power_p50",
            kind: Value,
            decimals: 1,
            // extract 签名是 Option,但快照只在 SNAPSHOT_DAYS 落点、day 1
            // 必在其中,任何合法天数都至少有一次快照,故无不可用情形。
            optional: false,
            days_required: 0,
            requires_gacha: false,
            requires_loot: false,
        },
        MetricKey::ChurnRate => MetricDefinition {
            id: "churn_rate",
            kind: Ratio,
            decimals: 1,
            optional: false,
            days_required: 0,
            requires_gacha: false,
            requires_loot: false,
        },
        MetricKey::GachaPullsToHit => MetricDefinition {
            id: "gacha_pulls_to_hit",
            kind: Value,
            decimals: 1,
            optional: true,
            days_required: 0,
            requires_gacha: true,
            requires_loot: false,
        },
        MetricKey::LootGoldPerPlayer => MetricDefinition {
            id: "loot_gold_per_player",
            kind: Value,
            decimals: 1,
            optional: true,
            days_required: 0,
            requires_gacha: false,
            requires_loot: true,
        },
    }
}

/// 按字典门槛判定「该配置下此指标是否有不可用情形」。
/// 与 [`MetricKey::unavailable_reason`] 判 **是否存在原因**(同一套门槛),
/// 文案仍以 `unavailable_reason` 为准;两者不一致由测试锁定。
pub fn is_gated(def: &MetricDefinition, cfg: &crate::config::SimConfig) -> bool {
    (def.days_required > 0 && cfg.days < def.days_required)
        || (def.requires_gacha && cfg.gacha.is_none())
        || (def.requires_loot && cfg.loot.is_none())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::SimConfig;

    /// 构造一个最小配置(days / gacha / loot 三轴),其余字段走内核缺省。
    fn cfg(days: u32, gacha: bool, loot: bool) -> SimConfig {
        let yaml = format!(
            "schema_version: '1'\nscenario: {{population: 40, duration: '{days}d', seed: 7}}\n",
        );
        let cfg = crate::scenario::load_str(&yaml).unwrap();
        let mut cfg = cfg;
        if !gacha {
            cfg.gacha = None;
        } else {
            cfg.gacha = Some(crate::config::GachaConfig::default());
        }
        if !loot {
            cfg.loot = None;
        } else {
            cfg.loot = Some(crate::config::LootConfig::default());
        }
        cfg
    }

    #[test]
    fn dictionary_covers_every_metric_in_declaration_order() {
        let defs = metric_definitions();
        assert_eq!(defs.len(), MetricKey::ALL.len(), "每个内置指标恰一条");
        let want: Vec<&str> = MetricKey::ALL.iter().map(|key| key.name()).collect();
        assert_eq!(
            defs.iter().map(|d| d.id).collect::<Vec<_>>(),
            want,
            "字典顺序 = MetricKey::ALL 声明序(与 CSV 列序、KPI 白名单同序)"
        );
        // 每条 id 都能被 parse 认回,且回到的就是同一枚举项(无别名歧义)
        for (def, key) in defs.iter().zip(MetricKey::ALL.iter()) {
            assert_eq!(MetricKey::parse(def.id), Some(*key), "id 与枚举项一一对应");
        }
    }

    #[test]
    fn ratio_metrics_are_the_percent_metrics() {
        let defs = metric_definitions();
        let ratio_ids: Vec<&str> = defs
            .iter()
            .filter(|d| d.kind == MetricKind::Ratio)
            .map(|d| d.id)
            .collect();
        assert_eq!(
            ratio_ids,
            vec!["retention_d7", "retention_d3", "win_rate", "churn_rate"],
            "比例口径 = 四个比率指标(×100 只发生在显示层)"
        );
        let value_ids: Vec<&str> = defs
            .iter()
            .filter(|d| d.kind == MetricKind::Value)
            .map(|d| d.id)
            .collect();
        assert_eq!(
            value_ids,
            vec![
                "gold_per_player",
                "power_p50",
                "gacha_pulls_to_hit",
                "loot_gold_per_player"
            ],
            "绝对量口径 = 四个绝对量指标(不换算)"
        );
    }

    #[test]
    fn optional_flags_match_the_kernels_unavailable_shapes() {
        let defs = metric_definitions();
        let optional_ids: Vec<&str> = defs.iter().filter(|d| d.optional).map(|d| d.id).collect();
        assert_eq!(
            optional_ids,
            vec![
                "retention_d7",
                "retention_d3",
                "gacha_pulls_to_hit",
                "loot_gold_per_player"
            ],
            "可空 = 天数门槛或结构依赖的四个指标(power_p50 总有 day 1 快照)"
        );
    }

    #[test]
    fn dictionary_gates_agree_with_kernel_reasons() {
        // 配置矩阵:天数 2/3/7 × gacha/loot 各两态,足以覆盖全部门槛分支
        for days in [2u32, 3, 7] {
            for gacha in [true, false] {
                for loot in [true, false] {
                    let cfg = cfg(days, gacha, loot);
                    for key in MetricKey::ALL {
                        let def = definition(key);
                        let gated = is_gated(&def, &cfg);
                        let id = def.id;
                        assert_eq!(
                            gated,
                            key.unavailable_reason(&cfg).is_some(),
                            "门槛判定必须与内核原文原因一致:id={id} days={days} gacha={gacha} loot={loot}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn reason_text_carries_the_dictionary_thresholds() {
        // 天数门槛的原文要点名 id 与阈值,与字典字段同值
        for (key, days_required) in [
            (MetricKey::RetentionD7, 7u32),
            (MetricKey::RetentionD3, 3u32),
        ] {
            let cfg = cfg(1, false, false);
            let reason = key
                .unavailable_reason(&cfg)
                .expect("1 天配置下 d3/d7 必不可用");
            let def = definition(key);
            assert_eq!(def.days_required, days_required, "字典阈值 = 门槛语义");
            assert!(reason.starts_with(def.id), "原因要点名内核 ID");
            assert!(
                reason.contains(&format!("days ≥ {days_required}")),
                "原因要点名阈值"
            );
        }
        let gacha = cfg(7, false, false);
        assert_eq!(
            MetricKey::GachaPullsToHit.unavailable_reason(&gacha),
            Some("gacha_pulls_to_hit 需要 model.gacha 配置,当前未配置"),
            "结构依赖原因逐字稳定(前端词典按前缀归类)"
        );
        let loot = cfg(7, true, false);
        assert_eq!(
            MetricKey::LootGoldPerPlayer.unavailable_reason(&loot),
            Some("loot_gold_per_player 需要 model.loot 配置,当前未配置"),
        );
        // 门槛全过:全部可用
        let full = cfg(7, true, true);
        assert!(MetricKey::ALL
            .iter()
            .all(|k| (*k).unavailable_reason(&full).is_none()));
    }

    #[test]
    fn power_p50_needs_at_least_the_day_one_snapshot() {
        // optional=false 的依据:快照只落 SNAPSHOT_DAYS,而 day 1 必在其中
        assert!(SNAPSHOT_DAYS.contains(&1u32), "day 1 必须在快照日集合内");
        let def = definition(MetricKey::PowerP50Final);
        assert!(
            !def.optional && def.days_required == 0,
            "power_p50 无不可用情形(任何合法天数都至少有一次快照)"
        );
    }

    #[test]
    fn dictionary_version_is_recorded() {
        assert_eq!(METRIC_DICT_VERSION, "1");
    }
}
