//! Sandtable CLI(Phase 1 壳层)。
//!
//! 职责:参数解析、文件 I/O、环境 meta;仿真与统计全部在 sandtable-core。
//! 退出码约定(文档 10 章):0 成功;1 运行失败;2 配置 / 参数错误。

use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Context;
use clap::{Args, Parser, Subcommand};
use sandtable_core as core;

#[derive(Parser)]
#[command(
    name = "sandtable",
    version,
    about = "配置驱动的游戏系统数字沙盘(Phase 1:硬编码最小 RPG 闭环)"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// 运行仿真(默认硬编码最小 RPG,参数可覆盖)
    Simulate {
        #[command(flatten)]
        over: Overrides,
        /// replicate 数(默认 1;增大可平滑指标)
        #[arg(long, default_value_t = 1)]
        replicates: u32,
        /// 输出目录(写 report.json 与 days.csv)
        #[arg(long)]
        out: Option<PathBuf>,
    },
    /// A/B 比较:两臂仅初始攻击力不同,同种子配对(CRN)
    Compare {
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
    /// 校验参数组合是否合法
    Validate {
        #[command(flatten)]
        over: Overrides,
    },
}

#[derive(Args)]
struct Overrides {
    /// 玩家数
    #[arg(long)]
    players: Option<u32>,
    /// 天数
    #[arg(long)]
    days: Option<u32>,
    /// 基础种子
    #[arg(long)]
    seed: Option<u64>,
    /// 初始攻击力
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
            cfg.init_attack = v;
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

fn run() -> anyhow::Result<std::process::ExitCode> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Validate { over } => {
            let cfg = build_config(&over);
            match core::config::validate(&cfg) {
                Ok(()) => {
                    println!(
                        "配置有效。config_hash = {}",
                        core::config::config_hash(&cfg)
                    );
                    Ok(std::process::ExitCode::SUCCESS)
                }
                Err(e) => {
                    eprintln!("配置无效: {e}");
                    Ok(std::process::ExitCode::from(2))
                }
            }
        }
        Cmd::Simulate {
            over,
            replicates,
            out,
        } => {
            let cfg = build_config(&over);
            if let Err(e) = core::config::validate(&cfg) {
                eprintln!("配置无效: {e}");
                return Ok(std::process::ExitCode::from(2));
            }
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
                println!("已写出 {}(report.json, days.csv)", dir.display());
            }
            Ok(std::process::ExitCode::SUCCESS)
        }
        Cmd::Compare {
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
            let mut cfg_a = build_config(&over);
            cfg_a.init_attack = attack_a;
            let mut cfg_b = build_config(&over);
            cfg_b.init_attack = attack_b;
            for cfg in [&cfg_a, &cfg_b] {
                if let Err(e) = core::config::validate(cfg) {
                    eprintln!("配置无效: {e}");
                    return Ok(std::process::ExitCode::from(2));
                }
            }

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

fn build_config(over: &Overrides) -> core::config::SimConfig {
    let mut cfg = core::config::SimConfig::default();
    over.apply(&mut cfg);
    cfg
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
