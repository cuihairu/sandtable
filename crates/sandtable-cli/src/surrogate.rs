//! 随机森林代理子命令面(文档 12 章自动寻优增量):sweep 产物 →
//! 森林训练 / 参数预测 / 特征重要性。只读产物不进仿真路径。

use std::fs;
use std::path::PathBuf;

use anyhow::Context;

use crate::args::SurrogateAction;
use sandtable_core as core;

/// sweep.json 回读结构(只要 spec 与 results;meta / counts 忽略)。
#[derive(serde::Deserialize)]
pub(crate) struct SweepRun {
    pub(crate) spec: core::sweep::SweepSpec,
    pub(crate) results: Vec<core::sweep::CandidateResult>,
}

/// 随机森林代理子命令(文档 12 章自动寻优增量,2026-10-10 裁定):
/// sweep 产物 → 森林训练 / 参数预测 / 特征重要性。只读产物不进仿真路径。
/// 配置错误走退出码 2。
pub(crate) fn run_surrogate(action: &SurrogateAction) -> anyhow::Result<()> {
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
                anyhow::anyhow!("未知指标 {metric}(可选 retention_d7 | retention_d3 | win_rate | gold_per_player | power_p50 | churn_rate | gacha_pulls_to_hit | loot_gold_per_player)")
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
            // model.json 是外部输入面:回读先校验(特征下标越界会在预测时 panic)
            forest
                .validate()
                .map_err(|e| anyhow::anyhow!("模型无效: {e}"))?;
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
            let values = forest.tree_values(&row)?;
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
            forest
                .validate()
                .map_err(|e| anyhow::anyhow!("模型无效: {e}"))?;
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
