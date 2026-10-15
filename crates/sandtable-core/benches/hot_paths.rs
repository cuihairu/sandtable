//! 热点细基准(docs 19「性能守卫」):criterion 覆盖文档点名的热点——
//! 公式求值 / 带键随机数派生 / 战斗结算 / 事件循环全流程(含在线聚合)。
//! 运行(仓库根):`cargo bench -p sandtable-core`;解读与回归口径见 docs 19。
//! **不进常规 CI 门禁**(耗时且共享 runner 噪声大),本地手动触发。

use std::hint::black_box;

use criterion::{criterion_group, criterion_main, Criterion};
use sandtable_core::config::SimConfig;
use sandtable_core::formula::{compile, XP_NEEDED_VARS};
use sandtable_core::rng::{derive_u64, DayRng, Purpose};
use sandtable_core::sim;
use sandtable_core::systems::combat::{monster_of, settle_battle};

/// 全流程基准的规模:与案例 KPI 锚同一口径(200 玩家 × 30 天 × 1 replicate),
/// 单次 release 量级几十毫秒——大足以摊平调度噪声,小足以整轮跑完。
fn small_cfg() -> SimConfig {
    SimConfig {
        players: 200,
        days: 30,
        ..Default::default()
    }
}

pub fn bench_formula_eval(c: &mut Criterion) {
    let src = SimConfig::default().formulas.xp_needed;
    let formula = compile(&src, XP_NEEDED_VARS).expect("默认公式编译失败");
    // env 顺序 = XP_NEEDED_VARS:[level, xp_base, xp_pow]
    let env = [12.0, 15.0, 2.0];
    c.bench_function("formula_eval_xp_needed", |b| {
        b.iter(|| black_box(formula.eval(black_box(&env))))
    });
}

pub fn bench_rng_derive(c: &mut Criterion) {
    c.bench_function("rng_derive_u64", |b| {
        b.iter(|| {
            black_box(derive_u64(
                black_box(12345),
                black_box(42),
                black_box(7),
                black_box(3),
                black_box(Purpose::CombatHit),
            ))
        })
    });
}

pub fn bench_settle_battle(c: &mut Criterion) {
    let cfg = SimConfig::default();
    let monster = monster_of(&cfg, 2);
    let mut rng = DayRng::new(999, 7, 5);
    c.bench_function("combat_settle_battle", |b| {
        b.iter(|| {
            black_box(settle_battle(
                black_box(120),
                black_box(40),
                black_box(600),
                black_box(&monster),
                black_box(&mut rng),
                black_box(3),
                black_box(&cfg),
            ))
        })
    });
}

pub fn bench_sim_pipeline(c: &mut Criterion) {
    let cfg = small_cfg();
    c.bench_function("sim_pipeline_200x30", |b| {
        b.iter(|| black_box(sim::run(black_box(&cfg), black_box(1))))
    });
}

criterion_group!(
    name = hot_paths;
    config = Criterion::default();
    targets = bench_formula_eval,
        bench_rng_derive,
        bench_settle_battle,
        bench_sim_pipeline
);
criterion_main!(hot_paths);
