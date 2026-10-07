//! YAML 场景配置(文档 03/07 章):scenario 节(实验环境)+ model 节(游戏本身)
//! 物理分离;部分覆盖语义——省略的节 / 字段回退默认值。
//!
//! 加载流程:YAML 解析 → 注册表树校验(未知路径报错附建议)→ schema_version
//! 检查 → 反序列化(类型检查)→ duration / population_mix 语义解析 →
//! [`crate::config::validate`]。config_hash 在反序列化后的结构体上计算,
//! 键序与注释天然不影响(文档 07 章)。

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_yaml_ng::Value;

use crate::config::{
    validate, BehaviorConfig, ChurnConfig, CombatConfig, DungeonConfig, FormulaConfig,
    ProgressionConfig, SimConfig, WarriorConfig,
};
use crate::sweep::{ParamRange, SweepMode, SweepSpec, Target, TargetKind};
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
    warrior: WarriorConfig,
    whale_gain_mult: i64,
    combat: CombatConfig,
    dungeon: DungeonConfig,
    behavior: BehaviorConfig,
    progression: ProgressionConfig,
    formulas: FormulaConfig,
    churn: ChurnConfig,
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
            progression: d.progression,
            formulas: d.formulas,
            churn: d.churn,
        }
    }
}

#[derive(Debug, Deserialize, Default)]
#[serde(default)]
struct ScenarioFile {
    scenario: ScenarioSection,
    model: ModelSection,
}

/// 解析 YAML 场景为内部配置(Model 编译产物)。
pub fn load_str(yaml: &str) -> Result<SimConfig, Error> {
    let root: Value =
        serde_yaml_ng::from_str(yaml).map_err(|e| Error::Config(format!("YAML 解析失败: {e}")))?;
    crate::registry::check_tree(&root)?;
    check_schema_version(&root)?;

    let file: ScenarioFile =
        serde_yaml_ng::from_value(root).map_err(|e| Error::Config(format!("配置类型不符: {e}")))?;
    file.into_config()
}

fn check_schema_version(root: &Value) -> Result<(), Error> {
    let sv = root
        .get("schema_version")
        .ok_or_else(|| Error::Config("配置根节点缺少 schema_version(当前支持 \"1\")".into()))?;
    let sv = sv.as_str().ok_or_else(|| {
        Error::Config("schema_version 必须为字符串 \"1\"(YAML 中加引号,避免被解析为数字)".into())
    })?;
    if sv != crate::SCHEMA_VERSION {
        return Err(Error::Config(format!(
            "schema_version 不支持: {sv}(当前支持 {})",
            crate::SCHEMA_VERSION
        )));
    }
    Ok(())
}

/// 扫描参数范围(sweep.parameters 的值;文档 12 章的 map 形式:路径作键)。
#[derive(Debug, Deserialize)]
struct RangeSpec {
    min: f64,
    max: f64,
    step: f64,
}

/// 约束目标(sweep.targets 的项;metric 用 [`crate::experiment::MetricKey`]
/// 的名字,kind 缺省 hard)。
#[derive(Debug, Deserialize)]
struct TargetYaml {
    metric: String,
    min: Option<f64>,
    max: Option<f64>,
    #[serde(default)]
    kind: TargetKind,
}

/// Experiment 文件的 sweep 节(文档 10/12 章)。parameters 用 map 形式,
/// 键即注册表路径;这里的形状是 YAML 面,经 [`load_experiment_str`]
/// 翻译为 [`SweepSpec`] 后交给扫描引擎。
#[derive(Debug, Deserialize)]
#[serde(default)]
struct SweepSection {
    mode: SweepMode,
    /// 复跑数缺省 5(文档 11 章:R 默认 5–10)
    replicates: u32,
    samples: u32,
    parameters: BTreeMap<String, RangeSpec>,
    targets: Vec<TargetYaml>,
}

impl Default for SweepSection {
    fn default() -> Self {
        Self {
            mode: SweepMode::default(),
            replicates: 5,
            samples: 0,
            parameters: BTreeMap::new(),
            targets: Vec::new(),
        }
    }
}

impl SweepSection {
    fn into_spec(self) -> Result<SweepSpec, Error> {
        let parameters = self
            .parameters
            .into_iter()
            .map(|(path, r)| ParamRange {
                path,
                min: r.min,
                max: r.max,
                step: r.step,
            })
            .collect();
        let targets = self
            .targets
            .into_iter()
            .map(|t| {
                let metric = crate::experiment::MetricKey::parse(&t.metric).ok_or_else(|| {
                    Error::Config(format!(
                        "sweep.targets: 未知指标 {:?},可选: {:?}",
                        t.metric,
                        crate::experiment::MetricKey::ALL.map(|k| k.name())
                    ))
                })?;
                Ok(Target {
                    metric,
                    min: t.min,
                    max: t.max,
                    kind: t.kind,
                })
            })
            .collect::<Result<Vec<_>, Error>>()?;
        Ok(SweepSpec {
            mode: self.mode,
            parameters,
            replicates: self.replicates,
            samples: self.samples,
            targets,
        })
    }
}

/// 解析 YAML 实验文件为 (基础配置, 扫描定义)。
///
/// 与 [`load_str`] 同一套加载纪律:schema_version 检查 → 注册表树校验
/// (sweep 节有自己的 schema,摘出后不进注册表树;其参数路径由
/// [`SweepSpec::validate`] 逐条查注册表)→ 反序列化 → 语义校验。
pub fn load_experiment_str(yaml: &str) -> Result<(SimConfig, SweepSpec), Error> {
    let root: Value =
        serde_yaml_ng::from_str(yaml).map_err(|e| Error::Config(format!("YAML 解析失败: {e}")))?;
    check_schema_version(&root)?;

    let sweep_value = root.get("sweep").ok_or_else(|| {
        Error::Config(
            "实验文件缺少 sweep 节(见文档 12 章:mode / parameters / replicates / targets)".into(),
        )
    })?;
    let sweep: SweepSection = serde_yaml_ng::from_value(sweep_value.clone())
        .map_err(|e| Error::Config(format!("sweep 节解析失败: {e}")))?;
    let spec = sweep.into_spec()?;

    // 注册表树校验只看 scenario / model;sweep 的参数路径走 spec 校验
    let mut cfg_root = root.clone();
    if let Some(m) = cfg_root.as_mapping_mut() {
        m.swap_remove(Value::from("sweep"));
    }
    crate::registry::check_tree(&cfg_root)?;

    let file: ScenarioFile = serde_yaml_ng::from_value(cfg_root)
        .map_err(|e| Error::Config(format!("配置类型不符: {e}")))?;
    let cfg = file.into_config()?;
    spec.validate()?;
    Ok((cfg, spec))
}

impl ScenarioFile {
    fn into_config(self) -> Result<SimConfig, Error> {
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
        cfg.progression = m.progression;
        cfg.formulas = m.formulas;
        cfg.churn = m.churn;

        validate(&cfg)?;
        Ok(cfg)
    }
}

/// 时长解析:仅支持 "<N>d"(N ≥ 1)。
fn parse_duration(s: &str) -> Result<u32, Error> {
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
    reward_growth: {reward_growth}

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
        reward_growth = d.dungeon.reward_growth,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::config_hash;

    const FULL: &str = include_str!("../tests/fixtures/scenario_full.yaml");

    #[test]
    fn 键序与注释不影响_hash() {
        let a = load_str(FULL).unwrap();
        // 同一配置:键序打乱 + 注释与空白不同
        let b = load_str(
            r#"# 注释在前
model:
  churn: {stall_days: 2, p_stall: 0.05, p_base: 0.003}
  warrior: {hp: 1000, defense: 80, attack: 100}
scenario:
  seed: 12345
  population_mix: {casual: 0.6, core: 0.3, whale: 0.1}
  duration: "30d"
  population: 10000
schema_version: "1"
"#,
        )
        .unwrap();
        assert_eq!(config_hash(&a), config_hash(&b));
    }

    #[test]
    fn 完整模板与默认配置等价() {
        let cfg = load_str(FULL).unwrap();
        assert_eq!(config_hash(&cfg), config_hash(&SimConfig::default()));
    }

    #[test]
    fn 部分覆盖_其余回退默认() {
        let cfg = load_str(
            r#"schema_version: "1"
scenario:
  population: 500
model:
  churn:
    p_stall: 0.2
"#,
        )
        .unwrap();
        assert_eq!(cfg.players, 500);
        assert_eq!(cfg.days, 30);
        assert_eq!(cfg.churn.p_stall, 0.2);
        assert_eq!(cfg.churn.p_base, SimConfig::default().churn.p_base);
        assert_eq!(cfg.warrior.attack, 100);
    }

    #[test]
    fn 缺少_schema_version_报错() {
        let err = load_str("scenario:\n  population: 10\n").unwrap_err();
        assert!(err.to_string().contains("schema_version"));
    }

    #[test]
    fn duration_格式() {
        assert_eq!(parse_duration("30d").unwrap(), 30);
        assert!(parse_duration("30").is_err());
        assert!(parse_duration("1w").is_err());
        assert!(parse_duration("0d").is_err());
    }

    #[test]
    fn mix_非法值报错() {
        let err = load_str(
            r#"schema_version: "1"
scenario:
  population_mix: {casual: -0.1, core: 0.3, whale: 0.1}
"#,
        )
        .unwrap_err();
        assert!(err.to_string().contains("population_mix"));
        let err = load_str(
            r#"schema_version: "1"
scenario:
  population_mix: {casual: 0, core: 0, whale: 0}
"#,
        )
        .unwrap_err();
        assert!(err.to_string().contains("population_mix"));
    }

    #[test]
    fn behavior_按分群命名覆盖() {
        let cfg = load_str(
            r#"schema_version: "1"
model:
  behavior:
    whale:
      sessions_int: 8
"#,
        )
        .unwrap();
        assert_eq!(cfg.behavior.whale.sessions_int, 8);
        assert_eq!(cfg.behavior.casual.sessions_int, 1);
        assert_eq!(
            cfg.behavior.whale.p_dungeon,
            SimConfig::default().behavior.whale.p_dungeon
        );
    }

    /// 公式槽:YAML 覆盖进入配置;非法表达式在加载期(validate)报槽名。
    #[test]
    fn 公式覆盖与非法公式报错() {
        let cfg = load_str(
            r#"schema_version: "1"
model:
  formulas:
    xp_needed: "level * 10"
"#,
        )
        .unwrap();
        assert_eq!(cfg.formulas.xp_needed, "level * 10");
        // 未覆盖的公式槽保持默认
        let d = SimConfig::default();
        assert_eq!(d.formulas.xp_needed, "xp_base * level ^ xp_pow");

        let err = load_str(
            r#"schema_version: "1"
model:
  formulas:
    xp_needed: "xp_base * level ^"
"#,
        )
        .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("formulas.xp_needed"), "{msg}");

        // 白名单外的变量同样在加载期报错
        let err = load_str(
            r#"schema_version: "1"
model:
  formulas:
    xp_needed: "xp_base * atk"
"#,
        )
        .unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("atk") && msg.contains("未知变量"), "{msg}");
    }

    /// init 模板本身必须是合法场景(默认值模板可直接运行)。
    #[test]
    fn 示例模板可加载() {
        let cfg = load_str(&example_yaml()).unwrap();
        assert_eq!(config_hash(&cfg), config_hash(&SimConfig::default()));
    }

    /// 实验文件(docs 10/12 章):scenario + model + sweep 三节齐全,
    /// sweep 节不进注册表树校验,但参数路径经 spec 校验查注册表。
    #[test]
    fn 实验文件_三节齐全_网格候选与覆盖生效() {
        let (cfg, spec) = load_experiment_str(
            r#"schema_version: "1"
scenario:
  population: 200
  duration: "10d"
model:
  warrior: {attack: 100, defense: 80, hp: 1000}
sweep:
  replicates: 2
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
  targets:
    - metric: win_rate
      min: 0.3
      max: 0.9
"#,
        )
        .unwrap();
        assert_eq!(cfg.players, 200);
        assert_eq!(cfg.warrior.attack, 100);
        assert_eq!(spec.replicates, 2);
        assert_eq!(spec.parameters.len(), 1);
        assert_eq!(spec.targets.len(), 1);
        assert_eq!(spec.targets[0].kind, TargetKind::Hard);
        let cands = spec.plan(cfg.base_seed).unwrap();
        assert_eq!(cands.len(), 3);
        assert_eq!(cands[0]["model.warrior.attack"], 90.0);
        assert_eq!(cands[2]["model.warrior.attack"], 110.0);
    }

    #[test]
    fn 实验文件_缺_sweep_节报错() {
        let e = load_experiment_str("schema_version: \"1\"\nscenario:\n  population: 100\n")
            .unwrap_err();
        assert!(e.to_string().contains("sweep"), "{e}");
    }

    #[test]
    fn 实验文件_参数路径未知_报错附建议() {
        let e = load_experiment_str(
            r#"schema_version: "1"
sweep:
  parameters:
    model.warrior.atk: {min: 90, max: 110, step: 10}
"#,
        )
        .unwrap_err();
        assert!(
            e.to_string().contains("model.warrior.atk") && e.to_string().contains("attack"),
            "{e}"
        );
    }

    #[test]
    fn 实验文件_未知指标报错列可选值() {
        let e = load_experiment_str(
            r#"schema_version: "1"
sweep:
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
  targets:
    - metric: dps
      min: 0.3
"#,
        )
        .unwrap_err();
        let msg = e.to_string();
        assert!(msg.contains("dps") && msg.contains("win_rate"), "{msg}");
    }

    #[test]
    fn 实验文件_随机模式_默认与覆盖() {
        let (_, spec) = load_experiment_str(
            r#"schema_version: "1"
sweep:
  mode: random
  samples: 9
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 1}
"#,
        )
        .unwrap();
        assert_eq!(spec.mode, SweepMode::Random);
        assert_eq!(spec.replicates, 5, "缺省复跑数 5(文档 11 章)");
        assert_eq!(spec.plan(7).unwrap().len(), 9);
    }

    /// sweep 节内部形状错误(min/max/step 缺失)要清晰报错,
    /// 不能串到 scenario/model 的错误信息上。
    #[test]
    fn 实验文件_范围缺_step_报错() {
        let e = load_experiment_str(
            r#"schema_version: "1"
sweep:
  parameters:
    model.warrior.attack: {min: 90, max: 110}
"#,
        )
        .unwrap_err();
        assert!(
            e.to_string().contains("sweep 节解析失败") || e.to_string().contains("step"),
            "{e}"
        );
    }
}
