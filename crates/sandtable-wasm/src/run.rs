//! 仿真域(web 绑定):replicates 上限 + run_simulation(native/wasm 入口成对)。

use wasm_bindgen::prelude::*;

// 显式 use 优先于 prelude 的 glob(wasm-bindgen 会导出 core 别名,须显式声明遮蔽回核心 crate)
use sandtable_core as core;
use serde_json::json;

use crate::validate::load;

/// 单次 Web 实验的 replicates 上限(内存边界,见模块注释)。
pub const MAX_REPLICATES: u32 = 64;

/// 运行仿真(native 纯函数):R 个 replicate 的 [`core::metrics::RunMetrics`]
/// 序列化数组,与 CLI `simulate` report.json 的 `results` 逐字段同构
/// (同 seed 同配置时逐值相等,含 day_stats / cohort_stats)。
///
/// 另附 `days_csv`:replicate 1 的按天 CSV([`core::export::day_csv`]),
/// 与 CLI `simulate --out` 写盘的 days.csv **逐字节一致**(文档 09 章契约,
/// `web_parity` 测试锁死)——浏览器导出的文件 CLI 可直接继续分析。
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
        "days_csv": core::export::day_csv(&results[0]),
        "results": results,
    }))
}

/// 运行仿真(wasm 入口):返回 JSON 字符串(形状同 [`run_simulation_native`])。
#[wasm_bindgen]
pub fn run_simulation(yaml: &str, replicates: u32) -> Result<JsValue, JsValue> {
    let v = run_simulation_native(yaml, replicates).map_err(|e| JsValue::from_str(&e))?;
    serde_json::to_string(&v)
        .map(|s| JsValue::from_str(&s))
        .map_err(|e| JsValue::from_str(&e.to_string()))
}
