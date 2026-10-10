//! Sandtable CLI(壳层,文档 10 章)。
//!
//! 职责:参数解析、文件 I/O、环境 meta;仿真与统计全部在 sandtable-core。
//! 退出码约定:0 成功;1 运行失败;2 配置 / 参数错误。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Context;
use clap::{Args, Parser, Subcommand};
use sandtable_core as core;

mod params;
mod project;
mod report;

#[derive(Parser)]
#[command(
    name = "sandtable",
    version,
    about = "配置驱动的游戏系统数字沙盘(Phase 2:YAML 场景配置 + 硬编码最小 RPG)"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// 运行仿真;SCENARIO 为 YAML 场景文件(缺省用内置默认值)
    Simulate {
        /// YAML 场景文件
        scenario: Option<PathBuf>,
        #[command(flatten)]
        over: Overrides,
        /// replicate 数(默认 1;增大可平滑指标)
        #[arg(long, default_value_t = 1)]
        replicates: u32,
        /// 输出目录(写 report.json 与 days.csv)
        #[arg(long)]
        out: Option<PathBuf>,
        /// 追加 Parquet 输出(day_stats / power_snapshots / cohort,
        /// 文档 09 章数据契约;与 days.csv 同源,取第 1 个 replicate)。
        /// 需以 --features parquet 构建本 CLI。
        #[cfg(feature = "parquet")]
        #[arg(long)]
        parquet: bool,
    },
    /// A/B 比较:两臂仅 warrior.attack 不同,同种子配对(CRN)
    Compare {
        /// YAML 场景文件
        scenario: Option<PathBuf>,
        #[command(flatten)]
        over: Overrides,
        #[arg(long, default_value_t = 100)]
        attack_a: i64,
        #[arg(long, default_value_t = 105)]
        attack_b: i64,
        /// 每臂 replicate 数
        #[arg(long, default_value_t = 12)]
        replicates: u32,
        /// 比较指标:retention_d7 | retention_d3 | win_rate | gold_per_player | power_p50 | churn_rate | gacha_pulls_to_hit
        #[arg(long, default_value = "retention_d7")]
        metric: String,
        /// 输出目录(写 comparison.json)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 参数扫描:读实验文件(scenario + model + sweep 三节),候选间并行,
    /// 写候选清单与汇总表(文档 12 章)
    Sweep {
        /// 实验 YAML 文件
        experiment: PathBuf,
        /// 覆盖 sweep.replicates(粗筛可临时调小)
        #[arg(long)]
        replicates: Option<u32>,
        /// 输出目录(candidates.csv / summary.csv / sweep.json,缺省 ./sweep-out)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 参数寻优:读寻优实验文件(scenario + model + optimize 三节),进化
    /// 算法逐代搜索可行点(文档 12 章自动寻优;代间串行是算法语义)
    Optimize {
        /// 实验 YAML 文件
        experiment: PathBuf,
        /// 覆盖 optimize.replicates(粗筛可临时调小)
        #[arg(long)]
        replicates: Option<u32>,
        /// 输出目录(opt.json / candidates.csv,缺省 ./opt-out)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 随机森林代理:读 sweep 产物训练 / 预测 / 特征重要性(文档 12 章
    /// 自动寻优;只读产物不进仿真路径)
    Surrogate {
        #[command(subcommand)]
        action: SurrogateAction,
    },
    /// 分布检验:均匀 / 加权 χ² 检验(文档 24 章 R1;测试台,不进仿真路径)
    Disttest {
        #[command(subcommand)]
        action: DisttestAction,
    },
    /// 校验场景文件 / 参数组合是否合法
    Validate {
        /// YAML 场景文件
        scenario: Option<PathBuf>,
        #[command(flatten)]
        over: Overrides,
    },
    /// SQL 事后探索结果数据集(文档 09/10 章;feature duckdb)
    #[cfg(feature = "duckdb")]
    Query {
        /// 输入数据文件(CSV / Parquet);视图名 = 文件名词根
        #[arg(required = true)]
        inputs: Vec<PathBuf>,
        /// SQL 查询(以视图名引用输入)
        #[arg(long)]
        sql: String,
        /// 结果以 CSV 落盘(缺省表格输出 stdout)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 平衡推荐:读 sweep 产物,重算敏感性与单轴推荐区间(文档 14/15 章)
    Recommend {
        /// 实验 YAML 文件(读基线配置)
        experiment: PathBuf,
        /// sweep 输出目录或 sweep.json 路径
        sweep_json: PathBuf,
        /// 敏感性矩阵与推荐以 JSON 落盘(供报告层复用)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// HTML 报告:渲染已落盘产物为单文件 HTML(文档 9/10 章)
    Report {
        /// 结果目录或产物文件(可多个;发现什么渲染什么)
        #[arg(required = true)]
        inputs: Vec<PathBuf>,
        /// 输出 HTML 路径(缺省 ./report.html)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 参数表导入导出:扁平 CSV ↔ 注册表数值参数(文档 9/10 章)
    Params {
        #[command(subcommand)]
        cmd: ParamsCmd,
    },
    /// 项目打包:场景 / 实验(可选产物)→ 单个 .sandtable 归档(文档 9/10 章)
    Project {
        #[command(subcommand)]
        cmd: ProjectCmd,
    },
    /// 生成示例场景骨架(默认值 + 注释,可直接编辑运行)
    Init {
        /// 目标路径(缺省 ./scenario.yaml)
        path: Option<PathBuf>,
        /// 已存在时覆盖
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand)]
enum SurrogateAction {
    /// 训练:sweep 产物 → 随机森林模型(model.json)
    Train {
        /// sweep 输出目录或 sweep.json 路径
        sweep_json: PathBuf,
        /// 训练目标指标(retention_d7 | retention_d3 | win_rate | gold_per_player | power_p50 | churn_rate | gacha_pulls_to_hit)
        #[arg(long, default_value = "retention_d7")]
        metric: String,
        /// 树数
        #[arg(long, default_value_t = core::surrogate::DEFAULT_TREES)]
        trees: u32,
        /// 最大深度
        #[arg(long, default_value_t = core::surrogate::DEFAULT_MAX_DEPTH)]
        max_depth: u32,
        /// 叶最小样本数
        #[arg(long, default_value_t = core::surrogate::DEFAULT_MIN_SAMPLES_LEAF)]
        min_samples_leaf: usize,
        /// 森林种子(每棵树按序派生,同种子同森林)
        #[arg(long, default_value_t = 42)]
        seed: u64,
        /// 模型输出路径(缺省 ./model.json)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 预测:模型 + 参数 JSON 对象 → 指标预测(含全树散布)
    Predict {
        /// 模型文件(train 产物)
        model: PathBuf,
        /// 参数 JSON 对象(键 = 参数路径,须与训练特征集一致)
        #[arg(long)]
        params: String,
    },
    /// 特征重要性:模型 → 参数重要性排序表
    Importance {
        /// 模型文件(train 产物)
        model: PathBuf,
    },
}

#[derive(Subcommand)]
enum DisttestAction {
    /// 均匀检验:[lo, hi) 上均匀采样 → 等宽桶 χ² 检验
    Uniform {
        /// 采样次数
        #[arg(long, default_value_t = 100_000)]
        samples: u64,
        /// 桶数
        #[arg(long, default_value_t = 10)]
        buckets: usize,
        /// 显著性水平 α
        #[arg(long, default_value_t = 0.01)]
        alpha: f64,
        /// 随机种子
        #[arg(long, default_value_t = 42)]
        seed: u64,
        /// 下界(含)
        #[arg(long, default_value_t = 0.0)]
        lo: f64,
        /// 上界(不含)
        #[arg(long, default_value_t = 1.0)]
        hi: f64,
    },
    /// 加权检验:读场景 YAML 的掉落表 → 按权重采样 → χ² 检验
    Weighted {
        /// YAML 场景文件(含 model.loot.tables)
        scenario: PathBuf,
        /// 表名
        table: String,
        /// 采样次数
        #[arg(long, default_value_t = 100_000)]
        samples: u64,
        /// 显著性水平 α
        #[arg(long, default_value_t = 0.01)]
        alpha: f64,
        /// 随机种子
        #[arg(long, default_value_t = 42)]
        seed: u64,
    },
}

#[derive(Subcommand)]
enum ParamsCmd {
    /// 导出全量数值参数模板(path,value)
    Export {
        /// 基线场景(缺省默认配置)
        scenario: Option<PathBuf>,
        /// 输出路径(缺省 ./params.csv)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 导入参数表:逐行覆写基线配置并校验(坏行逐行报,退出码 2)
    Import {
        /// 参数表 CSV(path,value)
        csv: PathBuf,
        /// 基线场景(缺省默认配置)
        scenario: Option<PathBuf>,
        /// 合并结果落盘为场景 YAML(可直接 simulate)
        #[arg(long)]
        out: Option<PathBuf>,
    },
}

#[derive(Subcommand)]
enum ProjectCmd {
    /// 打包项目目录为 .sandtable 归档(scenarios/ experiments/ results/ 一层)
    Pack {
        /// 项目目录
        dir: PathBuf,
        /// 输出归档路径(缺省 <目录名>.sandtable)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 校验并展开归档(目标目录须不存在或为空,不覆盖既有文件)
    Unpack {
        /// .sandtable 归档
        archive: PathBuf,
        /// 输出目录(缺省归档去扩展名)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 只校验归档(manifest、哈希、路径纪律、配置加载),不落盘
    Check {
        /// .sandtable 归档
        archive: PathBuf,
    },
}

#[derive(Args)]
struct Overrides {
    /// 玩家数(scenario.population)
    #[arg(long)]
    players: Option<u32>,
    /// 天数(scenario.duration)
    #[arg(long)]
    days: Option<u32>,
    /// 基础种子(scenario.seed)
    #[arg(long)]
    seed: Option<u64>,
    /// 初始攻击力(model.warrior.attack)
    #[arg(long)]
    init_attack: Option<i64>,
}

impl Overrides {
    fn apply(&self, cfg: &mut core::config::SimConfig) {
        if let Some(v) = self.players {
            cfg.players = v;
        }
        if let Some(v) = self.days {
            cfg.days = v;
        }
        if let Some(v) = self.seed {
            cfg.base_seed = v;
        }
        if let Some(v) = self.init_attack {
            cfg.warrior.attack = v;
        }
    }
}

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
            let (mut n_pass, mut n_border, mut n_fail) = (0usize, 0usize, 0usize);
            for r in &results {
                for o in &r.target_outcomes {
                    match o.verdict {
                        core::sweep::ConstraintVerdict::Pass => n_pass += 1,
                        core::sweep::ConstraintVerdict::Borderline => n_border += 1,
                        core::sweep::ConstraintVerdict::Fail => n_fail += 1,
                    }
                }
            }
            println!("完成:{ok} 成功 / {failed} 配置错误,耗时 {:.2?}", elapsed);
            if !spec.targets.is_empty() {
                println!(
                    "约束判定:PASS {n_pass} · BORDERLINE {n_border} · FAIL {n_fail}(共 {} 项)",
                    n_pass + n_border + n_fail
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
            println!(
                "寻优计划:{} 种群 × {} 代 × {} replicates(mode {:?},候选预算上限 {})",
                spec.population,
                spec.generations,
                spec.replicates,
                spec.mode,
                spec.population as usize * (spec.generations as usize + 1),
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

fn meta_json() -> serde_json::Value {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    serde_json::json!({
        // 环境字段不参与确定性:同 seed 重跑时 results 部分逐字节一致
        "generated_at_unix": ts,
        "git_sha": option_env!("SANDTABLE_GIT_SHA").unwrap_or("unknown"),
        "schema_version": core::SCHEMA_VERSION,
        "model_version": core::MODEL_VERSION,
    })
}

/// CSV 字段转义(RFC 4180):含分隔符/引号/换行时整体加引号,内部引号翻倍。
fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// 一行 CSV:字段逐个转义后以逗号连接,行尾换行。
fn csv_row<'a>(fields: impl IntoIterator<Item = &'a str>) -> String {
    let mut line = String::new();
    for f in fields {
        if !line.is_empty() {
            line.push(',');
        }
        line.push_str(&csv_field(f));
    }
    line.push('\n');
    line
}

fn status_str(status: &core::sweep::CandidateStatus) -> &'static str {
    match status {
        core::sweep::CandidateStatus::Ok => "ok",
        core::sweep::CandidateStatus::ConfigError(_) => "config_error",
    }
}

/// SQL 查询结果:(列名, 行)。
#[cfg(feature = "duckdb")]
type QueryResult = (Vec<String>, Vec<Vec<String>>);

/// 对已落盘的结果数据集跑 SQL(文档 09 章红线:DuckDB 只读结果,
/// 不进仿真路径)。输入按词根注册为视图:summary.csv → summary。
#[cfg(feature = "duckdb")]
fn run_query(inputs: &[PathBuf], sql: &str) -> anyhow::Result<QueryResult> {
    use duckdb::Connection;

    let conn = Connection::open_in_memory().context("打开 DuckDB 内存库失败")?;
    for path in inputs {
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .ok_or_else(|| anyhow::anyhow!("无法从 {} 取视图名", path.display()))?;
        if !is_ident(stem) {
            anyhow::bail!("视图名 {stem:?} 非法:文件名词根须为 [A-Za-z_][A-Za-z0-9_]*");
        }
        // 路径进 DDL 字面量:单引号翻倍(视图名已在 is_ident 拦住)
        let p = path.to_string_lossy().replace('\'', "''");
        let ddl = match path.extension().and_then(|e| e.to_str()) {
            Some("parquet") => format!("CREATE VIEW {stem} AS SELECT * FROM read_parquet('{p}')"),
            _ => format!("CREATE VIEW {stem} AS SELECT * FROM read_csv_auto('{p}', header = true)"),
        };
        conn.execute_batch(&ddl)
            .with_context(|| format!("注册视图 {stem} 失败({})", path.display()))?;
    }

    // 列名取自 DESCRIBE(计划期元数据,不执行查询体):prepare 阶段的
    // C API 不暴露结果列,column_names 要执行后才可用
    let sql = sql.trim().trim_end_matches(';');
    let mut desc = conn.prepare(&format!("DESCRIBE {sql}"))?;
    let mut dcur = desc.query([])?;
    let mut names = Vec::new();
    while let Some(r) = dcur.next()? {
        let n: String = r.get(0)?;
        names.push(n);
    }

    let mut stmt = conn.prepare(sql)?;
    let ncols = names.len();
    let mut rows = Vec::new();
    let mut cur = stmt.query([])?;
    while let Some(r) = cur.next()? {
        let mut row = Vec::with_capacity(ncols);
        for i in 0..ncols {
            row.push(cell_string(r, i)?);
        }
        rows.push(row);
    }
    Ok((names, rows))
}

/// 视图名须是合法标识符(拼进 DDL,注入在注册处拦截)。
#[cfg(feature = "duckdb")]
fn is_ident(s: &str) -> bool {
    let mut cs = s.chars();
    matches!(cs.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// 单元格转显示文本:数值/文本直转,复合类型走 Debug。
#[cfg(feature = "duckdb")]
fn cell_string(r: &duckdb::Row<'_>, i: usize) -> anyhow::Result<String> {
    use duckdb::types::ValueRef;
    let s = match r.get_ref(i)? {
        ValueRef::Null => String::new(),
        ValueRef::Boolean(v) => v.to_string(),
        ValueRef::TinyInt(v) => v.to_string(),
        ValueRef::SmallInt(v) => v.to_string(),
        ValueRef::Int(v) => v.to_string(),
        ValueRef::BigInt(v) => v.to_string(),
        ValueRef::HugeInt(v) => v.to_string(),
        ValueRef::UTinyInt(v) => v.to_string(),
        ValueRef::USmallInt(v) => v.to_string(),
        ValueRef::UInt(v) => v.to_string(),
        ValueRef::UBigInt(v) => v.to_string(),
        ValueRef::UHugeInt(v) => v.to_string(),
        ValueRef::Float(v) => v.to_string(),
        ValueRef::Double(v) => v.to_string(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
        ValueRef::Date32(v) => v.to_string(),
        other => format!("{other:?}"),
    };
    Ok(s)
}

/// 简单表格输出:按列宽对齐(终端人读,面向 stdout)。
#[cfg(feature = "duckdb")]
fn print_table((names, rows): &QueryResult) {
    if names.is_empty() {
        return;
    }
    let mut widths: Vec<usize> = names.iter().map(|n| n.chars().count()).collect();
    for r in rows {
        for (i, c) in r.iter().enumerate() {
            widths[i] = widths[i].max(c.chars().count());
        }
    }
    let line = |cells: &[String]| {
        cells
            .iter()
            .enumerate()
            .map(|(i, c)| format!("{c:>width$}", width = widths[i]))
            .collect::<Vec<_>>()
            .join("  ")
    };
    println!("{}", line(names));
    let rule = widths
        .iter()
        .map(|w| "-".repeat(*w))
        .collect::<Vec<_>>()
        .join("  ");
    println!("{rule}");
    for r in rows {
        println!("{}", line(r));
    }
    println!("({} 行)", rows.len());
}

/// sweep.json 回读结构(只要 spec 与 results;meta / counts 忽略)。
#[derive(serde::Deserialize)]
struct SweepRun {
    spec: core::sweep::SweepSpec,
    results: Vec<core::sweep::CandidateResult>,
}

/// 随机森林代理子命令(文档 12 章自动寻优增量,2026-10-10 裁定):
/// sweep 产物 → 森林训练 / 参数预测 / 特征重要性。只读产物不进仿真路径。
/// 配置错误走退出码 2。
fn run_surrogate(action: &SurrogateAction) -> anyhow::Result<()> {
    match action {
        SurrogateAction::Train {
            sweep_json,
            metric,
            trees,
            max_depth,
            min_samples_leaf,
            seed,
            out,
        } => {
            let json_path = if sweep_json.is_dir() {
                sweep_json.join("sweep.json")
            } else {
                sweep_json.to_path_buf()
            };
            let raw = fs::read_to_string(&json_path).with_context(|| {
                format!("读取 {} 失败(先跑 sandtable sweep)", json_path.display())
            })?;
            let run: SweepRun = serde_json::from_str(&raw)
                .with_context(|| format!("{} 解析失败(sweep 产物)", json_path.display()))?;
            let key = core::experiment::MetricKey::parse(metric).ok_or_else(|| {
                anyhow::anyhow!("未知指标 {metric}(可选 retention_d7 | retention_d3 | win_rate | gold_per_player | power_p50 | churn_rate | gacha_pulls_to_hit)")
            })?;
            let spec = core::surrogate::SurrogateSpec {
                trees: *trees,
                max_depth: *max_depth,
                min_samples_leaf: *min_samples_leaf,
                seed: *seed,
            };
            let model = core::surrogate::RandomForest::fit(&run.results, key, spec)?;
            // 训练内 MAE:同批 Ok 候选回代
            let key_name = key.name();
            let mut n_eval = 0usize;
            let mut abs_err = 0.0f64;
            for r in &run.results {
                if r.metric_stats.iter().any(|(k, _)| k.name() == key_name) {
                    if let Ok(p) = model.predict(&r.values) {
                        let y = r
                            .metric_stats
                            .iter()
                            .find(|(k, _)| k.name() == key_name)
                            .map(|(_, s)| s.mean)
                            .unwrap_or_default();
                        abs_err += (p - y).abs();
                        n_eval += 1;
                    }
                }
            }
            let mae = if n_eval > 0 {
                abs_err / n_eval as f64
            } else {
                0.0
            };
            let mut ranked: Vec<(&String, f64)> = model
                .features
                .iter()
                .zip(model.importance.iter().copied())
                .collect();
            ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            println!(
                "训练完成:样本 {} · 树 {}(深度 ≤ {},叶 ≥ {}) · 训练内 MAE {:.4}",
                n_eval, model.spec.trees, model.spec.max_depth, model.spec.min_samples_leaf, mae
            );
            println!("特征重要性:");
            for (name, imp) in ranked.iter().take(8) {
                println!("  {:.4}  {}", imp, name);
            }
            let dst = out.clone().unwrap_or_else(|| PathBuf::from("model.json"));
            fs::write(&dst, serde_json::to_string_pretty(&model)?)
                .with_context(|| format!("写 {} 失败", dst.display()))?;
            println!("已写出 {}(metric {})", dst.display(), model.metric);
            Ok(())
        }
        SurrogateAction::Predict { model, params } => {
            let raw = fs::read_to_string(model)
                .with_context(|| format!("读取 {} 失败", model.display()))?;
            let forest: core::surrogate::RandomForest = serde_json::from_str(&raw)
                .with_context(|| format!("{} 解析失败(代理模型)", model.display()))?;
            let map: std::collections::BTreeMap<String, f64> = serde_json::from_str(params)
                .with_context(|| "params 解析失败(须为 JSON 对象,键 = 参数路径)".to_string())?;
            let row: Vec<f64> = forest
                .features
                .iter()
                .map(|f| {
                    map.get(f).copied().ok_or_else(|| {
                        anyhow::anyhow!("缺少特征 {f}(训练特征集:{:?})", forest.features)
                    })
                })
                .collect::<Result<_, _>>()?;
            let values = forest.tree_values(&row);
            let mean = values.iter().sum::<f64>() / values.len() as f64;
            let min = values.iter().cloned().fold(f64::INFINITY, f64::min);
            let max = values.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            println!(
                "{} 预测 = {:.4}(全树 min {:.4} / max {:.4},{} 棵)",
                forest.metric,
                mean,
                min,
                max,
                values.len()
            );
            Ok(())
        }
        SurrogateAction::Importance { model } => {
            let raw = fs::read_to_string(model)
                .with_context(|| format!("读取 {} 失败", model.display()))?;
            let forest: core::surrogate::RandomForest = serde_json::from_str(&raw)
                .with_context(|| format!("{} 解析失败(代理模型)", model.display()))?;
            let mut ranked: Vec<(&String, f64)> = forest
                .features
                .iter()
                .zip(forest.importance.iter().copied())
                .collect();
            ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            println!(
                "特征重要性(metric {},{} 个特征,方差削减归一):",
                forest.metric,
                ranked.len()
            );
            for (name, imp) in &ranked {
                println!("  {:.4}  {}", imp, name);
            }
            Ok(())
        }
    }
}

/// 分布检验子命令(文档 24 章 R1):均匀 / 加权 χ² 检验。
/// 通过退出码 0,失败退出码 1,配置错误退出码 2。
fn run_disttest(action: &DisttestAction) -> anyhow::Result<std::process::ExitCode> {
    match action {
        DisttestAction::Uniform {
            samples,
            buckets,
            alpha,
            seed,
            lo,
            hi,
        } => {
            if *hi <= *lo {
                anyhow::bail!("hi({hi}) 必须大于 lo({lo})");
            }
            if *buckets < 2 {
                anyhow::bail!("桶数须 ≥ 2 才能做 χ² 检验");
            }
            if *alpha <= 0.0 || *alpha >= 1.0 {
                anyhow::bail!("α 须在 (0, 1) 区间内");
            }
            let width = hi - lo;
            let exp = vec![*samples as f64 / *buckets as f64; *buckets];
            let mut obs = vec![0.0f64; *buckets];
            let mut rng = core::rng::DayRng::new(*seed, 1, 1);
            for _ in 0..*samples {
                let u = rng.draw(core::rng::Purpose::Shuffle).f64();
                let v = lo + u * width;
                let b = ((v - lo) / width * *buckets as f64).floor() as usize;
                obs[b.min(*buckets - 1)] += 1.0;
            }
            let p = print_chi_square("uniform [lo, hi)", &obs, &exp, *alpha);
            Ok(exit_from_p(p, *alpha))
        }
        DisttestAction::Weighted {
            scenario,
            table,
            samples,
            alpha,
            seed,
        } => {
            let yaml = fs::read_to_string(scenario)
                .with_context(|| format!("读取 {} 失败", scenario.display()))?;
            let cfg = core::scenario::load_str(&yaml)?;
            let loot = cfg
                .loot
                .as_ref()
                .ok_or_else(|| anyhow::anyhow!("场景未配置 model.loot(无掉落表可检验)"))?;
            let tc = loot.tables.get(table).ok_or_else(|| {
                anyhow::anyhow!("掉落表 {} 不存在(可用:{:?})", table, loot.tables.keys())
            })?;
            let weights: Vec<(String, f64)> =
                tc.weights.iter().map(|(k, v)| (k.clone(), *v)).collect();
            let wt = core::rng::WeightedTable::from_weights(&weights)?;
            let probs = wt.probabilities();
            let exp: Vec<f64> = probs.iter().map(|p| p * *samples as f64).collect();
            let mut obs = vec![0.0f64; wt.len()];
            let mut rng = core::rng::DayRng::new(*seed, 1, 1);
            for _ in 0..*samples {
                let i = rng.weighted(core::rng::Purpose::Loot, &wt);
                obs[i] += 1.0;
            }
            let p = print_chi_square(&format!("weighted table '{}'", table), &obs, &exp, *alpha);
            Ok(exit_from_p(p, *alpha))
        }
    }
}

fn exit_from_p(p: f64, alpha: f64) -> std::process::ExitCode {
    if p >= alpha {
        std::process::ExitCode::SUCCESS
    } else {
        std::process::ExitCode::from(1)
    }
}

/// 打印 χ² 检验结果(含 Cochran 桶合并报告),返回 p 值。
fn print_chi_square(label: &str, observed: &[f64], expected: &[f64], alpha: f64) -> f64 {
    println!("=== {} χ² 检验 ===", label);
    println!(
        "  采样 {} · 桶数 {} · α = {}",
        observed.iter().sum::<f64>(),
        observed.len(),
        alpha
    );
    let (o, e) = core::disttest::merge_buckets(observed, expected, core::disttest::MIN_EXPECTED);
    if o.len() != observed.len() {
        println!(
            "  ⚠ Cochran 桶合并:{} → {} 桶(期望 < {} 的桶并入相邻桶)",
            observed.len(),
            o.len(),
            core::disttest::MIN_EXPECTED
        );
    }
    let Ok(chi) = core::disttest::chi_square(&o, &e) else {
        println!("  ✗ 样本不足:合并后不足 2 桶,χ² 近似无效(增大 --samples)");
        return 0.0;
    };
    println!(
        "  χ² = {:.4} · df = {} · p = {:.6}",
        chi.stat, chi.df, chi.p_value
    );
    if chi.pass(alpha) {
        println!("  ✓ 通过(p ≥ α)");
    } else {
        println!("  ✗ 失败(p < α):分布偏离预期");
    }
    chi.p_value
}

/// 推荐子命令(文档 14/15 章):sweep 产物 + 基线配置 → 敏感性矩阵 +
/// 单轴推荐区间。复用扫描数据,零额外仿真。配置错误走退出码 2。
fn run_recommend(experiment: &Path, sweep_path: &Path, out: Option<&Path>) -> anyhow::Result<()> {
    let yaml = fs::read_to_string(experiment)
        .with_context(|| format!("读取 {} 失败", experiment.display()))?;
    let (cfg, _) = core::scenario::load_experiment_str(&yaml)?;
    let json_path = if sweep_path.is_dir() {
        sweep_path.join("sweep.json")
    } else {
        sweep_path.to_path_buf()
    };
    let raw = fs::read_to_string(&json_path)
        .with_context(|| format!("读取 {} 失败(先跑 sandtable sweep)", json_path.display()))?;
    let run: SweepRun = serde_json::from_str(&raw)
        .with_context(|| format!("{} 解析失败(sweep 产物)", json_path.display()))?;

    // MVP 红线(文档 15 章):单参数轴;多参数联合可行域属后续阶段
    if run.spec.parameters.len() != 1 {
        anyhow::bail!(
            "推荐目前只支持单参数轴,sweep 定义了 {} 个参数(多参数联合可行域属后续阶段)",
            run.spec.parameters.len()
        );
    }
    let axis = 0;

    let elasticities = core::sensitivity::oat_elasticity(
        &run.spec,
        &cfg,
        &run.results,
        core::sensitivity::DEFAULT_DELTA,
    );
    let rec = core::recommend::recommend_axis(&run.spec, &cfg, &run.results, axis);

    // 敏感性矩阵(文档 14 章输出形式:参数 × 指标,不跨参数排序)
    let param = &run.spec.parameters[axis].path;
    println!("敏感性矩阵(OAT 弹性,{}):", param);
    for e in &elasticities {
        if e.note == core::sensitivity::SensNote::Ok {
            println!(
                "  {} → {}:E = {:+.4} [{:+.4}, {:+.4}](δ_eff {:.3}),{}",
                e.param,
                e.metric.name(),
                e.e,
                e.e_lo,
                e.e_hi,
                e.delta_eff,
                if e.significant { "显著" } else { "不显著" }
            );
        } else {
            println!(
                "  {} → {}:不可算({})",
                e.param,
                e.metric.name(),
                e.note.as_str()
            );
        }
    }

    // 推荐块(文档 15 章输出形态)
    println!();
    println!("Current:");
    println!("  {} = {}", rec.param, rec.baseline);
    println!();
    println!("Recommended:");
    match rec.interval {
        Some((lo, hi)) => println!("  {lo:.6} ~ {hi:.6}"),
        None => println!("  无可行区间(hard 约束无交集或无可行点)"),
    }
    println!();
    println!("Reason:");
    for r in &rec.reasons {
        println!("  - {r}");
    }
    println!();
    println!("Confidence:");
    println!("  {}", rec.confidence.as_str());

    if let Some(path) = out {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).context("创建输出目录失败")?;
        }
        let report = serde_json::json!({
            "meta": meta_json(),
            "elasticities": elasticities,
            "recommendation": rec,
        });
        fs::write(path, serde_json::to_string_pretty(&report)?)?;
        println!();
        println!("已写出 {}(敏感性矩阵 + 推荐)", path.display());
    }
    Ok(())
}

/// 候选清单(文档 12 章:参数组合 + 状态;失败候选不静默丢弃)。
fn candidates_csv(
    parameters: &[core::sweep::ParamRange],
    results: &[core::sweep::CandidateResult],
) -> String {
    let mut header: Vec<String> = vec!["candidate".into(), "status".into()];
    header.extend(parameters.iter().map(|p| p.path.clone()));
    let mut out = csv_row(header.iter().map(String::as_str));
    for (i, r) in results.iter().enumerate() {
        let mut row: Vec<String> = vec![i.to_string(), status_str(&r.status).into()];
        for p in parameters {
            row.push(
                r.values
                    .get(&p.path)
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
            );
        }
        out.push_str(&csv_row(row.iter().map(String::as_str)));
    }
    out
}

/// 汇总表(文档 12 章:候选 × 指标 mean ± CI + 约束判定;失败候选在
/// error 列标注原因,指标与判定列留空)。
fn summary_csv(
    parameters: &[core::sweep::ParamRange],
    targets: &[core::sweep::Target],
    results: &[core::sweep::CandidateResult],
) -> String {
    let mut header: Vec<String> = vec!["candidate".into(), "status".into(), "error".into()];
    header.extend(parameters.iter().map(|p| p.path.clone()));
    for k in core::experiment::MetricKey::ALL {
        for s in ["mean", "ci95_lo", "ci95_hi"] {
            header.push(format!("{}_{}", k.name(), s));
        }
    }
    for (i, t) in targets.iter().enumerate() {
        header.push(format!("t{}_{}", i + 1, t.metric.name()));
    }
    let mut out = csv_row(header.iter().map(String::as_str));

    for (i, r) in results.iter().enumerate() {
        let mut row: Vec<String> = vec![
            i.to_string(),
            status_str(&r.status).into(),
            match &r.status {
                core::sweep::CandidateStatus::ConfigError(e) => e.clone(),
                core::sweep::CandidateStatus::Ok => String::new(),
            },
        ];
        for p in parameters {
            row.push(
                r.values
                    .get(&p.path)
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
            );
        }
        for k in core::experiment::MetricKey::ALL {
            match r.metric_stats.iter().find(|(mk, _)| *mk == k) {
                Some((_, s)) => {
                    row.push(s.mean.to_string());
                    row.push(s.ci95_lo.to_string());
                    row.push(s.ci95_hi.to_string());
                }
                None => row.extend(["".into(), "".into(), "".into()]),
            }
        }
        // target_outcomes 按声明序生成,但指标不足的 target 会被跳过:
        // 按 (指标, 区间, 类型) 消费式匹配回原位,缺口记 n/a
        let mut used = vec![false; r.target_outcomes.len()];
        for t in targets {
            let pos = r.target_outcomes.iter().enumerate().position(|(idx, o)| {
                !used[idx]
                    && o.metric == t.metric.name()
                    && o.min == t.min
                    && o.max == t.max
                    && o.kind == t.kind
            });
            match pos {
                Some(p) => {
                    used[p] = true;
                    row.push(r.target_outcomes[p].verdict.as_str().into());
                }
                None => row.push("n/a".into()),
            }
        }
        out.push_str(&csv_row(row.iter().map(String::as_str)));
    }
    out
}

/// Parquet 落盘(文档 09 章:Arrow 契约的载体,feature `parquet`)。
/// 与 days.csv 同源:取第 1 个 replicate 的三个批次。
#[cfg(feature = "parquet")]
fn write_parquet(dir: &Path, m: &core::metrics::RunMetrics) -> anyhow::Result<()> {
    use parquet::arrow::ArrowWriter;

    for (name, batch) in [
        ("day_stats", core::export::arrow::day_stats_batch(m)?),
        (
            "power_snapshots",
            core::export::arrow::power_snapshots_batch(m)?,
        ),
        ("cohort", core::export::arrow::cohort_batch(m)?),
    ] {
        let path = dir.join(format!("{name}.parquet"));
        let file =
            fs::File::create(&path).with_context(|| format!("创建 {} 失败", path.display()))?;
        let mut w = ArrowWriter::try_new(file, batch.schema(), None)?;
        w.write(&batch)?;
        w.close()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    // 显式重导入:`use super::*` 带入的别名与内建 core crate 撞名
    use core::experiment::{MetricKey, SampleStats};
    use core::sweep::{
        CandidateResult, CandidateStatus, ConstraintVerdict, ParamRange, SweepMode, SweepSpec,
        Target, TargetKind, TargetOutcome,
    };
    use sandtable_core as core;
    use std::collections::BTreeMap;

    #[test]
    fn csv_字段转义() {
        assert_eq!(csv_field("plain"), "plain");
        assert_eq!(csv_field("a,b"), "\"a,b\"");
        assert_eq!(csv_field("说\"话\""), "\"说\"\"话\"\"\"");
    }

    fn stats(v: f64) -> SampleStats {
        SampleStats {
            n: 3,
            mean: v,
            sd: 0.01,
            ci95_lo: v - 0.01,
            ci95_hi: v + 0.01,
        }
    }

    /// 汇总表列序:candidate/status/error/参数列/6 指标×3 列/t 判定列;
    /// 失败候选标注错误,指标与判定留空。
    #[test]
    fn 汇总表_列结构与失败候选标注() {
        let spec = SweepSpec {
            mode: SweepMode::Grid,
            parameters: vec![ParamRange {
                path: "model.warrior.attack".into(),
                min: 90.0,
                max: 100.0,
                step: 10.0,
            }],
            replicates: 2,
            samples: 0,
            targets: vec![Target {
                metric: MetricKey::WinRate,
                min: Some(0.0),
                max: Some(1.0),
                kind: TargetKind::Hard,
            }],
        };
        let mut values = BTreeMap::new();
        values.insert("model.warrior.attack".to_string(), 90.0);
        let ok = CandidateResult {
            values,
            status: CandidateStatus::Ok,
            metric_stats: vec![(MetricKey::WinRate, stats(0.5))],
            target_outcomes: vec![TargetOutcome {
                metric: "win_rate".into(),
                kind: TargetKind::Hard,
                min: Some(0.0),
                max: Some(1.0),
                stats: stats(0.5),
                verdict: ConstraintVerdict::Pass,
            }],
        };
        let err = CandidateResult {
            values: BTreeMap::new(),
            status: CandidateStatus::ConfigError("配置无效: 命中概率必须在 [0, 1]".into()),
            metric_stats: vec![],
            target_outcomes: vec![],
        };
        let csv = summary_csv(&spec.parameters, &spec.targets, &[ok, err]);
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines.len(), 3);
        let header = lines[0];
        assert!(
            header.starts_with("candidate,status,error,model.warrior.attack,"),
            "{header}"
        );
        assert!(header.contains("win_rate_mean,win_rate_ci95_lo,win_rate_ci95_hi"));
        assert!(header.ends_with("t1_win_rate"), "{header}");

        // 成功行:win_rate 是第 3 个指标 → 第 10..13 列;末列 = t1 判定
        let cells: Vec<&str> = lines[1].split(',').collect();
        assert_eq!(cells[1], "ok");
        assert_eq!(cells[3], "90");
        assert_eq!(cells[4], "", "缺提取的指标列留空");
        assert_eq!(cells[10], "0.5");
        assert_eq!(*cells.last().unwrap(), "PASS", "{:?}", cells.last());

        // 失败行:error 列带引号转义(消息含逗号),指标列全空
        assert!(lines[2].contains("config_error"));
        assert!(lines[2].contains("\"配置无效: 命中概率必须在 [0, 1]\""));
        assert!(lines[2].ends_with("n/a"));
    }

    /// target_outcomes 与 spec.targets 的消费式对位:判定缺口记 n/a。
    #[test]
    fn 汇总表_判定缺口记_na() {
        let spec = SweepSpec {
            mode: SweepMode::Grid,
            parameters: vec![ParamRange {
                path: "model.warrior.attack".into(),
                min: 90.0,
                max: 90.0,
                step: 1.0,
            }],
            replicates: 1,
            samples: 0,
            targets: vec![
                Target {
                    metric: MetricKey::RetentionD7,
                    min: Some(0.0),
                    max: Some(1.0),
                    kind: TargetKind::Hard,
                },
                Target {
                    metric: MetricKey::WinRate,
                    min: Some(0.0),
                    max: Some(1.0),
                    kind: TargetKind::Hard,
                },
            ],
        };
        let r = CandidateResult {
            values: BTreeMap::new(),
            status: CandidateStatus::Ok,
            // 只有 win_rate 有统计(d7 因天数不足无值)→ 第一个判定缺口
            metric_stats: vec![(MetricKey::WinRate, stats(0.5))],
            target_outcomes: vec![TargetOutcome {
                metric: "win_rate".into(),
                kind: TargetKind::Hard,
                min: Some(0.0),
                max: Some(1.0),
                stats: stats(0.5),
                verdict: ConstraintVerdict::Pass,
            }],
        };
        let csv = summary_csv(&spec.parameters, &spec.targets, &[r]);
        let row = csv.lines().nth(1).unwrap();
        assert!(row.ends_with("n/a,PASS"), "{row}");
    }
}
