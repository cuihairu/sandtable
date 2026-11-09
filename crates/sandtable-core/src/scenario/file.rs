//! 场景 YAML 的文档面(文档 03 章):scenario / model 节结构与编译
//! (into_config → SimConfig + 语义校验)。

use serde::Deserialize;

use crate::config::{
    validate, BehaviorConfig, ChurnConfig, CombatConfig, DungeonConfig, FormulaConfig,
    ProgressionConfig, SimConfig, TrainingConfig, WarriorConfig,
};
use crate::Error;

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct PopulationMix {
    casual: f64,
    core: f64,
    whale: f64,
}

#[derive(Debug, Deserialize)]
#[serde(default)]
struct ScenarioSection {
    population: u32,
    duration: String,
    population_mix: PopulationMix,
    seed: u64,
}

impl Default for ScenarioSection {
    fn default() -> Self {
        let d = SimConfig::default();
        Self {
            population: d.players,
            duration: format!("{}d", d.days),
            population_mix: PopulationMix {
                casual: d.cohort_weights[0],
                core: d.cohort_weights[1],
                whale: d.cohort_weights[2],
            },
            seed: d.base_seed,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(default)]
struct ModelSection {
    // 注意(2026-11-09 I-034):`model.stage_rules` 有意无字段——工作台
    // 编辑器写入的该节经 registry check_section 形状放行后,在此被 serde
    // 静默丢弃(无 deny_unknown_fields),不进仿真;死配置现状已在
    // registry 特例处与编辑器 UI 显式声明。
    warrior: WarriorConfig,
    whale_gain_mult: i64,
    combat: CombatConfig,
    dungeon: DungeonConfig,
    behavior: BehaviorConfig,
    training: Option<TrainingConfig>,
    progression: ProgressionConfig,
    formulas: FormulaConfig,
    churn: ChurnConfig,
    loot: Option<crate::config::LootConfig>,
    gacha: Option<crate::config::GachaConfig>,
}

impl Default for ModelSection {
    fn default() -> Self {
        let d = SimConfig::default();
        Self {
            warrior: d.warrior,
            whale_gain_mult: d.whale_gain_mult,
            combat: d.combat,
            dungeon: d.dungeon,
            behavior: d.behavior,
            training: d.training,
            progression: d.progression,
            formulas: d.formulas,
            churn: d.churn,
            loot: d.loot,
            gacha: d.gacha,
        }
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
pub(super) struct ScenarioFile {
    scenario: ScenarioSection,
    model: ModelSection,
}

impl ScenarioFile {
    pub(super) fn into_config(self) -> Result<SimConfig, Error> {
        let mut cfg = SimConfig::default();
        let s = self.scenario;
        cfg.players = s.population;
        cfg.days = parse_duration(&s.duration)?;
        cfg.base_seed = s.seed;
        let mix = s.population_mix;
        if mix.casual < 0.0 || mix.core < 0.0 || mix.whale < 0.0 {
            return Err(Error::Config(
                "scenario.population_mix: 占比不能为负".into(),
            ));
        }
        let total = mix.casual + mix.core + mix.whale;
        if total <= 0.0 {
            return Err(Error::Config(
                "scenario.population_mix: 占比之和必须大于 0".into(),
            ));
        }
        cfg.cohort_weights = [mix.casual, mix.core, mix.whale];

        let m = self.model;
        cfg.warrior = m.warrior;
        cfg.whale_gain_mult = m.whale_gain_mult;
        cfg.combat = m.combat;
        cfg.dungeon = m.dungeon;
        cfg.behavior = m.behavior;
        cfg.training = m.training;
        cfg.progression = m.progression;
        cfg.formulas = m.formulas;
        cfg.churn = m.churn;
        cfg.loot = m.loot;
        cfg.gacha = m.gacha;

        validate(&cfg)?;
        Ok(cfg)
    }
}

/// 时长解析:仅支持 "<N>d"(N ≥ 1)。
pub(super) fn parse_duration(s: &str) -> Result<u32, Error> {
    let Some(num) = s.strip_suffix('d') else {
        return Err(Error::Config(format!(
            "scenario.duration: {s:?} 格式不符,应为 \"<N>d\"(如 \"30d\")"
        )));
    };
    let n: u32 = num
        .parse()
        .map_err(|_| Error::Config(format!("scenario.duration: {s:?} 的天数不是合法整数")))?;
    if n == 0 {
        return Err(Error::Config("scenario.duration: 天数必须 ≥ 1".into()));
    }
    Ok(n)
}
