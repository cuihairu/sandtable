// sandtable 桌面壳(Phase 7,拍板 2026-10-10:Linux 本机先行):
// Tauri 2 壳 + sandtable-core path 依赖直连——native 仿真,不经 wasm 边界。
// 命令面不含仿真语义:加载(错误透出)→ 逐 replicate 仿真 → 结果按
// CLI report.json / wasm run_simulation_native 的 results 同构序列化。
// 自动更新器、签名证书按拍板后置。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_scenario])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// 跑场景实验:yaml + replicates → `{results: RunMetrics[]}`(单文件 JSON,
/// 与 wasm run_simulation_native 的 results 逐字段同构,前端后续接入);
/// 配置错误透出为 Err 字符串,与 CLI 退出码 2 的加载错误同源。
#[tauri::command]
fn run_scenario(yaml: String, replicates: u32) -> Result<serde_json::Value, String> {
    let cfg = sandtable_core::scenario::load_str(&yaml).map_err(|e| e.to_string())?;
    let mut results = Vec::new();
    for r in 1..=replicates {
        results.push(sandtable_core::sim::run(&cfg, r));
    }
    serde_json::to_value(results).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    // 不用 use super::*:command 宏在同模块生成隐藏 item,重导入会 E0255
    #[test]
    fn 桌面命令_加载并仿真() {
        let v = super::run_scenario(sandtable_core::scenario::example_yaml(), 2).unwrap();
        let results = v.as_array().unwrap();
        assert_eq!(results.len(), 2, "两个 replicate");
        assert_eq!(
            results[0]["config_hash"], results[1]["config_hash"],
            "同配置同 hash"
        );
        assert_eq!(results[0]["replicate"], 1);
        assert_eq!(results[1]["replicate"], 2);
    }

    #[test]
    fn 桌面命令_坏配置透出错误() {
        let e = super::run_scenario("schema_version: \"1\"\nscenario: {population: 0}".into(), 1)
            .unwrap_err();
        assert!(!e.is_empty(), "坏配置要有错误串");
    }
}
