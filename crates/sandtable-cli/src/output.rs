//! 输出整形面:meta 环境 JSON、CSV 转义 / 行、候选与汇总表、Parquet 落盘。
//! 只做结果整形,不做命令分发(文档 09 章输出契约)。

#[cfg(feature = "parquet")]
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

use sandtable_core as core;

#[cfg(feature = "parquet")]
use std::path::Path;

#[cfg(feature = "parquet")]
use anyhow::Context;

pub(crate) fn meta_json() -> serde_json::Value {
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

/// CSV 字段转义(RFC 4180):含分隔符/引号/换行时整体加引号,内部引号翻倍;
/// 公式注入防护(I-037):`=` / `@` 开头或非数值的 `+` / `-` 开头会被
/// Excel/WPS 当公式执行,前置 `'` 中和——真数值(-1.5)不动,保下游解析。
fn csv_field(s: &str) -> String {
    let head = s.chars().next();
    let formula_like = matches!(head, Some('=') | Some('@'))
        || (matches!(head, Some('+') | Some('-')) && s.parse::<f64>().is_err());
    let s = if formula_like {
        format!("'{s}")
    } else {
        s.to_string()
    };
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s
    }
}

/// 一行 CSV:字段逐个转义后以逗号连接,行尾换行。
pub(crate) fn csv_row<'a>(fields: impl IntoIterator<Item = &'a str>) -> String {
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
pub(crate) fn candidates_csv(
    parameters: &[core::sweep::ParamRange],
    results: &[core::sweep::CandidateResult],
) -> String {
    let mut header: Vec<String> = vec!["candidate".into(), "status".into()];
    header.extend(parameters.iter().map(|p| p.path.clone()));
    let mut out = csv_row(header.iter().map(String::as_str));
    for (i, r) in results.iter().enumerate() {
        let mut row: Vec<String> = vec![i.to_string(), status_str(&r.status).into()];
        for p in parameters {
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
pub(crate) fn summary_csv(
    parameters: &[core::sweep::ParamRange],
    targets: &[core::sweep::Target],
    results: &[core::sweep::CandidateResult],
) -> String {
    let mut header: Vec<String> = vec!["candidate".into(), "status".into(), "error".into()];
    header.extend(parameters.iter().map(|p| p.path.clone()));
    for k in core::experiment::MetricKey::ALL {
        for s in ["mean", "ci95_lo", "ci95_hi"] {
            header.push(format!("{}_{}", k.name(), s));
        }
    }
    for (i, t) in targets.iter().enumerate() {
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
        for p in parameters {
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
        for t in targets {
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
pub(crate) fn write_parquet(dir: &Path, m: &core::metrics::RunMetrics) -> anyhow::Result<()> {
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
    use std::collections::BTreeMap;

    use core::experiment::{MetricKey, SampleStats};
    use core::sweep::{
        CandidateResult, CandidateStatus, ConstraintVerdict, ParamRange, SweepMode, SweepSpec,
        Target, TargetKind, TargetOutcome,
    };
    use sandtable_core as core;

    use super::*;

    #[test]
    fn csv_field_escaping() {
        assert_eq!(csv_field("plain"), "plain");
        assert_eq!(csv_field("a,b"), "\"a,b\"");
        assert_eq!(csv_field("说\"话\""), "\"说\"\"话\"\"\"");
    }

    /// I-037 · 公式注入防护:= / @ 前置 ' 中和;真数值不动(保下游解析)
    #[test]
    fn csv_field_formula_prefix_neutralized() {
        assert_eq!(csv_field("=cmd()"), "'=cmd()");
        assert_eq!(csv_field("@sum"), "'@sum");
        assert_eq!(csv_field("-1.5"), "-1.5", "数值不得被改写");
        assert_eq!(csv_field("+2.5"), "+2.5", "数值不得被改写");
        assert_eq!(csv_field("-2+3"), "'-2+3", "非数值的 - 开头按公式处理");
        assert_eq!(csv_field("1+2"), "1+2", "非前导符号不受影响");
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
    fn summary_table_columns_and_failed_candidates() {
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
                metric: "win_rate".into(),
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
        let csv = summary_csv(&spec.parameters, &spec.targets, &[ok, err]);
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
    fn summary_table_na_for_missing_verdict() {
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
                metric: "win_rate".into(),
                kind: TargetKind::Hard,
                min: Some(0.0),
                max: Some(1.0),
                stats: stats(0.5),
                verdict: ConstraintVerdict::Pass,
            }],
        };
        let csv = summary_csv(&spec.parameters, &spec.targets, &[r]);
        let row = csv.lines().nth(1).unwrap();
        assert!(row.ends_with("n/a,PASS"), "{row}");
    }
}
