//! 参数注册表(文档 07 章):路径 → 类型 / 默认值 / 说明。
//!
//! 加载时校验:未知路径报错(附相近路径建议)、节形状不符报错;
//! 类型与取值范围由 serde 反序列化与 [`crate::config::validate`] 把关。
//! 注册表是静态表,运行期寻址零字符串查找(sweep / override 的寻址基础)。

use crate::config::SimConfig;
use crate::Error;
use serde_yaml_ng::Value;

/// 参数类型(注册表面)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ParamKind {
    U32,
    U64,
    I64,
    F64,
    /// 天数时长,写作 "30d"
    Dur,
    /// population_mix 的分群权重(casual / core / whale)
    Mix,
    /// 公式表达式(编译与白名单校验交给 [`crate::formula`])
    Expr,
}

/// 单个参数的注册项。
#[derive(Debug, Clone, Copy)]
pub struct ParamSpec {
    pub path: &'static str,
    pub kind: ParamKind,
    pub default: &'static str,
    pub desc: &'static str,
}

const SCENARIO: &[ParamSpec] = &[
    spec("scenario.population", U32, "10000", "玩家总数"),
    spec("scenario.duration", Dur, "30d", "仿真时长"),
    spec("scenario.seed", U64, "12345", "基础种子"),
    spec("scenario.population_mix.casual", Mix, "0.60", "casual 占比"),
    spec("scenario.population_mix.core", Mix, "0.30", "core 占比"),
    spec("scenario.population_mix.whale", Mix, "0.10", "whale 占比"),
];

const MODEL: &[ParamSpec] = &[
    spec(
        "model.warrior.attack",
        I64,
        "100",
        "初始攻击力(A/B 常用被扫参数)",
    ),
    spec("model.warrior.defense", I64, "80", "初始防御"),
    spec("model.warrior.hp", I64, "1000", "初始生命(每场战斗满血)"),
    spec(
        "model.whale_gain_mult",
        I64,
        "2",
        "whale 金币/经验获取倍率(无付费语义)",
    ),
    spec("model.combat.p_hit", F64, "0.85", "玩家命中概率"),
    spec("model.combat.p_hit_monster", F64, "0.85", "怪物命中概率"),
    spec("model.combat.dmg_var", I64, "10", "伤害浮动半宽 ±"),
    spec(
        "model.combat.max_rounds",
        U32,
        "32",
        "最大战斗轮数(超过判负)",
    ),
    spec("model.dungeon.tiers", U32, "8", "副本层数(0 起)"),
    spec("model.dungeon.m_hp", I64, "300", "第 0 层怪物 hp"),
    spec("model.dungeon.m_attack", I64, "45", "第 0 层怪物攻击"),
    spec("model.dungeon.m_defense", I64, "20", "第 0 层怪物防御"),
    spec("model.dungeon.tier_growth", F64, "1.5", "每层怪物数值倍率"),
    spec("model.dungeon.reward_gold", I64, "40", "第 0 层金币产出"),
    spec("model.dungeon.reward_xp", I64, "45", "第 0 层经验产出"),
    spec("model.dungeon.reward_growth", F64, "1.4", "每层产出倍率"),
    spec(
        "model.behavior.casual.sessions_int",
        U32,
        "1",
        "casual 每日会话整数部分",
    ),
    spec(
        "model.behavior.casual.sessions_frac",
        F64,
        "0.5",
        "casual 补 1 概率",
    ),
    spec(
        "model.behavior.casual.p_dungeon",
        F64,
        "0.7",
        "casual 副本概率",
    ),
    spec(
        "model.behavior.casual.p_upgrade",
        F64,
        "0.2",
        "casual 升级概率",
    ),
    spec(
        "model.behavior.core.sessions_int",
        U32,
        "2",
        "core 每日会话整数部分",
    ),
    spec(
        "model.behavior.core.sessions_frac",
        F64,
        "0.5",
        "core 补 1 概率",
    ),
    spec("model.behavior.core.p_dungeon", F64, "0.6", "core 副本概率"),
    spec("model.behavior.core.p_upgrade", F64, "0.3", "core 升级概率"),
    spec(
        "model.behavior.whale.sessions_int",
        U32,
        "5",
        "whale 每日会话整数部分",
    ),
    spec(
        "model.behavior.whale.sessions_frac",
        F64,
        "0.0",
        "whale 补 1 概率",
    ),
    spec(
        "model.behavior.whale.p_dungeon",
        F64,
        "0.65",
        "whale 副本概率",
    ),
    spec(
        "model.behavior.whale.p_upgrade",
        F64,
        "0.3",
        "whale 升级概率",
    ),
    spec("model.progression.xp_base", I64, "60", "升级经验基数"),
    spec("model.progression.xp_pow", F64, "1.3", "升级经验指数"),
    spec(
        "model.progression.level_attack_gain",
        I64,
        "5",
        "每次升级攻击增量",
    ),
    spec(
        "model.progression.level_defense_gain",
        I64,
        "3",
        "每次升级防御增量",
    ),
    spec(
        "model.progression.level_hp_gain",
        I64,
        "50",
        "每次升级生命增量",
    ),
    spec(
        "model.progression.upgrade_cost_base",
        I64,
        "50",
        "首次强化成本",
    ),
    spec("model.progression.upgrade_cost_num", I64, "5", "成本链分子"),
    spec("model.progression.upgrade_cost_den", I64, "4", "成本链分母"),
    spec(
        "model.progression.upgrade_attack_gain",
        I64,
        "2",
        "每次强化攻击增量",
    ),
    spec(
        "model.formulas.xp_needed",
        Expr,
        "xp_base * level ^ xp_pow",
        "升级所需经验公式(变量: level, xp_base, xp_pow)",
    ),
    spec("model.churn.p_base", F64, "0.003", "正常日流失概率"),
    spec("model.churn.p_stall", F64, "0.05", "停滞日流失概率"),
    spec("model.churn.stall_days", U32, "2", "连续无增长天数判停滞"),
];

use ParamKind::{Dur, Expr, Mix, F64, I64, U32, U64};

const fn spec(
    path: &'static str,
    kind: ParamKind,
    default: &'static str,
    desc: &'static str,
) -> ParamSpec {
    ParamSpec {
        path,
        kind,
        default,
        desc,
    }
}

/// 全部注册项(scenario 节 + model 节)。
pub fn all() -> impl Iterator<Item = &'static ParamSpec> {
    SCENARIO.iter().chain(MODEL.iter())
}

pub fn lookup(path: &str) -> Option<&'static ParamSpec> {
    all().find(|s| s.path == path)
}

/// 相近路径建议(编辑距离 ≤ 3,按距离升序取至多 3 条)。
pub fn suggestions(path: &str) -> Vec<&'static str> {
    let mut cands: Vec<(usize, &'static str)> = all()
        .map(|s| (edit_distance(path, s.path), s.path))
        .filter(|(d, _)| *d <= 3)
        .collect();
    cands.sort_by_key(|(d, _)| *d);
    cands.into_iter().map(|(_, p)| p).take(3).collect()
}

fn edit_distance(a: &str, b: &str) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    let mut cur = vec![0usize; b.len() + 1];
    for i in 1..=a.len() {
        cur[0] = i;
        for j in 1..=b.len() {
            cur[j] = (prev[j] + 1)
                .min(cur[j - 1] + 1)
                .min(prev[j - 1] + usize::from(a[i - 1] != b[j - 1]));
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    prev[b.len()]
}

/// 已知的节路径(其下为叶参数或已知子节)。
const SECTIONS: &[&str] = &[
    "scenario",
    "scenario.population_mix",
    "model",
    "model.warrior",
    "model.combat",
    "model.dungeon",
    "model.behavior",
    "model.behavior.casual",
    "model.behavior.core",
    "model.behavior.whale",
    "model.progression",
    "model.formulas",
    "model.churn",
];

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
        if SECTIONS.contains(&path.as_str()) {
            check_section(&path, sub)?;
        } else if lookup(&path).is_some() {
            // 标量参数,类型检查交给 serde
        } else {
            return Err(unknown(&path));
        }
    }
    Ok(())
}

/// 数值寻址:sweep / override 把一个扫描值写入指定注册表路径。
/// 非数值槽(时长、公式表达式)与未知路径报配置错误。
pub fn apply_numeric(cfg: &mut SimConfig, path: &str, value: f64) -> Result<(), Error> {
    let unsigned = |v: f64, ty: &str| -> Result<f64, Error> {
        if v < 0.0 {
            Err(Error::Config(format!("{path}: {ty} 不能为负(得到 {v})")))
        } else {
            Ok(v)
        }
    };
    match path {
        "scenario.population" => cfg.players = unsigned(value, "population")?.round() as u32,
        "scenario.seed" => cfg.base_seed = unsigned(value, "seed")?.round() as u64,
        "scenario.population_mix.casual" => cfg.cohort_weights[0] = value,
        "scenario.population_mix.core" => cfg.cohort_weights[1] = value,
        "scenario.population_mix.whale" => cfg.cohort_weights[2] = value,
        "model.warrior.attack" => cfg.warrior.attack = value.round() as i64,
        "model.warrior.defense" => cfg.warrior.defense = value.round() as i64,
        "model.warrior.hp" => cfg.warrior.hp = value.round() as i64,
        "model.whale_gain_mult" => cfg.whale_gain_mult = value.round() as i64,
        "model.combat.p_hit" => cfg.combat.p_hit = value,
        "model.combat.p_hit_monster" => cfg.combat.p_hit_monster = value,
        "model.combat.dmg_var" => cfg.combat.dmg_var = value.round() as i64,
        "model.combat.max_rounds" => {
            cfg.combat.max_rounds = unsigned(value, "max_rounds")?.round() as u32
        }
        "model.dungeon.tiers" => cfg.dungeon.tiers = unsigned(value, "tiers")?.round() as u32,
        "model.dungeon.m_hp" => cfg.dungeon.m_hp = value.round() as i64,
        "model.dungeon.m_attack" => cfg.dungeon.m_attack = value.round() as i64,
        "model.dungeon.m_defense" => cfg.dungeon.m_defense = value.round() as i64,
        "model.dungeon.tier_growth" => cfg.dungeon.tier_growth = value,
        "model.dungeon.reward_gold" => cfg.dungeon.reward_gold = value.round() as i64,
        "model.dungeon.reward_xp" => cfg.dungeon.reward_xp = value.round() as i64,
        "model.dungeon.reward_growth" => cfg.dungeon.reward_growth = value,
        "model.behavior.casual.sessions_int" => {
            cfg.behavior.casual.sessions_int = unsigned(value, "sessions_int")?.round() as u32
        }
        "model.behavior.casual.sessions_frac" => cfg.behavior.casual.sessions_frac = value,
        "model.behavior.casual.p_dungeon" => cfg.behavior.casual.p_dungeon = value,
        "model.behavior.casual.p_upgrade" => cfg.behavior.casual.p_upgrade = value,
        "model.behavior.core.sessions_int" => {
            cfg.behavior.core.sessions_int = unsigned(value, "sessions_int")?.round() as u32
        }
        "model.behavior.core.sessions_frac" => cfg.behavior.core.sessions_frac = value,
        "model.behavior.core.p_dungeon" => cfg.behavior.core.p_dungeon = value,
        "model.behavior.core.p_upgrade" => cfg.behavior.core.p_upgrade = value,
        "model.behavior.whale.sessions_int" => {
            cfg.behavior.whale.sessions_int = unsigned(value, "sessions_int")?.round() as u32
        }
        "model.behavior.whale.sessions_frac" => cfg.behavior.whale.sessions_frac = value,
        "model.behavior.whale.p_dungeon" => cfg.behavior.whale.p_dungeon = value,
        "model.behavior.whale.p_upgrade" => cfg.behavior.whale.p_upgrade = value,
        "model.progression.xp_base" => cfg.progression.xp_base = value.round() as i64,
        "model.progression.xp_pow" => cfg.progression.xp_pow = value,
        "model.progression.level_attack_gain" => {
            cfg.progression.level_attack_gain = value.round() as i64
        }
        "model.progression.level_defense_gain" => {
            cfg.progression.level_defense_gain = value.round() as i64
        }
        "model.progression.level_hp_gain" => cfg.progression.level_hp_gain = value.round() as i64,
        "model.progression.upgrade_cost_base" => {
            cfg.progression.upgrade_cost_base = value.round() as i64
        }
        "model.progression.upgrade_cost_num" => {
            cfg.progression.upgrade_cost_num = value.round() as i64
        }
        "model.progression.upgrade_cost_den" => {
            cfg.progression.upgrade_cost_den = value.round() as i64
        }
        "model.progression.upgrade_attack_gain" => {
            cfg.progression.upgrade_attack_gain = value.round() as i64
        }
        "model.churn.p_base" => cfg.churn.p_base = value,
        "model.churn.p_stall" => cfg.churn.p_stall = value,
        "model.churn.stall_days" => {
            cfg.churn.stall_days = unsigned(value, "stall_days")?.round() as u32
        }
        // 非数值槽:不可数值扫描(时长是字符串,公式是表达式)
        "scenario.duration" | "model.formulas.xp_needed" => {
            return Err(Error::Config(format!(
                "{path}: 该参数不是数值,不可数值扫描"
            )));
        }
        _ => return Err(unknown(path)),
    }
    Ok(())
}

fn key_str(k: &Value) -> Result<String, Error> {
    k.as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| Error::Config("配置键必须为字符串".into()))
}

fn unknown(path: &str) -> Error {
    let sugg = suggestions(path);
    if sugg.is_empty() {
        Error::Config(format!("{path}: 未知参数(注册表中无相近路径)"))
    } else {
        Error::Config(format!(
            "{path}: 未知参数,你是否想写 {}?注册表中相近路径: {}",
            sugg[0],
            sugg.join(" / ")
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_yaml_ng::from_str;

    #[test]
    fn 注册表路径唯一且非空() {
        let mut paths: Vec<&str> = all().map(|s| s.path).collect();
        let n = paths.len();
        paths.sort_unstable();
        paths.dedup();
        assert_eq!(paths.len(), n, "注册表路径必须唯一");
        assert!(n >= 40);
    }

    #[test]
    fn 未知路径给出建议() {
        let yaml = "schema_version: \"1\"\nmodel:\n  warrior:\n    atk: 100\n";
        let root: Value = from_str(yaml).unwrap();
        let err = check_tree(&root).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("model.warrior.atk"), "{msg}");
        assert!(msg.contains("model.warrior.attack"), "{msg}");
    }

    #[test]
    fn 合法树通过() {
        let yaml = "schema_version: \"1\"\nscenario:\n  population: 100\ndungeon_stub: 1\n";
        // dungeon_stub 是未知根键,应报错
        let root: Value = from_str(yaml).unwrap();
        assert!(check_tree(&root).is_err());

        let yaml = "schema_version: \"1\"\nscenario:\n  population: 100\nmodel:\n  churn:\n    p_base: 0.01\n";
        let root: Value = from_str(yaml).unwrap();
        assert!(check_tree(&root).is_ok());
    }

    #[test]
    fn 编辑距离_基础() {
        assert_eq!(edit_distance("abc", "abc"), 0);
        assert_eq!(edit_distance("atk", "attack"), 3);
        assert_eq!(edit_distance("", "ab"), 2);
    }
}
