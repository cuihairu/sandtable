//! 参数表导入导出(文档 9/10 章):扁平 CSV(path,value)↔ 注册表数值参数。
//!
//! 纪律:
//! - 只覆盖注册表数值参数(整数 / 浮点 / 分群权重);公式槽与时长不经参数表;
//! - 导入逐行 apply + 校验,未知路径给建议、数值非法 / 越界 / 重复逐行标注,
//!   不静默跳过——坏行全部报完再失败,策划一轮改完。

use std::collections::BTreeSet;

use anyhow::bail;
use core::config::SimConfig;
use sandtable_core as core;
use serde_json::{json, Map, Value};

/// 数值参数行:(注册表路径, 当前值),按注册表顺序。
pub fn rows(cfg: &SimConfig) -> Vec<(&'static str, f64)> {
    core::registry::all()
        .filter_map(|s| {
            core::registry::read_numeric(cfg, s.path)
                .ok()
                .map(|v| (s.path, v))
        })
        .collect()
}

/// 数值展示:整数值不带小数点,列宽稳定、Excel 友好。
fn fmt_num(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 9e15 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

/// 导出模板:`path,value` 表头 + 全量数值参数行。
pub fn export_csv(cfg: &SimConfig) -> String {
    let mut out = String::from("path,value\n");
    for (path, v) in rows(cfg) {
        out.push_str(&format!("{path},{}\n", fmt_num(v)));
    }
    out
}

/// 导入结果:覆写后的配置与成功行数。
pub struct Imported {
    pub applied: usize,
    pub config: SimConfig,
}

/// 导入参数表:逐行 apply 到基线配置;坏行全部收集完再失败。
pub fn import_csv(csv: &str, mut cfg: SimConfig) -> anyhow::Result<Imported> {
    let mut lines = csv.lines();
    let header = lines.next().unwrap_or("");
    if header.trim() != "path,value" {
        bail!("表头应为 path,value(得到 {header:?})");
    }
    let mut seen = BTreeSet::new();
    let mut errors: Vec<String> = Vec::new();
    let mut applied = 0usize;
    for (idx, line) in lines.enumerate() {
        let lineno = idx + 2;
        let t = line.trim();
        if t.is_empty() || t.starts_with('#') {
            continue;
        }
        let Some((path, val)) = t.split_once(',') else {
            errors.push(format!("第 {lineno} 行:应为 path,value 两列"));
            continue;
        };
        let path = path.trim();
        if !seen.insert(path.to_string()) {
            errors.push(format!("第 {lineno} 行:路径 {path} 重复"));
            continue;
        }
        let Ok(v) = val.trim().parse::<f64>() else {
            errors.push(format!(
                "第 {lineno} 行:{path} 的值 {:?} 不是数值",
                val.trim()
            ));
            continue;
        };
        if let Err(e) = core::registry::apply_numeric(&mut cfg, path, v) {
            // 未知路径的编辑距离建议由 apply_numeric 一并给出
            errors.push(format!("第 {lineno} 行:{e}"));
            continue;
        }
        applied += 1;
    }
    if !errors.is_empty() {
        bail!("参数表有 {} 处错误:\n{}", errors.len(), errors.join("\n"));
    }
    core::config::validate(&cfg)?;
    Ok(Imported {
        applied,
        config: cfg,
    })
}

/// 合并结果落盘为场景 YAML:scenario 节(population / duration / seed /
/// population_mix)+ model 节全量数值参数。公式槽按默认(见 docs 10)。
pub fn merged_yaml(cfg: &SimConfig) -> String {
    let mut scenario = Map::new();
    scenario.insert("population".into(), json!(cfg.players));
    scenario.insert("duration".into(), json!(format!("{}d", cfg.days)));
    scenario.insert("seed".into(), json!(cfg.base_seed));
    scenario.insert(
        "population_mix".into(),
        json!({
            "casual": cfg.cohort_weights[0],
            "core": cfg.cohort_weights[1],
            "whale": cfg.cohort_weights[2],
        }),
    );
    let mut model = Map::new();
    for s in core::registry::all() {
        if !s.path.starts_with("model.") {
            continue;
        }
        // 练级产出面未配置时不落节(read_numeric 对缺省回 0,写出会无中生有)
        if s.path.starts_with("model.training.") && cfg.training.is_none() {
            continue;
        }
        let Ok(v) = core::registry::read_numeric(cfg, s.path) else {
            continue;
        };
        let segs: Vec<&'static str> = s.path["model.".len()..].split('.').collect();
        insert_path(&mut model, &segs, num_value(v));
    }
    let mut root = Map::new();
    root.insert("schema_version".into(), json!("1"));
    root.insert("scenario".into(), Value::Object(scenario));
    root.insert("model".into(), Value::Object(model));
    serde_yaml_ng::to_string(&Value::Object(root)).expect("YAML 序列化不失败(Map/标量)")
}

fn num_value(v: f64) -> Value {
    if v.fract() == 0.0 && v.abs() < 9e15 {
        json!(v as i64)
    } else {
        json!(v)
    }
}

/// 按路径段嵌套插入:["warrior","attack"] → {warrior: {attack: v}}。
fn insert_path(map: &mut Map<String, Value>, segs: &[&'static str], v: Value) {
    let Some((first, rest)) = segs.split_first() else {
        return;
    };
    if rest.is_empty() {
        map.insert((*first).to_string(), v);
        return;
    }
    let entry = map
        .entry((*first).to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(Map::new());
    }
    if let Value::Object(inner) = entry {
        insert_path(inner, rest, v);
    }
}
