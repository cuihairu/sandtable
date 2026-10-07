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
        /// 比较指标:retention_d7 | retention_d3 | win_rate | gold_per_player | power_p50 | churn_rate
        #[arg(long, default_value = "retention_d7")]
        metric: String,
        /// 输出目录(写 comparison.json)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// 校验场景文件 / 参数组合是否合法
    Validate {
        /// YAML 场景文件
        scenario: Option<PathBuf>,
        #[command(flatten)]
        over: Overrides,
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
