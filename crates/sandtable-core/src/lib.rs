//! Sandtable 仿真内核。
//!
//! Phase 1 纵向切片:硬编码最小 RPG 闭环(Actor 行为 → 解析战斗 → 奖励 →
//! 成长 → 流失),30 天离散事件推进,带键随机数保证可复现与可比随机路径,
//! 指标在线聚合,A/B 比较输出置信区间。
//!
//! 平台边界(见文档 04 章):本 crate 只依赖纯 Rust;无文件 / 网络 I/O,
//! 无壁钟,无平台库;文件写出由壳层(sandtable-cli)完成。

pub mod config;
pub mod experiment;
pub mod export;
pub mod formula;
pub mod kernel;
pub mod metrics;
pub mod optimize;
pub mod recommend;
pub mod registry;
pub mod rng;
pub mod scenario;
pub mod sensitivity;
pub mod sim;
pub mod surrogate;
pub mod sweep;
pub mod systems;
pub mod world;

/// 配置结构版本(写入 meta 与 config_hash 输入)。
pub const SCHEMA_VERSION: &str = "1";

/// 内核语义版本。
pub const MODEL_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 核心错误类型。
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("配置无效: {0}")]
    Config(String),
}

pub type Result<T> = std::result::Result<T, Error>;
