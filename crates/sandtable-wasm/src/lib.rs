//! WebAssembly 薄绑定(文档 08/18 章:Phase 6)。
//!
//! 纪律:**不放仿真逻辑**——只转发 sandtable-core(load → validate → run),
//! 输出与 CLI `simulate` 的 report.json 同构(`{meta, results}`),统计等价
//! 由 CLI 侧等价测试锁死。meta 只带版本字段;`generated_at_unix`/`git_sha`
//! 是环境字段,由前端构建注入,不在绑定层伪造。
//!
//! Web 定位小中型仿真(文档 09 章:WASM 内存 4GB 上限、单线程),
//! replicates 上限 64,更大的实验引导走 CLI / 桌面。

use wasm_bindgen::prelude::*;

// 显式 use 优先于 prelude 的 glob(wasm-bindgen 会导出 core 别名,须显式声明遮蔽回核心 crate)
use sandtable_core as core;

use serde_json::json;

/// 单次 Web 实验的 replicates 上限(内存边界,见模块注释)。
pub const MAX_REPLICATES: u32 = 64;

fn load(yaml: &str) -> Result<core::config::SimConfig, String> {
    let cfg = core::scenario::load_str(yaml).map_err(|e| format!("配置错误: {e}"))?;
    core::config::validate(&cfg).map_err(|e| format!("配置错误: {e}"))?;
    Ok(cfg)
}

/// 校验配置(native 纯函数,wasm 包装见 [`validate_config`])。
///
/// 返回 `{config_hash, players, days, schema_version, model_version}`;
/// 配置非法时 Err,消息与 CLI 退出码 2 的 stderr 同源。
pub fn validate_config_native(yaml: &str) -> Result<serde_json::Value, String> {
    let cfg = load(yaml)?;
    Ok(json!({
        "config_hash": core::config::config_hash(&cfg),
        "players": cfg.players,
        "days": cfg.days,
        "schema_version": core::SCHEMA_VERSION,
        "model_version": core::MODEL_VERSION,
    }))
}

/// 运行仿真(native 纯函数):R 个 replicate 的 [`core::metrics::RunMetrics`]
/// 序列化数组,与 CLI `simulate` report.json 的 `results` 逐字段同构
/// (同 seed 同配置时逐值相等,含 day_stats / cohort_stats)。
pub fn run_simulation_native(yaml: &str, replicates: u32) -> Result<serde_json::Value, String> {
    if replicates == 0 {
        return Err("参数错误: replicates 至少为 1".into());
    }
    if replicates > MAX_REPLICATES {
        return Err(format!(
            "参数错误: Web 端 replicates 上限 {MAX_REPLICATES}(更大实验走 CLI / 桌面)"
        ));
    }
    let cfg = load(yaml)?;
    let results: Vec<core::metrics::RunMetrics> =
        (0..replicates).map(|r| core::sim::run(&cfg, r)).collect();
    Ok(json!({
        "meta": {
            "schema_version": core::SCHEMA_VERSION,
            "model_version": core::MODEL_VERSION,
        },
        "config_hash": core::config::config_hash(&cfg),
        "results": results,
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

/// 运行仿真(wasm 入口):返回 JSON 字符串(形状同 [`run_simulation_native`])。
#[wasm_bindgen]
pub fn run_simulation(yaml: &str, replicates: u32) -> Result<JsValue, JsValue> {
    let v = run_simulation_native(yaml, replicates).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
    );

    #[test]
    fn 校验_有效与无效() {
        let v = validate_config_native(YAML).unwrap();
        assert_eq!(v["players"], 40);
        assert_eq!(v["days"], 3);
        assert!(
            v["config_hash"].as_str().unwrap().len() == 64,
            "SHA-256 hex"
        );

        let err = validate_config_native(
            "schema_version: '1'\nscenario: {population: 40, duration: '3d'}\nmodel:\n  dungeon:\n    tiers: 0\n",
        )
        .unwrap_err();
        assert!(err.starts_with("配置错误"), "{err}");
    }

    #[test]
    fn 运行_与core直跑逐值一致() {
        let cfg = core::scenario::load_str(YAML).unwrap();
        let v = run_simulation_native(YAML, 2).unwrap();
        let want: Vec<serde_json::Value> = (0..2u32)
            .map(|r| serde_json::to_value(core::sim::run(&cfg, r)).unwrap())
            .collect();
        assert_eq!(
            v["results"],
            serde_json::Value::Array(want),
            "results 与 core::sim::run 直序列化逐值一致"
        );
        assert_eq!(v["results"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn 运行_参数边界拒绝() {
        assert!(run_simulation_native(YAML, 0).is_err());
        let e = run_simulation_native(YAML, MAX_REPLICATES + 1).unwrap_err();
        assert!(e.contains("上限"), "{e}");
    }
}
