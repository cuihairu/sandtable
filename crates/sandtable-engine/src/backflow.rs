//! 回流文件约定(设计文档 §1 场景 3、§6 阶段 2):引擎侧真实运行结果回指契约。
//!
//! 回流文件由引擎侧写、沙盘侧校验:键必须是沙盘中存在的指标名
//! (`MetricKey::parse` 通过),均值须为有限数,CI 区间下界 ≤ 上界。
//! 回流**不写回契约**(设计文档 §3.6 单向输出);`backflow_matches` 以
//! `config_hash` 把回流对回契约,供 A/B 对照。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::contract::{EngineContract, KIND_BACKFLOW, SCHEMA_VERSION};
use crate::error::{Error, Result};

/// 回流文件(引擎侧产出)。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BackflowReport {
    /// 文件种类标记,恒为 [`KIND_BACKFLOW`]。
    pub kind: String,
    /// 语义版本,当前 [`SCHEMA_VERSION`]。
    pub schema_version: String,
    /// 回指的沙盘配置哈希(须与目标契约一致)。
    pub config_hash: String,
    /// 引擎标识(名称 + 版本,自由文本,非空)。
    pub engine: String,
    /// 指标名 → 结果点(键序固定)。
    pub metrics: BTreeMap<String, MetricPoint>,
}

/// 单个指标的结果点。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct MetricPoint {
    /// 均值(有限数)。
    pub mean: f64,
    /// 95% 置信区间 `[下界, 上界]`(缺省 None = 引擎侧未给)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ci95: Option<[f64; 2]>,
}

/// 校验并加载回流文件(JSON 文本)。
pub fn backflow_load(json: &str) -> Result<BackflowReport> {
    let report: BackflowReport =
        serde_json::from_str(json).map_err(|e| Error::Contract(format!("JSON 解析失败: {e}")))?;
    report.validate()?;
    Ok(report)
}

impl BackflowReport {
    /// 结构与域值校验。
    pub fn validate(&self) -> Result<()> {
        if self.kind != KIND_BACKFLOW {
            return Err(Error::Contract(format!(
                "kind 不符: {}(应为 {KIND_BACKFLOW})",
                self.kind
            )));
        }
        if self.schema_version != SCHEMA_VERSION {
            return Err(Error::Contract(format!(
                "schema_version {} 不支持(当前支持 {SCHEMA_VERSION})",
                self.schema_version
            )));
        }
        let hash_ok =
            self.config_hash.len() == 64 && self.config_hash.bytes().all(|b| b.is_ascii_hexdigit());
        if !hash_ok {
            return Err(Error::Contract(format!(
                "config_hash 形态不符: {}(应为 64 位十六进制)",
                self.config_hash
            )));
        }
        if self.engine.trim().is_empty() {
            return Err(Error::Contract("engine 标识不能为空".into()));
        }
        for (key, point) in &self.metrics {
            if sandtable_core::experiment::MetricKey::parse(key).is_none() {
                return Err(Error::Contract(format!("指标名不是沙盘指标: {key}")));
            }
            if !point.mean.is_finite() {
                return Err(Error::Contract(format!(
                    "指标 {key} 均值不是有限数: {}",
                    point.mean
                )));
            }
            if let Some(pair) = point.ci95.as_ref() {
                let [lo, hi] = *pair;
                if !lo.is_finite() || !hi.is_finite() || lo > hi {
                    return Err(Error::Contract(format!(
                        "指标 {key} CI 区间无效: [{lo}, {hi}]"
                    )));
                }
            }
        }
        Ok(())
    }

    /// 回流序列化(稳定字段序)。
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).expect("回流文件为纯数据结构,序列化不会失败")
    }
}

/// 回流是否指向给定契约(config_hash 相等)。
pub fn backflow_matches(report: &BackflowReport, contract: &EngineContract) -> bool {
    report.config_hash == contract.config_hash
}
