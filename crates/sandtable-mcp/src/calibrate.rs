//! 本地数据校准对账(todo「数据分析面」step ①)。
//!
//! 安全边界:只读 [`CalibrationInput::data_dir`] 下的观测文件(.csv / .xlsx,
//! 后者复用 sandtable-cli 的 calamine 读取层);配置与映射均由调用方传入;
//! 输出只含聚合残差,不回显原始行。数据不做网络访问,也不做拟合——后者复用
//! 既有 sweep / optimize 管线。

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};

use sandtable_cli::xlsx;
use sandtable_core as core;

/// MCP 交互预算:避免代理在工具调用中请求全量多 replicate 重算。
pub const MAX_CALIBRATION_REPLICATES: u32 = 128;

/// 单次输出的锚点行上限。MCP 帧有结果尺寸限制;超限拒绝而不是静默截断,
/// 调用方应先在数据侧降采样/聚合,再把天数窗口收窄。
pub const MAX_CALIBRATION_ANCHORS: usize = 10_000;

/// 验收带与保留地板来自 calibration-design §3.4。
const BAND_REL: f64 = 0.10;
const RETENTION_FLOOR: f64 = 0.90;

/// 校准输入。`data_dir` 是本地只读数据目录;观测文件(.csv / .xlsx)路径不跨目录展开。
#[derive(Debug, Deserialize, PartialEq)]
pub struct CalibrationInput {
    pub yaml: String,
    pub data_dir: String,
    pub mapping: String,
    #[serde(default = "default_replicates")]
    pub replicates: u32,
}

fn default_replicates() -> u32 {
    1
}

#[derive(Debug, Deserialize)]
struct Mapping {
    #[serde(default)]
    anchors: BTreeMap<String, ObservedValue>,
    #[serde(default)]
    series: BTreeMap<String, SeriesMapping>,
}

#[derive(Debug, Deserialize)]
struct ObservedValue {
    observed: f64,
}

#[derive(Debug, Deserialize)]
struct SeriesMapping {
    file: String,
    /// 工作表名:仅 .xlsx 数据源可用;缺省取第一张表。
    #[serde(default)]
    sheet: Option<String>,
    day_column: String,
    value_column: String,
    denominator_column: Option<String>,
    aggregation: Aggregation,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
enum Aggregation {
    Sum,
    Ratio,
}

fn load(yaml: &str) -> Result<core::config::SimConfig, String> {
    let cfg = core::scenario::load_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    Ok(cfg)
}

fn parse_mapping(raw: &str) -> Result<Mapping, String> {
    let mapping: Mapping =
        serde_yaml_ng::from_str(raw).map_err(|e| format!("mapping 解析失败: {e}"))?;
    if mapping.anchors.is_empty() && mapping.series.is_empty() {
        return Err("mapping 至少需要一个 anchors 或 series 映射".into());
    }
    for (name, observed) in &mapping.anchors {
        if core::experiment::MetricKey::parse(name).is_none() {
            return Err(format!("mapping.anchors 含未知内核指标 {name}"));
        }
        require_positive(observed.observed, &format!("anchors.{name}.observed"))?;
    }
    for (name, series) in &mapping.series {
        core::experiment::MetricKey::parse(name)
            .ok_or_else(|| format!("mapping.series 含未知内核指标 {name}"))?;
        if series.file.is_empty() || series.day_column.is_empty() || series.value_column.is_empty()
        {
            return Err(format!(
                "mapping.series.{name} 的 file/day_column/value_column 不可为空"
            ));
        }
        // 路径边界先于载体白名单(绝对路径/穿越报边界,不报格式)。
        require_in_data_dir(&series.file)?;
        // 载体显式声明:按扩展名白名单(.csv / .xlsx),其它格式拒绝而不是猜。
        let carrier = series.file.to_ascii_lowercase();
        if !carrier.ends_with(".csv") && !carrier.ends_with(".xlsx") {
            return Err(format!("mapping.series.{name} 仅支持 .csv / .xlsx 数据源"));
        }
        // sheet 是工作簿概念:CSV 没有工作表,结构期即拒绝;空名与列名同一纪律。
        if let Some(sheet) = series.sheet.as_deref() {
            if sheet.is_empty() {
                return Err(format!("mapping.series.{name} sheet 不可为空字符串"));
            }
            if !carrier.ends_with(".xlsx") {
                return Err(format!(
                    "mapping.series.{name} 只有 .xlsx 数据源才能指定 sheet"
                ));
            }
        }
        if series.denominator_column.is_some() && series.aggregation != Aggregation::Ratio {
            return Err(format!(
                "mapping.series.{name} 只有 ratio 聚合才能指定 denominator_column"
            ));
        }
    }
    Ok(mapping)
}

fn require_positive(value: f64, what: &str) -> Result<(), String> {
    if value.is_finite() && value > 0.0 {
        Ok(())
    } else {
        Err(format!(
            "mapping.{what} 必须是正的有限数值;零或负锚点不做相对残差"
        ))
    }
}

/// mapping 文件路径的字符串级边界:空、穿越、盘符、绝对路径一律拒绝。
/// 结构校验期(parse_mapping)与读取期(read_table_rows)共用同一套口径,
/// 路径边界先于载体白名单——`/etc/passwd` 报边界而不是报格式。
fn require_in_data_dir(file: &str) -> Result<(), String> {
    if file.is_empty() {
        return Err("mapping 文件路径不可为空".into());
    }
    // 只把「..」作为独立路径分量判为穿越;子串「..」(如 v2..final.csv)是
    // 合法文件名,不得误拒(2026-11-05 审核发现 5)。
    if file.split(['/', '\\']).any(|c| c == "..") {
        return Err("mapping 文件路径必须留在数据目录内".into());
    }
    let bytes = file.as_bytes();
    // Windows 盘符绝对路径(如 C:/x.csv、C:\x.csv):join 会整体替换路径,
    // 直接拒绝;POSIX 合法文件名内冒号(如 a:b.csv)不属盘符,不误拒。
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'/' || bytes[2] == b'\\')
    {
        return Err("mapping 文件路径必须留在数据目录内".into());
    }
    if file.starts_with('/') || file.starts_with('\\') {
        return Err("mapping 文件路径必须留在数据目录内".into());
    }
    Ok(())
}

fn require_existing_dir(raw: &str) -> Result<std::path::PathBuf, String> {
    let path = Path::new(raw);
    let meta =
        std::fs::metadata(path).map_err(|e| format!("数据路径不可访问 {}: {e}", path.display()))?;
    if !meta.is_dir() {
        return Err(format!(
            "数据路径不是目录: {}(calibrate 只读本地目录)",
            path.display()
        ));
    }
    path.canonicalize()
        .map_err(|e| format!("数据路径规范化失败 {}: {e}", path.display()))
}

/// 读一张观测表为字符串行字典,CSV 与 XLSX 两条入口同一产出:
/// 表头/单元格值 trim、列缺失按名查、行序保持。xlsx 只是载体,聚合语义零变化。
fn read_table_rows(
    dir: &Path,
    file: &str,
    sheet: Option<&str>,
) -> Result<Vec<BTreeMap<String, String>>, String> {
    if file.is_empty() {
        return Err("mapping 文件路径不可为空".into());
    }
    require_in_data_dir(file)?;
    let path = dir.join(file);
    let resolved = path
        .canonicalize()
        .map_err(|_| "mapping 文件不可读".to_string())?;
    if !resolved.starts_with(dir) {
        return Err("mapping 文件路径必须留在数据目录内".into());
    }
    let (headers, records): (Vec<String>, Vec<Vec<String>>) =
        if file.to_ascii_lowercase().ends_with(".xlsx") {
            // 读端双口径:文件打不开只报「不可读」,不展开 zip/XML 内部错误;
            // 内容级错误(缺工作表、错误单元格带行列号)原样透传给最终用户。
            let (header, rows) = xlsx::read_sheet(&resolved, sheet, 1).map_err(|e| match e {
                xlsx::XlsxReadError::Unreadable(_) => "mapping 文件不可读".to_string(),
                xlsx::XlsxReadError::Content(message) => message,
            })?;
            (header, rows)
        } else {
            // CSV 没有 sheet 概念;结构校验已拦,这里兜底防御。
            if sheet.is_some() {
                return Err("只有 .xlsx 数据源才能指定 sheet".into());
            }
            let text =
                std::fs::read_to_string(&resolved).map_err(|_| "mapping 文件不可读".to_string())?;
            let mut reader = csv::ReaderBuilder::new()
                .has_headers(true)
                .flexible(true)
                .from_reader(text.as_bytes());
            let headers = reader
                .headers()
                .map_err(|e| format!("读 {} 表头失败: {e}", path.display()))?
                .iter()
                .map(|h| h.to_string())
                .collect::<Vec<_>>();
            let records = reader
                .records()
                .map(|record| -> Result<Vec<String>, String> {
                    let record =
                        record.map_err(|e| format!("读 {} 行失败: {e}", path.display()))?;
                    Ok(record.iter().map(|v| v.to_string()).collect::<Vec<_>>())
                })
                .collect::<Result<Vec<_>, _>>()?;
            (headers, records)
        };
    let mut result = Vec::new();
    for record in records {
        let mut row = BTreeMap::new();
        for (header, value) in headers.iter().zip(record.iter()) {
            row.insert(header.trim().to_string(), value.trim().to_string());
        }
        result.push(row);
    }
    Ok(result)
}

fn parse_day(raw: &str, file: &str) -> Result<u32, String> {
    raw.parse::<u32>()
        .map_err(|_| format!("{file}: 日轴必须是 ≥ 1 的整数"))
        .and_then(|day| {
            if day == 0 {
                Err(format!("{file}: 日轴从 1 开始"))
            } else {
                Ok(day)
            }
        })
}

fn parse_f64(raw: &str, what: &str) -> Result<f64, String> {
    raw.parse::<f64>()
        .map_err(|_| format!("{what}: 不是合法数值"))
}

fn read_series(
    dir: &Path,
    name: &str,
    mapping: &SeriesMapping,
) -> Result<BTreeMap<u32, f64>, String> {
    let rows = read_table_rows(dir, &mapping.file, mapping.sheet.as_deref())?;
    let mut grouped: BTreeMap<u32, (f64, Option<f64>)> = BTreeMap::new();
    for row in rows {
        let day_raw = row
            .get(&mapping.day_column)
            .ok_or_else(|| format!("{} 缺少日轴列 {}", mapping.file, mapping.day_column))?
            .clone();
        let value_raw = row
            .get(&mapping.value_column)
            .ok_or_else(|| format!("{} 缺少数值列 {}", mapping.file, mapping.value_column))?
            .clone();
        let day = parse_day(&day_raw, &mapping.file)?;
        let value = parse_f64(
            &value_raw,
            &format!("{}/{}", mapping.file, mapping.value_column),
        )?;
        let denominator = match &mapping.denominator_column {
            Some(column) => {
                let raw = row
                    .get(column)
                    .ok_or_else(|| format!("{} 缺少分母列 {}", mapping.file, column))?;
                parse_f64(raw, &format!("{}/{column}", mapping.file))?
            }
            None => 1.0,
        };
        let entry = grouped.entry(day).or_insert((0.0, Some(0.0)));
        entry.0 += value;
        if let Some(total) = entry.1.as_mut() {
            *total += denominator;
        }
    }
    let output = grouped
        .into_iter()
        .map(|(day, (value, denominator))| {
            let denominator = match mapping.aggregation {
                Aggregation::Sum => 1.0,
                Aggregation::Ratio => denominator.ok_or_else(|| {
                    format!("mapping.series.{name}: ratio 聚合遇到非有限分母")
                })?,
            };
            if !value.is_finite() || !denominator.is_finite() || denominator < 0.0 {
                return Err(format!("mapping.series.{name}: day {day} 聚合值非法"));
            }
            if denominator == 0.0 {
                return Err(format!(
                    "mapping.series.{name}: day {day} 分母为 0;缺失观测应显式标 unmapped,不用 0 替代"
                ));
            }
            let observed = match mapping.aggregation {
                Aggregation::Sum => value,
                Aggregation::Ratio => value / denominator,
            };
            Ok((day, observed))
        })
        .collect::<Result<BTreeMap<u32, f64>, String>>()?;
    if output.is_empty() {
        return Err(format!(
            "mapping.series.{name}: {} 没有数据行",
            mapping.file
        ));
    }
    Ok(output)
}

fn metric_runs(
    cfg: &core::config::SimConfig,
    replicates: u32,
) -> Result<Vec<core::metrics::RunMetrics>, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    if replicates > MAX_CALIBRATION_REPLICATES {
        return Err(format!(
            "参数错误: replicates 超出 calibrate 预算 {MAX_CALIBRATION_REPLICATES};更大规模走 CLI"
        ));
    }
    Ok((0..replicates)
        .map(|replicate| core::sim::run(cfg, replicate))
        .collect())
}

fn pass(anchor: &str, relative_residual: f64, observed: f64) -> bool {
    let floor_ok = !anchor.starts_with("retention_") || observed >= RETENTION_FLOOR;
    relative_residual <= BAND_REL && floor_ok
}

fn anchor_row(
    anchor: &str,
    day: Option<u32>,
    sim_stats: Option<core::experiment::SampleStats>,
    observed: Option<f64>,
    unavailable_reason: Option<&str>,
) -> Value {
    if let (Some(stats), Some(obs)) = (sim_stats, observed) {
        let relative_residual = (stats.mean - obs).abs() / obs;
        let accepted = pass(anchor, relative_residual, obs);
        json!({
            "anchor": anchor,
            "day": day,
            "sim_mean": stats.mean,
            "sim_ci95": [stats.ci95_lo, stats.ci95_hi],
            "replicates": stats.n,
            "observed": obs,
            "relative_residual": relative_residual,
            "band": BAND_REL,
            "retention_floor": if anchor.starts_with("retention_") { Some(RETENTION_FLOOR) } else { None },
            "verdict": if accepted { "PASS" } else { "FAIL" },
        })
    } else {
        let reason = unavailable_reason.unwrap_or("该锚点无观测映射");
        json!({
            "anchor": anchor,
            "day": day,
            "verdict": "UNMAPPED",
            "reason": reason,
        })
    }
}

/// 聚合本地观测、真跑本地仿真并输出逐锚点差异报告。
/// 输入数据只在本模块读取;返回值不含原始行。
pub fn calibrate_native(input: &CalibrationInput) -> Result<Value, String> {
    let cfg = load(&input.yaml)?;
    let mapping = parse_mapping(&input.mapping)?;
    let dir = require_existing_dir(&input.data_dir)?;
    let runs = metric_runs(&cfg, input.replicates)?;

    let mut rows = Vec::new();
    for key in core::experiment::MetricKey::ALL {
        let name = key.name();
        let observed = mapping.anchors.get(name).map(|value| value.observed);
        let stats = if runs.is_empty() {
            None
        } else {
            let values: Vec<f64> = runs.iter().filter_map(|run| key.extract(run)).collect();
            (!values.is_empty()).then(|| core::experiment::summarize(&values))
        };
        let unavailable = if stats.is_none() {
            key.unavailable_reason(&cfg)
                .map(|reason| reason.to_string())
        } else {
            None
        };
        rows.push(anchor_row(
            name,
            None,
            stats,
            observed,
            unavailable.as_deref(),
        ));
    }

    let mut series_count = 0usize;
    for (name, series_mapping) in &mapping.series {
        if rows.len() >= MAX_CALIBRATION_ANCHORS {
            return Err(format!(
                "锚点行数达到上限 {MAX_CALIBRATION_ANCHORS}(MCP 输出长度控制);请收窄 mapping.series 的天数窗口或先按日聚合"
            ));
        }
        let key = core::experiment::MetricKey::parse(name)
            .ok_or_else(|| format!("mapping.series 含未知内核指标 {name}"))?;
        let observed = read_series(&dir, name, series_mapping)?;
        let supported_daily = matches!(
            key,
            core::experiment::MetricKey::WinRate
                | core::experiment::MetricKey::GoldPerPlayer
                | core::experiment::MetricKey::PowerP50Final
        );
        if !supported_daily {
            rows.push(anchor_row(
                name,
                None,
                None,
                None,
                Some("该指标当前只做运行级锚点,不提供逐日内核序列"),
            ));
            continue;
        }
        let day_column_stats = |runs: &[core::metrics::RunMetrics],
                                day: u32|
         -> Option<core::experiment::SampleStats> {
            let value_of = |run: &core::metrics::RunMetrics| match key {
                core::experiment::MetricKey::WinRate => run
                    .day_stats
                    .iter()
                    .find(|stat| stat.day == day)
                    .map(|stat| stat.win_rate),
                core::experiment::MetricKey::GoldPerPlayer => run
                    .day_stats
                    .iter()
                    .find(|stat| stat.day == day)
                    .map(|stat| stat.income_per_active),
                core::experiment::MetricKey::PowerP50Final => run
                    .power_snapshots
                    .iter()
                    .find(|snap| snap.day == day)
                    .map(|snap| snap.p50),
                _ => unreachable!("supported_daily 已限制分支"),
            };
            let values: Vec<f64> = runs.iter().filter_map(value_of).collect();
            (!values.is_empty()).then(|| core::experiment::summarize(&values))
        };
        for (day, obs) in observed {
            if rows.len() >= MAX_CALIBRATION_ANCHORS {
                return Err(format!(
                    "锚点行数达到上限 {MAX_CALIBRATION_ANCHORS}(MCP 输出长度控制);请收窄 mapping.series 的天数窗口"
                ));
            }
            let stats = day_column_stats(&runs, day);
            let reason = stats.is_none().then(|| format!("仿真结果没有 day {day}"));
            rows.push(anchor_row(
                name,
                Some(day),
                stats,
                Some(obs),
                reason.as_deref(),
            ));
            series_count += 1;
        }
    }

    let pass_count = rows.iter().filter(|row| row["verdict"] == "PASS").count();
    let fail_count = rows.iter().filter(|row| row["verdict"] == "FAIL").count();
    let unmapped_count = rows
        .iter()
        .filter(|row| row["verdict"] == "UNMAPPED")
        .count();
    Ok(json!({
        "meta": {
            "schema_version": core::SCHEMA_VERSION,
            "model_version": core::MODEL_VERSION,
            "config_hash": core::config::config_hash(&cfg),
            "replicates": runs.len(),
            "band": BAND_REL,
            "retention_floor": RETENTION_FLOOR,
            "data_source": "local_readonly",
        },
        "summary": {
            "anchors": rows.len(),
            "series_anchors": series_count,
            "pass": pass_count,
            "fail": fail_count,
            "unmapped": unmapped_count,
        },
        "rows": rows,
    }))
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod tests_xlsx;
