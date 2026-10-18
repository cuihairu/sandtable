//! 参考导入器:契约 JSON 的结构与域值校验(设计文档 §3.5 参考实现)。
//!
//! 校验分两层:
//! - **结构层**:kind / schema_version / 必填字段 / 类型(解析期);
//! - **域值层**:取值范围与一致性(如命中率 ∈ [0,1]、表长 == tiers、
//!   config_hash 为 64 位十六进制)。
//!
//! 域值校验是契约的回归 oracle:引擎侧拿到的一定是「沙盘语义自洽」的契约。

use super::contract::*;
use crate::error::{Error, Result};

/// 校验并加载契约(JSON 文本)。
pub fn load(json: &str) -> Result<EngineContract> {
    let contract: EngineContract =
        serde_json::from_str(json).map_err(|e| Error::Contract(format!("JSON 解析失败: {e}")))?;
    contract.validate()?;
    Ok(contract)
}

impl EngineContract {
    /// 结构与域值校验(幂等,导出产物亦可通过)。
    pub fn validate(&self) -> Result<()> {
        if self.kind != KIND_CONTRACT {
            return Err(Error::Contract(format!(
                "kind 不符: {}(应为 {KIND_CONTRACT})",
                self.kind
            )));
        }
        if self.schema_version != SCHEMA_VERSION {
            return Err(Error::Contract(format!(
                "schema_version {} 不支持(当前支持 {SCHEMA_VERSION})",
                self.schema_version
            )));
        }
        check_hash(&self.config_hash)?;
        self.model.validate()
    }
}

/// config_hash 形态:64 位小写十六进制(SHA-256)。
fn check_hash(hash: &str) -> Result<()> {
    let ok = hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit());
    if !ok {
        return Err(Error::Contract(format!(
            "config_hash 形态不符: {hash}(应为 64 位十六进制)"
        )));
    }
    Ok(())
}

fn prob_in_01(v: f64, name: &str) -> Result<()> {
    if !(0.0..=1.0).contains(&v) {
        return Err(Error::Contract(format!("{name} 超出 [0,1]: {v}")));
    }
    Ok(())
}

impl ModelContract {
    fn validate(&self) -> Result<()> {
        let m = self;
        for (name, v) in [
            ("warrior.attack", m.warrior.attack),
            ("warrior.defense", m.warrior.defense),
            ("warrior.hp", m.warrior.hp),
        ] {
            if v <= 0 {
                return Err(Error::Contract(format!("{name} 必须为正: {v}")));
            }
        }
        if m.whale_gain_mult <= 0 {
            return Err(Error::Contract(format!(
                "whale_gain_mult 必须为正: {}",
                m.whale_gain_mult
            )));
        }
        m.combat.validate()?;
        m.dungeon.validate()?;
        m.behavior.validate()?;
        if let Some(t) = &m.training {
            if t.xp < 0 || t.gold < 0 {
                return Err(Error::Contract(format!(
                    "training 产出不能为负: xp={}, gold={}",
                    t.xp, t.gold
                )));
            }
        }
        m.progression.validate()?;
        if m.formula.xp_needed.trim().is_empty() {
            return Err(Error::Contract("formula.xp_needed 不能为空".into()));
        }
        m.churn.validate()?;
        if let Some(l) = &m.loot {
            l.validate()?;
        }
        if let Some(g) = &m.gacha {
            g.validate()?;
        }
        Ok(())
    }
}

impl CombatContract {
    fn validate(&self) -> Result<()> {
        prob_in_01(self.p_hit, "combat.p_hit")?;
        prob_in_01(self.p_hit_monster, "combat.p_hit_monster")?;
        if self.dmg_var < 0 {
            return Err(Error::Contract(format!(
                "dmg_var 不能为负: {}",
                self.dmg_var
            )));
        }
        if self.max_rounds == 0 {
            return Err(Error::Contract("max_rounds 必须为正".into()));
        }
        if self.damage_model != "difference" && self.damage_model != "ratio" {
            return Err(Error::Contract(format!(
                "damage_model 不符: {}(应为 difference 或 ratio)",
                self.damage_model
            )));
        }
        if self.ratio_k <= 0.0 {
            return Err(Error::Contract(format!(
                "ratio_k 必须为正: {}",
                self.ratio_k
            )));
        }
        Ok(())
    }
}

impl DungeonContract {
    fn validate(&self) -> Result<()> {
        if self.tiers == 0 {
            return Err(Error::Contract("dungeon.tiers 必须为正".into()));
        }
        let d = self;
        for (name, v) in [
            ("dungeon.m_hp", d.m_hp),
            ("dungeon.m_attack", d.m_attack),
            ("dungeon.m_defense", d.m_defense),
        ] {
            if v <= 0 {
                return Err(Error::Contract(format!("{name} 必须为正: {v}")));
            }
        }
        for (name, v) in [
            ("dungeon.tier_growth", d.tier_growth),
            ("dungeon.reward_gold_growth", d.reward_gold_growth),
            ("dungeon.reward_xp_growth", d.reward_xp_growth),
        ] {
            if v <= 0.0 {
                return Err(Error::Contract(format!("{name} 必须为正: {v}")));
            }
        }
        if d.reward_gold < 0 || d.reward_xp < 0 {
            return Err(Error::Contract(format!(
                "第 0 层产出不能为负: gold={}, xp={}",
                d.reward_gold, d.reward_xp
            )));
        }
        if let Some(rows) = &d.tier_table {
            if rows.len() as u32 != d.tiers {
                return Err(Error::Contract(format!(
                    "tier_table 行数 {} 与 tiers {} 不一致",
                    rows.len(),
                    d.tiers
                )));
            }
            for (i, r) in rows.iter().enumerate() {
                if r.hp <= 0 || r.attack <= 0 || r.defense <= 0 {
                    return Err(Error::Contract(format!("tier_table[{i}] 数值必须为正")));
                }
                if r.gold < 0 || r.xp < 0 {
                    return Err(Error::Contract(format!("tier_table[{i}] 产出不能为负")));
                }
            }
        }
        Ok(())
    }
}

impl BehaviorContract {
    fn validate(&self) -> Result<()> {
        for (name, a) in [
            ("casual", &self.casual),
            ("core", &self.core),
            ("whale", &self.whale),
        ] {
            if a.sessions_int == 0 {
                return Err(Error::Contract(format!(
                    "behavior.{name}.sessions_int 必须为正"
                )));
            }
            if !(0.0..1.0).contains(&a.sessions_frac) {
                return Err(Error::Contract(format!(
                    "behavior.{name}.sessions_frac 超出 [0,1): {}",
                    a.sessions_frac
                )));
            }
            prob_in_01(a.p_dungeon, &format!("behavior.{name}.p_dungeon"))?;
            prob_in_01(a.p_upgrade, &format!("behavior.{name}.p_upgrade"))?;
            prob_in_01(a.p_training, &format!("behavior.{name}.p_training"))?;
        }
        Ok(())
    }
}

impl ProgressionContract {
    fn validate(&self) -> Result<()> {
        let p = self;
        if p.xp_base <= 0 {
            return Err(Error::Contract(format!(
                "progression.xp_base 必须为正: {}",
                p.xp_base
            )));
        }
        if p.xp_pow <= 0.0 {
            return Err(Error::Contract(format!(
                "progression.xp_pow 必须为正: {}",
                p.xp_pow
            )));
        }
        for name in [
            "level_attack_gain",
            "level_defense_gain",
            "level_hp_gain",
            "upgrade_attack_gain",
        ] {
            let v = match name {
                "level_attack_gain" => p.level_attack_gain,
                "level_defense_gain" => p.level_defense_gain,
                "level_hp_gain" => p.level_hp_gain,
                _ => p.upgrade_attack_gain,
            };
            if v < 0 {
                return Err(Error::Contract(format!("progression.{name} 不能为负: {v}")));
            }
        }
        for (name, v) in [
            ("upgrade_cost_base", p.upgrade_cost_base),
            ("upgrade_cost_num", p.upgrade_cost_num),
            ("upgrade_cost_den", p.upgrade_cost_den),
        ] {
            if v <= 0 {
                return Err(Error::Contract(format!("progression.{name} 必须为正: {v}")));
            }
        }
        Ok(())
    }
}

impl ChurnContract {
    fn validate(&self) -> Result<()> {
        prob_in_01(self.p_base, "churn.p_base")?;
        prob_in_01(self.p_stall, "churn.p_stall")?;
        if self.p_base > self.p_stall {
            return Err(Error::Contract(format!(
                "churn.p_stall 应不小于 p_base: {} < {}",
                self.p_stall, self.p_base
            )));
        }
        if self.stall_days == 0 {
            return Err(Error::Contract("churn.stall_days 必须为正".into()));
        }
        Ok(())
    }
}

impl LootContract {
    fn validate(&self) -> Result<()> {
        if self.rate_mult < 0.0 {
            return Err(Error::Contract(format!(
                "loot.rate_mult 不能为负: {}",
                self.rate_mult
            )));
        }
        for (name, table) in &self.tables {
            if table.weights.is_empty() {
                return Err(Error::Contract(format!(
                    "loot.tables[{name}] 权重表不能为空"
                )));
            }
            for (item, w) in &table.weights {
                if *w < 0.0 {
                    return Err(Error::Contract(format!(
                        "loot.tables[{name}][{item}] 权重不能为负: {w}"
                    )));
                }
            }
        }
        // 结算已接入:胜利绑定表与条目数额必须自洽(与 core validate 同口径)
        if self.on_victory.trim().is_empty() {
            return Err(Error::Contract("loot.on_victory 必须指名掉落表名".into()));
        }
        if !self.tables.contains_key(&self.on_victory) {
            return Err(Error::Contract(format!(
                "loot.on_victory 表 {} 不存在(tables 中无此键)",
                self.on_victory
            )));
        }
        for (item, r) in &self.rewards {
            if r.gold < 0 || r.xp < 0 {
                return Err(Error::Contract(format!(
                    "loot.rewards[{item}] 数额不能为负: gold={}, xp={}",
                    r.gold, r.xp
                )));
            }
            if r.gold == 0 && r.xp == 0 {
                return Err(Error::Contract(format!(
                    "loot.rewards[{item}] 数额不能全为零(至少一项 > 0)"
                )));
            }
        }
        let bound = &self.tables[&self.on_victory];
        for item in bound.weights.keys() {
            if !self.rewards.contains_key(item) {
                return Err(Error::Contract(format!(
                    "loot 条目 {item} 缺少 rewards 定义"
                )));
            }
        }
        Ok(())
    }
}

impl GachaContract {
    fn validate(&self) -> Result<()> {
        if !(0.0..=1.0).contains(&self.base_rate) || self.base_rate == 0.0 {
            return Err(Error::Contract(format!(
                "gacha.base_rate 必须在 (0,1]: {}",
                self.base_rate
            )));
        }
        if self.pity_soft_step < 0.0 {
            return Err(Error::Contract(format!(
                "gacha.pity_soft_step 不能为负: {}",
                self.pity_soft_step
            )));
        }
        Ok(())
    }
}
