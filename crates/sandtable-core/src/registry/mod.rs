//! 参数注册表(文档 07 章):路径 → 类型 / 默认值 / 说明。
//!
//! 加载时校验:未知路径报错(附相近路径建议)、节形状不符报错;
//! 类型与取值范围由 serde 反序列化与 [`crate::config::validate`] 把关。
//! 注册表是静态表,运行期寻址零字符串查找(sweep / override 的寻址基础)。

mod access;
mod spec;
mod suggest;
mod tree;

pub use access::{apply_numeric, read_numeric, read_u64_raw};
pub use spec::{all, lookup, ParamKind, ParamSpec};
pub use suggest::suggestions;
pub use tree::check_tree;

#[cfg(test)]
mod tests;
