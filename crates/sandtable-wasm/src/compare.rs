//! 比较域(web 绑定):CRN A-B 对照 + 逐日跨 replicate 聚合(native/wasm 入口成对)。

use wasm_bindgen::prelude::*;

// 显式 use 优先于 prelude 的 glob(wasm-bindgen 会导出 core 别名,须显式声明遮蔽回核心 crate)
use crate::validate::load;
use sandtable_core as core;

/// A/B 统计比较(native 纯函数,WB-03.10):双臂 YAML + 双臂**已跑**结果
/// 数组(results JSON,与 run_simulation 输出的 `results` 字段同构)进内核。
/// CRN 成对前提(base_seed 一致 / replicate 等长非零)、指标可用性预检、
/// 逐 replicate extract(None 不 0 填)由 core::experiment::compare_arms
/// 显式判定,配对统计结论由内核直出,前端不另算(WB-03.11)。
///
/// 错误通道与既有桥一致(classifyWasmError 直接分类):
/// - 指标名不在 MetricKey 表、results JSON 解析失败 → `参数错误: `;
/// - YAML 非法、成对前提破坏、指标在某臂不可用 → `配置错误: `。
pub fn ab_compare_native(
    base_yaml: &str,
    cand_yaml: &str,
    metric: &str,
    results_a_json: &str,
    results_b_json: &str,
) -> Result<serde_json::Value, String> {
    let key = core::experiment::MetricKey::parse(metric).ok_or_else(|| {
        let all = core::experiment::MetricKey::ALL
            .iter()
            .map(|k| k.name())
            .collect::<Vec<_>>()
            .join(", ");
        format!("参数错误: 未知指标 {metric}(可选:{all})")
    })?;
    let cfg_a = load(base_yaml)?;
    let cfg_b = load(cand_yaml)?;
    let arm_a: Vec<core::metrics::RunMetrics> = serde_json::from_str(results_a_json)
        .map_err(|e| format!("参数错误: base 臂结果解析失败: {e}"))?;
    let arm_b: Vec<core::metrics::RunMetrics> = serde_json::from_str(results_b_json)
        .map_err(|e| format!("参数错误: cand 臂结果解析失败: {e}"))?;
    let comparison = core::experiment::compare_arms(&cfg_a, &cfg_b, key, &arm_a, &arm_b)
        .map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(&comparison).map_err(|e| format!("配置错误: {e}"))
}

/// A/B 统计比较(wasm 入口):JSON 字符串,形状同 [`ab_compare_native`]。
#[wasm_bindgen]
pub fn ab_compare(
    base_yaml: &str,
    cand_yaml: &str,
    metric: &str,
    results_a_json: &str,
    results_b_json: &str,
) -> Result<JsValue, JsValue> {
    let v = ab_compare_native(base_yaml, cand_yaml, metric, results_a_json, results_b_json)
        .map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 逐日跨 replicate 聚合(native 纯函数,P2 内核导出面)。
///
/// 输入是同一候选多份**已跑** results JSON(与 `run_simulation.results` 同构)。
/// replicates <2、天数交集裁剪、可选字段缺席、inflation day1 排除与
/// CI 口径全由 `core::experiment::daily_aggregate_metrics` 判定/计算,
/// 浏览器前端不得基于单次 days.csv 自算置信带。
pub fn daily_aggregate_native(results_json: &str) -> Result<serde_json::Value, String> {
    let results: Vec<core::metrics::RunMetrics> = serde_json::from_str(results_json)
        .map_err(|e| format!("参数错误: 逐日聚合结果解析失败: {e}"))?;
    let aggregation = core::experiment::daily_aggregate_metrics(&results)
        .map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(aggregation).map_err(|e| format!("配置错误: {e}"))
}

/// 逐日跨 replicate 聚合(wasm 入口):JSON 字符串,形状同 [`daily_aggregate_native`]。
#[wasm_bindgen]
pub fn daily_aggregate(results_json: &str) -> Result<JsValue, JsValue> {
    let v = daily_aggregate_native(results_json).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
