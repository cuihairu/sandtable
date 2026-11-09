//! YAML 场景配置(文档 03/07 章):scenario 节(实验环境)+ model 节(游戏本身)
//! 物理分离;部分覆盖语义——省略的节 / 字段回退默认值。
//!
//! 加载流程:YAML 解析 → 注册表树校验(未知路径报错附建议)→ schema_version
//! 检查 → 反序列化(类型检查)→ duration / population_mix 语义解析 →
//! [`crate::config::validate`]。config_hash 在反序列化后的结构体上计算,
//! 键序与注释天然不影响(文档 07 章)。

mod example;
mod experiment;
mod file;
mod loader;

pub use example::example_yaml;
pub use loader::{load_config_str, load_experiment_str, load_optimize_str, load_str};

#[cfg(test)]
mod tests;
