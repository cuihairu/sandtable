//! KPI 域(web 绑定):可用性 / 自定义 KPI 校验与求值 / 指标字典(native/wasm 入口成对)。

use wasm_bindgen::prelude::*;

// 显式 use 优先于 prelude 的 glob(wasm-bindgen 会导出 core 别名,须显式声明遮蔽回核心 crate)
use sandtable_core as core;
use serde_json::json;

use crate::validate::load;

/// KPI 可用性入口(native 纯函数):对给定配置,内核 `MetricKey::ALL` 逐项
/// `unavailable_reason`(WB-03.09 可用性语义 = 内核口径:天数不足 /
/// gacha / loot 未配置)。返回 `[{metric, reason}]`,空数组 = 全部可用;
/// metric 是内核 ID(snake_case),reason 是内核原文(中文,进错误通道
/// 原样透传,不前端改写)。名称/显示名/格式在 TS metricMeta 面(显示层)。
pub fn kpi_availability_native(yaml: &str) -> Result<serde_json::Value, String> {
    let cfg = load(yaml)?;
    Ok(json!(core::experiment::MetricKey::ALL
        .iter()
        .filter_map(|k| {
            core::experiment::MetricKey::unavailable_reason(*k, &cfg)
                .map(|reason| json!({ "metric": k.name(), "reason": reason }))
        })
        .collect::<Vec<_>>()))
}

/// KPI 可用性(wasm 入口):JSON 字符串,形状同 [`kpi_availability_native`]。
#[wasm_bindgen]
pub fn kpi_availability(yaml: &str) -> Result<JsValue, JsValue> {
    let v = kpi_availability_native(yaml).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 自定义 KPI 校验(native):只编译,不碰运行期数据。返回
/// [`core::kpi_custom::CustomKpiShape`](vars = 可引用指标全集,
/// used_vars = 表达式实际引用的)。
pub fn kpi_validate_native(expression: &str) -> Result<serde_json::Value, String> {
    let shape =
        core::kpi_custom::validate_expression(expression).map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(shape).map_err(|e| format!("序列化失败: {e}"))
}

/// 自定义 KPI 校验(wasm 入口):JSON 字符串,形状同 [`kpi_validate_native`]。
#[wasm_bindgen]
pub fn kpi_validate(expression: &str) -> Result<JsValue, JsValue> {
    let v = kpi_validate_native(expression).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 自定义 KPI 求值(native):表达式逐 replicate 求值 + 跨 replicate 聚合。
/// results 是 [`core::metrics::RunMetrics`] 数组 JSON(daily_aggregate 同通道,
/// replicate 粒度,不是候选聚合)。
pub fn kpi_eval_native(expression: &str, results_json: &str) -> Result<serde_json::Value, String> {
    let results: Vec<core::metrics::RunMetrics> = serde_json::from_str(results_json)
        .map_err(|e| format!("参数错误: 逐 replicate 结果解析失败: {e}"))?;
    let out =
        core::kpi_custom::evaluate(expression, &results).map_err(|e| format!("配置错误: {e}"))?;
    serde_json::to_value(out).map_err(|e| format!("序列化失败: {e}"))
}

/// 自定义 KPI 求值(wasm 入口):JSON 字符串,形状同 [`kpi_eval_native`]。
#[wasm_bindgen]
pub fn kpi_eval(expression: &str, results_json: &str) -> Result<JsValue, JsValue> {
    let v = kpi_eval_native(expression, results_json).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 指标字典(native):core::kpi_dict::metric_definitions 全量表 +
/// `dict_version`。机器可判定口径的事实源(量纲 / 小数位 / 可空 /
/// 可用性门槛),显示名在前端 locale 层;可用性原因原文仍走
/// `kpi_availability`(同一套门槛,一致性由 core 测试锁定)。
pub fn metric_dictionary_native() -> Result<serde_json::Value, String> {
    serde_json::to_value(serde_json::json!({
        "dict_version": core::kpi_dict::METRIC_DICT_VERSION,
        "metrics": core::kpi_dict::metric_definitions(),
    }))
    .map_err(|e| format!("序列化失败: {e}"))
}

/// 指标字典(wasm 入口):JSON 字符串,形状同 [`metric_dictionary_native`]。
#[wasm_bindgen]
pub fn metric_dictionary() -> Result<JsValue, JsValue> {
    let v = metric_dictionary_native().map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
