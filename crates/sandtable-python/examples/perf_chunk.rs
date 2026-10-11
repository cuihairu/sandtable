//! 脚本层阶段 3 第一批:批处理粒度(day-level chunk)回调的性能实测基准
//! (设计稿 §7 验收门槛「先出性能实测报告再拍板」的数据来源)。
//!
//! 量三个原语,全部走真实通道(真实 pyo3 跨界、真实 core::sim::run):
//! 1. 基线吞吐:纯 Rust 仿真单次耗时(三种规模,release);
//! 2. 跨界固定成本:空 attach、无参 Python 调用(回调每天的固定开销);
//! 3. 批量交接:n 玩家观测面向量 → Python list 的创建/消费(逐玩家批量
//!    chunk 的变动成本),numpy 在位时附 as.asarray 对照。
//!
//! 输出 markdown 表到 stdout,数字与推导进 `scripts/scripting-perf-report.md`。
//! 运行(仓库根):
//!   cargo run -p sandtable-python --release --example perf_chunk
//! 方法论:每项取 min(多次)——报告口径为「最快情形」,对结论偏保守
//! (实际回调只会更慢);机器与 Python 版本随输出记录,数字不跨机器承诺。

use std::hint::black_box;
use std::time::Instant;

use pyo3::conversion::IntoPyObjectExt;
use pyo3::prelude::*;

use sandtable_core as core;

/// 反复执行 `f`,返回每次平均耗时(ns)。外层再取 `repeats` 轮的 min,
/// 削掉调度噪声;报告口径 = 最快情形(对「回调可行」的结论偏保守)。
fn time_ns_min(repeats: u32, iters: u32, mut f: impl FnMut()) -> f64 {
    let mut best = f64::INFINITY;
    for _ in 0..repeats {
        let t = Instant::now();
        for _ in 0..iters {
            f();
        }
        let per = t.elapsed().as_nanos() as f64 / f64::from(iters);
        best = best.min(per);
    }
    best
}

/// 单次仿真耗时(ms),取 `repeats` 次 min。
fn run_ms(cfg: &core::config::SimConfig, replicate: u32, repeats: u32) -> f64 {
    let mut best = f64::INFINITY;
    for _ in 0..repeats {
        let t = Instant::now();
        black_box(core::sim::run(cfg, replicate));
        best = best.min(t.elapsed().as_secs_f64() * 1e3);
    }
    best
}

fn main() -> PyResult<()> {
    Python::initialize();

    // —— 1. 基线吞吐(纯 Rust,不经 Python)——
    // 10k×30 是文档口径的参照规模(docs 01:单次 ~0.5 s release)。
    println!("## baseline (release, min of repeats)");
    println!("| players | days | repeats | per-run ms |");
    println!("| --- | --- | --- | --- |");
    let shapes = [(200u32, 10u32, 20u32), (1_000, 30, 5), (10_000, 30, 2)];
    let mut baseline_ms = Vec::new();
    for &(players, days, reps) in &shapes {
        let cfg = core::config::SimConfig {
            players,
            days,
            ..core::config::SimConfig::default()
        };
        let ms = run_ms(&cfg, 0, reps);
        baseline_ms.push(ms);
        println!("| {players} | {days} | {reps} | {ms:.1} |");
    }

    Python::attach(|py| -> PyResult<()> {
        println!("python: {}", pyo3::Python::version_str().trim_end());

        // —— 2. 跨界固定成本 ——
        // 空 attach:每次日回调都要过一遍的 GIL 进入/退出。
        println!("## crossing primitives");
        println!("| primitive | iters | per-op ns |");
        println!("| --- | --- | --- |");
        let attach_ns = time_ns_min(5, 200_000, || {
            Python::attach(|_py| {});
        });
        println!("| attach(empty) | 200000 | {attach_ns:.0} |");

        // 无参调用:lambda 无体,量纯调用协议开销(与空 attach 相加 =
        // 「一天一次无参回调」的固定成本)。
        let noop = py.eval(c"(lambda: None)", None, None)?;
        let call_ns = time_ns_min(5, 50_000, || {
            black_box(noop.call0().unwrap());
        });
        println!("| noop call0 | 50000 | {call_ns:.0} |");

        // —— 3. 批量交接:n 玩家观测面(Vec<f64> → list),每日一次 ——
        // 消费用 builtins.sum 走真实遍历,不测「创建后即弃」的假通道。
        println!("## batch exchange (per day)");
        println!("| n (players) | iters | create list ns | create + sum ns | numpy asarray ns |");
        println!("| --- | --- | --- | --- | --- |");
        let sum_fn = py.import("builtins")?.getattr("sum")?;
        let np = py.import("numpy").ok();
        let mut derived: Vec<String> = Vec::new();
        let mut derived_multi: Vec<String> = Vec::new();
        for &(players, days, base_idx) in &[(1_000u32, 30u32, 1usize), (10_000, 30, 2usize)] {
            let iters = if players == 1_000 { 2_000 } else { 500 };
            let data: Vec<f64> = (0..players).map(|i| (i % 977) as f64).collect();
            let create_ns = time_ns_min(5, iters, || {
                black_box((&data).into_py_any(py).unwrap());
            });
            let consume_ns = time_ns_min(5, iters, || {
                let list: Py<PyAny> = (&data).into_py_any(py).unwrap();
                let obj = list.bind(py);
                black_box(sum_fn.call1((obj,)).unwrap());
            });
            let np_ns = np.as_ref().map_or(f64::NAN, |np| {
                time_ns_min(5, iters, || {
                    let list: Py<PyAny> = (&data).into_py_any(py).unwrap();
                    let obj = list.bind(py);
                    black_box(np.getattr("asarray").unwrap().call1((obj,)).unwrap());
                })
            });
            println!("| {players} | {iters} | {create_ns:.0} | {consume_ns:.0} | {np_ns:.0} |");

            // 多列载荷:钩子默认观测面 = cohort/level/power/gold/churned 5 列,
            // 每日一次全量交接;交接线性可乘,但全载荷要按 5 列如实报。
            let cols: Vec<Vec<f64>> = (0..5u64)
                .map(|c| {
                    (0..u64::from(players))
                        .map(|i| ((i + c) % 977) as f64)
                        .collect()
                })
                .collect();
            let multi_ns = time_ns_min(5, iters, || {
                let lists: Vec<Py<PyAny>> =
                    cols.iter().map(|v| v.into_py_any(py).unwrap()).collect();
                for l in &lists {
                    black_box(sum_fn.call1((l.bind(py),)).unwrap());
                }
            });
            let multi_pct = 100.0 * f64::from(days) * (attach_ns + call_ns + multi_ns)
                / (baseline_ms[base_idx] * 1e6);
            derived_multi.push(format!(
                "| {players} | 5 | {multi_ns:.0} | {multi_pct:.2}% |"
            ));

            // 推导行先收集,循环后统一出推导表
            let baseline_ns = baseline_ms[base_idx] * 1e6;
            let fixed = attach_ns + call_ns;
            let noop_pct = 100.0 * f64::from(days) * fixed / baseline_ns;
            let xchg_pct = 100.0 * f64::from(days) * (fixed + consume_ns) / baseline_ns;
            derived.push(format!(
                "| {players} | {days} | {:.1} | {noop_pct:.2}% | {xchg_pct:.2}% |",
                baseline_ms[base_idx]
            ));
        }
        if np.is_none() {
            println!();
            println!("(numpy 不在环境,asarray 列为 NaN)");
        }

        // —— 4. 推导:日粒度 chunk 挂满 30 天的开销占比 ——
        // 固定成本 = attach + call0;变动成本 = 交接 + 消费。
        println!();
        println!("## derived: day-level chunk overhead over a 30-day run");
        println!("| players | days | baseline ms | noop-only % | exchange + consume % |");
        println!("| --- | --- | --- | --- | --- |");
        for row in &derived {
            println!("{row}");
        }
        println!();
        println!("## derived: 5-column payload (full hook face) over a 30-day run");
        println!("| players | cols | create+sum per day ns | exchange % |");
        println!("| --- | --- | --- | --- |");
        for row in &derived_multi {
            println!("{row}");
        }

        Ok(())
    })?;

    Ok(())
}
