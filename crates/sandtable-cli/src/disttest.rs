//! 分布检验子命令面(文档 24 章 R1):均匀 / 加权 / 正态 χ² 检验,
//! 通过退出码 0,失败退出码 1,配置错误退出码 2。

use std::fs;

use anyhow::Context;

use crate::args::DisttestAction;
use sandtable_core as core;

/// 分布检验子命令(文档 24 章 R1):均匀 / 加权 χ² 检验。
/// 通过退出码 0,失败退出码 1,配置错误退出码 2。
pub(crate) fn run_disttest(action: &DisttestAction) -> anyhow::Result<std::process::ExitCode> {
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
        DisttestAction::Normal {
            samples,
            buckets,
            spread,
            mu,
            sigma,
            alpha,
            seed,
        } => {
            if *sigma <= 0.0 || !sigma.is_finite() {
                anyhow::bail!("σ 须为正有限数");
            }
            if *spread <= 0.0 || !spread.is_finite() {
                anyhow::bail!("spread 须为正有限数(σ 的倍数)");
            }
            if *alpha <= 0.0 || *alpha >= 1.0 {
                anyhow::bail!("α 须在 (0, 1) 区间内");
            }
            let mut rng = core::rng::DayRng::new(*seed, 1, 1);
            let xs: Vec<f64> = (0..*samples)
                .map(|_| rng.normal(core::rng::Purpose::Normal, *mu, *sigma))
                .collect();
            let n = xs.len() as f64;
            let mean = xs.iter().sum::<f64>() / n;
            let var = xs.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>() / (n - 1.0).max(1.0);
            println!("=== normal N({}, {}²) 抽样面 ===", mu, sigma);
            println!(
                "  实测均值 {mean:.4}(μ = {mu})· 实测方差 {var:.4}(σ² = {:.4})",
                sigma * sigma
            );
            let (obs, exp) = core::disttest::normal_buckets(&xs, *mu, *sigma, *buckets, *spread)?;
            let p = print_chi_square(
                &format!("normal N({}, {}), ±{}σ", mu, sigma, spread),
                &obs,
                &exp,
                *alpha,
            );
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
