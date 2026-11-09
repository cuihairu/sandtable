use super::fitness::{dominates, rank_and_crowd, Fitness, ParetoFit};
use super::ranking::cmp_pareto;
use super::spec::Objective;
use super::*;
use crate::config::SimConfig;
use crate::experiment::MetricKey;
use crate::sweep::{
    CandidateResult, CandidateStatus, ConstraintVerdict, ParamRange, Target, TargetKind,
};
use std::collections::BTreeMap;

fn spec() -> OptimSpec {
    OptimSpec {
        mode: OptimMode::Evolutionary,
        // 62e1185 起怪物 m_defense 150:win_rate≥0.5 需攻 ≥~175 才稳胜
        // (tier 0 击杀轮 ≈ 250/(0.85·(A-150)) ≤ 生存 ~14 轮 → A ≥ 171),
        // 原 60–160 全域破不了防、无可行候选;上界提到 250 覆盖可行区。
        parameters: vec![ParamRange {
            path: "model.warrior.attack".into(),
            min: 100.0,
            max: 250.0,
            step: 10.0,
        }],
        replicates: 2,
        population: 6,
        generations: 4,
        elite: 2,
        mutation_rate: 0.3,
        mutation_scale: 0.2,
        targets: vec![Target {
            metric: MetricKey::WinRate,
            min: Some(0.5),
            max: None,
            kind: TargetKind::Hard,
        }],
        objective: Some(Objective {
            metric: MetricKey::PowerP50Final,
            direction: Direction::Maximize,
        }),
        objectives: Vec::new(),
    }
}

/// 小场景基线(测试提速):100 人 × 10 天,默认三围。
fn base() -> SimConfig {
    SimConfig {
        players: 100,
        days: 10,
        ..SimConfig::default()
    }
}

#[test]
fn evolve_finds_feasible_and_moves_toward_target() {
    let base = base();
    let s = spec();
    let r = optimize(&base, &s).unwrap();
    assert_eq!(r.evaluated, 6 + 4 * 4, "初始种群 + 每代子代");
    assert_eq!(r.total_sims, r.evaluated * 2);
    assert_eq!(r.history.len(), 5, "初始 + 4 代");
    let best = r.best.expect("应找到候选");
    assert!(matches!(best.status, CandidateStatus::Ok));
    // 攻击力越高 power 越高;可行域内 win_rate≥0.5 随攻升高(攻 ~175+ 才
    // 稳胜,m_defense 150),hard 约束不约束方向 → 最优可推向域高端
    let atk = best.values["model.warrior.attack"];
    assert!((100.0..=250.0).contains(&atk), "最优值应在域内:{atk}");
    assert!(r.best_fitness.unwrap().hard_pass == 1, "hard 约束应 pass");
    // 目标方向:末代种群最优不劣于初始种群(精英保留的单调性)
    assert!(r.history.last().unwrap().best.score >= r.history[0].best.score);
    // power 随攻击单调 → 最优应偏向域高端(域 100–250 中点 175,收敛性
    // 冒烟,不逐位卡;实测最优 250)
    assert!(atk > 175.0, "maximize power 应把攻击推向高端:{atk}");
}

#[test]
fn evolve_same_seed_same_result() {
    let base = base();
    let s = spec();
    let a = optimize(&base, &s).unwrap();
    let b = optimize(&base, &s).unwrap();
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap()
    );
}

#[test]
fn evolve_config_error_candidates_ranked_last() {
    let base = base();
    let mut s = spec();
    // reward_gold 范围含负值 → 部分候选被 validate 拦截为配置错误
    s.parameters.push(ParamRange {
        path: "model.dungeon.reward_gold".into(),
        min: -100.0,
        max: 100.0,
        step: 10.0,
    });
    s.population = 8;
    let r = optimize(&base, &s).unwrap();
    assert!(r.best.is_some(), "配置错误不该让寻优崩溃");
    // 最优不落在配置错误候选上
    let bf = r.best_fitness.unwrap();
    assert!(bf.score > f64::NEG_INFINITY);
}

/// 全部候选配置错误时,Pareto 模式必须返回可读错误而不是 panic
/// (审核整改 P2:此前 pareto_front().expect 在无有效前沿时崩溃)。
#[test]
fn pareto_all_config_errors_returns_error_not_panic() {
    let base = base();
    let mut s = spec();
    s.mode = OptimMode::Pareto;
    s.objective = None;
    s.objectives = vec![
        Objective {
            metric: MetricKey::PowerP50Final,
            direction: Direction::Maximize,
        },
        Objective {
            metric: MetricKey::GoldPerPlayer,
            direction: Direction::Maximize,
        },
    ];
    // 全域负值:每个候选都被 config::validate 拒绝 → 无有效前沿
    s.parameters = vec![ParamRange {
        path: "model.dungeon.reward_gold".into(),
        min: -100.0,
        max: -10.0,
        step: 5.0,
    }];
    let err = optimize(&base, &s).unwrap_err().to_string();
    assert!(err.contains("无有效前沿"), "{err}");
}

/// 目标可用性兜底(审核整改 P1):绕过加载器直连调用时,days 不足的
/// 指标在 optimize 入口被拦,不再静默缺席。
#[test]
fn optimize_unavailable_metric_rejected() {
    let base = SimConfig {
        players: 100,
        days: 5,
        ..SimConfig::default()
    };
    let mut s = spec(); // targets = win_rate(总可用),改 retention_d7
    s.targets[0].metric = MetricKey::RetentionD7;
    let err = optimize(&base, &s).unwrap_err().to_string();
    assert!(err.contains("retention_d7"), "{err}");
}

#[test]
fn optimize_spec_budget_and_shape() {
    let mut s = spec();
    s.population = 1;
    assert!(s.validate().is_err(), "population ≥ 2");
    let mut s = spec();
    s.elite = s.population;
    assert!(s.validate().is_err(), "elite < population");
    let mut s = spec();
    s.mutation_scale = 1.5;
    assert!(s.validate().is_err(), "mutation_scale ≤ 1");
    let mut s = spec();
    s.mutation_rate = -0.1;
    assert!(s.validate().is_err(), "mutation_rate ∈ [0,1]");
    let mut s = spec();
    s.generations = 0;
    assert!(s.validate().is_err(), "generations ≥ 1");
    let mut s = spec();
    s.targets.clear();
    s.objective = None;
    assert!(s.validate().is_err(), "targets 与 objective 不能同时为空");
    let mut s = spec();
    s.targets[0].kind = TargetKind::Soft;
    assert!(s.validate().is_err(), "soft 目标不参与寻优");
    let mut s = spec();
    s.population = 400;
    s.generations = 100;
    assert!(s.validate().is_err(), "预算上限");
    // 2026-11-06 审核发现:寻优校验只限制 replicates 下限,未应用
    // 核心上限 MAX_SWEEP_REPLICATES;run_candidate 直接按 spec.replicates
    // 跑 R 次仿真,超大 replicates 仍可触发巨量分配。
    let mut s = spec();
    s.replicates = crate::config::MAX_SWEEP_REPLICATES + 1;
    let msg = s.validate().unwrap_err().to_string();
    assert!(msg.contains("replicates"), "{msg}");
    let mut s = spec();
    s.replicates = crate::config::MAX_SWEEP_REPLICATES;
    assert!(s.validate().is_ok(), "上限本身合法");
    // 合法 spec 应通过
    assert!(spec().validate().is_ok());
}

#[test]
fn fitness_lexicographic_and_direction() {
    use crate::experiment::SampleStats;
    let stat = |m: f64| SampleStats {
        n: 2,
        mean: m,
        sd: 0.0,
        ci95_lo: m,
        ci95_hi: m,
    };
    let ok = |hard_pass: u32, power: f64| CandidateResult {
        values: BTreeMap::new(),
        status: CandidateStatus::Ok,
        metric_stats: vec![(MetricKey::PowerP50Final, stat(power))],
        target_outcomes: (0..hard_pass)
            .map(|_| crate::sweep::TargetOutcome {
                metric: "win_rate".into(),
                kind: TargetKind::Hard,
                min: Some(0.5),
                max: None,
                stats: stat(0.9),
                verdict: ConstraintVerdict::Pass,
            })
            .collect(),
    };
    let obj = Objective {
        metric: MetricKey::PowerP50Final,
        direction: Direction::Maximize,
    };
    // 主键优先:pass 多者胜,score 再大也不翻盘
    let f1 = Fitness::of(&ok(1, 100.0), Some(&obj));
    let f0 = Fitness::of(&ok(0, 999.0), Some(&obj));
    assert!(f1.better(f0) && f1.hard_pass == 1);
    // 次键:同 pass 数比 score
    let f2 = Fitness::of(&ok(1, 200.0), Some(&obj));
    assert!(f2.better(f1));
    // minimize 方向折算
    let obj_min = Objective {
        metric: MetricKey::PowerP50Final,
        direction: Direction::Minimize,
    };
    let flo = Fitness::of(&ok(1, 100.0), Some(&obj_min));
    let fhi = Fitness::of(&ok(1, 200.0), Some(&obj_min));
    assert!(flo.better(fhi), "minimize 时低值更优");
    // 配置错误垫底
    let err = CandidateResult {
        values: BTreeMap::new(),
        status: CandidateStatus::ConfigError("bad".into()),
        metric_stats: vec![],
        target_outcomes: vec![],
    };
    let ferr = Fitness::of(&err, Some(&obj));
    assert!(f0.better(ferr));
}

// —— Pareto 模式(2026-10-10 裁定:约束感知非支配排序)——

fn pareto_spec() -> OptimSpec {
    OptimSpec {
        mode: OptimMode::Pareto,
        parameters: vec![
            ParamRange {
                path: "model.warrior.attack".into(),
                min: 60.0,
                max: 160.0,
                step: 10.0,
            },
            ParamRange {
                path: "model.dungeon.reward_gold".into(),
                min: 800.0,
                max: 2000.0,
                step: 100.0,
            },
        ],
        replicates: 2,
        population: 6,
        generations: 3,
        elite: 2,
        mutation_rate: 0.3,
        mutation_scale: 0.2,
        targets: vec![Target {
            metric: MetricKey::ChurnRate,
            min: Some(0.0),
            max: Some(0.3),
            kind: TargetKind::Hard,
        }],
        objective: None,
        objectives: vec![
            Objective {
                metric: MetricKey::PowerP50Final,
                direction: Direction::Maximize,
            },
            Objective {
                metric: MetricKey::GoldPerPlayer,
                direction: Direction::Minimize,
            },
        ],
    }
}

/// 双目标合成候选:power / gold(mean 值直接指定)。
fn cand2(hard_pass: u32, power: f64, gold: f64) -> CandidateResult {
    use crate::experiment::SampleStats;
    let stat = |m: f64| SampleStats {
        n: 2,
        mean: m,
        sd: 0.0,
        ci95_lo: m,
        ci95_hi: m,
    };
    CandidateResult {
        values: BTreeMap::new(),
        status: CandidateStatus::Ok,
        metric_stats: vec![
            (MetricKey::PowerP50Final, stat(power)),
            (MetricKey::GoldPerPlayer, stat(gold)),
        ],
        target_outcomes: (0..hard_pass)
            .map(|_| crate::sweep::TargetOutcome {
                metric: "churn_rate".into(),
                kind: TargetKind::Hard,
                min: Some(0.0),
                max: Some(0.3),
                stats: stat(0.1),
                verdict: ConstraintVerdict::Pass,
            })
            .collect(),
    }
}

#[test]
fn pareto_dominance_and_fronts() {
    // maximize power(折算原值)/ minimize gold(折算取负)
    let objs = pareto_spec().objectives;
    // A(1500, 800) 与 B(1600, 900) 互不支配(power↑gold↓同涨,折算后
    // B 在两维都占优?不——minimize gold 折算后 B 是 −900 < −800 劣)
    let a = cand2(1, 1500.0, 800.0); // 折算 (1500, −800)
    let b = cand2(1, 1600.0, 900.0); // 折算 (1600, −900):power 优 gold 劣,非支配
    let c = cand2(1, 1400.0, 900.0); // 折算 (1400, −900):被 A 与 B 双支配
    let results = vec![a, b, c];
    let fits = rank_and_crowd(&results, &objs);
    assert_eq!(fits[0].rank, 0);
    assert_eq!(fits[1].rank, 0);
    assert_eq!(fits[2].rank, 1, "c 被 a、b 双支配,落在前沿 1");
}

#[test]
fn pareto_sort_hard_constraint_tiers_first() {
    let objs = pareto_spec().objectives;
    // hard_pass 0 但目标值全优,仍不得压过 hard_pass 1
    let great_infeasible = cand2(0, 5000.0, 10.0);
    let poor_feasible = cand2(1, 100.0, 9999.0);
    let results = vec![great_infeasible, poor_feasible];
    let fits = rank_and_crowd(&results, &objs);
    assert_eq!(fits[0].hard_pass, 0);
    assert_eq!(fits[1].hard_pass, 1);
    assert!(
        cmp_pareto(&fits[1], &fits[0]) == std::cmp::Ordering::Less,
        "hard_pass 1 严格优于 hard_pass 0"
    );
}

#[test]
fn pareto_crowding_distance_boundary_infinite() {
    let objs = pareto_spec().objectives;
    // 三点单层:两个边界(∞)夹一个内部点(有限)
    let results = vec![
        cand2(1, 100.0, 100.0),
        cand2(1, 200.0, 200.0),
        cand2(1, 150.0, 150.0),
    ];
    let fits = rank_and_crowd(&results, &objs);
    assert_eq!(fits[0].rank, 0);
    assert_eq!(fits[1].rank, 0);
    assert_eq!(fits[2].rank, 0, "三点都非支配(同涨,折算后 power/gold 反向)");
    let finite: Vec<f64> = fits
        .iter()
        .map(|f| f.crowding)
        .filter(|c| c.is_finite())
        .collect();
    assert_eq!(finite.len(), 1, "恰一个内部点:{:?}", fits);
    assert!(fits.iter().any(|f| f.crowding == f64::INFINITY));
}

#[test]
fn pareto_final_front_deterministic() {
    let base = base();
    let s = pareto_spec();
    let a = optimize(&base, &s).unwrap();
    let b = optimize(&base, &s).unwrap();
    assert_eq!(
        serde_json::to_string(&a).unwrap(),
        serde_json::to_string(&b).unwrap(),
        "同种子同前沿"
    );
    assert_eq!(a.evaluated, 6 + 3 * 4);
    assert!(a.history.len() == 4, "初始 + 3 代");
    assert!(a.history[0].front0 >= 1, "初始层前沿非空");
    assert!(!a.front0.is_empty(), "末代前沿 0 应有解");
    // 前沿内部互不支配
    for i in 0..a.front0.len() {
        for j in (i + 1)..a.front0.len() {
            let vi = ParetoFit::objective_values(&a.front0[i], &s.objectives);
            let vj = ParetoFit::objective_values(&a.front0[j], &s.objectives);
            assert!(
                !dominates(&vi, &vj) && !dominates(&vj, &vi),
                "前沿 0 内互不支配:{vi:?} vs {vj:?}"
            );
        }
    }
    // best = 代表点(前沿 0 拥挤距离最大者 = front0 首个)
    let rep = a.best.expect("代表点存在");
    assert_eq!(rep.values, a.front0[0].values);
    // best_fitness.score = 代表点首目标折算值(maximize power → 原值)
    let bf = a.best_fitness.unwrap();
    let power = rep
        .metric_stats
        .iter()
        .find(|(k, _)| *k == MetricKey::PowerP50Final)
        .map(|(_, s)| s.mean)
        .unwrap();
    assert_eq!(bf.score, power);
}

#[test]
fn pareto_config_error_candidates_excluded() {
    let base = base();
    let mut s = pareto_spec();
    s.parameters.push(ParamRange {
        path: "model.dungeon.reward_gold".into(),
        min: -100.0,
        max: 100.0,
        step: 10.0,
    });
    let r = optimize(&base, &s).unwrap();
    assert!(r.best.is_some(), "配置错误不崩溃");
    for c in &r.front0 {
        assert!(
            matches!(c.status, CandidateStatus::Ok),
            "前沿 0 不含配置错误候选"
        );
    }
}

#[test]
fn optimize_spec_mode_objective_exclusive() {
    let mut s = pareto_spec();
    s.objectives = vec![s.objectives[0].clone()];
    assert!(s.validate().is_err(), "pareto 至少 2 个目标");
    let mut s = pareto_spec();
    s.objective = Some(Objective {
        metric: MetricKey::WinRate,
        direction: Direction::Maximize,
    });
    assert!(s.validate().is_err(), "pareto 不收 objective");
    let mut s = spec();
    s.objectives = vec![
        Objective {
            metric: MetricKey::WinRate,
            direction: Direction::Maximize,
        },
        Objective {
            metric: MetricKey::ChurnRate,
            direction: Direction::Minimize,
        },
    ];
    assert!(s.validate().is_err(), "evolutionary 不收 objectives");
    let mut s = spec();
    s.targets.clear();
    s.objective = None;
    s.objectives.clear();
    assert!(s.validate().is_err(), "targets 与排序目标不能同时为空");
    assert!(pareto_spec().validate().is_ok());
    assert!(spec().validate().is_ok());
}

#[test]
fn pareto_yaml_loading() {
    let yaml = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 200, duration: '10d'}\n",
        "model:\n",
        "  warrior: {attack: 100, defense: 80, hp: 1000}\n",
        "optimize:\n",
        "  mode: pareto\n",
        "  population: 4\n",
        "  generations: 2\n",
        "  replicates: 2\n",
        "  parameters:\n",
        "    model.warrior.attack: {min: 60, max: 160}\n",
        "  targets:\n",
        "    - {metric: churn_rate, min: 0.0, max: 0.3, kind: hard}\n",
        "  objectives:\n",
        "    - {metric: power_p50, direction: maximize}\n",
        "    - {metric: gold_per_player, direction: minimize}\n",
    );
    let (cfg, spec) = crate::scenario::load_optimize_str(yaml).unwrap();
    assert_eq!(spec.mode, OptimMode::Pareto);
    assert_eq!(spec.objectives.len(), 2);
    assert_eq!(spec.objectives[0].metric, MetricKey::PowerP50Final);
    assert_eq!(spec.objectives[1].direction, Direction::Minimize);
    assert!(spec.objective.is_none());
    assert_eq!(cfg.players, 200);

    // evolutionary + objectives → 拦截
    let bad = yaml.replace("mode: pareto", "mode: evolutionary");
    assert!(crate::scenario::load_optimize_str(&bad).is_err());
    // pareto + objective → 拦截
    let bad = yaml.replace(
        "  objectives:\n",
        "  objective: {metric: win_rate}\n  objectives:\n",
    );
    assert!(crate::scenario::load_optimize_str(&bad).is_err());
}
