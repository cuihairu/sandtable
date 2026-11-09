//! 报告渲染面:HTML 外壳 + 各板块(字符串拼接,无模板引擎)。

use std::collections::BTreeMap;

use sandtable_core as core;
use serde_json::Value;

use super::data::{days_col, days_frame, stat_map, Sources, Stat};
use super::svg::{svg_bars, svg_chart, Chart, Series};

const SHELL: &str = r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sandtable 报告</title>
<style>
:root{--fg:#1f2328;--mut:#656d76;--line:#d8dee4;--acc:#0969da;--ok:#1a7f37;--warn:#9a6700;--bad:#cf222e;--chip:#eef2f6}
*{box-sizing:border-box}
body{margin:0 auto;padding:28px 20px 64px;max-width:1020px;font:14px/1.65 -apple-system,"Segoe UI","PingFang SC","Noto Sans CJK SC",sans-serif;color:var(--fg);background:#fff}
h1{font-size:26px;margin:0 0 6px}
h2{font-size:17px;margin:34px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
.mut{color:var(--mut)}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{border:1px solid var(--line);padding:5px 9px;text-align:right;white-space:nowrap}
th{background:var(--chip);font-weight:600}
th:first-child,td:first-child{text-align:left}
td.wrap{white-space:normal;max-width:360px}
.pass{color:var(--ok)}.borderline{color:var(--warn)}.fail,.err{color:var(--bad)}
.badge{display:inline-block;padding:2px 12px;border-radius:999px;background:var(--chip);border:1px solid var(--line);font-weight:600}
.badge.high{color:var(--ok)}.badge.medium{color:var(--warn)}.badge.low{color:var(--bad)}
.kv{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0}
.kv div{background:var(--chip);border:1px solid var(--line);border-radius:6px;padding:8px 14px}
.kv b{display:block;font-size:12px;color:var(--mut);font-weight:600}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(440px,1fr));gap:14px}
svg{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:6px;background:#fff}
ul.reasons{margin:8px 0;padding-left:22px}
code{background:var(--chip);padding:1px 5px;border-radius:4px}
footer{margin-top:44px;border-top:1px solid var(--line);padding-top:10px;font-size:12px;color:var(--mut)}
</style>
</head>
<body>
<h1>Sandtable 报告</h1>
<p class="mut">读取:{sources} · 只读产物,未重新仿真</p>
<p class="mut"><b>模型边界</b>:置信区间与差值判定仅在仿真模型内有效——行为概率为人为设定,结论用于相对比较与平衡探索,不预测真实玩家的绝对行为(见文档 01)</p>
{body}
<footer>sandtable · 报告由已落盘产物渲染,数据口径见文档 9 / 10 章</footer>
</body>
</html>
"#;

pub(crate) fn page(src: &Sources) -> String {
    let mut body = String::new();
    section_overview(&mut body, src);
    section_kpi(&mut body, src);
    section_population(&mut body, src);
    section_power_dist(&mut body, src);
    section_compare(&mut body, src);
    section_sweep(&mut body, src);
    section_recommend(&mut body, src);
    section_days(&mut body, src);
    section_economy(&mut body, src);
    section_progression(&mut body, src);
    let sources = src
        .found
        .iter()
        .map(|n| format!("<code>{}</code>", esc(n)))
        .collect::<Vec<_>>()
        .join(" ");
    SHELL
        .replace("{sources}", &sources)
        .replace("{body}", &body)
}

pub(crate) fn esc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// 数值展示:大数少小数位、小数保 4 位,列宽稳定。
pub(crate) fn f(v: f64) -> String {
    if v == 0.0 {
        "0".into()
    } else if v.abs() >= 100.0 {
        format!("{v:.2}")
    } else {
        format!("{v:.4}")
    }
}

// ---------------------------------------------------------------- 总览板块

/// 总览块(原计划 Phase 7:Dashboard):run 身份一屏读全——规模 / 时长 /
/// replicates / 种子 / 版本 / config_hash。取第一份 report 的 meta 与首 replicate。
pub(crate) fn section_overview(body: &mut String, src: &Sources) {
    let Some(r) = src.reports.first() else {
        return;
    };
    let results = r.get("results").and_then(Value::as_array);
    let Some(r0) = results.and_then(|a| a.first()) else {
        return;
    };
    let u64_of = |v: &Value, k: &str| v.get(k).and_then(Value::as_u64);
    let mut chips: Vec<(&str, String)> = vec![
        (
            "玩家数",
            u64_of(r0, "players")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "?".into()),
        ),
        (
            "时长",
            u64_of(r0, "days")
                .map(|v| format!("{v} 天"))
                .unwrap_or_else(|| "?".into()),
        ),
        (
            "replicates",
            results.map(|a| a.len()).unwrap_or(0).to_string(),
        ),
        (
            "基础种子",
            u64_of(r0, "seed")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "?".into()),
        ),
    ];
    if let Some(meta) = r.get("meta") {
        let s_of = |k: &str| {
            meta.get(k)
                .and_then(Value::as_str)
                .unwrap_or("?")
                .to_string()
        };
        chips.push(("model_version", s_of("model_version")));
        chips.push(("git_sha", s_of("git_sha")));
    }
    // 多份 report 可能是不同配置:列出不同 hash 数,页内各板块按报告分列
    let mut hashes: Vec<String> = src
        .reports
        .iter()
        .flat_map(|r| {
            r.get("results")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(|x| {
            x.get("config_hash")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect();
    hashes.sort();
    hashes.dedup();
    if let Some(h) = hashes.first() {
        let short = h.get(..12).unwrap_or(h).to_string();
        chips.push((
            "config_hash",
            if hashes.len() == 1 {
                short
            } else {
                format!("{short} 等 {} 种", hashes.len())
            },
        ));
    }
    body.push_str("<h2>总览</h2>\n<div class=\"kv\">\n");
    for (k, v) in chips {
        body.push_str(&format!("<div><b>{k}</b>{}</div>\n", esc(&v)));
    }
    body.push_str("</div>\n");
}

// ------------------------------------------------------------- 分群画像板块

/// 分群画像(原计划 Phase 7:Population Analysis):按 report 聚合三分群——
/// 人数取首 replicate(人口结构固定),流失率跨 replicate 合并,均值跨 replicate 平均。
pub(crate) fn section_population(body: &mut String, src: &Sources) {
    for r in &src.reports {
        let Some(results) = r.get("results").and_then(Value::as_array) else {
            continue;
        };
        let Some(cohorts) = results
            .first()
            .and_then(|x| x.get("cohort_stats"))
            .and_then(Value::as_array)
        else {
            continue;
        };
        let names: Vec<&str> = cohorts
            .iter()
            .filter_map(|c| c.get("cohort").and_then(Value::as_str))
            .collect();
        if names.is_empty() {
            continue;
        }
        let n = results.len();
        let hash = results
            .first()
            .and_then(|x| x.get("config_hash"))
            .and_then(Value::as_str)
            .and_then(|h| h.get(..12))
            .unwrap_or("?");
        body.push_str(&format!(
            "<h2>分群画像</h2>\n<p class=\"mut\">config {hash} · replicates = {n}(人数为首 replicate 结构,流失率合并,均值跨 replicate 平均)</p>\n"
        ));

        let mut counts = Vec::new();
        let mut rates = Vec::new();
        let mut levels = Vec::new();
        let mut powers = Vec::new();
        let mut golds = Vec::new();
        for (i, name) in names.iter().enumerate() {
            let per: Vec<&Value> = results
                .iter()
                .filter_map(|x| x.get("cohort_stats").and_then(Value::as_array))
                .filter_map(|a| a.get(i))
                .filter(|c| c.get("cohort").and_then(Value::as_str) == Some(name))
                .collect();
            // I-026 · 均值除数必须跟条目数:某 replicate 缺该分群(索引错位或
            // 空群被省)时,旧代码除以 results.len() 会把均值稀释。
            // 均值走内核聚合 core::experiment::summarize(与 KPI 板块同口径)。
            let vals = |field: &str| -> Vec<f64> {
                per.iter()
                    .filter_map(|c| c.get(field).and_then(Value::as_f64))
                    .collect()
            };
            let mean_of = |field: &str| -> f64 { core::experiment::summarize(&vals(field)).mean };
            let count = cohorts[i]
                .get("count")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            counts.push(count);
            let churn_sum: f64 = vals("churned").iter().sum();
            let denom_sum: f64 = vals("count").iter().sum();
            rates.push(if denom_sum > 0.0 {
                churn_sum / denom_sum
            } else {
                0.0
            });
            levels.push(mean_of("mean_level"));
            powers.push(mean_of("mean_power"));
            golds.push(mean_of("mean_gold"));
        }

        body.push_str("<table><thead><tr><th>分群</th><th>人数</th><th>流失率</th><th>平均等级</th><th>平均战力</th><th>平均金币</th></tr></thead><tbody>\n");
        for (i, name) in names.iter().enumerate() {
            body.push_str(&format!(
                "<tr><td>{name}</td><td>{:.0}</td><td>{:.2}%</td><td>{}</td><td>{}</td><td>{}</td></tr>\n",
                counts[i],
                rates[i] * 100.0,
                f(levels[i]),
                f(powers[i]),
                f(golds[i]),
            ));
        }
        body.push_str("</tbody></table>\n");

        body.push_str("<div class=\"grid\">\n");
        body.push_str(&svg_bars(
            "平均战力(按分群)",
            &names,
            &powers,
            "#0969da",
            &f,
        ));
        body.push_str(&svg_bars(
            "流失率(按分群)",
            &names,
            &rates,
            "#cf222e",
            &|v| format!("{:.1}%", v * 100.0),
        ));
        body.push_str("</div>\n");
    }
}

// ------------------------------------------------------------------ KPI 板块

/// 报告用 KPI 列表:(JSON 字段, 表头)。retention 系列是 Option,短跑为 null 时跳过。
const KPIS: [(&str, &str); 8] = [
    ("retention_d3", "D3 留存"),
    ("retention_d7", "D7 留存"),
    ("retention_d30", "D30 留存"),
    ("win_rate", "全程胜率"),
    ("churn_rate_total", "累计流失率"),
    ("gold_earned_total", "金币产出"),
    ("inflation_daily_mean", "日均通胀"),
    ("sink_ratio_mean", "sink_ratio 均值"),
];

pub(crate) fn section_kpi(body: &mut String, src: &Sources) {
    let results: Vec<&Value> = src
        .reports
        .iter()
        .flat_map(|r| r.get("results").and_then(Value::as_array))
        .flat_map(|a| a.iter())
        .collect();
    if results.is_empty() {
        return;
    }
    body.push_str("<h2>KPI 汇总</h2>\n<table><thead><tr><th>指标</th><th>n</th><th>mean</th><th>CI₉₅ 下界</th><th>CI₉₅ 上界</th></tr></thead><tbody>\n");
    for (field, label) in KPIS {
        let vals: Vec<f64> = results
            .iter()
            .filter_map(|r| r.get(field).and_then(Value::as_f64))
            .collect();
        if vals.is_empty() {
            continue;
        }
        let n = vals.len();
        let s = core::experiment::summarize(&vals);
        body.push_str(&format!(
            "<tr><td>{label}</td><td>{n}</td><td>{}</td><td>{}</td><td>{}</td></tr>\n",
            f(s.mean),
            f(s.ci95_lo),
            f(s.ci95_hi)
        ));
    }
    body.push_str("</tbody></table>\n");
}

// ----------------------------------------------------------- 群体分位板块

/// 群体分位曲线(原计划 Phase 7:Population Analysis 的分布面):
/// power_snapshots 的 p50/p90/p99 随快照日三线同轴;快照日是抽样点非逐天,
/// 各 replicate 的同日分位取平均。
pub(crate) fn section_power_dist(body: &mut String, src: &Sources) {
    for r in &src.reports {
        let Some(results) = r.get("results").and_then(Value::as_array) else {
            continue;
        };
        let mut acc: BTreeMap<u64, Vec<[f64; 3]>> = BTreeMap::new();
        for x in results {
            let Some(snaps) = x.get("power_snapshots").and_then(Value::as_array) else {
                continue;
            };
            for s in snaps {
                let (Some(day), Some(p50), Some(p90), Some(p99)) = (
                    s.get("day").and_then(Value::as_u64),
                    s.get("p50").and_then(Value::as_f64),
                    s.get("p90").and_then(Value::as_f64),
                    s.get("p99").and_then(Value::as_f64),
                ) else {
                    continue;
                };
                acc.entry(day).or_default().push([p50, p90, p99]);
            }
        }
        if acc.is_empty() {
            continue;
        }
        let xs: Vec<f64> = acc.keys().map(|d| *d as f64).collect();
        let mean_at = |j: usize| -> Vec<f64> {
            acc.values()
                .map(|v| v.iter().map(|t| t[j]).sum::<f64>() / v.len() as f64)
                .collect()
        };
        let (p50, p90, p99) = (mean_at(0), mean_at(1), mean_at(2));
        let hash = results
            .first()
            .and_then(|x| x.get("config_hash"))
            .and_then(Value::as_str)
            .and_then(|h| h.get(..12))
            .unwrap_or("?");
        body.push_str(&format!(
            "<h2>群体分位曲线</h2>\n<p class=\"mut\">config {hash} · replicates = {}(同日分位跨 replicate 平均;快照日为抽样点,非逐天)</p>\n<div class=\"grid\">\n",
            results.len()
        ));
        body.push_str(&svg_chart(&Chart {
            title: "战力分位 p50 / p90 / p99",
            x_label: "day",
            xs: &xs,
            series: vec![
                Series {
                    label: Some("p50"),
                    ys: &p50,
                    color: "#0969da",
                },
                Series {
                    label: Some("p90"),
                    ys: &p90,
                    color: "#9a6700",
                },
                Series {
                    label: Some("p99"),
                    ys: &p99,
                    color: "#cf222e",
                },
            ],
            ci: None,
            mark: None,
        }));
        body.push_str("</div>\n");
    }
}

// --------------------------------------------------------------- A/B 对比板块

fn verdict_text(v: &str) -> &'static str {
    match v {
        "BHigher" | "b_higher" => "B 高于 A",
        "AHigher" | "a_higher" => "A 高于 B",
        "NoDifference" | "no_difference" => "无显著差异",
        _ => "—",
    }
}

pub(crate) fn section_compare(body: &mut String, src: &Sources) {
    for c in &src.comparisons {
        let Some(cmp) = c.get("comparison") else {
            continue;
        };
        body.push_str("<h2>A/B 对比</h2>\n");
        body.push_str(&format!(
            "<p>指标 <code>{}</code> · A(attack = {}) → B(attack = {})</p>\n",
            esc(c.get("metric").and_then(Value::as_str).unwrap_or("?")),
            esc(&c.get("attack_a").map(|v| v.to_string()).unwrap_or_default()),
            esc(&c.get("attack_b").map(|v| v.to_string()).unwrap_or_default()),
        ));
        let Some(arm_a) = cmp
            .get("arm_a")
            .and_then(|a| a.get("mean"))
            .and_then(Value::as_f64)
        else {
            continue;
        };
        let arm_b = cmp
            .get("arm_b")
            .and_then(|a| a.get("mean"))
            .and_then(Value::as_f64)
            .unwrap_or(f64::NAN);
        body.push_str("<table><thead><tr><th>A 均值</th><th>B 均值</th><th>配对差</th><th>差值 CI 下</th><th>差值 CI 上</th><th>效应量 d</th><th>判定</th></tr></thead><tbody>\n");
        body.push_str(&format!(
            "<tr><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>\n",
            f(arm_a),
            f(arm_b),
            f(cmp.get("diff_mean").and_then(Value::as_f64).unwrap_or(f64::NAN)),
            f(cmp.get("diff_ci95_lo").and_then(Value::as_f64).unwrap_or(f64::NAN)),
            f(cmp.get("diff_ci95_hi").and_then(Value::as_f64).unwrap_or(f64::NAN)),
            f(cmp.get("effect_size_d").and_then(Value::as_f64).unwrap_or(f64::NAN)),
            esc(verdict_text(
                cmp.get("verdict").and_then(Value::as_str).unwrap_or("")
            )),
        ));
        body.push_str("</tbody></table>\n");
    }
}

// --------------------------------------------------------------- 扫描板块

pub(crate) fn section_sweep(body: &mut String, src: &Sources) {
    for sw in &src.sweeps {
        let spec = sw.get("spec");
        let results = match sw.get("results").and_then(Value::as_array) {
            Some(r) if !r.is_empty() => r,
            _ => continue,
        };
        let params: Vec<String> = spec
            .and_then(|s| s.get("parameters"))
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|p| p.get("path").and_then(Value::as_str).map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        if params.is_empty() {
            continue;
        }

        body.push_str("<h2>参数扫描</h2>\n");
        if let Some(counts) = sw.get("counts") {
            let num = |k: &str| counts.get(k).and_then(Value::as_u64).unwrap_or(0);
            body.push_str(&format!(
                "<p>候选 {} · 成功 {} · 配置错误 {} · 判定 <span class=\"pass\">PASS {}</span> / <span class=\"borderline\">BORDERLINE {}</span> / <span class=\"fail\">FAIL {}</span></p>\n",
                num("candidates"),
                num("ok"),
                num("config_error"),
                counts
                    .get("verdicts")
                    .map(|v| v.get("pass").and_then(Value::as_u64).unwrap_or(0))
                    .unwrap_or(0),
                counts
                    .get("verdicts")
                    .map(|v| v.get("borderline").and_then(Value::as_u64).unwrap_or(0))
                    .unwrap_or(0),
                counts
                    .get("verdicts")
                    .map(|v| v.get("fail").and_then(Value::as_u64).unwrap_or(0))
                    .unwrap_or(0),
            ));
        }

        // 列:参数(全路径,诚实)、状态、各指标均值、各目标判定
        let mut metrics: Vec<String> = Vec::new();
        for r in results {
            for (name, _) in stat_map(r) {
                if !metrics.contains(&name) {
                    metrics.push(name);
                }
            }
        }
        let mut targets: Vec<String> = Vec::new();
        if let Some(ts) = spec
            .and_then(|s| s.get("targets"))
            .and_then(Value::as_array)
        {
            for t in ts {
                if let Some(m) = t.get("metric").and_then(Value::as_str) {
                    if !targets.contains(&m.to_string()) {
                        targets.push(m.to_string());
                    }
                }
            }
        }

        body.push_str("<table><thead><tr>");
        for p in &params {
            body.push_str(&format!("<th>{}</th>", esc(p)));
        }
        body.push_str("<th>状态</th>");
        for m in &metrics {
            body.push_str(&format!("<th>{}</th>", esc(m)));
        }
        for t in &targets {
            body.push_str(&format!("<th>判定 · {t}</th>"));
        }
        body.push_str("</tr></thead><tbody>\n");
        for r in results {
            body.push_str("<tr>");
            for p in &params {
                let v = r
                    .get("values")
                    .and_then(|m| m.get(p))
                    .and_then(Value::as_f64)
                    .map(f)
                    .unwrap_or_else(|| "—".into());
                body.push_str(&format!("<td>{v}</td>"));
            }
            match r.get("status") {
                Some(s) if s.as_str() == Some("ok") => body.push_str("<td>ok</td>"),
                Some(s) => {
                    let msg = s
                        .get("config_error")
                        .and_then(Value::as_str)
                        .unwrap_or("配置错误");
                    body.push_str(&format!("<td class=\"err wrap\">{}</td>", esc(msg)));
                }
                None => body.push_str("<td>—</td>"),
            }
            let stats = stat_map(r);
            for m in &metrics {
                match stats.iter().find(|(n, _)| n == m) {
                    Some((_, (mean, _, _))) => body.push_str(&format!("<td>{}</td>", f(*mean))),
                    None => body.push_str("<td>—</td>"),
                }
            }
            for t in &targets {
                let verdict = r
                    .get("target_outcomes")
                    .and_then(Value::as_array)
                    .and_then(|a| {
                        a.iter()
                            .find(|o| o.get("metric").and_then(Value::as_str) == Some(t))
                    })
                    .and_then(|o| o.get("verdict"))
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let cls = match verdict {
                    "pass" => "pass",
                    "borderline" => "borderline",
                    "fail" => "fail",
                    "missing" => "missing",
                    _ => "",
                };
                let txt = match verdict {
                    "pass" => "PASS",
                    "borderline" => "BORDERLINE",
                    "fail" => "FAIL",
                    "missing" => "MISSING",
                    _ => "—",
                };
                body.push_str(&format!("<td class=\"{cls}\">{txt}</td>"));
            }
            body.push_str("</tr>\n");
        }
        body.push_str("</tbody></table>\n");

        // 单轴才有"指标随参数变化"的图;多轴网格摊在两维上,不硬画
        if params.len() == 1 {
            section_sweep_charts(body, src, results, &params[0], &metrics);
        }
    }
}

/// 单轴扫描折线图:每指标一图,均值折线 + CI 须;推荐与扫描同轴时叠基线与可行区间带。
pub(crate) fn section_sweep_charts(
    body: &mut String,
    src: &Sources,
    results: &[Value],
    param: &str,
    metrics: &[String],
) {
    let mut mark: Option<(f64, Option<(f64, f64)>)> = None;
    for r in &src.recs {
        let Some(rec) = r.get("recommendation") else {
            continue;
        };
        if rec.get("param").and_then(Value::as_str) != Some(param) {
            continue;
        }
        if let Some(b) = rec.get("baseline").and_then(Value::as_f64) {
            let interval = rec
                .get("interval")
                .and_then(|i| Some((i.get(0)?.as_f64()?, i.get(1)?.as_f64()?)));
            mark = Some((b, interval));
        }
    }
    // 每候选:(轴值, 指标统计);ok 才有指标,失败候选自然缺
    let mut pts: Vec<(f64, Vec<Stat>)> = results
        .iter()
        .filter_map(|r| {
            if r.get("status").and_then(Value::as_str) != Some("ok") {
                return None;
            }
            let x = r.get("values")?.get(param)?.as_f64()?;
            Some((x, stat_map(r)))
        })
        .collect();
    pts.sort_by(|a, b| a.0.total_cmp(&b.0));
    body.push_str("<div class=\"grid\">\n");
    for m in metrics {
        let series: Vec<(f64, f64, f64, f64)> = pts
            .iter()
            .filter_map(|(x, stats)| {
                stats
                    .iter()
                    .find(|(n, _)| n == m)
                    .map(|(_, (mean, lo, hi))| (*x, *mean, *lo, *hi))
            })
            .collect();
        if series.is_empty() {
            continue;
        }
        let xs: Vec<f64> = series.iter().map(|s| s.0).collect();
        let ys: Vec<f64> = series.iter().map(|s| s.1).collect();
        let ci: Vec<(f64, f64)> = series.iter().map(|s| (s.2, s.3)).collect();
        body.push_str(&svg_chart(&Chart {
            title: m,
            x_label: param,
            xs: &xs,
            series: vec![Series {
                label: None,
                ys: &ys,
                color: "#0969da",
            }],
            ci: Some(&ci),
            mark,
        }));
    }
    body.push_str("</div>\n");
}

// ----------------------------------------------------------- 推荐板块

fn fnum(v: Option<&Value>) -> String {
    v.and_then(Value::as_f64)
        .map(f)
        .unwrap_or_else(|| "—".into())
}

pub(crate) fn section_recommend(body: &mut String, src: &Sources) {
    for r in &src.recs {
        body.push_str("<h2>敏感性与推荐</h2>\n");
        if let Some(els) = r.get("elasticities").and_then(Value::as_array) {
            body.push_str(
                "<table><thead><tr><th>参数 → 指标</th><th>E</th><th>CI 下</th><th>CI 上</th><th>δ_eff</th><th>显著性</th></tr></thead><tbody>\n",
            );
            for e in els {
                let p = e.get("param").and_then(Value::as_str).unwrap_or("?");
                let m = e.get("metric").and_then(Value::as_str).unwrap_or("?");
                let note = e.get("note").and_then(Value::as_str).unwrap_or("ok");
                if note == "ok" {
                    let sig = if e.get("significant").and_then(Value::as_bool) == Some(true) {
                        "显著"
                    } else {
                        "不显著"
                    };
                    body.push_str(&format!(
                        "<tr><td>{p} → {m}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{sig}</td></tr>\n",
                        fnum(e.get("e")),
                        fnum(e.get("e_lo")),
                        fnum(e.get("e_hi")),
                        fnum(e.get("delta_eff")),
                    ));
                } else {
                    body.push_str(&format!(
                        "<tr><td>{p} → {m}</td><td colspan=\"5\" class=\"mut\">不可算({note})</td></tr>\n"
                    ));
                }
            }
            body.push_str("</tbody></table>\n");
        }
        let Some(rec) = r.get("recommendation") else {
            continue;
        };
        let param = rec.get("param").and_then(Value::as_str).unwrap_or("?");
        let baseline = rec
            .get("baseline")
            .and_then(Value::as_f64)
            .map(f)
            .unwrap_or_else(|| "?".into());
        body.push_str("<div class=\"kv\">\n");
        body.push_str(&format!(
            "<div><b>Current</b><code>{}</code> = {baseline}</div>\n",
            esc(param)
        ));
        let interp = |k: usize| -> bool {
            rec.get("interpolated")
                .and_then(Value::as_array)
                .and_then(|a| a.get(k))
                .and_then(Value::as_bool)
                .unwrap_or(false)
        };
        match rec
            .get("interval")
            .and_then(|i| Some((i.get(0)?.as_f64()?, i.get(1)?.as_f64()?)))
        {
            Some((lo, hi)) => {
                let mut marks = Vec::new();
                if interp(0) {
                    marks.push("下端插值");
                }
                if interp(1) {
                    marks.push("上端插值");
                }
                let suffix = if marks.is_empty() {
                    String::new()
                } else {
                    format!(" <span class=\"mut\">({}·端点)</span>", marks.join(" · "))
                };
                body.push_str(&format!(
                    "<div><b>Recommended</b>{} ~ {}{}</div>\n",
                    f(lo),
                    f(hi),
                    suffix
                ));
            }
            None => body.push_str("<div><b>Recommended</b>无可行区间</div>\n"),
        }
        let conf = rec.get("confidence").and_then(Value::as_str).unwrap_or("?");
        let cls = match conf {
            "high" => "high",
            "medium" => "medium",
            _ => "low",
        };
        body.push_str(&format!(
            "<div><b>Confidence</b><span class=\"badge {cls}\">{conf}</span></div>\n"
        ));
        body.push_str("</div>\n");
        if let Some(rs) = rec.get("reasons").and_then(Value::as_array) {
            if !rs.is_empty() {
                body.push_str("<ul class=\"reasons\">\n");
                for x in rs {
                    if let Some(t) = x.as_str() {
                        body.push_str(&format!("<li>{}</li>\n", esc(t)));
                    }
                }
                body.push_str("</ul>\n");
            }
        }
    }
}

// ----------------------------------------------------------- 按天时序板块

/// days.csv → 每数值列一张小折线图(各列自持 y 范围,量纲不互扰)。
pub(crate) fn section_days(body: &mut String, src: &Sources) {
    for csv in &src.days {
        let Some((cols, rows)) = days_frame(csv) else {
            continue;
        };
        body.push_str("<h2>按天指标</h2>\n<div class=\"grid\">\n");
        let xs: Vec<f64> = rows.iter().map(|r| r[0]).collect();
        for ci in 1..cols.len() {
            let ys: Vec<f64> = rows.iter().map(|r| r[ci]).collect();
            body.push_str(&svg_chart(&Chart {
                title: cols[ci],
                x_label: cols[0],
                xs: &xs,
                series: vec![Series {
                    label: None,
                    ys: &ys,
                    color: "#0969da",
                }],
                ci: None,
                mark: None,
            }));
        }
        body.push_str("</div>\n");
    }
}

// ----------------------------------------------------------- 经济流板块

/// 经济流(原计划 Phase 7:Economy Flow):产出 vs 消耗双线(同量纲共用 y 轴)
/// + 累计汇总(合计 sink = Σ消耗 / Σ产出)。
pub(crate) fn section_economy(body: &mut String, src: &Sources) {
    for csv in &src.days {
        let Some((cols, rows)) = days_frame(csv) else {
            continue;
        };
        let (Some(earned), Some(spent)) = (
            days_col(&cols, &rows, "gold_earned"),
            days_col(&cols, &rows, "gold_spent"),
        ) else {
            continue;
        };
        let xs: Vec<f64> = rows.iter().map(|r| r[0]).collect();
        let sum = |v: &[f64]| v.iter().sum::<f64>();
        let sink = if sum(&earned) > 0.0 {
            sum(&spent) / sum(&earned)
        } else {
            0.0
        };
        let supply = days_col(&cols, &rows, "gold_supply");
        body.push_str("<h2>经济流</h2>\n<div class=\"kv\">\n");
        body.push_str(&format!("<div><b>累计产出</b>{}</div>\n", f(sum(&earned))));
        body.push_str(&format!("<div><b>累计消耗</b>{}</div>\n", f(sum(&spent))));
        body.push_str(&format!(
            "<div><b>合计 sink</b>{:.2}%</div>\n",
            sink * 100.0
        ));
        if let Some(s) = &supply {
            body.push_str(&format!(
                "<div><b>期末存量</b>{}</div>\n",
                f(*s.last().unwrap_or(&0.0))
            ));
        }
        body.push_str("</div>\n<div class=\"grid\">\n");
        body.push_str(&svg_chart(&Chart {
            title: "产出 vs 消耗(按天)",
            x_label: cols[0],
            xs: &xs,
            series: vec![
                Series {
                    label: Some("产出 gold_earned"),
                    ys: &earned,
                    color: "#0969da",
                },
                Series {
                    label: Some("消耗 gold_spent"),
                    ys: &spent,
                    color: "#9a6700",
                },
            ],
            ci: None,
            mark: None,
        }));
        body.push_str("</div>\n");
    }
}

// ----------------------------------------------------------- 成长曲线板块

/// 成长曲线(原计划 Phase 7:Progression Curve):平均战力按天(存量)+
/// 升级次数累计(节奏;战力与升级次数量纲悬殊,分图各持 y 轴,不硬画双轴)。
pub(crate) fn section_progression(body: &mut String, src: &Sources) {
    for csv in &src.days {
        let Some((cols, rows)) = days_frame(csv) else {
            continue;
        };
        let (Some(power), Some(levelups)) = (
            days_col(&cols, &rows, "mean_power"),
            days_col(&cols, &rows, "levelups"),
        ) else {
            continue;
        };
        let xs: Vec<f64> = rows.iter().map(|r| r[0]).collect();
        let mut cum = Vec::with_capacity(levelups.len());
        let mut acc = 0.0;
        for v in &levelups {
            acc += v;
            cum.push(acc);
        }
        body.push_str("<h2>成长曲线</h2>\n<div class=\"grid\">\n");
        body.push_str(&svg_chart(&Chart {
            title: "平均战力(按天)",
            x_label: cols[0],
            xs: &xs,
            series: vec![Series {
                label: None,
                ys: &power,
                color: "#0969da",
            }],
            ci: None,
            mark: None,
        }));
        body.push_str(&svg_chart(&Chart {
            title: "升级次数累计",
            x_label: cols[0],
            xs: &xs,
            series: vec![Series {
                label: None,
                ys: &cum,
                color: "#1a7f37",
            }],
            ci: None,
            mark: None,
        }));
        body.push_str("</div>\n");
    }
}

// ------------------------------------------------------------ 手写 SVG 图
