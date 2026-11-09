//! Sandtable CLI(壳层,文档 10 章)。
//!
//! 职责:参数解析、文件 I/O、环境 meta;仿真与统计全部在 sandtable-core。
//! 退出码约定:0 成功;1 运行失败;2 配置 / 参数错误。
//!
//! 入口只留子命令分发(run());按域拆分:args(clap 参数)/ output
//! (CSV / meta / Parquet 输出整形)/ query(DuckDB 只读查询)/ surrogate
//! / disttest / recommend(独立子命令);analyze / params / project /
//! report / scaffold 为既有子模块。

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::Context;
use clap::Parser;
use sandtable_core as core;

mod analyze;
mod args;
mod disttest;
mod output;
mod params;
mod project;
mod query;
mod recommend;
mod report;
mod scaffold;
mod surrogate;

use args::{Cli, Cmd, Overrides, ParamsCmd, ProjectCmd};
use disttest::run_disttest;
use output::{candidates_csv, meta_json, summary_csv};
use recommend::run_recommend;
use surrogate::run_surrogate;

#[cfg(feature = "duckdb")]
use output::csv_row;
use sandtable_cli::workbook;

#[cfg(feature = "parquet")]
use output::write_parquet;
#[cfg(feature = "duckdb")]
use query::{print_table, run_query};

/// 桌面 / CLI 扫描与寻优的仿真规模预算(文档 09/12 章;ST-AUD-17/19 / I-017/I-019,
/// 桌面路径此前无规模 / 仿真量门,仅靠 core 候选与 replicates 上限兜底):
/// - 规模门 `players × days ≤ core::config::MAX_SIM_SCALE`(五壳层共用同一常量);
/// - 单候选驻留内存门 `replicates × days ≤ MAX_CLI_REPLICATE_DAYS`(每 replicate
///   持 `days` 个 DayStats,rayon 并行时线程数份在飞,大 R × 大 days 即 OOM 源);
/// - 总工作量门 [`core::sweep::sim_work`] ≤ [`MAX_CLI_SIM_WORK`](候选 × R × players × days)。
pub const MAX_CLI_REPLICATE_DAYS: u64 = 2_000_000;
pub const MAX_CLI_SIM_WORK: u64 = 1_000_000_000;

fn main() -> std::process::ExitCode {
    match run() {
        Ok(code) => code,
        Err(e) => {
            eprintln!("错误: {e:#}");
            std::process::ExitCode::from(1)
        }
    }
}

/// 配置错误以退出码 2 报告(文档 10 章),其余走 anyhow(退出码 1)。
fn load_config(scenario: Option<&Path>, over: &Overrides) -> Result<core::config::SimConfig, i32> {
    let mut cfg = match scenario {
        Some(path) => {
            let yaml = fs::read_to_string(path).map_err(|e| {
                eprintln!("配置错误: 读取 {} 失败: {e}", path.display());
                2
            })?;
            core::scenario::load_str(&yaml).map_err(|e| {
                eprintln!("配置错误: {e}");
                2
            })?
        }
        None => core::config::SimConfig::default(),
    };
    over.apply(&mut cfg);
    core::config::validate(&cfg).map_err(|e| {
        eprintln!("配置错误: {e}");
        2
    })?;
    Ok(cfg)
}

fn run() -> anyhow::Result<std::process::ExitCode> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Sweep {
            experiment,
            replicates,
            out,
        } => {
            let yaml = match fs::read_to_string(&experiment) {
                Ok(y) => y,
                Err(e) => {
                    eprintln!("配置错误: 读取 {} 失败: {e}", experiment.display());
                    return Ok(std::process::ExitCode::from(2));
                }
            };
            let (cfg, mut spec) = match core::scenario::load_experiment_str(&yaml) {
                Ok(x) => x,
                Err(e) => {
                    eprintln!("配置错误: {e}");
                    return Ok(std::process::ExitCode::from(2));
                }
            };
            if let Some(r) = replicates {
                spec.replicates = r;
                if let Err(e) = spec.validate() {
                    eprintln!("参数错误: {e}");
                    return Ok(std::process::ExitCode::from(2));
                }
            }
            // ST-AUD-17/19 / I-017/I-019:预算账在物化候选 **之前** 先算
            // (candidate_count 纯计数不展开),统一 sim_work 口径收紧驻留内存
            // (R × days)与总工作量(候选 × R × players × days)两扇门——桌面
            // 路径此前仅靠 core 候选 / replicates 上限兜底,大 R × 大 days
            // 仍会 OOM。规模门(players × days)已由 load_experiment_str →
            // into_config → config::validate 统一把关,不重复判界。
            let count = match spec.candidate_count() {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("配置错误: {e}");
                    return Ok(std::process::ExitCode::from(2));
                }
            };
            let rd = core::sweep::sim_work(1, spec.replicates, 1, cfg.days);
            if rd > MAX_CLI_REPLICATE_DAYS {
                eprintln!(
                    "参数错误: replicates × days = {rd} 超出驻留内存预算 {MAX_CLI_REPLICATE_DAYS}(调小 replicates 或 duration)"
                );
                return Ok(std::process::ExitCode::from(2));
            }
            let work = core::sweep::sim_work(count, spec.replicates, cfg.players, cfg.days);
            if work > MAX_CLI_SIM_WORK {
                eprintln!(
                    "参数错误: 总仿真工作量 {work} 超出预算 {MAX_CLI_SIM_WORK}(调小网格 / replicates / population / duration)"
                );
                return Ok(std::process::ExitCode::from(2));
            }
            let candidates = match spec.plan(cfg.base_seed) {
                Ok(c) => c,
                Err(e) => {
                    eprintln!("配置错误: {e}");
                    return Ok(std::process::ExitCode::from(2));
                }
            };
            println!(
                "扫描计划:{} 个候选 × {} replicates(mode {:?})",
                candidates.len(),
                spec.replicates,
                spec.mode
            );

            // 候选间并行(文档 11 章);run_candidate 纯函数,collect 保序 →
            // 输出顺序与线程数无关
            use rayon::prelude::*;
            let t0 = std::time::Instant::now();
            let results: Vec<core::sweep::CandidateResult> = candidates
                .par_iter()
                .map(|values| core::sweep::run_candidate(&cfg, &spec, values))
                .collect();
            let elapsed = t0.elapsed();

            let ok = results
                .iter()
                .filter(|r| matches!(r.status, core::sweep::CandidateStatus::Ok))
                .count();
            let failed = results.len() - ok;
            let (mut n_pass, mut n_border, mut n_fail, mut n_missing) =
                (0usize, 0usize, 0usize, 0usize);
            for r in &results {
                for o in &r.target_outcomes {
                    match o.verdict {
                        core::sweep::ConstraintVerdict::Pass => n_pass += 1,
                        core::sweep::ConstraintVerdict::Borderline => n_border += 1,
                        core::sweep::ConstraintVerdict::Fail => n_fail += 1,
                        core::sweep::ConstraintVerdict::Missing => n_missing += 1,
                    }
                }
            }
            println!("完成:{ok} 成功 / {failed} 配置错误,耗时 {:.2?}", elapsed);
            if !spec.targets.is_empty() {
                println!(
                    "约束判定:PASS {n_pass} · BORDERLINE {n_border} · FAIL {n_fail} · MISSING {n_missing}(共 {} 项)",
                    n_pass + n_border + n_fail + n_missing
                );
            }

            let dir = out.unwrap_or_else(|| PathBuf::from("sweep-out"));
            fs::create_dir_all(&dir).context("创建输出目录失败")?;
            fs::write(
                dir.join("candidates.csv"),
                candidates_csv(&spec.parameters, &results),
            )?;
            fs::write(
                dir.join("summary.csv"),
                summary_csv(&spec.parameters, &spec.targets, &results),
            )?;
            let report = serde_json::json!({
                "meta": meta_json(),
                "spec": spec,
                "counts": {
                    "candidates": results.len(),
                    "ok": ok,
                    "config_error": failed,
                    "verdicts": {"pass": n_pass, "borderline": n_border, "fail": n_fail},
                },
                "results": results,
            });
            fs::write(
                dir.join("sweep.json"),
                serde_json::to_string_pretty(&report)?,
            )?;
            println!(
                "已写出 {}(candidates.csv, summary.csv, sweep.json)",
                dir.display()
            );
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Optimize {
            experiment,
            replicates,
            out,
        } => {
            let yaml = match fs::read_to_string(&experiment) {
                Ok(y) => y,
                Err(e) => {
                    eprintln!("配置错误: 读取 {} 失败: {e}", experiment.display());
                    return Ok(std::process::ExitCode::from(2));
                }
            };
            let (cfg, mut spec) = match core::scenario::load_optimize_str(&yaml) {
                Ok(x) => x,
                Err(e) => {
                    eprintln!("配置错误: {e}");
                    return Ok(std::process::ExitCode::from(2));
                }
            };
            if let Some(r) = replicates {
                spec.replicates = r;
                if let Err(e) = spec.validate() {
                    eprintln!("参数错误: {e}");
                    return Ok(std::process::ExitCode::from(2));
                }
            }
            // ST-AUD-17/19 / I-017/I-019:寻优同样收紧驻留内存 / 总工作量两扇门
            // (候选数 = population × (generations + 1),同 validate 口径);
            // 规模门由加载器统一把关。
            let count = spec.population as usize * (spec.generations as usize + 1);
            let rd = core::sweep::sim_work(1, spec.replicates, 1, cfg.days);
            if rd > MAX_CLI_REPLICATE_DAYS {
                eprintln!(
                    "参数错误: replicates × days = {rd} 超出驻留内存预算 {MAX_CLI_REPLICATE_DAYS}(调小 replicates 或 duration)"
                );
                return Ok(std::process::ExitCode::from(2));
            }
            let work = core::sweep::sim_work(count, spec.replicates, cfg.players, cfg.days);
            if work > MAX_CLI_SIM_WORK {
                eprintln!(
                    "参数错误: 总仿真工作量 {work} 超出预算 {MAX_CLI_SIM_WORK}(调小 population / generations / replicates / duration)"
                );
                return Ok(std::process::ExitCode::from(2));
            }
            println!(
                "寻优计划:{} 种群 × {} 代 × {} replicates(mode {:?},候选预算上限 {})",
                spec.population, spec.generations, spec.replicates, spec.mode, count,
            );
            let t0 = std::time::Instant::now();
            let result = match core::optimize::optimize(&cfg, &spec) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("配置错误: {e}");
                    return Ok(std::process::ExitCode::from(2));
                }
            };
            println!(
                "完成:评了 {} 个候选(≈{} 次仿真),耗时 {:.2?}",
                result.evaluated,
                result.total_sims,
                t0.elapsed()
            );
            let is_pareto = matches!(spec.mode, core::optimize::OptimMode::Pareto);
            for g in &result.history {
                if is_pareto {
                    println!(
                        "  gen {:>2}:feasible {:>3}/{} · front0 {:>3} · best hard_pass {}",
                        g.generation,
                        g.feasible,
                        result.spec.targets.len(),
                        g.front0,
                        g.best.hard_pass
                    );
                } else {
                    println!(
                        "  gen {:>2}:feasible {:>3}/{} · best hard_pass {} · score {:.4}",
                        g.generation,
                        g.feasible,
                        result.spec.targets.len(),
                        g.best.hard_pass,
                        g.best.score
                    );
                }
            }
            match (&result.best, result.best_fitness) {
                (Some(b), Some(f)) => {
                    if is_pareto {
                        // 多目标无单一最优:best = 代表点(前沿 0 拥挤距离最大者)
                        println!(
                            "最优前沿:{} 个非支配解 · 代表点 hard_pass {}/{} · 首目标 {:.4} · {:?}",
                            result.front0.len(),
                            f.hard_pass,
                            result.spec.targets.len(),
                            f.score,
                            b.values
                        );
                    } else {
                        println!(
                            "最优:hard_pass {}/{} · score {:.4} · {:?}",
                            f.hard_pass,
                            result.spec.targets.len(),
                            f.score,
                            b.values
                        );
                    }
                }
                _ => println!("最优:无(全部候选配置错误)"),
            }

            let dir = out.unwrap_or_else(|| PathBuf::from("opt-out"));
            fs::create_dir_all(&dir).context("创建输出目录失败")?;
            fs::write(
                dir.join("candidates.csv"),
                candidates_csv(&result.spec.parameters, &result.all),
            )?;
            let report = serde_json::json!({
                "meta": meta_json(),
                "spec": result.spec,
                "evaluated": result.evaluated,
                "total_sims": result.total_sims,
                "best_fitness": result.best_fitness,
                "history": result.history,
                "best": result.best,
                "front0": result.front0,
            });
            fs::write(dir.join("opt.json"), serde_json::to_string_pretty(&report)?)?;
            println!("已写出 {}(opt.json, candidates.csv)", dir.display());
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Surrogate { action } => match run_surrogate(&action) {
            Ok(()) => Ok(std::process::ExitCode::SUCCESS),
            Err(e) => {
                eprintln!("配置错误: {e:#}");
                Ok(std::process::ExitCode::from(2))
            }
        },
        Cmd::Disttest { action } => match run_disttest(&action) {
            Ok(exit_code) => Ok(exit_code),
            Err(e) => {
                eprintln!("配置错误: {e:#}");
                Ok(std::process::ExitCode::from(2))
            }
        },
        Cmd::Analyze {
            script,
            data,
            timeout,
            python,
            script_args,
        } => {
            let code = analyze::run(&script, &data, timeout, python.as_deref(), &script_args)?;
            Ok(std::process::ExitCode::from(code.clamp(0, 255) as u8))
        }
        Cmd::Scaffold { name, out } => {
            let paths = scaffold::generate(&out, &name)?;
            for p in &paths {
                println!("已生成 {}", p.display());
            }
            println!(
                "完成:{}(场景/基线/实验/README 四件套)",
                out.join(&name).display()
            );
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Validate { scenario, over } => match load_config(scenario.as_deref(), &over) {
            Ok(cfg) => {
                println!(
                    "配置有效。config_hash = {}",
                    core::config::config_hash(&cfg)
                );
                Ok(std::process::ExitCode::SUCCESS)
            }
            Err(code) => Ok(std::process::ExitCode::from(code as u8)),
        },
        #[cfg(feature = "duckdb")]
        Cmd::Query { inputs, sql, out } => {
            let rows = run_query(&inputs, &sql)?;
            match out {
                Some(path) => {
                    let mut csv = csv_row(rows.0.iter().map(String::as_str));
                    for r in &rows.1 {
                        csv.push_str(&csv_row(r.iter().map(String::as_str)));
                    }
                    if let Some(parent) = path.parent() {
                        fs::create_dir_all(parent).context("创建输出目录失败")?;
                    }
                    fs::write(&path, csv).with_context(|| format!("写 {} 失败", path.display()))?;
                    println!("已写出 {} 行 → {}", rows.1.len(), path.display());
                }
                None => print_table(&rows),
            }
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Recommend {
            experiment,
            sweep_json,
            out,
        } => match run_recommend(&experiment, &sweep_json, out.as_deref()) {
            Ok(()) => Ok(std::process::ExitCode::SUCCESS),
            Err(e) => {
                eprintln!("配置错误: {e:#}");
                Ok(std::process::ExitCode::from(2))
            }
        },
        Cmd::Report { inputs, out } => {
            let html = match report::render(&inputs) {
                Ok(h) => h,
                Err(e) => {
                    eprintln!("配置错误: {e:#}");
                    return Ok(std::process::ExitCode::from(2));
                }
            };
            let dst = out.unwrap_or_else(|| PathBuf::from("report.html"));
            if let Some(parent) = dst.parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent).context("创建输出目录失败")?;
                }
            }
            fs::write(&dst, html).with_context(|| format!("写 {} 失败", dst.display()))?;
            println!("已写出 {}(单文件 HTML,离线可开)", dst.display());
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Params { cmd } => {
            let empty = Overrides {
                players: None,
                days: None,
                seed: None,
                init_attack: None,
            };
            match cmd {
                ParamsCmd::Export { scenario, out } => {
                    let cfg = match load_config(scenario.as_deref(), &empty) {
                        Ok(c) => c,
                        Err(code) => return Ok(std::process::ExitCode::from(code as u8)),
                    };
                    let dst = out.unwrap_or_else(|| PathBuf::from("params.csv"));
                    if let Some(parent) = dst.parent() {
                        if !parent.as_os_str().is_empty() {
                            fs::create_dir_all(parent).context("创建输出目录失败")?;
                        }
                    }
                    fs::write(&dst, params::export_csv(&cfg))
                        .with_context(|| format!("写 {} 失败", dst.display()))?;
                    println!("已导出 {} 项 → {}", params::rows(&cfg).len(), dst.display());
                }
                ParamsCmd::Import { csv, scenario, out } => {
                    let cfg = match load_config(scenario.as_deref(), &empty) {
                        Ok(c) => c,
                        Err(code) => return Ok(std::process::ExitCode::from(code as u8)),
                    };
                    let text = fs::read_to_string(&csv)
                        .with_context(|| format!("读取 {} 失败", csv.display()))?;
                    let imp = match params::import_csv(&text, cfg) {
                        Ok(i) => i,
                        Err(e) => {
                            eprintln!("参数错误: {e:#}");
                            return Ok(std::process::ExitCode::from(2));
                        }
                    };
                    println!(
                        "已导入 {} 项,config_hash = {}",
                        imp.applied,
                        core::config::config_hash(&imp.config)
                    );
                    if let Some(dst) = out {
                        if let Some(parent) = dst.parent() {
                            if !parent.as_os_str().is_empty() {
                                fs::create_dir_all(parent).context("创建输出目录失败")?;
                            }
                        }
                        fs::write(&dst, params::merged_yaml(&imp.config))
                            .with_context(|| format!("写 {} 失败", dst.display()))?;
                        println!("已写出 {}(可直接 simulate)", dst.display());
                    }
                }
            }
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Project { cmd } => {
            let r = match cmd {
                ProjectCmd::Pack { dir, out } => {
                    let dst = out.unwrap_or_else(|| {
                        let mut s = dir.as_os_str().to_owned();
                        s.push(".sandtable");
                        PathBuf::from(s)
                    });
                    project::pack(&dir, &dst)
                }
                ProjectCmd::Unpack { archive, out } => {
                    let dst = out.unwrap_or_else(|| {
                        let stem = archive
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or_default();
                        if stem.is_empty() {
                            PathBuf::from("restored")
                        } else {
                            PathBuf::from(stem)
                        }
                    });
                    project::unpack(&archive, &dst)
                }
                ProjectCmd::Check { archive } => project::check(&archive),
            };
            // 校验 / 路径纪律 / 哈希失败都是配置类错误,退出码 2
            if let Err(e) = r {
                eprintln!("项目错误: {e:#}");
                return Ok(std::process::ExitCode::from(2));
            }
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Workbook { dir, out } => {
            let package = match workbook::build(&dir) {
                Ok(p) => p,
                Err(e) => {
                    eprintln!("产物错误: {e:#}");
                    return Ok(std::process::ExitCode::from(2));
                }
            };
            let dst = out.unwrap_or_else(|| dir.join("sandbox.xlsx"));
            if let Some(parent) = dst.parent() {
                if !parent.as_os_str().is_empty() {
                    fs::create_dir_all(parent).context("创建输出目录失败")?;
                }
            }
            package.workbook.write(&dst).context("写工作簿失败")?;
            let names = package
                .present
                .iter()
                .map(|(n, _, _)| *n)
                .collect::<Vec<_>>()
                .join(", ");
            let absent = if package.absent.is_empty() {
                "无".to_string()
            } else {
                package.absent.join(", ")
            };
            println!(
                "已写出 {}:共 {} 张表({names});缺席产物 {absent} 只记入 manifest,不出表",
                dst.display(),
                package.workbook.sheet_count()
            );
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Init { path, force } => {
            let path = path.unwrap_or_else(|| PathBuf::from("scenario.yaml"));
            if path.exists() && !force {
                eprintln!("参数错误: {} 已存在(加 --force 覆盖)", path.display());
                return Ok(std::process::ExitCode::from(2));
            }
            fs::write(&path, core::scenario::example_yaml()).context("写入场景模板失败")?;
            println!(
                "已生成 {} ——编辑后:sandtable validate {};sandtable simulate {}",
                path.display(),
                path.display(),
                path.display()
            );
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Simulate {
            scenario,
            over,
            replicates,
            out,
            #[cfg(feature = "parquet")]
            parquet,
        } => {
            let cfg = match load_config(scenario.as_deref(), &over) {
                Ok(c) => c,
                Err(code) => return Ok(std::process::ExitCode::from(code as u8)),
            };
            let t0 = std::time::Instant::now();
            let results: Vec<core::metrics::RunMetrics> =
                (0..replicates).map(|r| core::sim::run(&cfg, r)).collect();
            let elapsed = t0.elapsed();

            println!("{}", core::export::summary_text(&results[0]));
            if replicates > 1 {
                println!("--- {} 个 replicate 均值 ---", replicates);
                for key in core::experiment::MetricKey::ALL {
                    let vals: Vec<f64> = results.iter().filter_map(|m| key.extract(m)).collect();
                    if vals.len() == results.len() {
                        let s = core::experiment::summarize(&vals);
                        println!(
                            "{:<16} mean {:.4}  CI95 [{:.4}, {:.4}]",
                            key.name(),
                            s.mean,
                            s.ci95_lo,
                            s.ci95_hi
                        );
                    }
                }
            }
            println!("耗时 {:.2?}", elapsed);

            #[cfg(feature = "parquet")]
            if parquet && out.is_none() {
                eprintln!("参数错误: --parquet 需要 --out 目录(与 JSON/CSV 一起落盘)");
                return Ok(std::process::ExitCode::from(2));
            }
            if let Some(dir) = out {
                fs::create_dir_all(&dir).context("创建输出目录失败")?;
                let report = serde_json::json!({
                    "meta": meta_json(),
                    "results": results,
                });
                fs::write(
                    dir.join("report.json"),
                    serde_json::to_string_pretty(&report)?,
                )?;
                fs::write(dir.join("days.csv"), core::export::day_csv(&results[0]))?;
                #[cfg(feature = "parquet")]
                if parquet {
                    write_parquet(&dir, &results[0])?;
                }
                println!("已写出 {}(report.json, days.csv)", dir.display());
            }
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Compare {
            scenario,
            over,
            attack_a,
            attack_b,
            replicates,
            metric,
            out,
        } => {
            if replicates < 2 {
                eprintln!("参数错误: replicates 至少为 2(单点无法给出置信区间)");
                return Ok(std::process::ExitCode::from(2));
            }
            let key = match core::experiment::MetricKey::parse(&metric) {
                Some(k) => k,
                None => {
                    eprintln!(
                        "参数错误: 未知指标 {metric:?},可选: {:?}",
                        core::experiment::MetricKey::ALL.map(|k| k.name())
                    );
                    return Ok(std::process::ExitCode::from(2));
                }
            };
            let base = match load_config(scenario.as_deref(), &over) {
                Ok(c) => c,
                Err(code) => return Ok(std::process::ExitCode::from(code as u8)),
            };
            let mut cfg_a = base.clone();
            cfg_a.warrior.attack = attack_a;
            let mut cfg_b = base.clone();
            cfg_b.warrior.attack = attack_b;

            let t0 = std::time::Instant::now();
            let mut vals_a = Vec::with_capacity(replicates as usize);
            let mut vals_b = Vec::with_capacity(replicates as usize);
            for r in 0..replicates {
                // 同 r 同种子:CRN 配对
                let a = core::sim::run(&cfg_a, r);
                let b = core::sim::run(&cfg_b, r);
                match (key.extract(&a), key.extract(&b)) {
                    (Some(x), Some(y)) => {
                        vals_a.push(x);
                        vals_b.push(y);
                    }
                    _ => {
                        eprintln!(
                            "配置错误: 运行天数 {} 不足以产生指标 {}(需要更长窗口)",
                            cfg_a.days,
                            key.name()
                        );
                        return Ok(std::process::ExitCode::from(2));
                    }
                }
            }
            let elapsed = t0.elapsed();

            let cmp = core::experiment::compare(key.name(), &vals_a, &vals_b);
            println!("{}", core::export::comparison_text(&cmp));
            println!("耗时 {:.2?}", elapsed);

            if let Some(dir) = out {
                fs::create_dir_all(&dir).context("创建输出目录失败")?;
                let report = serde_json::json!({
                    "meta": meta_json(),
                    "metric": key.name(),
                    "attack_a": attack_a,
                    "attack_b": attack_b,
                    "hash_a": core::config::config_hash(&cfg_a),
                    "hash_b": core::config::config_hash(&cfg_b),
                    "comparison": cmp,
                });
                fs::write(
                    dir.join("comparison.json"),
                    serde_json::to_string_pretty(&report)?,
                )?;
                println!("已写出 {}(comparison.json)", dir.display());
            }
            Ok(std::process::ExitCode::SUCCESS)
        }
    }
}
