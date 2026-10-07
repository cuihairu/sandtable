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
            fs::write(dir.join("candidates.csv"), candidates_csv(&spec, &results))?;
            fs::write(dir.join("summary.csv"), summary_csv(&spec, &results))?;
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

/// 候选清单(文档 12 章:参数组合 + 状态;失败候选不静默丢弃)。
fn candidates_csv(
    spec: &core::sweep::SweepSpec,
    results: &[core::sweep::CandidateResult],
) -> String {
    let mut header: Vec<String> = vec!["candidate".into(), "status".into()];
    header.extend(spec.parameters.iter().map(|p| p.path.clone()));
    let mut out = csv_row(header.iter().map(String::as_str));
    for (i, r) in results.iter().enumerate() {
        let mut row: Vec<String> = vec![i.to_string(), status_str(&r.status).into()];
        for p in &spec.parameters {
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
fn summary_csv(spec: &core::sweep::SweepSpec, results: &[core::sweep::CandidateResult]) -> String {
    let mut header: Vec<String> = vec!["candidate".into(), "status".into(), "error".into()];
    header.extend(spec.parameters.iter().map(|p| p.path.clone()));
    for k in core::experiment::MetricKey::ALL {
        for s in ["mean", "ci95_lo", "ci95_hi"] {
            header.push(format!("{}_{}", k.name(), s));
        }
    }
    for (i, t) in spec.targets.iter().enumerate() {
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
        for p in &spec.parameters {
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
        for t in &spec.targets {
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
                metric: "win_rate",
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
        let csv = summary_csv(&spec, &[ok, err]);
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
                metric: "win_rate",
                kind: TargetKind::Hard,
                min: Some(0.0),
                max: Some(1.0),
                stats: stats(0.5),
                verdict: ConstraintVerdict::Pass,
            }],
        };
        let csv = summary_csv(&spec, &[r]);
        let row = csv.lines().nth(1).unwrap();
        assert!(row.ends_with("n/a,PASS"), "{row}");
    }
}
