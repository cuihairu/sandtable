//! `sandtable-mcp` stdio 端到端:官方 rmcp 客户端真 spawn 本 crate 二进制,
//! 走 initialize → list_tools → call_tool 全链路(todo 计划:核心连接的
//! 最终证明——不经任何测试桩,同一条链路就是代理/IDE 的接入方式)。

use rmcp::{
    model::{CallToolRequestParams, ContentBlock},
    transport::TokioChildProcess,
    ServiceExt,
};
use serde_json::{json, Value};
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::process::Command;

const SCEN: &str =
    "schema_version: \"1\"\nscenario: {population: 100, duration: \"5d\", seed: 7}\n";

const EXP: &str = "schema_version: \"1\"\nscenario: {population: 100, duration: \"5d\"}\nsweep:\n  replicates: 2\n  parameters:\n    model.warrior.attack: {min: 90, max: 110, step: 10}\n  targets:\n    - metric: win_rate\n      min: 0.0\n      max: 1.0\n";

async fn call_text(
    client: &rmcp::service::RunningService<rmcp::RoleClient, ()>,
    name: &str,
    args: Value,
) -> (bool, String) {
    let params = CallToolRequestParams::new(name.to_string())
        .with_arguments(args.as_object().unwrap().clone());
    let result = client.call_tool(params).await.unwrap();
    let text = match result.content.first() {
        Some(ContentBlock::Text(t)) => t.text.clone(),
        other => panic!("意外的内容块:{other:?}"),
    };
    (result.is_error == Some(true), text)
}

#[tokio::test]
async fn mcp_stdio_end_to_end_kernel_tools() -> anyhow::Result<()> {
    let bin = env!("CARGO_BIN_EXE_sandtable-mcp");
    // TokioChildProcess::new 返回 Result(spawn 失败可报),先 ? 取传输
    let client = ().serve(TokioChildProcess::new(Command::new(bin))?).await?;

    // 1) list_tools:五枚工具齐
    let tools = client.list_all_tools().await?;
    let names: Vec<String> = tools.iter().map(|t| t.name.to_string()).collect();
    for expected in [
        "sandtable_validate",
        "sandtable_run",
        "sandtable_plan_sweep",
        "sandtable_analyze",
        "sandtable_calibrate",
    ] {
        assert!(names.iter().any(|n| n == expected), "tools = {names:?}");
    }

    // 2) validate:非法配置走 tool-level error,内核消息原文透传
    let (is_err, text) = call_text(
        &client,
        "sandtable_validate",
        json!({ "yaml": "schema_version: \"1\"\nscenario: {population: 0, duration: \"5d\"}\n" }),
    )
    .await;
    assert!(is_err, "population=0 应报错:{text}");
    assert!(text.starts_with("配置错误"), "{text}");

    // 3) run:真跑 4 个 replicate,results 与 CLI report 同构
    let (is_err, text) = call_text(
        &client,
        "sandtable_run",
        json!({ "yaml": SCEN, "replicates": 4 }),
    )
    .await;
    assert!(!is_err, "{text}");
    let run: Value = serde_json::from_str(&text)?;
    let results = run["results"].as_array().unwrap();
    assert_eq!(results.len(), 4);
    assert!(run["days_csv"].as_str().unwrap().contains(','));

    // 4) analyze daily_aggregate:把 run 的 results 喂回去,内核 CI 聚合
    let (is_err, text) = call_text(
        &client,
        "sandtable_analyze",
        json!({ "analysis": "daily_aggregate", "results_json": results }),
    )
    .await;
    assert!(!is_err, "{text}");
    let agg: Value = serde_json::from_str(&text)?;
    assert_eq!(agg["replicates"], 4);
    assert!(!agg["day_stats"].as_array().unwrap().is_empty());

    // 5) analyze kpi_summary:可用指标出统计,缺席指标带内核原因
    let (is_err, text) = call_text(
        &client,
        "sandtable_analyze",
        json!({ "analysis": "kpi_summary", "base_yaml": SCEN, "results_json": results }),
    )
    .await;
    assert!(!is_err, "{text}");
    let kpis: Value = serde_json::from_str(&text)?;
    let win = kpis["kpis"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["metric"] == "win_rate")
        .unwrap();
    assert!(win["mean"].is_number(), "{win}");

    // 6) plan_sweep:网格 3 候选 × 2 replicate 真跑,带判定
    let (is_err, text) = call_text(&client, "sandtable_plan_sweep", json!({ "yaml": EXP })).await;
    assert!(!is_err, "{text}");
    let sweep: Value = serde_json::from_str(&text)?;
    assert_eq!(sweep["sims"], 6);
    assert_eq!(sweep["results"].as_array().unwrap().len(), 3);

    // 7) calibrate:官方客户端完整链路 + 本地 fixture 数据只读聚合。
    let dir = std::env::temp_dir().join(format!(
        "st-mcp-e2e-{}-{}",
        std::process::id(),
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    ));
    fs::create_dir_all(&dir)?;
    fs::write(
        dir.join("daily.csv"),
        "cohort_day,retained,active\n3,98,100\n3,99,100\n",
    )?;
    let mapping = "anchors:\n  win_rate: {observed: 0.98}\nseries:\n  win_rate:\n    file: daily.csv\n    day_column: cohort_day\n    value_column: retained\n    denominator_column: active\n    aggregation: ratio\n".to_string();
    let (is_err, text) = call_text(
        &client,
        "sandtable_calibrate",
        json!({
            "yaml": SCEN,
            "data_dir": dir.to_string_lossy(),
            "mapping": mapping,
            "replicates": 2
        }),
    )
    .await;
    assert!(!is_err, "{text}");
    let calibrated: Value = serde_json::from_str(&text)?;
    assert_eq!(calibrated["meta"]["data_source"], "local_readonly");
    assert_eq!(calibrated["summary"]["series_anchors"], 1);
    assert!(calibrated["rows"].as_array().unwrap().len() <= 10_000);
    let win_daily = calibrated["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["anchor"] == "win_rate" && row["day"] == 3)
        .unwrap();
    assert_eq!(win_daily["observed"], 0.985);
    assert_eq!(win_daily["replicates"], 2);

    client.cancel().await?;
    Ok(())
}
