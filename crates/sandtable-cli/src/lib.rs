//! Sandtable CLI 库面:跨壳层复用的数据交换模块(workbook / xlsx 读取)。
//!
//! 二进制入口仍在 `src/main.rs`;此 lib 只暴露需要被其他 crate(MCP 校准的
//! .xlsx 观测数据入口、往返测试)复用的模块。仿真与统计不在这里——内核在
//! sandtable-core,壳层不做任何数值重算。

pub mod workbook;
pub mod xlsx;
