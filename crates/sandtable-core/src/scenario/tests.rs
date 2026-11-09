use super::file::parse_duration;
use super::*;
use crate::config::config_hash;
use crate::config::{SimConfig, WarriorConfig};
use crate::optimize::Direction;
use crate::sweep::{SweepMode, TargetKind};

const FULL: &str = include_str!("../../tests/fixtures/scenario_full.yaml");

#[test]
fn key_order_and_comments_do_not_affect_hash() {
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
fn full_template_equals_default() {
    let cfg = load_str(FULL).unwrap();
    assert_eq!(config_hash(&cfg), config_hash(&SimConfig::default()));
}

#[test]
fn partial_override_rest_defaults() {
    let cfg = load_str(
        r#"schema_version: "1"
scenario:
  population: 500
model:
  churn:
    p_stall: 0.2
  warrior:
    attack: 90
"#,
    )
    .unwrap();
    assert_eq!(cfg.players, 500);
    assert_eq!(cfg.days, 30);
    assert_eq!(cfg.churn.p_stall, 0.2);
    assert_eq!(cfg.churn.p_base, SimConfig::default().churn.p_base);
    // warrior 部分覆盖:只给 attack 时 defense / hp 回退默认,不能被清零
    // (example_yaml 承诺「省略任何节或字段都会回退默认值」)
    assert_eq!(cfg.warrior.attack, 90);
    assert_eq!(cfg.warrior.defense, SimConfig::default().warrior.defense);
    assert_eq!(cfg.warrior.hp, SimConfig::default().warrior.hp);
}

#[test]
fn warrior_default_is_single_sourced() {
    // WarriorConfig::Default 曾 derive 成全零,与 SimConfig::default() 的
    // 100/80/1000 分叉;部分覆盖小节时兄弟字段就静默归零。这里锁同源。
    let d = SimConfig::default();
    let w = WarriorConfig::default();
    assert_eq!((w.attack, w.defense, w.hp), (100, 80, 1000));
    assert_eq!(
        (w.attack, w.defense, w.hp),
        (d.warrior.attack, d.warrior.defense, d.warrior.hp)
    );
}

#[test]
fn missing_schema_version_rejected() {
    let err = load_str("scenario:\n  population: 10\n").unwrap_err();
    assert!(err.to_string().contains("schema_version"));
}

#[test]
fn load_config_accepts_experiment_sections() {
    // 校验通道接受实验 YAML:sweep / optimize 节摘出后基础配置同口径校验
    let cfg = load_config_str(
        r#"schema_version: "1"
scenario: {population: 40, duration: "3d", seed: 7}
model:
  warrior:
    attack: 100
sweep:
  mode: grid
  replicates: 2
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
  targets:
    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}
"#,
    )
    .unwrap();
    assert_eq!(cfg.players, 40);
    assert_eq!(cfg.days, 3);
    // 与直载同一份基础配置逐字段等价(config_hash 同源)
    let base = load_str(
        r#"schema_version: "1"
scenario: {population: 40, duration: "3d", seed: 7}
model:
  warrior:
    attack: 100
"#,
    )
    .unwrap();
    assert_eq!(
        crate::config::config_hash(&cfg),
        crate::config::config_hash(&base),
        "实验节不进配置身份"
    );
}

#[test]
fn load_config_still_rejects_unknown_params() {
    // sweep 节已整体摘出,节内非法路径由 load_experiment_str 报,本通道放行
    load_config_str(
        r#"schema_version: "1"
scenario: {population: 40, duration: "3d", seed: 7}
model:
  warrior:
    attack: 100
sweep:
  parameters:
    model.warrior.atk: {min: 1, max: 2, step: 1}
"#,
    )
    .unwrap();
    // 基础树里的未知顶层键仍然拦截(校验通道不是随便什么都放行)
    let err = load_config_str(
        r#"schema_version: "1"
scenario: {population: 40, duration: "3d", seed: 7}
extra: {a: 1}
"#,
    )
    .unwrap_err();
    assert!(err.to_string().contains("extra"), "{}", err);
}

#[test]
fn duration_formats() {
    assert_eq!(parse_duration("30d").unwrap(), 30);
    assert!(parse_duration("30").is_err());
    assert!(parse_duration("1w").is_err());
    assert!(parse_duration("0d").is_err());
}

#[test]
fn mix_invalid_value_rejected() {
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
fn behavior_named_cohort_overrides() {
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
fn formula_override_and_invalid_rejected() {
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
fn example_templates_load() {
    let cfg = load_str(&example_yaml()).unwrap();
    assert_eq!(config_hash(&cfg), config_hash(&SimConfig::default()));
}

/// 遗留字段 reward_growth(文档 21 阻力 #2 拆分前写法):载入时同时
/// 填入 gold / xp 两个新字段(旧配置语义不变);新字段显式给出时优先;
/// 遗留字段不进注册表数值通道。
#[test]
fn legacy_reward_growth_maps_two_rates() {
    let cfg = load_str(
        r#"schema_version: "1"
model:
  dungeon:
    reward_growth: 1.31
"#,
    )
    .unwrap();
    assert_eq!(cfg.dungeon.reward_gold_growth, 1.31);
    assert_eq!(cfg.dungeon.reward_xp_growth, 1.31);

    let cfg = load_str(
        r#"schema_version: "1"
model:
  dungeon:
    reward_growth: 1.31
    reward_gold_growth: 1.26
"#,
    )
    .unwrap();
    assert_eq!(cfg.dungeon.reward_gold_growth, 1.26);
    assert_eq!(cfg.dungeon.reward_xp_growth, 1.31);

    assert!(crate::registry::lookup("model.dungeon.reward_growth").is_none());
}

/// 逐层数组(文档 21 阻力 #3):三维逐格覆盖几何推导;产出缺省回退几何;
/// 层数与数组长度必须一致,hp 须为正。
#[test]
fn tier_table_override_and_validation() {
    let yaml = |tiers: u32| {
        format!(
            r#"schema_version: "1"
model:
  dungeon:
    tiers: {tiers}
    reward_gold: 100
    reward_gold_growth: 1.5
    tier_table:
      - {{hp: 100, attack: 50, defense: 10}}
      - {{hp: 200, attack: 60, defense: 20, gold: 999}}
"#
        )
    };
    let cfg = load_str(&yaml(2)).unwrap();
    let m0 = crate::systems::combat::monster_of(&cfg, 0);
    let m1 = crate::systems::combat::monster_of(&cfg, 1);
    assert_eq!((m0.hp, m0.attack, m0.defense), (100, 50, 10));
    assert_eq!((m1.hp, m1.attack, m1.defense), (200, 60, 20));
    // 产出缺省回退几何,显式行取表值
    assert_eq!(m0.gold, 100);
    assert_eq!(m1.gold, 999);
    // 表长越界回退几何(防御性;validate 已保证表长 = tiers)。
    // 回退式 = m_hp · tier_growth^tier;期望值从载入配置读缺省参数再套同一
    // 公式(62e1185 起缺省 m_hp 300→250、tier_growth 1.5→1.3,硬编码旧缺省
    // 会随 retune 再碎一次),断言的是「回退按几何增长」这一契约本身。
    let m5 = crate::systems::combat::monster_of(&cfg, 5);
    let g5 = cfg.dungeon.tier_growth.powi(5);
    assert_eq!(m5.hp, (cfg.dungeon.m_hp as f64 * g5) as i64);

    let err = load_str(&yaml(8)).unwrap_err();
    assert!(err.to_string().contains("tier_table"), "{err}");

    let err = load_str(
        r#"schema_version: "1"
model:
  dungeon:
    tiers: 1
    tier_table:
      - {hp: 0, attack: 50, defense: 10}
"#,
    )
    .unwrap_err();
    assert!(err.to_string().contains("hp"), "{err}");
}

/// 掉落面(文档 24 章 R1):结算已接入仿真(loot_gold_per_player 等
/// 指标),配置了 loot 的 YAML 正常加载(注释曾写「未接入被拒」,与
/// 现实相反,I-033 更正);未配置时为 None(不进 canonical JSON)。
/// 契约改动见 docs/review 整改记录。
#[test]
fn loot_yaml_roundtrip() {
    // 配置了 loot(带 on_victory / rewards):结算已接入,加载通过
    let cfg = load_str(
        r#"schema_version: "1"
scenario:
  population: 100
  duration: "3d"
model:
  loot:
    rate_mult: 1.5
    on_victory: chest
    tables:
      chest:
        weights:
          gold_small: 70
          gold_mid: 25
          xp_charm: 5
      bag:
        weights:
          coin: 99
          charm: 1
    rewards:
      gold_small: { gold: 10, xp: 0 }
      gold_mid: { gold: 50, xp: 0 }
      xp_charm: { gold: 0, xp: 20 }
      coin: { gold: 1, xp: 0 }
      charm: { gold: 0, xp: 1 }
"#,
    )
    .expect("loot 配置应可加载(结算已接入)");
    let loot = cfg.loot.as_ref().expect("loot 应被保留(不得静默丢弃)");
    assert!((loot.rate_mult - 1.5).abs() < 1e-12);
    assert_eq!(loot.on_victory, "chest");
    assert_eq!(loot.tables.len(), 2);
    let chest = &loot.tables["chest"];
    assert_eq!(chest.weights.len(), 3);
    assert_eq!(chest.weights["gold_small"], 70.0);
    assert_eq!(chest.weights["gold_mid"], 25.0);
    assert_eq!(chest.weights["xp_charm"], 5.0);
    assert_eq!(loot.tables["bag"].weights["charm"], 1.0);
    assert_eq!(loot.rewards["gold_mid"].gold, 50);
    assert_eq!(loot.rewards["xp_charm"].xp, 20);
    // 数值通道随结算接入重开:rate_mult 可读可写
    //(参数表导出 / 合并 / sweep 数值轴恢复该槽,先测后码见设计文档)
    assert!(
        (crate::registry::read_numeric(&cfg, "model.loot.rate_mult").unwrap() - 1.5).abs() < 1e-12
    );
    let mut cfg2 = cfg.clone();
    crate::registry::apply_numeric(&mut cfg2, "model.loot.rate_mult", 2.0)
        .expect("通道重开,应可写");

    // 未配置 loot → None
    let plain = load_str(
        r#"schema_version: "1"
scenario:
  population: 100
  duration: "3d"
"#,
    )
    .unwrap();
    assert!(plain.loot.is_none());

    // 坏权重(全零)在加载期报错
    let err = load_str(
        r#"schema_version: "1"
scenario:
  population: 100
  duration: "3d"
model:
  loot:
    tables:
      bad:
        weights:
          a: 0
"#,
    )
    .unwrap_err();
    assert!(err.to_string().contains("权重"), "{err}");
}

/// 抽卡面(文档 24 章 R2):model.gacha YAML 进 cfg,四个保底参数
/// 完整保留;未配置时为 None;base_rate 可经数值通道读写(镜像口径)。
#[test]
fn gacha_yaml_roundtrip() {
    let cfg = load_str(
        r#"schema_version: "1"
scenario:
  population: 100
  duration: "3d"
model:
  gacha:
    base_rate: 0.02
    pity_hard: 50
    pity_soft_start: 40
    pity_soft_step: 0.05
"#,
    )
    .unwrap();
    let g = cfg.gacha.as_ref().expect("gacha 应被加载(不得静默丢弃)");
    assert_eq!(g.base_rate, 0.02);
    assert_eq!(g.pity_hard, 50);
    assert_eq!(g.pity_soft_start, 40);
    assert_eq!(g.pity_soft_step, 0.05);
    // 数值通道读写(镜像口径)
    assert_eq!(
        crate::registry::read_numeric(&cfg, "model.gacha.pity_hard").unwrap(),
        50.0
    );
    let mut cfg2 = cfg.clone();
    crate::registry::apply_numeric(&mut cfg2, "model.gacha.pity_hard", 90.0).unwrap();
    assert_eq!(cfg2.gacha.as_ref().unwrap().pity_hard, 90);
    // 未配置 gacha 的场景也允许 apply(槽位 get_or_insert)
    crate::registry::apply_numeric(&mut cfg2, "model.gacha.pity_soft_start", 70.0).unwrap();
    assert_eq!(cfg2.gacha.as_ref().unwrap().pity_soft_start, 70);

    // 未配置 gacha → None;数值槽读缺省
    let plain = load_str(
        r#"schema_version: "1"
scenario:
  population: 100
  duration: "3d"
"#,
    )
    .unwrap();
    assert!(plain.gacha.is_none());
    assert_eq!(
        crate::registry::read_numeric(&plain, "model.gacha.base_rate").unwrap(),
        0.02
    );

    // base_rate ≤ 0 在加载期报错(防永不终止)
    let err = load_str(
        r#"schema_version: "1"
scenario:
  population: 100
  duration: "3d"
model:
  gacha:
    base_rate: 0
"#,
    )
    .unwrap_err();
    assert!(err.to_string().contains("base_rate"), "{err}");
}

/// 实验文件(docs 10/12 章):scenario + model + sweep 三节齐全,
/// sweep 节不进注册表树校验,但参数路径经 spec 校验查注册表。
#[test]
fn experiment_full_sections_grid_and_overrides() {
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
fn experiment_missing_sweep_rejected() {
    let e =
        load_experiment_str("schema_version: \"1\"\nscenario:\n  population: 100\n").unwrap_err();
    assert!(e.to_string().contains("sweep"), "{e}");
}

/// 目标可用性预检(审核整改 P1):days 不足时 retention_d7 无值,
/// 加载期报错而不是在 run_candidate 被静默跳过。
#[test]
fn experiment_unavailable_target_rejected_at_load() {
    let e = load_experiment_str(
        r#"schema_version: "1"
scenario:
  population: 200
  duration: "5d"
sweep:
  replicates: 2
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
  targets:
    - metric: retention_d7
      min: 0.5
"#,
    )
    .unwrap_err();
    assert!(e.to_string().contains("retention_d7"), "{e}");

    // gacha 指标:未配置 model.gacha 时同样加载期报错
    let e = load_optimize_str(
        r#"schema_version: "1"
scenario:
  population: 200
  duration: "30d"
optimize:
  mode: evolutionary
  population: 6
  generations: 2
  replicates: 2
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
  objective:
    metric: gacha_pulls_to_hit
"#,
    )
    .unwrap_err();
    assert!(e.to_string().contains("gacha_pulls_to_hit"), "{e}");
}

/// 寻优实验(docs 12 章自动寻优):scenario + model + optimize 三节,
/// 字段缺省值与 objective 方向缺省 maximize;与 sweep 节互斥。
#[test]
fn experiment_optimize_section_exclusive() {
    let (cfg, spec) = load_optimize_str(
        r#"schema_version: "1"
scenario:
  population: 200
  duration: "10d"
model:
  warrior: {attack: 100, defense: 80, hp: 1000}
optimize:
  mode: evolutionary
  population: 6
  generations: 4
  replicates: 2
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
  targets:
    - metric: churn_rate
      max: 0.3
  objective:
    metric: power_p50
"#,
    )
    .unwrap();
    assert_eq!(cfg.players, 200);
    assert_eq!(spec.population, 6);
    assert_eq!(spec.generations, 4);
    assert_eq!(spec.replicates, 2);
    assert_eq!(spec.parameters.len(), 1);
    assert_eq!(spec.targets.len(), 1);
    // 缺省值:elite 2 / mutation 0.3 / 0.2 / direction maximize
    assert_eq!(spec.elite, 2);
    assert_eq!(spec.mutation_rate, 0.3);
    assert_eq!(spec.mutation_scale, 0.2);
    let obj = spec.objective.unwrap();
    assert_eq!(obj.direction, Direction::Maximize);

    // 与 sweep 节互斥(两个方向都报)
    let both = r#"schema_version: "1"
sweep:
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
optimize:
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
"#;
    let e = load_experiment_str(both).unwrap_err();
    assert!(e.to_string().contains("互斥"), "{e}");
    let e = load_optimize_str(both).unwrap_err();
    assert!(e.to_string().contains("互斥"), "{e}");

    // 缺 optimize 节报错
    let e = load_optimize_str("schema_version: \"1\"\nscenario:\n  population: 100\n").unwrap_err();
    assert!(e.to_string().contains("optimize"), "{e}");

    // 未知指标报错列可选值
    let e = load_optimize_str(
        r#"schema_version: "1"
optimize:
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
  objective:
    metric: dps
"#,
    )
    .unwrap_err();
    assert!(e.to_string().contains("optimize.objective"), "{e}");
}

#[test]
fn experiment_unknown_path_suggests() {
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
fn experiment_unknown_metric_lists_options() {
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
fn experiment_random_mode_defaults_and_override() {
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
fn experiment_range_missing_step_rejected() {
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
