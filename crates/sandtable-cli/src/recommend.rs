//! 推荐子命令面(文档 14/15 章):sweep 产物 + 基线配置 → 敏感性矩阵 +
//! 单轴推荐区间。复用扫描数据,零额外仿真。

use std::fs;
use std::path::Path;

use anyhow::Context;

use sandtable_core as core;

use crate::output::meta_json;
use crate::surrogate::SweepRun;

/// 推荐子命令(文档 14/15 章):sweep 产物 + 基线配置 → 敏感性矩阵 +
/// 单轴推荐区间。复用扫描数据,零额外仿真。配置错误走退出码 2。
pub(crate) fn run_recommend(
    experiment: &Path,
    sweep_path: &Path,
    out: Option<&Path>,
) -> anyhow::Result<()> {
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
