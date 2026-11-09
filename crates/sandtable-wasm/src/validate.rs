//! 校验域(web 绑定):配置加载与校验(native 纯函数 / wasm 入口成对)。

use wasm_bindgen::prelude::*;

// 显式 use 优先于 prelude 的 glob(wasm-bindgen 会导出 core 别名,须显式声明遮蔽回核心 crate)
use sandtable_core as core;
use serde_json::json;

pub(crate) fn load(yaml: &str) -> Result<core::config::SimConfig, String> {
    let cfg = core::scenario::load_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    Ok(cfg)
}

/// 校验配置(native 纯函数,wasm 包装见 [`validate_config`])。
///
/// 返回 `{config_hash, players, days, schema_version, model_version}`;
/// 配置非法时 Err,消息与 CLI 退出码 2 的 stderr 同源。
pub fn validate_config_native(yaml: &str) -> Result<serde_json::Value, String> {
    // 校验通道接受实验 YAML(sweep / optimize 节摘出):前端提交纪律要求
    // 送达的输入快照(含 sweep 节)被内核完整校验,run_simulation 等执行
    // 入口仍走 load_str 只收场景 YAML。
    let cfg = core::scenario::load_config_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    Ok(json!({
        "config_hash": core::config::config_hash(&cfg),
        "players": cfg.players,
        "days": cfg.days,
        "schema_version": core::SCHEMA_VERSION,
        "model_version": core::MODEL_VERSION,
    }))
}

/// 校验配置(wasm 入口):返回 JSON 字符串,前端 `JSON.parse`。
///
/// 不用 serde-wasm-bindgen 直出对象——其 JsValue 协议与 wasm-bindgen 新版
/// 存在静默不兼容(实测 to_value 产出空对象);字符串是 wasm ABI 最稳通道。
#[wasm_bindgen]
pub fn validate_config(yaml: &str) -> Result<JsValue, JsValue> {
    let v = validate_config_native(yaml).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
