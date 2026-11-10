//! YAML 树校验:根键、节形状、叶路径。类型交给 serde,范围交给 validate。
use crate::Error;
use serde_yaml_ng::Value;

use super::access::{key_str, unknown};
use super::spec::lookup;
const SECTIONS: &[&str] = &[
    "scenario",
    "scenario.population_mix",
    "model",
    "model.warrior",
    "model.combat",
    "model.dungeon",
    "model.training",
    "model.behavior",
    "model.behavior.casual",
    "model.behavior.core",
    "model.behavior.whale",
    "model.progression",
    "model.formulas",
    "model.churn",
    "model.loot",
    "model.gacha",
];

/// 遗留路径:只放行 YAML 加载(serde 侧按遗留语义映射,见
/// [`crate::config::DungeonConfigRaw`]),不进注册表数值通道(不可 sweep /
/// 不进参数表)。
const LEGACY_PATHS: &[&str] = &["model.dungeon.reward_growth"];

/// 校验 YAML 树:根键、节形状、叶路径。类型交给 serde,范围交给 validate。
pub fn check_tree(root: &Value) -> Result<(), Error> {
    let root_map = root
        .as_mapping()
        .ok_or_else(|| Error::Config("配置根节点必须是映射(yaml 顶层为 key: value 列表)".into()))?;
    for (k, v) in root_map {
        let key = key_str(k)?;
        match key.as_str() {
            "schema_version" => continue,
            "scenario" | "model" => check_section(&key, v)?,
            other => return Err(unknown(other)),
        }
    }
    Ok(())
}

fn check_section(prefix: &str, v: &Value) -> Result<(), Error> {
    let map = v.as_mapping().ok_or_else(|| {
        Error::Config(format!("{prefix}: 应为映射(节下是参数键值),实际为其他类型"))
    })?;
    for (k, sub) in map {
        let key = key_str(k)?;
        let path = format!("{prefix}.{key}");
        if path == "model.stage_rules" {
            // I-034 · 死配置声明:内核不消费该键(ModelSection 无对应字段),
            // 这里只放行序列形状——工作台阶段规则编辑器是创作侧产物,写入
            // YAML 后不进仿真。机制落地前,加载器如实在此声明现状。
            sub.as_sequence()
                .ok_or_else(|| Error::Config(format!("{path}: 应为规则序列")))?;
        } else if SECTIONS.contains(&path.as_str()) {
            check_section(&path, sub)?;
        } else if LEGACY_PATHS.contains(&path.as_str()) {
            // 遗留字段:放行加载,不在数值通道(见 LEGACY_PATHS 注释)
        } else if lookup(&path).is_some() {
            // 标量参数,类型检查交给 serde
        } else {
            return Err(unknown(&path));
        }
    }
    Ok(())
}
