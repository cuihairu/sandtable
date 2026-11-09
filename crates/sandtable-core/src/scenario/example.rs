//! 示例场景模板(`sandtable init` 的 YAML,全默认值 + 注释)。

use crate::config::SimConfig;

/// 示例场景(`sandtable init` 的模板):全部默认值 + 注释,可直接编辑后运行。
pub fn example_yaml() -> String {
    let d = SimConfig::default();
    let b = |c: crate::config::Cohort| d.behavior.for_cohort(c);
    format!(
        r#"# Sandtable 场景配置(schema 见 https://cuihairu.github.io/sandtable/)
# 省略任何节或字段都会回退默认值;字符串一律加引号(避免 YAML 类型陷阱)。
schema_version: "1"

# —— Scenario:一次实验如何运行(文档 03 章)——
scenario:
  population: {population}
  duration: "{duration}d"
  population_mix:
    casual: {mix_casual}
    core: {mix_core}
    whale: {mix_whale}
  seed: {seed}

# —— Model:游戏本身(文档 03 章)——
model:
  warrior:
    attack: {attack}
    defense: {defense}
    hp: {hp}
  whale_gain_mult: {whale_mult}   # 金币/经验倍率,MVP 无付费语义

  combat:
    p_hit: {p_hit}
    p_hit_monster: {p_hit_monster}
    dmg_var: {dmg_var}
    max_rounds: {max_rounds}

  dungeon:
    tiers: {tiers}
    m_hp: {m_hp}
    m_attack: {m_attack}
    m_defense: {m_defense}
    tier_growth: {tier_growth}
    reward_gold: {reward_gold}
    reward_xp: {reward_xp}
    reward_gold_growth: {reward_gold_growth}
    reward_xp_growth: {reward_xp_growth}

  behavior:
    casual: {{ sessions_int: {ci_casual}, sessions_frac: {cf_casual}, p_dungeon: {pd_casual}, p_upgrade: {pu_casual} }}
    core:   {{ sessions_int: {ci_core}, sessions_frac: {cf_core}, p_dungeon: {pd_core}, p_upgrade: {pu_core} }}
    whale:  {{ sessions_int: {ci_whale}, sessions_frac: {cf_whale}, p_dungeon: {pd_whale}, p_upgrade: {pu_whale} }}

  progression:
    xp_base: {xp_base}
    xp_pow: {xp_pow}
    level_attack_gain: {la}
    level_defense_gain: {ld}
    level_hp_gain: {lh}
    upgrade_cost_base: {ucb}
    upgrade_cost_num: {ucn}
    upgrade_cost_den: {ucd}
    upgrade_attack_gain: {ua}

  formulas:
    xp_needed: "{xp_formula}"   # 升到下一级所需经验;变量: level, xp_base, xp_pow

  churn:
    p_base: {p_base}
    p_stall: {p_stall}
    stall_days: {stall_days}
"#,
        population = d.players,
        duration = d.days,
        mix_casual = d.cohort_weights[0],
        mix_core = d.cohort_weights[1],
        mix_whale = d.cohort_weights[2],
        seed = d.base_seed,
        attack = d.warrior.attack,
        defense = d.warrior.defense,
        hp = d.warrior.hp,
        whale_mult = d.whale_gain_mult,
        p_hit = d.combat.p_hit,
        p_hit_monster = d.combat.p_hit_monster,
        dmg_var = d.combat.dmg_var,
        max_rounds = d.combat.max_rounds,
        tiers = d.dungeon.tiers,
        m_hp = d.dungeon.m_hp,
        m_attack = d.dungeon.m_attack,
        m_defense = d.dungeon.m_defense,
        tier_growth = d.dungeon.tier_growth,
        reward_gold = d.dungeon.reward_gold,
        reward_xp = d.dungeon.reward_xp,
        reward_gold_growth = d.dungeon.reward_gold_growth,
        reward_xp_growth = d.dungeon.reward_xp_growth,
        ci_casual = b(crate::config::Cohort::Casual).sessions_int,
        cf_casual = b(crate::config::Cohort::Casual).sessions_frac,
        pd_casual = b(crate::config::Cohort::Casual).p_dungeon,
        pu_casual = b(crate::config::Cohort::Casual).p_upgrade,
        ci_core = b(crate::config::Cohort::Core).sessions_int,
        cf_core = b(crate::config::Cohort::Core).sessions_frac,
        pd_core = b(crate::config::Cohort::Core).p_dungeon,
        pu_core = b(crate::config::Cohort::Core).p_upgrade,
        ci_whale = b(crate::config::Cohort::Whale).sessions_int,
        cf_whale = b(crate::config::Cohort::Whale).sessions_frac,
        pd_whale = b(crate::config::Cohort::Whale).p_dungeon,
        pu_whale = b(crate::config::Cohort::Whale).p_upgrade,
        xp_base = d.progression.xp_base,
        xp_pow = d.progression.xp_pow,
        la = d.progression.level_attack_gain,
        ld = d.progression.level_defense_gain,
        lh = d.progression.level_hp_gain,
        ucb = d.progression.upgrade_cost_base,
        ucn = d.progression.upgrade_cost_num,
        ucd = d.progression.upgrade_cost_den,
        ua = d.progression.upgrade_attack_gain,
        xp_formula = d.formulas.xp_needed,
        p_base = d.churn.p_base,
        p_stall = d.churn.p_stall,
        stall_days = d.churn.stall_days,
    )
}
