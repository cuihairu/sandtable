//! 参数读写域(web 绑定):注册表 / 数值读取 / 数值应用(native/wasm 入口成对)。

use wasm_bindgen::prelude::*;

// 显式 use 优先于 prelude 的 glob(wasm-bindgen 会导出 core 别名,须显式声明遮蔽回核心 crate)
use sandtable_core as core;
use serde_json::json;

use crate::validate::load;

/// 参数定义注册表(native 纯函数):静态全量 `core::registry::all()`,
/// 每项恰为 {path, kind, default, desc}(WB-03.04)。注册表不含配置读取,
/// 无入参、不会失败;desc 是注册表里的 zh 原文,译名在前端显示层。
pub fn param_registry_native() -> serde_json::Value {
    json!(core::registry::all().cloned().collect::<Vec<_>>())
}

/// 参数定义注册表(wasm 入口):JSON 字符串,形状同 [`param_registry_native`]。
#[wasm_bindgen]
pub fn param_registry() -> JsValue {
    JsValue::from_str(&param_registry_native().to_string())
}

/// 当前配置数值读取(native 纯函数):load+validate 后逐数值注册路径
/// `registry::read_numeric`,返回 `{path: 当前生效值}`(WB-03.05)。
///
/// - 数值槽 = u32/u64/i64/f64/mix;非数值槽(dur/expr/table)**缺键 ≠ 0**,
///   其有效形态就是配置文本本身(WB-03.07 回写契约);
/// - loot/gacha 未配置时返回的是内核真实生效缺省(read_numeric 的
///   unwrap_or),不是前端拿注册表 default 补值;
/// - u64 槽位(seed/pity_*)走无损通道(WB-03.08):≤ 2^53−1 返回 JSON
///   数字;超出 JS 安全整数的值以**十进制字符串**无损表达,
///   不经 f64 静默舍入(apply 侧对越界值明确拒绝,见 apply_numeric)。
pub fn param_values_native(yaml: &str) -> Result<serde_json::Value, String> {
    const MAX_SAFE: u64 = 9_007_199_254_740_991;
    let cfg = load(yaml)?;
    let mut out = serde_json::Map::new();
    for spec in core::registry::all() {
        if let Some(raw) = core::registry::read_u64_raw(&cfg, spec.path) {
            let v = if raw <= MAX_SAFE {
                json!(raw)
            } else {
                json!(raw.to_string())
            };
            out.insert(spec.path.to_string(), v);
            continue;
        }
        if let Ok(v) = core::registry::read_numeric(&cfg, spec.path) {
            out.insert(spec.path.to_string(), json!(v));
        }
    }
    Ok(serde_json::Value::Object(out))
}

/// 当前配置数值读取(wasm 入口):JSON 字符串,形状同 [`param_values_native`]。
#[wasm_bindgen]
pub fn param_values(yaml: &str) -> Result<JsValue, JsValue> {
    let v = param_values_native(yaml).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// 数值参数应用(native 纯函数):按内核寻址 `registry::apply_numeric`
/// 应用单条数值编辑,应用后**重验**(显式性契约:如对未配置 loot 的配置
/// 应用 rate_mult 会经 get_or_insert 物化半配置 loot,on_victory 空必须
/// 在编辑期报错而不是等到运行),通过后返回应用后 config_hash 与回读值
/// (apply/read 镜像证明)(WB-03.06)。
///
/// 错误全部 `配置错误: ` 前缀(与 validate_config 同通道,前端
/// classifyWasmError 直接分类):未知路径带相近路径建议、非数值槽
/// (时长/公式/结构表)、非法类型与范围(u32/u64 为负等)。u64/seed 经
/// f64 通道,超过 JS 安全整数的精度边界归 WB-03.08。
pub fn param_apply_native(yaml: &str, path: &str, value: f64) -> Result<serde_json::Value, String> {
    let mut cfg = load(yaml)?;
    core::registry::apply_numeric(&mut cfg, path, value).map_err(|e| format!("配置错误: {e}"))?;
    core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    let back = core::registry::read_numeric(&cfg, path).map_err(|e| format!("配置错误: {e}"))?;
    Ok(json!({
        "config_hash": core::config::config_hash(&cfg),
        "path": path,
        "value": back,
    }))
}

/// 数值参数应用(wasm 入口):JSON 字符串,形状同 [`param_apply_native`]。
#[wasm_bindgen]
pub fn param_apply(yaml: &str, path: &str, value: f64) -> Result<JsValue, JsValue> {
    let v = param_apply_native(yaml, path, value).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
