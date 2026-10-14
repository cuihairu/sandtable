//! 最小可跑示例:宝可梦案例 → 契约 JSON → 参考导入器回归。
//!
//! 运行(仓库根):
//! ```sh
//! cargo run -p sandtable-engine --example export_pokemon
//! ```

use sandtable_engine::contract::export_from_yaml;
use sandtable_engine::importer::load;
use std::env;
use std::fs;

fn main() {
    let yaml_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../examples/pokemon.yaml");
    let yaml = fs::read_to_string(yaml_path).expect("读取 examples/pokemon.yaml");

    // ① 导出(YAML 场景 → 契约,导出前同源 validate)
    let contract = export_from_yaml(&yaml).expect("导出失败");
    let json = contract.to_json();

    // ② 参考导入器重新加载并等价校验
    let loaded = load(&json).expect("重新加载失败");
    assert_eq!(loaded, contract, "重新加载与导出必须等价");

    let out_dir = env::args().nth(1).unwrap_or_else(|| ".".into());
    let out_path = format!("{out_dir}/pokemon.engine.json");
    fs::write(&out_path, &json).expect("写盘失败");

    println!("契约已写出:{out_path}");
    println!("config_hash:{}", contract.config_hash);
    println!("参考导入器回归通过(重新加载 == 导出)");
}
