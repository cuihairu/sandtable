//! Sandtable 游戏引擎 Adapter(引擎无关 JSON 契约)。
//!
//! 定位(设计文档 §0):沙盘的核心资产是**配置语义**,不是任何引擎的运行时。
//! 本 crate 把沙盘验证过的语义层以机器可读 JSON 交给引擎侧消费,
//! 减少「沙盘与实机两套数」的漂移;引擎是消费方,不是同构实现。
//!
//! 三个能力面:
//! - **导出**([`export`] / [`export_from_yaml`] / [`export_json`]):语义层 →
//!   契约 JSON(`.engine.json`),导出前走 `validate_config` 同源校验;
//! - **参考导入器**([`importer::load`]):契约 JSON → 校验后的 [`EngineContract`],
//!   结构与域值双层校验,作为引擎侧接入的参考实现;
//! - **回流约定**([`backflow_load`] / [`backflow_matches`]):引擎侧运行结果
//!   回指契约 `config_hash`,供与沙盘分布做 A/B 对照(不写回契约)。
//!
//! 契约面、版本纪律与接入三步见仓库 `docs/engine-adapter-design.md` §7。

pub mod backflow;
pub mod contract;
pub mod error;
pub mod importer;

pub use backflow::{backflow_load, backflow_matches, BackflowReport, MetricPoint};
pub use contract::{
    export, export_from_yaml, export_json, EngineContract, FILE_EXTENSION, KIND_BACKFLOW,
    KIND_CONTRACT, SCHEMA_VERSION,
};
pub use error::{Error, Result};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contract_json_is_stable_and_loadable() {
        let cfg = sandtable_core::config::SimConfig::default();
        let json = export_json(&cfg).unwrap();
        let loaded = importer::load(&json).unwrap();
        assert_eq!(loaded, export(&cfg).unwrap());
    }
}
