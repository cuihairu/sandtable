//! HTML 报告(Phase 5,文档 9/10 章):读已落盘产物 → 单文件自包含 HTML。
//!
//! 纪律:
//! - 只读文件,不重新仿真(与 `query` 同一条:产物 → 报告,仿真路径之外);
//! - 发现什么渲染什么,缺失的板块跳过,页首列出实际读取的源;
//! - 输出内联 CSS + 手写内联 SVG,无 CDN、无 JS,离线双击可开;
//! - 一个源文件都找不到则报错(调用方走退出码 2)。

use std::path::{Path, PathBuf};

use anyhow::{bail, Context};
use sandtable_core as core;
use serde_json::Value;

/// 可识别的产物文件名(目录发现顺序)。
const KNOWN: [&str; 5] = [
    "report.json",
    "comparison.json",
    "sweep.json",
    "rec.json",
    "days.csv",
];

/// 已发现的源。JSON 按内容分类,文件名只是提示。
#[derive(Default)]
struct Sources {
    reports: Vec<Value>,
    comparisons: Vec<Value>,
    sweeps: Vec<Value>,
    recs: Vec<Value>,
    days: Vec<String>,
    /// 页首展示的实际读取清单
    found: Vec<String>,
}

impl Sources {
    fn push_json(&mut self, name: &str, v: Value) {
        // 分类看内容,不依赖文件名(report.json 与 sweep.json 都有 results)
        let kind = if v.get("comparison").is_some() {
            1
        } else if v.get("recommendation").is_some() || v.get("elasticities").is_some() {
            2
        } else if v.get("spec").is_some() && v.get("results").is_some() {
            3
        } else if v.get("results").is_some() {
            0
        } else {
            return;
        };
        self.found.push(name.to_string());
        match kind {
            1 => self.comparisons.push(v),
            2 => self.recs.push(v),
            3 => self.sweeps.push(v),
            _ => self.reports.push(v),
        }
    }

    fn is_empty(&self) -> bool {
        self.found.is_empty()
    }
}

/// 渲染报告。输入是目录(发现约定文件)或直接给的产物文件。
pub fn render(inputs: &[PathBuf]) -> anyhow::Result<String> {
    let mut src = Sources::default();
    for input in inputs {
        if input.is_dir() {
            for name in KNOWN {
                let p = input.join(name);
                if p.is_file() {
                    load(&mut src, &p)?;
                }
            }
        } else if input.is_file() {
            load(&mut src, input)?;
        } else {
            bail!("{} 不存在", input.display());
        }
    }
    if src.is_empty() {
        bail!("给定路径中没有报告源(可识别:{})", KNOWN.join(" / "));
    }
    Ok(page(&src))
}

fn load(src: &mut Sources, path: &Path) -> anyhow::Result<()> {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string());
    let text =
        std::fs::read_to_string(path).with_context(|| format!("读取 {} 失败", path.display()))?;
    if name.ends_with(".json") || text.trim_start().starts_with('{') {
        let v: Value =
            serde_json::from_str(&text).with_context(|| format!("{} 解析失败", path.display()))?;
        src.push_json(&name, v);
    } else if name.ends_with(".csv") {
        // 目前只出按天时序图(约定 days.csv);其他 CSV 不是报告源
        if name == "days.csv" {
            src.found.push(name);
            src.days.push(text);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- HTML 骨架

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
{body}
<footer>sandtable · 报告由已落盘产物渲染,数据口径见文档 9 / 10 章</footer>
</body>
</html>
"#;

fn page(src: &Sources) -> String {
    let mut body = String::new();
    section_kpi(&mut body, src);
    section_compare(&mut body, src);
    section_sweep(&mut body, src);
    section_recommend(&mut body, src);
    section_days(&mut body, src);
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

fn esc(s: &str) -> String {
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
fn f(v: f64) -> String {
    if v == 0.0 {
        "0".into()
    } else if v.abs() >= 100.0 {
        format!("{v:.2}")
    } else {
        format!("{v:.4}")
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

fn section_kpi(body: &mut String, src: &Sources) {
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

// --------------------------------------------------------------- A/B 对比板块

fn verdict_text(v: &str) -> &'static str {
    match v {
        "BHigher" | "b_higher" => "B 高于 A",
        "AHigher" | "a_higher" => "A 高于 B",
        "NoDifference" | "no_difference" => "无显著差异",
        _ => "—",
    }
}

fn section_compare(body: &mut String, src: &Sources) {
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

/// 单条指标统计:name → (mean, ci95_lo, ci95_hi)。
type Stat = (String, (f64, f64, f64));

/// 单条候选的指标统计(name → mean / CI)。
fn stat_map(r: &Value) -> Vec<Stat> {
    r.get("metric_stats")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|e| {
                    let name = e.get(0)?.as_str()?.to_string();
                    let s = e.get(1)?;
                    Some((
                        name,
                        (
                            s.get("mean")?.as_f64()?,
                            s.get("ci95_lo")?.as_f64()?,
                            s.get("ci95_hi")?.as_f64()?,
                        ),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn section_sweep(body: &mut String, src: &Sources) {
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
                    _ => "",
                };
                let txt = match verdict {
                    "pass" => "PASS",
                    "borderline" => "BORDERLINE",
                    "fail" => "FAIL",
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
fn section_sweep_charts(
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
            ys: &ys,
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

fn section_recommend(body: &mut String, src: &Sources) {
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
fn section_days(body: &mut String, src: &Sources) {
    for csv in &src.days {
        let mut lines = csv.lines();
        let Some(header) = lines.next() else {
            continue;
        };
        let cols: Vec<&str> = header.split(',').collect();
        if cols.len() < 2 {
            continue;
        }
        let rows: Vec<Vec<f64>> = lines
            .filter_map(|l| {
                let cells: Vec<&str> = l.split(',').collect();
                (cells.len() == cols.len())
                    .then(|| cells.iter().map(|c| c.trim().parse::<f64>().ok()).collect())
                    .flatten()
            })
            .collect();
        if rows.is_empty() {
            continue;
        }
        body.push_str("<h2>按天指标</h2>\n<div class=\"grid\">\n");
        for ci in 1..cols.len() {
            let xs: Vec<f64> = rows.iter().map(|r| r[0]).collect();
            let ys: Vec<f64> = rows.iter().map(|r| r[ci]).collect();
            body.push_str(&svg_chart(&Chart {
                title: cols[ci],
                x_label: cols[0],
                xs: &xs,
                ys: &ys,
                ci: None,
                mark: None,
            }));
        }
        body.push_str("</div>\n");
    }
}

// ------------------------------------------------------------ 手写 SVG 图

struct Chart<'a> {
    title: &'a str,
    x_label: &'a str,
    xs: &'a [f64],
    ys: &'a [f64],
    /// 每点 CI 须 (lo, hi);None = 无须
    ci: Option<&'a [(f64, f64)]>,
    /// 基线(虚线)与可行区间带,随 x 轴量纲
    mark: Option<(f64, Option<(f64, f64)>)>,
}

fn svg_chart(c: &Chart) -> String {
    const W: f64 = 460.0;
    const H: f64 = 190.0;
    const PL: f64 = 56.0;
    const PR: f64 = 14.0;
    const PT: f64 = 34.0;
    const PB: f64 = 34.0;
    if c.xs.is_empty() || c.ys.is_empty() {
        return format!("<div class=\"mut\">{}:无数据</div>", esc(c.title));
    }
    let n = c.xs.len().min(c.ys.len());
    let mut x0 = f64::INFINITY;
    let mut x1 = f64::NEG_INFINITY;
    let mut y0 = f64::INFINITY;
    let mut y1 = f64::NEG_INFINITY;
    for i in 0..n {
        x0 = x0.min(c.xs[i]);
        x1 = x1.max(c.xs[i]);
        y0 = y0.min(c.ys[i]);
        y1 = y1.max(c.ys[i]);
    }
    if let Some(ci) = c.ci {
        for &(lo, hi) in &ci[..n.min(ci.len())] {
            y0 = y0.min(lo);
            y1 = y1.max(hi);
        }
    }
    if let Some((b, band)) = c.mark {
        // 基线与区间带是 x 轴(参数)量纲,纳入范围免裁剪
        x0 = x0.min(b);
        x1 = x1.max(b);
        if let Some((a, d)) = band {
            x0 = x0.min(a);
            x1 = x1.max(d);
        }
    }
    if x0 == x1 {
        x0 -= 0.5;
        x1 += 0.5;
    }
    if (y1 - y0).abs() < f64::EPSILON {
        y0 -= 0.5;
        y1 += 0.5;
    } else {
        let pad = (y1 - y0) * 0.06;
        y0 -= pad;
        y1 += pad;
    }
    let sx = |x: f64| PL + (x - x0) / (x1 - x0) * (W - PL - PR);
    let sy = |y: f64| PT + (1.0 - (y - y0) / (y1 - y0)) * (H - PT - PB);
    let mut g = String::new();
    if let Some((_, Some((a, d)))) = c.mark {
        let (rx0, rx1) = (sx(a).max(PL), sx(d).min(W - PR));
        if rx1 > rx0 {
            g.push_str(&format!(
                "<rect x=\"{rx0:.1}\" y=\"{PT}\" width=\"{w:.1}\" height=\"{h:.1}\" fill=\"#0969da\" opacity=\"0.10\"/>",
                w = rx1 - rx0,
                h = H - PT - PB
            ));
        }
    }
    if let Some((b, _)) = c.mark {
        let x = sx(b);
        g.push_str(&format!(
            "<line x1=\"{x:.1}\" y1=\"{PT}\" x2=\"{x:.1}\" y2=\"{yb:.1}\" stroke=\"#cf222e\" stroke-width=\"1\" stroke-dasharray=\"4 3\"/>",
            yb = H - PB
        ));
        g.push_str(&format!(
            "<text x=\"{x:.1}\" y=\"{ty:.1}\" font-size=\"9\" fill=\"#cf222e\" text-anchor=\"middle\">基线</text>",
            ty = PT + 11.0
        ));
    }
    if let Some(ci) = c.ci {
        for (i, &(lo, hi)) in ci.iter().enumerate().take(n) {
            let x = sx(c.xs[i]);
            let (lo, hi) = (lo.max(y0), hi.min(y1));
            let (ya, yb) = (sy(hi), sy(lo));
            g.push_str(&format!(
                "<line x1=\"{x:.1}\" y1=\"{ya:.1}\" x2=\"{x:.1}\" y2=\"{yb:.1}\" stroke=\"#9a6700\" stroke-width=\"1.4\" opacity=\"0.9\"/>"
            ));
            g.push_str(&format!(
                "<line x1=\"{lx:.1}\" y1=\"{ya:.1}\" x2=\"{rx:.1}\" y2=\"{ya:.1}\" stroke=\"#9a6700\" stroke-width=\"1.4\" opacity=\"0.9\"/>",
                lx = x - 3.0,
                rx = x + 3.0
            ));
            g.push_str(&format!(
                "<line x1=\"{lx:.1}\" y1=\"{yb:.1}\" x2=\"{rx:.1}\" y2=\"{yb:.1}\" stroke=\"#9a6700\" stroke-width=\"1.4\" opacity=\"0.9\"/>",
                lx = x - 3.0,
                rx = x + 3.0
            ));
        }
    }
    let poly: String = (0..n)
        .map(|i| format!("{:.1},{:.1}", sx(c.xs[i]), sy(c.ys[i])))
        .collect::<Vec<_>>()
        .join(" ");
    g.push_str(&format!(
        "<polyline points=\"{poly}\" fill=\"none\" stroke=\"#0969da\" stroke-width=\"1.8\" stroke-linejoin=\"round\"/>"
    ));
    for i in 0..n {
        let (x, y) = (sx(c.xs[i]), sy(c.ys[i]));
        g.push_str(&format!(
            "<circle cx=\"{x:.1}\" cy=\"{y:.1}\" r=\"2.6\" fill=\"#0969da\"/>"
        ));
    }
    // 框线与刻度文字
    g.push_str(&format!(
        "<line x1=\"{pl}\" y1=\"{yb}\" x2=\"{pr}\" y2=\"{yb}\" stroke=\"#d8dee4\" stroke-width=\"1\"/>",
        pl = PL,
        pr = W - PR,
        yb = H - PB
    ));
    g.push_str(&format!(
        "<text x=\"{lx:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"end\">{}</text>",
        f(y1),
        lx = PL - 6.0,
        ty = PT + 8.0
    ));
    g.push_str(&format!(
        "<text x=\"{lx:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"end\">{}</text>",
        f(y0),
        lx = PL - 6.0,
        ty = H - PB
    ));
    g.push_str(&format!(
        "<text x=\"{x:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"middle\">{}</text>",
        f(c.xs[0]),
        x = sx(c.xs[0]),
        ty = H - PB + 14.0
    ));
    g.push_str(&format!(
        "<text x=\"{x:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"middle\">{}</text>",
        f(c.xs[n - 1]),
        x = sx(c.xs[n - 1]),
        ty = H - PB + 14.0
    ));
    g.push_str(&format!(
        "<text x=\"{x:.1}\" y=\"17\" font-size=\"11\" fill=\"#1f2328\" font-weight=\"600\" text-anchor=\"middle\">{}</text>",
        esc(c.title),
        x = (PL + W - PR) / 2.0
    ));
    g.push_str(&format!(
        "<text x=\"{x:.1}\" y=\"{ty:.1}\" font-size=\"10\" fill=\"#656d76\" text-anchor=\"middle\">{}</text>",
        esc(c.x_label),
        x = (PL + W - PR) / 2.0,
        ty = H - 6.0
    ));
    format!("<svg viewBox=\"0 0 {W} {H}\" role=\"img\">{g}</svg>")
}
