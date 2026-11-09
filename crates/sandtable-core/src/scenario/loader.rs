//! 场景与实验 YAML 的加载纪律(文档 03/07/12 章):注册表树校验 →
//! schema_version → 反序列化 → 语义校验;实验节(sweep / optimize)摘出
//! 后各自 spec 逐条查注册表 + 目标可用性预检。

use serde_yaml_ng::Value;

use crate::config::SimConfig;
use crate::optimize::OptimSpec;
use crate::sweep::SweepSpec;
use crate::Error;

use super::experiment::{OptimSection, SweepSection};
use super::file::ScenarioFile;

/// 解析 YAML 场景为内部配置(Model 编译产物)。
pub fn load_str(yaml: &str) -> Result<SimConfig, Error> {
    let root: Value =
        serde_yaml_ng::from_str(yaml).map_err(|e| Error::Config(format!("YAML 解析失败: {e}")))?;
    crate::registry::check_tree(&root)?;
    check_schema_version(&root)?;

    let file: ScenarioFile =
        serde_yaml_ng::from_value(root).map_err(|e| Error::Config(format!("配置类型不符: {e}")))?;
    file.into_config()
}

/// 校验通道加载:普通场景 YAML 与实验 YAML(sweep / optimize 节)同入口。
///
/// 实验节有自己的 schema,由 [`load_experiment_str`] / [`load_optimize_str`]
/// 逐字段校验(注册表路径 + 目标可用性),本通道只做配置完整校验:摘出
/// 实验节后走与 [`load_str`] 同一套纪律(注册表树 → schema_version →
/// 反序列化)。校验入口接受实验 YAML 的原因:前端提交纪律要求送达的
/// 输入快照(含 sweep 节)被内核完整校验,而不是只校验候选场景部分。
pub fn load_config_str(yaml: &str) -> Result<SimConfig, Error> {
    let root: Value =
        serde_yaml_ng::from_str(yaml).map_err(|e| Error::Config(format!("YAML 解析失败: {e}")))?;
    let mut cfg_root = root;
    if let Some(m) = cfg_root.as_mapping_mut() {
        m.swap_remove(Value::from("sweep"));
        m.swap_remove(Value::from("optimize"));
    }
    crate::registry::check_tree(&cfg_root)?;
    check_schema_version(&cfg_root)?;
    let file: ScenarioFile = serde_yaml_ng::from_value(cfg_root)
        .map_err(|e| Error::Config(format!("配置类型不符: {e}")))?;
    file.into_config()
}

fn check_schema_version(root: &Value) -> Result<(), Error> {
    let sv = root
        .get("schema_version")
        .ok_or_else(|| Error::Config("配置根节点缺少 schema_version(当前支持 \"1\")".into()))?;
    let sv = sv.as_str().ok_or_else(|| {
        Error::Config("schema_version 必须为字符串 \"1\"(YAML 中加引号,避免被解析为数字)".into())
    })?;
    if sv != crate::SCHEMA_VERSION {
        return Err(Error::Config(format!(
            "schema_version 不支持: {sv}(当前支持 {})",
            crate::SCHEMA_VERSION
        )));
    }
    Ok(())
}

/// 解析 YAML 实验文件为 (基础配置, 扫描/寻优定义)。
///
/// 与 [`load_str`] 同一套加载纪律:schema_version 检查 → 注册表树校验
/// (sweep / optimize 节有自己的 schema,摘出后不进注册表树;其参数路径由
/// 各自 spec 校验逐条查注册表)→ 反序列化 → 语义校验。
fn load_base_from_root(root: &Value, experiment_section: &str) -> Result<SimConfig, Error> {
    let mut cfg_root = root.clone();
    if let Some(m) = cfg_root.as_mapping_mut() {
        m.swap_remove(Value::from(experiment_section));
    }
    crate::registry::check_tree(&cfg_root)?;
    let file: ScenarioFile = serde_yaml_ng::from_value(cfg_root)
        .map_err(|e| Error::Config(format!("配置类型不符: {e}")))?;
    file.into_config()
}

/// 解析 YAML 实验文件为 (基础配置, 扫描定义)。
pub fn load_experiment_str(yaml: &str) -> Result<(SimConfig, SweepSpec), Error> {
    let root: Value =
        serde_yaml_ng::from_str(yaml).map_err(|e| Error::Config(format!("YAML 解析失败: {e}")))?;
    check_schema_version(&root)?;
    if root.get("optimize").is_some() {
        return Err(Error::Config(
            "实验文件不能同时含 sweep 与 optimize 节(两种实验形态互斥,见文档 12 章)".into(),
        ));
    }

    let sweep_value = root.get("sweep").ok_or_else(|| {
        Error::Config(
            "实验文件缺少 sweep 节(见文档 12 章:mode / parameters / replicates / targets)".into(),
        )
    })?;
    let sweep: SweepSection = serde_yaml_ng::from_value(sweep_value.clone())
        .map_err(|e| Error::Config(format!("sweep 节解析失败: {e}")))?;
    let spec = sweep.into_spec()?;
    let cfg = load_base_from_root(&root, "sweep")?;
    spec.validate()?;
    // 目标可用性预检(审核整改 P1):不可用指标的目标此前会在 run_candidate
    // 被静默跳过(约束消失、候选照常显示成功)。days 不足 / gacha 未配置在
    // 加载期就能判定,直接报错。
    for t in &spec.targets {
        if let Some(reason) = t.metric.unavailable_reason(&cfg) {
            return Err(Error::Config(format!(
                "sweep.targets[{}]: {reason}",
                t.metric.name()
            )));
        }
    }
    Ok((cfg, spec))
}

/// 解析 YAML 寻优实验文件为 (基础配置, 寻优定义)(文档 12 章自动寻优)。
pub fn load_optimize_str(yaml: &str) -> Result<(SimConfig, OptimSpec), Error> {
    let root: Value =
        serde_yaml_ng::from_str(yaml).map_err(|e| Error::Config(format!("YAML 解析失败: {e}")))?;
    check_schema_version(&root)?;
    if root.get("sweep").is_some() {
        return Err(Error::Config(
            "实验文件不能同时含 sweep 与 optimize 节(两种实验形态互斥,见文档 12 章)".into(),
        ));
    }

    let optim_value = root.get("optimize").ok_or_else(|| {
        Error::Config(
            "实验文件缺少 optimize 节(见文档 12 章:mode / parameters / population / generations / targets)".into(),
        )
    })?;
    let optim: OptimSection = serde_yaml_ng::from_value(optim_value.clone())
        .map_err(|e| Error::Config(format!("optimize 节解析失败: {e}")))?;
    let spec = optim.into_spec()?;
    let cfg = load_base_from_root(&root, "optimize")?;
    spec.validate()?;
    // 目标可用性预检(审核整改 P1,口径同 sweep 加载):hard 约束与适应度
    // 目标的指标在 days 不足 / gacha 未配置时无值,加载期报错而非静默缺席。
    let metric_err = |m: crate::experiment::MetricKey| -> Option<Error> {
        m.unavailable_reason(&cfg)
            .map(|reason| Error::Config(format!("optimize: {reason}")))
    };
    for t in &spec.targets {
        if let Some(e) = metric_err(t.metric) {
            return Err(e);
        }
    }
    for o in &spec.objectives {
        if let Some(e) = metric_err(o.metric) {
            return Err(e);
        }
    }
    if let Some(o) = &spec.objective {
        if let Some(e) = metric_err(o.metric) {
            return Err(e);
        }
    }
    Ok((cfg, spec))
}
