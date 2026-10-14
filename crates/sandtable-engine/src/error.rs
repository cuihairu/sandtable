//! Adapter 错误类型:配置侧错误透传 core,契约侧错误独立变体。

use sandtable_core;

/// Adapter 错误。
///
/// `Config` 是沙盘侧错误(加载 / 校验失败,含 `core::Error` 原文);
/// `Contract` 是契约 / 回流文件本身的结构或域值问题。
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error(transparent)]
    Config(#[from] sandtable_core::Error),
    #[error("契约无效: {0}")]
    Contract(String),
}

/// Adapter 结果别名。
pub type Result<T> = std::result::Result<T, Error>;
