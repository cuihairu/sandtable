//! 数值读写镜像:read_numeric / apply_numeric 逐路径互为镜像(镜像测试锁定),
//! 附 read_u64_raw / key_str / unknown 辅助。
use crate::config::SimConfig;
use crate::Error;
use serde_yaml_ng::Value;

use super::suggest::suggestions;

/// 读数值参数(弹性 / 推荐要取基线值;与 [`apply_numeric`] 逐路径互为镜像,
/// 镜像测试锁定)。
pub fn read_numeric(cfg: &SimConfig, path: &str) -> Result<f64, Error> {
    match path {
        "scenario.population" => Ok(cfg.players as f64),
        "scenario.seed" => Ok(cfg.base_seed as f64),
        "scenario.population_mix.casual" => Ok(cfg.cohort_weights[0]),
        "scenario.population_mix.core" => Ok(cfg.cohort_weights[1]),
        "scenario.population_mix.whale" => Ok(cfg.cohort_weights[2]),
        "model.warrior.attack" => Ok(cfg.warrior.attack as f64),
        "model.warrior.defense" => Ok(cfg.warrior.defense as f64),
        "model.warrior.hp" => Ok(cfg.warrior.hp as f64),
        "model.whale_gain_mult" => Ok(cfg.whale_gain_mult as f64),
        "model.combat.p_hit" => Ok(cfg.combat.p_hit),
        "model.combat.p_hit_monster" => Ok(cfg.combat.p_hit_monster),
        "model.combat.dmg_var" => Ok(cfg.combat.dmg_var as f64),
        "model.combat.max_rounds" => Ok(cfg.combat.max_rounds as f64),
        "model.combat.ratio_k" => Ok(cfg.combat.ratio_k),
        "model.training.xp" => Ok(cfg.training.map(|t| t.xp).unwrap_or(0) as f64),
        "model.training.gold" => Ok(cfg.training.map(|t| t.gold).unwrap_or(0) as f64),
        "model.dungeon.tiers" => Ok(cfg.dungeon.tiers as f64),
        "model.dungeon.m_hp" => Ok(cfg.dungeon.m_hp as f64),
        "model.dungeon.m_attack" => Ok(cfg.dungeon.m_attack as f64),
        "model.dungeon.m_defense" => Ok(cfg.dungeon.m_defense as f64),
        "model.dungeon.tier_growth" => Ok(cfg.dungeon.tier_growth),
        "model.dungeon.reward_gold" => Ok(cfg.dungeon.reward_gold as f64),
        "model.dungeon.reward_xp" => Ok(cfg.dungeon.reward_xp as f64),
        "model.dungeon.reward_gold_growth" => Ok(cfg.dungeon.reward_gold_growth),
        "model.dungeon.reward_xp_growth" => Ok(cfg.dungeon.reward_xp_growth),
        "model.behavior.casual.sessions_int" => Ok(cfg.behavior.casual.sessions_int as f64),
        "model.behavior.casual.sessions_frac" => Ok(cfg.behavior.casual.sessions_frac),
        "model.behavior.casual.p_dungeon" => Ok(cfg.behavior.casual.p_dungeon),
        "model.behavior.casual.p_upgrade" => Ok(cfg.behavior.casual.p_upgrade),
        "model.behavior.casual.p_training" => Ok(cfg.behavior.casual.p_training),
        "model.behavior.core.sessions_int" => Ok(cfg.behavior.core.sessions_int as f64),
        "model.behavior.core.sessions_frac" => Ok(cfg.behavior.core.sessions_frac),
        "model.behavior.core.p_dungeon" => Ok(cfg.behavior.core.p_dungeon),
        "model.behavior.core.p_upgrade" => Ok(cfg.behavior.core.p_upgrade),
        "model.behavior.core.p_training" => Ok(cfg.behavior.core.p_training),
        "model.behavior.whale.sessions_int" => Ok(cfg.behavior.whale.sessions_int as f64),
        "model.behavior.whale.sessions_frac" => Ok(cfg.behavior.whale.sessions_frac),
        "model.behavior.whale.p_dungeon" => Ok(cfg.behavior.whale.p_dungeon),
        "model.behavior.whale.p_upgrade" => Ok(cfg.behavior.whale.p_upgrade),
        "model.behavior.whale.p_training" => Ok(cfg.behavior.whale.p_training),
        "model.progression.xp_base" => Ok(cfg.progression.xp_base as f64),
        "model.progression.xp_pow" => Ok(cfg.progression.xp_pow),
        "model.progression.level_attack_gain" => Ok(cfg.progression.level_attack_gain as f64),
        "model.progression.level_defense_gain" => Ok(cfg.progression.level_defense_gain as f64),
        "model.progression.level_hp_gain" => Ok(cfg.progression.level_hp_gain as f64),
        "model.progression.upgrade_cost_base" => Ok(cfg.progression.upgrade_cost_base as f64),
        "model.progression.upgrade_cost_num" => Ok(cfg.progression.upgrade_cost_num as f64),
        "model.progression.upgrade_cost_den" => Ok(cfg.progression.upgrade_cost_den as f64),
        "model.progression.upgrade_attack_gain" => Ok(cfg.progression.upgrade_attack_gain as f64),
        "model.churn.p_base" => Ok(cfg.churn.p_base),
        "model.churn.p_stall" => Ok(cfg.churn.p_stall),
        "model.churn.stall_days" => Ok(cfg.churn.stall_days as f64),
        // 掉落数值通道(docs/loot-settlement-design.md):结算已接入,
        // 未配置时缺省 1.0(与 gacha 同口径——写不写都不改变未配置语义)
        "model.loot.rate_mult" => Ok(cfg.loot.as_ref().map(|l| l.rate_mult).unwrap_or(1.0)),
        "model.gacha.base_rate" => Ok(cfg.gacha.as_ref().map(|g| g.base_rate).unwrap_or(0.02)),
        "model.gacha.pity_hard" => Ok(cfg.gacha.as_ref().map(|g| g.pity_hard).unwrap_or(0) as f64),
        "model.gacha.pity_soft_start" => {
            Ok(cfg.gacha.as_ref().map(|g| g.pity_soft_start).unwrap_or(0) as f64)
        }
        "model.gacha.pity_soft_step" => {
            Ok(cfg.gacha.as_ref().map(|g| g.pity_soft_step).unwrap_or(0.0))
        }
        "model.gacha.featured_rate" => {
            Ok(cfg.gacha.as_ref().map(|g| g.featured_rate).unwrap_or(0.0))
        }
        "model.gacha.featured_guarantee" => Ok(cfg
            .gacha
            .as_ref()
            .map(|g| g.featured_guarantee)
            .unwrap_or(0) as f64),
        // 非数值槽:与 apply_numeric 同口径
        "scenario.duration"
        | "model.formulas.xp_needed"
        | "model.dungeon.tier_table"
        | "model.combat.damage_model"
        | "model.loot.tables"
        | "model.loot.on_victory"
        | "model.loot.rewards" => Err(Error::Config(format!(
            "{path}: 该参数不是数值,不可数值读取"
        ))),
        _ => Err(unknown(path)),
    }
}

/// 数值寻址:sweep / override 把一个扫描值写入指定注册表路径。
/// 非数值槽(时长、公式表达式)与未知路径报配置错误。
pub fn apply_numeric(cfg: &mut SimConfig, path: &str, value: f64) -> Result<(), Error> {
    let unsigned = |v: f64, ty: &str| -> Result<f64, Error> {
        if v < 0.0 {
            Err(Error::Config(format!("{path}: {ty} 不能为负(得到 {v})")))
        } else if v > u32::MAX as f64 {
            Err(Error::Config(format!(
                "{path}: {ty} 不能超过 u32 上限(得到 {v})"
            )))
        } else {
            Ok(v)
        }
    };
    // u64 槽位安全整数门(WB-03.08):f64 在 2^53 之外整数值会静默舍入,
    // seed / 保底抽数是确定性语义,错 1 就是另一个实验——明确拒绝不静默。
    let exact_u64 = |v: f64, ty: &str| -> Result<f64, Error> {
        // 不复用 unsigned:u64 槽(seed/保底抽数)合法值域到 2^53−1,
        // u32 上界只属于 u32 槽,先经 unsigned 会把大 seed 误报成 u32 超限。
        if v < 0.0 {
            Err(Error::Config(format!("{path}: {ty} 不能为负(得到 {v})")))
        } else if v > 9_007_199_254_740_991.0 {
            Err(Error::Config(format!(
                "{path}: {ty} 超出安全整数上限 2^53−1(得到 {v}),请在 YAML 直接编辑,不静默舍入"
            )))
        } else {
            Ok(v)
        }
    };
    // F64 槽门(与 validate 的「非负有限」一致):pity_soft_step 是概率增量
    // f64,合法值域为非负有限数——不得套 u32 上界门(u32 上界只属于 u32 槽),
    // 否则同一参数经 YAML 直配与 apply_numeric 两条入口行为不一致。
    let finite_nonneg = |v: f64, ty: &str| -> Result<f64, Error> {
        if !v.is_finite() || v < 0.0 {
            Err(Error::Config(format!(
                "{path}: {ty} 必须为非负有限数(得到 {v})"
            )))
        } else {
            Ok(v)
        }
    };
    // 只拒绝非有限(NaN/Inf):cohort_weights 是人群配比,validate 允许单项为负
    // (只要求每项有限且总和 > 0),故不套非负门,只挡会污染仿真的 NaN/Inf。
    let finite_only = |v: f64, ty: &str| -> Result<f64, Error> {
        if !v.is_finite() {
            Err(Error::Config(format!(
                "{path}: {ty} 必须为有限数(得到 {v})"
            )))
        } else {
            Ok(v)
        }
    };
    match path {
        "scenario.population" => cfg.players = unsigned(value, "population")?.round() as u32,
        "scenario.seed" => cfg.base_seed = exact_u64(value, "seed")?.round() as u64,
        "scenario.population_mix.casual" => {
            cfg.cohort_weights[0] = finite_only(value, "population_mix.casual")?
        }
        "scenario.population_mix.core" => {
            cfg.cohort_weights[1] = finite_only(value, "population_mix.core")?
        }
        "scenario.population_mix.whale" => {
            cfg.cohort_weights[2] = finite_only(value, "population_mix.whale")?
        }
        "model.warrior.attack" => cfg.warrior.attack = value.round() as i64,
        "model.warrior.defense" => cfg.warrior.defense = value.round() as i64,
        "model.warrior.hp" => cfg.warrior.hp = value.round() as i64,
        "model.whale_gain_mult" => cfg.whale_gain_mult = value.round() as i64,
        "model.combat.p_hit" => cfg.combat.p_hit = finite_nonneg(value, "p_hit")?,
        "model.combat.p_hit_monster" => {
            cfg.combat.p_hit_monster = finite_nonneg(value, "p_hit_monster")?
        }
        "model.combat.dmg_var" => cfg.combat.dmg_var = value.round() as i64,
        "model.combat.max_rounds" => {
            cfg.combat.max_rounds = unsigned(value, "max_rounds")?.round() as u32
        }
        "model.combat.ratio_k" => cfg.combat.ratio_k = finite_nonneg(value, "ratio_k")?,
        "model.training.xp" => {
            cfg.training
                .get_or_insert_with(crate::config::TrainingConfig::default)
                .xp = value.round() as i64;
        }
        "model.training.gold" => {
            cfg.training
                .get_or_insert_with(crate::config::TrainingConfig::default)
                .gold = value.round() as i64;
        }
        "model.dungeon.tiers" => cfg.dungeon.tiers = unsigned(value, "tiers")?.round() as u32,
        "model.dungeon.m_hp" => cfg.dungeon.m_hp = value.round() as i64,
        "model.dungeon.m_attack" => cfg.dungeon.m_attack = value.round() as i64,
        "model.dungeon.m_defense" => cfg.dungeon.m_defense = value.round() as i64,
        "model.dungeon.tier_growth" => {
            cfg.dungeon.tier_growth = finite_nonneg(value, "tier_growth")?
        }
        "model.dungeon.reward_gold" => cfg.dungeon.reward_gold = value.round() as i64,
        "model.dungeon.reward_xp" => cfg.dungeon.reward_xp = value.round() as i64,
        "model.dungeon.reward_gold_growth" => {
            cfg.dungeon.reward_gold_growth = finite_nonneg(value, "reward_gold_growth")?
        }
        "model.dungeon.reward_xp_growth" => {
            cfg.dungeon.reward_xp_growth = finite_nonneg(value, "reward_xp_growth")?
        }
        "model.behavior.casual.sessions_int" => {
            cfg.behavior.casual.sessions_int = unsigned(value, "sessions_int")?.round() as u32
        }
        "model.behavior.casual.sessions_frac" => {
            cfg.behavior.casual.sessions_frac =
                finite_nonneg(value, "behavior.casual.sessions_frac")?
        }
        "model.behavior.casual.p_dungeon" => {
            cfg.behavior.casual.p_dungeon = finite_nonneg(value, "behavior.casual.p_dungeon")?
        }
        "model.behavior.casual.p_upgrade" => {
            cfg.behavior.casual.p_upgrade = finite_nonneg(value, "behavior.casual.p_upgrade")?
        }
        "model.behavior.casual.p_training" => {
            cfg.behavior.casual.p_training = finite_nonneg(value, "behavior.casual.p_training")?
        }
        "model.behavior.core.sessions_int" => {
            cfg.behavior.core.sessions_int = unsigned(value, "sessions_int")?.round() as u32
        }
        "model.behavior.core.sessions_frac" => {
            cfg.behavior.core.sessions_frac = finite_nonneg(value, "behavior.core.sessions_frac")?
        }
        "model.behavior.core.p_dungeon" => {
            cfg.behavior.core.p_dungeon = finite_nonneg(value, "behavior.core.p_dungeon")?
        }
        "model.behavior.core.p_upgrade" => {
            cfg.behavior.core.p_upgrade = finite_nonneg(value, "behavior.core.p_upgrade")?
        }
        "model.behavior.core.p_training" => {
            cfg.behavior.core.p_training = finite_nonneg(value, "behavior.core.p_training")?
        }
        "model.behavior.whale.sessions_int" => {
            cfg.behavior.whale.sessions_int = unsigned(value, "sessions_int")?.round() as u32
        }
        "model.behavior.whale.sessions_frac" => {
            cfg.behavior.whale.sessions_frac = finite_nonneg(value, "behavior.whale.sessions_frac")?
        }
        "model.behavior.whale.p_dungeon" => {
            cfg.behavior.whale.p_dungeon = finite_nonneg(value, "behavior.whale.p_dungeon")?
        }
        "model.behavior.whale.p_upgrade" => {
            cfg.behavior.whale.p_upgrade = finite_nonneg(value, "behavior.whale.p_upgrade")?
        }
        "model.behavior.whale.p_training" => {
            cfg.behavior.whale.p_training = finite_nonneg(value, "behavior.whale.p_training")?
        }
        "model.progression.xp_base" => cfg.progression.xp_base = value.round() as i64,
        "model.progression.xp_pow" => cfg.progression.xp_pow = finite_nonneg(value, "xp_pow")?,
        "model.progression.level_attack_gain" => {
            cfg.progression.level_attack_gain = value.round() as i64
        }
        "model.progression.level_defense_gain" => {
            cfg.progression.level_defense_gain = value.round() as i64
        }
        "model.progression.level_hp_gain" => cfg.progression.level_hp_gain = value.round() as i64,
        "model.progression.upgrade_cost_base" => {
            cfg.progression.upgrade_cost_base = value.round() as i64
        }
        "model.progression.upgrade_cost_num" => {
            cfg.progression.upgrade_cost_num = value.round() as i64
        }
        "model.progression.upgrade_cost_den" => {
            cfg.progression.upgrade_cost_den = value.round() as i64
        }
        "model.progression.upgrade_attack_gain" => {
            cfg.progression.upgrade_attack_gain = value.round() as i64
        }
        "model.churn.p_base" => cfg.churn.p_base = finite_nonneg(value, "p_base")?,
        "model.churn.p_stall" => cfg.churn.p_stall = finite_nonneg(value, "p_stall")?,
        "model.churn.stall_days" => {
            cfg.churn.stall_days = unsigned(value, "stall_days")?.round() as u32
        }
        "model.loot.rate_mult" => {
            cfg.loot
                .get_or_insert_with(crate::config::LootConfig::default)
                .rate_mult = finite_nonneg(value, "rate_mult")?;
        }
        "model.gacha.base_rate" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .base_rate = finite_nonneg(value, "base_rate")?;
        }
        "model.gacha.pity_hard" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .pity_hard = exact_u64(value, "pity_hard")?.round() as u64;
        }
        "model.gacha.pity_soft_start" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .pity_soft_start = exact_u64(value, "pity_soft_start")?.round() as u64;
        }
        "model.gacha.pity_soft_step" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .pity_soft_step = finite_nonneg(value, "pity_soft_step")?;
        }
        "model.gacha.featured_rate" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .featured_rate = finite_nonneg(value, "featured_rate")?;
        }
        "model.gacha.featured_guarantee" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .featured_guarantee = exact_u64(value, "featured_guarantee")?.round() as u64;
        }
        // 非数值槽:不可数值扫描(时长是字符串,公式是表达式,逐层表是数组,
        // 伤害口径是枚举开关,掉落结构面是字符串/映射)
        "scenario.duration"
        | "model.formulas.xp_needed"
        | "model.dungeon.tier_table"
        | "model.combat.damage_model"
        | "model.loot.tables"
        | "model.loot.on_victory"
        | "model.loot.rewards" => {
            return Err(Error::Config(format!(
                "{path}: 该参数不是数值,不可数值扫描"
            )));
        }
        _ => return Err(unknown(path)),
    }
    Ok(())
}

/// 读 u64 槽位的原始整数值(WB-03.08 无损通道):u64 经 [`read_numeric`]
/// 的 f64 会在 2^53 之外静默舍入,seed / 保底抽数要原始通道;桥接层对
/// 超出 JS 安全整数的值以十进制字符串无损表达。非 u64 路径返回 None。
pub fn read_u64_raw(cfg: &SimConfig, path: &str) -> Option<u64> {
    match path {
        "scenario.seed" => Some(cfg.base_seed),
        "model.gacha.pity_hard" => Some(cfg.gacha.as_ref().map(|g| g.pity_hard).unwrap_or(0)),
        "model.gacha.pity_soft_start" => {
            Some(cfg.gacha.as_ref().map(|g| g.pity_soft_start).unwrap_or(0))
        }
        "model.gacha.featured_guarantee" => Some(
            cfg.gacha
                .as_ref()
                .map(|g| g.featured_guarantee)
                .unwrap_or(0),
        ),
        _ => None,
    }
}

pub(super) fn key_str(k: &Value) -> Result<String, Error> {
    k.as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| Error::Config("配置键必须为字符串".into()))
}

pub(super) fn unknown(path: &str) -> Error {
    let sugg = suggestions(path);
    if sugg.is_empty() {
        Error::Config(format!("{path}: 未知参数(注册表中无相近路径)"))
    } else {
        Error::Config(format!(
            "{path}: 未知参数,你是否想写 {}?注册表中相近路径: {}",
            sugg[0],
            sugg.join(" / ")
        ))
    }
}
