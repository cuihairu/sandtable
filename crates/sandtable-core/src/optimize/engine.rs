//! 寻优引擎面:optimize 主循环(进化 / Pareto)与初始种群均匀采样。

use super::fitness::{Fitness, ParetoFit};
use super::ranking::Ranking;
use super::result::OptimResult;
use super::spec::{OptimMode, OptimSpec};
use crate::config::SimConfig;
use crate::experiment::MetricKey;
use crate::sweep::{run_candidate, CandidateResult, ParamRange, SweepRng};
use crate::Error;
use std::collections::BTreeMap;

/// 运行寻优(纯内核、单线程、逐代依赖;文档 12 章)。进化与 Pareto 共用
/// 主循环:适应度形态、精英序、锦标赛由 [`Ranking`] 分支,采样/交叉/变异
/// 序列两模式一致(RNG 消耗序不变)。
pub fn optimize(base: &SimConfig, spec: &OptimSpec) -> Result<OptimResult, Error> {
    spec.validate()?;
    // 目标可用性兜底(审核整改 P1;加载器 scenario::load_optimize_str 已
    // 预检,此处覆盖绕过加载器的直连调用):无值指标的目标/目标函数会
    // 在 run_candidate 被静默跳过。
    let check_metric = |m: MetricKey| -> Result<(), Error> {
        if let Some(reason) = m.unavailable_reason(base) {
            return Err(Error::Config(format!("optimize: {reason}")));
        }
        Ok(())
    };
    for t in &spec.targets {
        check_metric(t.metric)?;
    }
    for o in &spec.objectives {
        check_metric(o.metric)?;
    }
    if let Some(o) = &spec.objective {
        check_metric(o.metric)?;
    }
    let eval_spec = spec.eval_spec();

    // 寻优流与扫描流分立:同 base_seed 的扫描与寻优不共享采样序列
    let mut rng = SweepRng::new(base.base_seed ^ 0x9E37_79B9_7F4A_7C15);
    let pop_n = spec.population as usize;
    let offspring_n = pop_n - spec.elite as usize;
    let hard_total = spec.targets.len() as u32;

    // 初始种群:各维 [min, max] 均匀
    let mut pop: Vec<BTreeMap<String, f64>> = (0..pop_n)
        .map(|_| sample_uniform(&spec.parameters, &mut rng))
        .collect();
    let mut results: Vec<CandidateResult> = pop
        .iter()
        .map(|v| run_candidate(base, &eval_spec, v))
        .collect();

    let mut evaluated = pop_n;
    let mut ranking = Ranking::compute(spec.mode, &results, spec);
    let mut history = vec![ranking.gen_stats(0, &results, spec, hard_total, pop_n)];
    let mut all: Vec<CandidateResult> = results.clone();
    // evolutionary 的全历史最优逐代累积(pareto 只答末代前沿,见 final_best)
    let mut best: Option<(Fitness, CandidateResult)> = None;

    for gen in 1..=spec.generations {
        // 精英:适应度降序前 elite 个
        let elites = ranking.elite_order(spec.elite as usize);

        // 子代:锦标赛(size 2)× 逐维均匀交叉 × 均匀变异
        let mut offspring = Vec::with_capacity(offspring_n);
        while offspring.len() < offspring_n {
            let pa = ranking.tournament(&mut rng);
            let pb = ranking.tournament(&mut rng);
            let mut child = BTreeMap::new();
            for p in &spec.parameters {
                let va = pop[pa].get(&p.path).copied().unwrap_or(p.min);
                let vb = pop[pb].get(&p.path).copied().unwrap_or(p.min);
                let v = if rng.next_f64() < 0.5 { va } else { vb };
                let v = if rng.next_f64() < spec.mutation_rate {
                    let w = p.max - p.min;
                    (v + (rng.next_f64() * 2.0 - 1.0) * spec.mutation_scale * w).clamp(p.min, p.max)
                } else {
                    v
                };
                child.insert(p.path.clone(), v);
            }
            offspring.push(child);
        }
        let off_results: Vec<CandidateResult> = offspring
            .iter()
            .map(|v| run_candidate(base, &eval_spec, v))
            .collect();
        evaluated += offspring_n;
        all.extend(off_results.iter().cloned());

        // 合并:精英原样 + 子代。pop 与 results 同步换血——精英基因重新
        // 进入交配池(修前 bug:pop 停在初始种群,第 2 代起 pop[pa] 读到
        // 初始基因,锦标赛选中的当代个体基因被忽略,GA 退化为初始重组合)
        let mut next_results = Vec::with_capacity(pop_n);
        let mut next_pop = Vec::with_capacity(pop_n);
        for &e in &elites {
            next_results.push(results[e].clone());
            next_pop.push(pop[e].clone());
        }
        next_results.extend(off_results);
        next_pop.extend(offspring);
        results = next_results;
        pop = next_pop;

        ranking = Ranking::compute(spec.mode, &results, spec);
        history.push(ranking.gen_stats(gen, &results, spec, hard_total, offspring_n));
        if spec.mode == OptimMode::Evolutionary {
            for r in &results {
                let f = Fitness::of(r, spec.objective.as_ref());
                match best {
                    None => best = Some((f, r.clone())),
                    Some((bf, _)) if f.better(bf) => best = Some((f, r.clone())),
                    _ => {}
                }
            }
        }
    }

    let (best_fitness, best, front0) = match spec.mode {
        OptimMode::Evolutionary => (
            best.as_ref().map(|(f, _)| *f),
            best.map(|(_, r)| r),
            Vec::new(),
        ),
        OptimMode::Pareto => {
            // 末代排序无有效前沿 = 全部候选配置错误(审核整改 P2:此前
            // expect 直接 panic;现在作为可读错误返回)
            let (max_pass, front) = ranking.pareto_front().ok_or_else(|| {
                Error::Config("寻优无有效前沿:所有候选均为配置错误,请检查参数范围与基础配置".into())
            })?;
            let candidates: Vec<CandidateResult> =
                front.iter().map(|&i| results[i].clone()).collect();
            let (rep, best) = match front.first() {
                None => (None, None),
                Some(&i) => (
                    Some(Fitness {
                        hard_pass: max_pass,
                        score: ParetoFit::objective_values(&results[i], &spec.objectives)
                            .first()
                            .copied()
                            .unwrap_or(f64::NEG_INFINITY),
                    }),
                    Some(results[i].clone()),
                ),
            };
            (rep, best, candidates)
        }
    };
    Ok(OptimResult {
        spec: spec.clone(),
        best,
        best_fitness,
        history,
        all,
        evaluated,
        total_sims: evaluated * spec.replicates as usize,
        front0,
    })
}

fn sample_uniform(parameters: &[ParamRange], rng: &mut SweepRng) -> BTreeMap<String, f64> {
    parameters
        .iter()
        .map(|p| {
            let v = p.min + rng.next_f64() * (p.max - p.min);
            (p.path.clone(), v)
        })
        .collect()
}
