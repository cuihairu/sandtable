//! 报告数据面:产物发现 / 分类装载(Sources)/ 候选统计与 days.csv 列提取。
//! 只读解析,不渲染(渲染在 html,图表在 svg)。

use std::path::Path;

use anyhow::Context;
use serde_json::Value;

/// 可识别的产物文件名(目录发现顺序)。
pub(crate) const KNOWN: [&str; 5] = [
    "report.json",
    "comparison.json",
    "sweep.json",
    "rec.json",
    "days.csv",
];

/// 已发现的源。JSON 按内容分类,文件名只是提示。
#[derive(Default)]

pub(crate) struct Sources {
    pub(crate) reports: Vec<Value>,
    pub(crate) comparisons: Vec<Value>,
    pub(crate) sweeps: Vec<Value>,
    pub(crate) recs: Vec<Value>,
    pub(crate) days: Vec<String>,
    /// 页首展示的实际读取清单
    pub(crate) found: Vec<String>,
}

impl Sources {
    pub(crate) fn push_json(&mut self, name: &str, v: Value) {
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

    pub(crate) fn is_empty(&self) -> bool {
        self.found.is_empty()
    }
}

pub(crate) fn load(src: &mut Sources, path: &Path) -> anyhow::Result<()> {
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

/// 单条指标统计:name → (mean, ci95_lo, ci95_hi)。
pub(crate) type Stat = (String, (f64, f64, f64));

/// 单条候选的指标统计(name → mean / CI)。
pub(crate) fn stat_map(r: &Value) -> Vec<Stat> {
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

/// days.csv 解析为(表头, 数值行);行长度不齐或解析失败的行丢弃。
pub(crate) fn days_frame(csv: &str) -> Option<(Vec<&str>, Vec<Vec<f64>>)> {
    let mut lines = csv.lines();
    let header = lines.next()?;
    let cols: Vec<&str> = header.split(',').collect();
    if cols.len() < 2 {
        return None;
    }
    let rows: Vec<Vec<f64>> = lines
        .filter_map(|l| {
            let cells: Vec<&str> = l.split(',').collect();
            (cells.len() == cols.len())
                .then(|| cells.iter().map(|c| c.trim().parse::<f64>().ok()).collect())
                .flatten()
        })
        .collect();
    (!rows.is_empty()).then_some((cols, rows))
}

/// 按列名取数值列。
pub(crate) fn days_col(cols: &[&str], rows: &[Vec<f64>], name: &str) -> Option<Vec<f64>> {
    let i = cols.iter().position(|c| *c == name)?;
    Some(rows.iter().map(|r| r[i]).collect())
}
