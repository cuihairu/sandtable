//! 参数注册表(文档 07 章):路径 → 类型 / 默认值 / 说明。
//!
//! 加载时校验:未知路径报错(附相近路径建议)、节形状不符报错;
//! 类型与取值范围由 serde 反序列化与 [`crate::config::validate`] 把关。
//! 注册表是静态表,运行期寻址零字符串查找(sweep / override 的寻址基础)。

use crate::config::SimConfig;
use crate::Error;
use serde_yaml_ng::Value;

/// 参数类型(注册表面)。serde 小写串(#[serde(rename_all)]),wasm / Tauri
/// 桥接与 TS ParamKind 字面量同形(WB-03.04)。
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
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
    /// 结构参数(如逐层数组):注册在案供校验与提示,不进数值通道
    Table,
}

/// 单个参数的注册项。Serialize 直出桥接面(WB-03.04):恰四字段
/// path/kind/default/desc,内核没有的可选元信息一概不出场(缺失保持
/// 缺席,由消费方按空值处理),不造默认元信息。
#[derive(Debug, Clone, Copy, serde::Serialize)]
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
    spec(
        "model.combat.damage_model",
        Table,
        "difference",
        "战斗伤害口径(difference 缺省 / ratio;结构开关,不进数值通道)",
    ),
    spec(
        "model.combat.ratio_k",
        F64,
        "1.0",
        "比值伤害比例参数(dmg = k·attack/(attack+defense),仅 damage_model: ratio 生效)",
    ),
    spec(
        "model.training.xp",
        I64,
        "400",
        "每次练级会话经验产出(需 behavior.*.p_training > 0)",
    ),
    spec(
        "model.training.gold",
        I64,
        "150",
        "每次练级会话金币产出(需 behavior.*.p_training > 0)",
    ),
    spec("model.dungeon.tiers", U32, "8", "副本层数(0 起)"),
    spec("model.dungeon.m_hp", I64, "250", "第 0 层怪物 hp"),
    spec("model.dungeon.m_attack", I64, "160", "第 0 层怪物攻击"),
    spec("model.dungeon.m_defense", I64, "150", "第 0 层怪物防御"),
    spec("model.dungeon.tier_growth", F64, "1.3", "每层怪物数值倍率"),
    spec("model.dungeon.reward_gold", I64, "40", "第 0 层金币产出"),
    spec("model.dungeon.reward_xp", I64, "45", "第 0 层经验产出"),
    spec(
        "model.dungeon.reward_gold_growth",
        F64,
        "1.4",
        "每层金币产出倍率",
    ),
    spec(
        "model.dungeon.reward_xp_growth",
        F64,
        "1.4",
        "每层经验产出倍率",
    ),
    spec(
        "model.dungeon.tier_table",
        Table,
        "—",
        "逐层怪物表(给出时覆盖几何推导,长度须等于 tiers)",
    ),
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
        "model.behavior.casual.p_training",
        F64,
        "0.1",
        "casual 练级概率(需 model.training 产出面)",
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
        "model.behavior.core.p_training",
        F64,
        "0.1",
        "core 练级概率(需 model.training 产出面)",
    ),
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
    spec(
        "model.behavior.whale.p_training",
        F64,
        "0.05",
        "whale 练级概率(需 model.training 产出面)",
    ),
    spec("model.progression.xp_base", I64, "60", "升级经验基数"),
    spec("model.progression.xp_pow", F64, "1.3", "升级经验指数"),
    spec(
        "model.progression.level_attack_gain",
        I64,
        "8",
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
    spec(
        "model.loot.rate_mult",
        F64,
        "1.0",
        "掉落产出倍率(乘到金币/经验数额,不改表形状;loot 未配置时不生效)",
    ),
    spec(
        "model.loot.tables",
        Table,
        "—",
        "掉落加权表(表名 → 权重;结构性参数,改形状走 YAML 编辑)",
    ),
    spec(
        "model.loot.on_victory",
        Table,
        "—",
        "胜利结算用表名(须为 tables 中的键;结构开关,不进数值通道)",
    ),
    spec(
        "model.loot.rewards",
        Table,
        "—",
        "掉落条目数额表(条目 → {gold, xp};结构性参数,改形状走 YAML 编辑)",
    ),
    spec(
        "model.gacha.base_rate",
        F64,
        "0.02",
        "抽卡单抽基础命中率(0, 1];扫它 = 扫出货概率强度)",
    ),
    spec(
        "model.gacha.pity_hard",
        U64,
        "0",
        "硬保底抽数(第 N 抽必中;0 = 无保底)",
    ),
    spec(
        "model.gacha.pity_soft_start",
        U64,
        "0",
        "软保底起点抽数(从第 N 抽起每抽 +step)",
    ),
    spec(
        "model.gacha.pity_soft_step",
        F64,
        "0.0",
        "软保底起点后每抽概率增量(0 = 无软保底)",
    ),
    spec(
        "model.gacha.featured_rate",
        F64,
        "0.0",
        "5★ 命中时为所定目标/UP 卡的概率(0 = 无目标概念,如常驻池)",
    ),
    spec(
        "model.gacha.featured_guarantee",
        U64,
        "0",
        "定轨:连续非目标 5★ 达该次数后,下一次 5★ 必为所定目标(0 = 无定轨)",
    ),
];

use ParamKind::{Dur, Expr, Mix, Table, F64, I64, U32, U64};

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

/// 读数值参数(弹性 / 推荐要取基线值;与 [`apply_numeric`] 逐路径互为镜像,
/// 镜像测试锁定)。
pub fn read_numeric(cfg: &SimConfig, path: &str) -> Result<f64, Error> {
    match path {
        "scenario.population" => Ok(cfg.players as f64),
        "scenario.seed" => Ok(cfg.base_seed as f64),
        "scenario.population_mix.casual" => Ok(cfg.cohort_weights[0]),
        "scenario.population_mix.core" => Ok(cfg.cohort_weights[1]),
        "scenario.population_mix.whale" => Ok(cfg.cohort_weights[2]),
        "model.warrior.attack" => Ok(cfg.warrior.attack as f64),
        "model.warrior.defense" => Ok(cfg.warrior.defense as f64),
        "model.warrior.hp" => Ok(cfg.warrior.hp as f64),
        "model.whale_gain_mult" => Ok(cfg.whale_gain_mult as f64),
        "model.combat.p_hit" => Ok(cfg.combat.p_hit),
        "model.combat.p_hit_monster" => Ok(cfg.combat.p_hit_monster),
        "model.combat.dmg_var" => Ok(cfg.combat.dmg_var as f64),
        "model.combat.max_rounds" => Ok(cfg.combat.max_rounds as f64),
        "model.combat.ratio_k" => Ok(cfg.combat.ratio_k),
        "model.training.xp" => Ok(cfg.training.map(|t| t.xp).unwrap_or(0) as f64),
        "model.training.gold" => Ok(cfg.training.map(|t| t.gold).unwrap_or(0) as f64),
        "model.dungeon.tiers" => Ok(cfg.dungeon.tiers as f64),
        "model.dungeon.m_hp" => Ok(cfg.dungeon.m_hp as f64),
        "model.dungeon.m_attack" => Ok(cfg.dungeon.m_attack as f64),
        "model.dungeon.m_defense" => Ok(cfg.dungeon.m_defense as f64),
        "model.dungeon.tier_growth" => Ok(cfg.dungeon.tier_growth),
        "model.dungeon.reward_gold" => Ok(cfg.dungeon.reward_gold as f64),
        "model.dungeon.reward_xp" => Ok(cfg.dungeon.reward_xp as f64),
        "model.dungeon.reward_gold_growth" => Ok(cfg.dungeon.reward_gold_growth),
        "model.dungeon.reward_xp_growth" => Ok(cfg.dungeon.reward_xp_growth),
        "model.behavior.casual.sessions_int" => Ok(cfg.behavior.casual.sessions_int as f64),
        "model.behavior.casual.sessions_frac" => Ok(cfg.behavior.casual.sessions_frac),
        "model.behavior.casual.p_dungeon" => Ok(cfg.behavior.casual.p_dungeon),
        "model.behavior.casual.p_upgrade" => Ok(cfg.behavior.casual.p_upgrade),
        "model.behavior.casual.p_training" => Ok(cfg.behavior.casual.p_training),
        "model.behavior.core.sessions_int" => Ok(cfg.behavior.core.sessions_int as f64),
        "model.behavior.core.sessions_frac" => Ok(cfg.behavior.core.sessions_frac),
        "model.behavior.core.p_dungeon" => Ok(cfg.behavior.core.p_dungeon),
        "model.behavior.core.p_upgrade" => Ok(cfg.behavior.core.p_upgrade),
        "model.behavior.core.p_training" => Ok(cfg.behavior.core.p_training),
        "model.behavior.whale.sessions_int" => Ok(cfg.behavior.whale.sessions_int as f64),
        "model.behavior.whale.sessions_frac" => Ok(cfg.behavior.whale.sessions_frac),
        "model.behavior.whale.p_dungeon" => Ok(cfg.behavior.whale.p_dungeon),
        "model.behavior.whale.p_upgrade" => Ok(cfg.behavior.whale.p_upgrade),
        "model.behavior.whale.p_training" => Ok(cfg.behavior.whale.p_training),
        "model.progression.xp_base" => Ok(cfg.progression.xp_base as f64),
        "model.progression.xp_pow" => Ok(cfg.progression.xp_pow),
        "model.progression.level_attack_gain" => Ok(cfg.progression.level_attack_gain as f64),
        "model.progression.level_defense_gain" => Ok(cfg.progression.level_defense_gain as f64),
        "model.progression.level_hp_gain" => Ok(cfg.progression.level_hp_gain as f64),
        "model.progression.upgrade_cost_base" => Ok(cfg.progression.upgrade_cost_base as f64),
        "model.progression.upgrade_cost_num" => Ok(cfg.progression.upgrade_cost_num as f64),
        "model.progression.upgrade_cost_den" => Ok(cfg.progression.upgrade_cost_den as f64),
        "model.progression.upgrade_attack_gain" => Ok(cfg.progression.upgrade_attack_gain as f64),
        "model.churn.p_base" => Ok(cfg.churn.p_base),
        "model.churn.p_stall" => Ok(cfg.churn.p_stall),
        "model.churn.stall_days" => Ok(cfg.churn.stall_days as f64),
        // 掉落数值通道(docs/loot-settlement-design.md):结算已接入,
        // 未配置时缺省 1.0(与 gacha 同口径——写不写都不改变未配置语义)
        "model.loot.rate_mult" => Ok(cfg.loot.as_ref().map(|l| l.rate_mult).unwrap_or(1.0)),
        "model.gacha.base_rate" => Ok(cfg.gacha.as_ref().map(|g| g.base_rate).unwrap_or(0.02)),
        "model.gacha.pity_hard" => Ok(cfg.gacha.as_ref().map(|g| g.pity_hard).unwrap_or(0) as f64),
        "model.gacha.pity_soft_start" => {
            Ok(cfg.gacha.as_ref().map(|g| g.pity_soft_start).unwrap_or(0) as f64)
        }
        "model.gacha.pity_soft_step" => {
            Ok(cfg.gacha.as_ref().map(|g| g.pity_soft_step).unwrap_or(0.0))
        }
        "model.gacha.featured_rate" => {
            Ok(cfg.gacha.as_ref().map(|g| g.featured_rate).unwrap_or(0.0))
        }
        "model.gacha.featured_guarantee" => Ok(cfg
            .gacha
            .as_ref()
            .map(|g| g.featured_guarantee)
            .unwrap_or(0) as f64),
        // 非数值槽:与 apply_numeric 同口径
        "scenario.duration"
        | "model.formulas.xp_needed"
        | "model.dungeon.tier_table"
        | "model.combat.damage_model"
        | "model.loot.tables"
        | "model.loot.on_victory"
        | "model.loot.rewards" => Err(Error::Config(format!(
            "{path}: 该参数不是数值,不可数值读取"
        ))),
        _ => Err(unknown(path)),
    }
}

/// 数值寻址:sweep / override 把一个扫描值写入指定注册表路径。
/// 非数值槽(时长、公式表达式)与未知路径报配置错误。
pub fn apply_numeric(cfg: &mut SimConfig, path: &str, value: f64) -> Result<(), Error> {
    let unsigned = |v: f64, ty: &str| -> Result<f64, Error> {
        if v < 0.0 {
            Err(Error::Config(format!("{path}: {ty} 不能为负(得到 {v})")))
        } else if v > u32::MAX as f64 {
            Err(Error::Config(format!(
                "{path}: {ty} 不能超过 u32 上限(得到 {v})"
            )))
        } else {
            Ok(v)
        }
    };
    // u64 槽位安全整数门(WB-03.08):f64 在 2^53 之外整数值会静默舍入,
    // seed / 保底抽数是确定性语义,错 1 就是另一个实验——明确拒绝不静默。
    let exact_u64 = |v: f64, ty: &str| -> Result<f64, Error> {
        // 不复用 unsigned:u64 槽(seed/保底抽数)合法值域到 2^53−1,
        // u32 上界只属于 u32 槽,先经 unsigned 会把大 seed 误报成 u32 超限。
        if v < 0.0 {
            Err(Error::Config(format!("{path}: {ty} 不能为负(得到 {v})")))
        } else if v > 9_007_199_254_740_991.0 {
            Err(Error::Config(format!(
                "{path}: {ty} 超出安全整数上限 2^53−1(得到 {v}),请在 YAML 直接编辑,不静默舍入"
            )))
        } else {
            Ok(v)
        }
    };
    // F64 槽门(与 validate 的「非负有限」一致):pity_soft_step 是概率增量
    // f64,合法值域为非负有限数——不得套 u32 上界门(u32 上界只属于 u32 槽),
    // 否则同一参数经 YAML 直配与 apply_numeric 两条入口行为不一致。
    let finite_nonneg = |v: f64, ty: &str| -> Result<f64, Error> {
        if !v.is_finite() || v < 0.0 {
            Err(Error::Config(format!(
                "{path}: {ty} 必须为非负有限数(得到 {v})"
            )))
        } else {
            Ok(v)
        }
    };
    // 只拒绝非有限(NaN/Inf):cohort_weights 是人群配比,validate 允许单项为负
    // (只要求每项有限且总和 > 0),故不套非负门,只挡会污染仿真的 NaN/Inf。
    let finite_only = |v: f64, ty: &str| -> Result<f64, Error> {
        if !v.is_finite() {
            Err(Error::Config(format!(
                "{path}: {ty} 必须为有限数(得到 {v})"
            )))
        } else {
            Ok(v)
        }
    };
    match path {
        "scenario.population" => cfg.players = unsigned(value, "population")?.round() as u32,
        "scenario.seed" => cfg.base_seed = exact_u64(value, "seed")?.round() as u64,
        "scenario.population_mix.casual" => {
            cfg.cohort_weights[0] = finite_only(value, "population_mix.casual")?
        }
        "scenario.population_mix.core" => {
            cfg.cohort_weights[1] = finite_only(value, "population_mix.core")?
        }
        "scenario.population_mix.whale" => {
            cfg.cohort_weights[2] = finite_only(value, "population_mix.whale")?
        }
        "model.warrior.attack" => cfg.warrior.attack = value.round() as i64,
        "model.warrior.defense" => cfg.warrior.defense = value.round() as i64,
        "model.warrior.hp" => cfg.warrior.hp = value.round() as i64,
        "model.whale_gain_mult" => cfg.whale_gain_mult = value.round() as i64,
        "model.combat.p_hit" => cfg.combat.p_hit = finite_nonneg(value, "p_hit")?,
        "model.combat.p_hit_monster" => {
            cfg.combat.p_hit_monster = finite_nonneg(value, "p_hit_monster")?
        }
        "model.combat.dmg_var" => cfg.combat.dmg_var = value.round() as i64,
        "model.combat.max_rounds" => {
            cfg.combat.max_rounds = unsigned(value, "max_rounds")?.round() as u32
        }
        "model.combat.ratio_k" => cfg.combat.ratio_k = finite_nonneg(value, "ratio_k")?,
        "model.training.xp" => {
            cfg.training
                .get_or_insert_with(crate::config::TrainingConfig::default)
                .xp = value.round() as i64;
        }
        "model.training.gold" => {
            cfg.training
                .get_or_insert_with(crate::config::TrainingConfig::default)
                .gold = value.round() as i64;
        }
        "model.dungeon.tiers" => cfg.dungeon.tiers = unsigned(value, "tiers")?.round() as u32,
        "model.dungeon.m_hp" => cfg.dungeon.m_hp = value.round() as i64,
        "model.dungeon.m_attack" => cfg.dungeon.m_attack = value.round() as i64,
        "model.dungeon.m_defense" => cfg.dungeon.m_defense = value.round() as i64,
        "model.dungeon.tier_growth" => {
            cfg.dungeon.tier_growth = finite_nonneg(value, "tier_growth")?
        }
        "model.dungeon.reward_gold" => cfg.dungeon.reward_gold = value.round() as i64,
        "model.dungeon.reward_xp" => cfg.dungeon.reward_xp = value.round() as i64,
        "model.dungeon.reward_gold_growth" => {
            cfg.dungeon.reward_gold_growth = finite_nonneg(value, "reward_gold_growth")?
        }
        "model.dungeon.reward_xp_growth" => {
            cfg.dungeon.reward_xp_growth = finite_nonneg(value, "reward_xp_growth")?
        }
        "model.behavior.casual.sessions_int" => {
            cfg.behavior.casual.sessions_int = unsigned(value, "sessions_int")?.round() as u32
        }
        "model.behavior.casual.sessions_frac" => {
            cfg.behavior.casual.sessions_frac =
                finite_nonneg(value, "behavior.casual.sessions_frac")?
        }
        "model.behavior.casual.p_dungeon" => {
            cfg.behavior.casual.p_dungeon = finite_nonneg(value, "behavior.casual.p_dungeon")?
        }
        "model.behavior.casual.p_upgrade" => {
            cfg.behavior.casual.p_upgrade = finite_nonneg(value, "behavior.casual.p_upgrade")?
        }
        "model.behavior.casual.p_training" => {
            cfg.behavior.casual.p_training = finite_nonneg(value, "behavior.casual.p_training")?
        }
        "model.behavior.core.sessions_int" => {
            cfg.behavior.core.sessions_int = unsigned(value, "sessions_int")?.round() as u32
        }
        "model.behavior.core.sessions_frac" => {
            cfg.behavior.core.sessions_frac = finite_nonneg(value, "behavior.core.sessions_frac")?
        }
        "model.behavior.core.p_dungeon" => {
            cfg.behavior.core.p_dungeon = finite_nonneg(value, "behavior.core.p_dungeon")?
        }
        "model.behavior.core.p_upgrade" => {
            cfg.behavior.core.p_upgrade = finite_nonneg(value, "behavior.core.p_upgrade")?
        }
        "model.behavior.core.p_training" => {
            cfg.behavior.core.p_training = finite_nonneg(value, "behavior.core.p_training")?
        }
        "model.behavior.whale.sessions_int" => {
            cfg.behavior.whale.sessions_int = unsigned(value, "sessions_int")?.round() as u32
        }
        "model.behavior.whale.sessions_frac" => {
            cfg.behavior.whale.sessions_frac = finite_nonneg(value, "behavior.whale.sessions_frac")?
        }
        "model.behavior.whale.p_dungeon" => {
            cfg.behavior.whale.p_dungeon = finite_nonneg(value, "behavior.whale.p_dungeon")?
        }
        "model.behavior.whale.p_upgrade" => {
            cfg.behavior.whale.p_upgrade = finite_nonneg(value, "behavior.whale.p_upgrade")?
        }
        "model.behavior.whale.p_training" => {
            cfg.behavior.whale.p_training = finite_nonneg(value, "behavior.whale.p_training")?
        }
        "model.progression.xp_base" => cfg.progression.xp_base = value.round() as i64,
        "model.progression.xp_pow" => cfg.progression.xp_pow = finite_nonneg(value, "xp_pow")?,
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
        "model.churn.p_base" => cfg.churn.p_base = finite_nonneg(value, "p_base")?,
        "model.churn.p_stall" => cfg.churn.p_stall = finite_nonneg(value, "p_stall")?,
        "model.churn.stall_days" => {
            cfg.churn.stall_days = unsigned(value, "stall_days")?.round() as u32
        }
        "model.loot.rate_mult" => {
            cfg.loot
                .get_or_insert_with(crate::config::LootConfig::default)
                .rate_mult = finite_nonneg(value, "rate_mult")?;
        }
        "model.gacha.base_rate" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .base_rate = finite_nonneg(value, "base_rate")?;
        }
        "model.gacha.pity_hard" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .pity_hard = exact_u64(value, "pity_hard")?.round() as u64;
        }
        "model.gacha.pity_soft_start" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .pity_soft_start = exact_u64(value, "pity_soft_start")?.round() as u64;
        }
        "model.gacha.pity_soft_step" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .pity_soft_step = finite_nonneg(value, "pity_soft_step")?;
        }
        "model.gacha.featured_rate" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .featured_rate = finite_nonneg(value, "featured_rate")?;
        }
        "model.gacha.featured_guarantee" => {
            cfg.gacha
                .get_or_insert_with(crate::config::GachaConfig::default)
                .featured_guarantee = exact_u64(value, "featured_guarantee")?.round() as u64;
        }
        // 非数值槽:不可数值扫描(时长是字符串,公式是表达式,逐层表是数组,
        // 伤害口径是枚举开关,掉落结构面是字符串/映射)
        "scenario.duration"
        | "model.formulas.xp_needed"
        | "model.dungeon.tier_table"
        | "model.combat.damage_model"
        | "model.loot.tables"
        | "model.loot.on_victory"
        | "model.loot.rewards" => {
            return Err(Error::Config(format!(
                "{path}: 该参数不是数值,不可数值扫描"
            )));
        }
        _ => return Err(unknown(path)),
    }
    Ok(())
}

/// 读 u64 槽位的原始整数值(WB-03.08 无损通道):u64 经 [`read_numeric`]
/// 的 f64 会在 2^53 之外静默舍入,seed / 保底抽数要原始通道;桥接层对
/// 超出 JS 安全整数的值以十进制字符串无损表达。非 u64 路径返回 None。
pub fn read_u64_raw(cfg: &SimConfig, path: &str) -> Option<u64> {
    match path {
        "scenario.seed" => Some(cfg.base_seed),
        "model.gacha.pity_hard" => Some(cfg.gacha.as_ref().map(|g| g.pity_hard).unwrap_or(0)),
        "model.gacha.pity_soft_start" => {
            Some(cfg.gacha.as_ref().map(|g| g.pity_soft_start).unwrap_or(0))
        }
        "model.gacha.featured_guarantee" => Some(
            cfg.gacha
                .as_ref()
                .map(|g| g.featured_guarantee)
                .unwrap_or(0),
        ),
        _ => None,
    }
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
    fn registry_paths_unique_and_nonempty() {
        let mut paths: Vec<&str> = all().map(|s| s.path).collect();
        let n = paths.len();
        paths.sort_unstable();
        paths.dedup();
        assert_eq!(paths.len(), n, "注册表路径必须唯一");
        assert!(n >= 40);
    }

    #[test]
    fn unknown_path_suggests_alternatives() {
        let yaml = "schema_version: \"1\"\nmodel:\n  warrior:\n    atk: 100\n";
        let root: Value = from_str(yaml).unwrap();
        let err = check_tree(&root).unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("model.warrior.atk"), "{msg}");
        assert!(msg.contains("model.warrior.attack"), "{msg}");
    }

    #[test]
    fn valid_tree_passes() {
        let yaml = "schema_version: \"1\"\nscenario:\n  population: 100\ndungeon_stub: 1\n";
        // dungeon_stub 是未知根键,应报错
        let root: Value = from_str(yaml).unwrap();
        assert!(check_tree(&root).is_err());

        let yaml = "schema_version: \"1\"\nscenario:\n  population: 100\nmodel:\n  churn:\n    p_base: 0.01\n";
        let root: Value = from_str(yaml).unwrap();
        assert!(check_tree(&root).is_ok());
    }

    #[test]
    fn edit_distance_basics() {
        assert_eq!(edit_distance("abc", "abc"), 0);
        assert_eq!(edit_distance("atk", "attack"), 3);
        assert_eq!(edit_distance("", "ab"), 2);
    }

    /// 定轨字段已注册进参数表:YAML 入口放行(check_tree),数值通道可读可写
    /// (read_numeric / apply_numeric / read_u64_raw)。新增注册路径漏任何一臂
    /// 都会在此红(与 get_set_mirror_all_numeric_paths 同纪律)。
    #[test]
    fn featured_fields_registered_and_routable() {
        let yaml = "schema_version: \"1\"\nmodel:\n  gacha:\n    featured_rate: 0.5\n    featured_guarantee: 1\n";
        let root: Value = from_str(yaml).unwrap();
        check_tree(&root).expect("定轨字段应通过 YAML 入口校验");

        let cfg = SimConfig::default();
        assert_eq!(
            read_numeric(&cfg, "model.gacha.featured_rate").unwrap(),
            0.0
        );
        assert_eq!(
            read_numeric(&cfg, "model.gacha.featured_guarantee").unwrap(),
            0.0
        );
        assert_eq!(
            read_u64_raw(&cfg, "model.gacha.featured_guarantee"),
            Some(0)
        );

        let mut c2 = cfg.clone();
        apply_numeric(&mut c2, "model.gacha.featured_rate", 0.5).unwrap();
        apply_numeric(&mut c2, "model.gacha.featured_guarantee", 1.0).unwrap();
        let g = c2.gacha.as_ref().unwrap();
        assert_eq!(g.featured_rate, 0.5);
        assert_eq!(g.featured_guarantee, 1);
        assert_eq!(read_numeric(&c2, "model.gacha.featured_rate").unwrap(), 0.5);
        assert_eq!(read_u64_raw(&c2, "model.gacha.featured_guarantee"), Some(1));
    }

    #[test]
    fn unsigned_rejects_above_u32_max() {
        let mut cfg = SimConfig::default();
        let err = apply_numeric(&mut cfg, "scenario.population", u32::MAX as f64 + 1.0)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("不能超过 u32 上限"),
            "应拒绝超 u32 上限,实际:{err}"
        );
        let err = apply_numeric(&mut cfg, "scenario.population", -1.0)
            .unwrap_err()
            .to_string();
        assert!(err.contains("不能为负"), "仍应拒绝负数,实际:{err}");
        apply_numeric(&mut cfg, "scenario.population", 0.0).unwrap();
    }

    #[test]
    fn f64_slot_pity_soft_step_uses_finite_nonneg_not_u32_bound() {
        // F64 槽(概率增量)不得套 u32 上界门:超 u32 的值仍应可写(与 YAML
        // validate 的「非负有限」入口一致),但非有限/负值必须拒绝。
        let mut cfg = SimConfig::default();
        apply_numeric(
            &mut cfg,
            "model.gacha.pity_soft_step",
            u32::MAX as f64 + 1.0,
        )
        .unwrap();
        assert_eq!(
            cfg.gacha.as_ref().unwrap().pity_soft_step,
            u32::MAX as f64 + 1.0
        );
        for bad in [f64::NAN, f64::INFINITY, -1.0] {
            let err = apply_numeric(&mut cfg, "model.gacha.pity_soft_step", bad)
                .unwrap_err()
                .to_string();
            assert!(err.contains("非负有限"), "应拒绝 {bad},实际:{err}");
        }
        apply_numeric(&mut cfg, "model.gacha.pity_soft_step", 0.0).unwrap();
    }

    #[test]
    fn f64_slots_reject_nonfinite_and_negative() {
        // L631:非负有限门扩展到全部 f64 槽(此前只 pity_soft_step)。NaN/Inf/
        // 负值经数值通道必须拒绝,不静默写入污染仿真;validate 未覆盖的槽
        // (tier_growth / reward_*_growth / xp_pow)由此获得数值通道防线。
        let bad = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1.0];
        for path in [
            "model.combat.p_hit",
            "model.combat.p_hit_monster",
            "model.combat.ratio_k",
            "model.dungeon.tier_growth",
            "model.dungeon.reward_gold_growth",
            "model.dungeon.reward_xp_growth",
            "model.behavior.casual.sessions_frac",
            "model.behavior.casual.p_dungeon",
            "model.behavior.casual.p_upgrade",
            "model.behavior.casual.p_training",
            "model.behavior.core.sessions_frac",
            "model.behavior.core.p_dungeon",
            "model.behavior.core.p_upgrade",
            "model.behavior.core.p_training",
            "model.behavior.whale.sessions_frac",
            "model.behavior.whale.p_dungeon",
            "model.behavior.whale.p_upgrade",
            "model.behavior.whale.p_training",
            "model.progression.xp_pow",
            "model.churn.p_base",
            "model.churn.p_stall",
            "model.loot.rate_mult",
            "model.gacha.base_rate",
            "model.gacha.featured_rate",
        ] {
            for v in bad {
                let mut c = SimConfig::default();
                let err = apply_numeric(&mut c, path, v).unwrap_err().to_string();
                assert!(
                    err.contains("非负有限"),
                    "{path} 应拒绝 {v}(非负有限),实际:{err}"
                );
            }
            // 有效值仍可写(非负有限门不误伤合法值)
            let mut c = SimConfig::default();
            apply_numeric(&mut c, path, 0.5).unwrap();
        }
        // cohort_weights:validate 允许单项为负(只要求每项有限且总和 > 0),故
        // 只拒非有限;负值仍可写(与 validate 同口径,不额外加非负门)。
        for v in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            let mut c = SimConfig::default();
            let err = apply_numeric(&mut c, "scenario.population_mix.casual", v)
                .unwrap_err()
                .to_string();
            assert!(
                err.contains("有限数"),
                "cohort_weights 应拒绝 {v},实际:{err}"
            );
        }
        let mut c = SimConfig::default();
        apply_numeric(&mut c, "scenario.population_mix.casual", -0.5).unwrap();
    }

    #[test]
    fn exact_u64_accepts_above_u32_up_to_safe_integer() {
        // C2 修复回归锁:u64 槽(seed)合法值域到 2^53−1,u32 上界不得误伤;
        // 越 2^53−1 仍走安全整数门(明确拒绝不静默),不是 u32 门。
        let mut cfg = SimConfig::default();
        apply_numeric(&mut cfg, "scenario.seed", 12_345_678_901.0).unwrap();
        assert_eq!(cfg.base_seed, 12_345_678_901);
        let err = apply_numeric(&mut cfg, "scenario.seed", 9_007_199_254_740_993.0)
            .unwrap_err()
            .to_string();
        assert!(
            err.contains("2^53−1") && err.contains("不静默舍入"),
            "超安全整数应报 2^53−1 门,实际:{err}"
        );
    }

    /// read_numeric 与 apply_numeric 互为镜像:全部数值路径读出 → 写回 →
    /// 读出不变;非数值路径读必报错。新增注册表路径漏写读臂在此红。
    #[test]
    fn get_set_mirror_all_numeric_paths() {
        let cfg = crate::config::SimConfig::default();
        for sp in all() {
            match sp.kind {
                ParamKind::U32
                | ParamKind::U64
                | ParamKind::I64
                | ParamKind::F64
                | ParamKind::Mix => {
                    let v = read_numeric(&cfg, sp.path)
                        .unwrap_or_else(|e| panic!("{}: 读失败 {e}", sp.path));
                    let mut c2 = cfg.clone();
                    apply_numeric(&mut c2, sp.path, v)
                        .unwrap_or_else(|e| panic!("{}: 写失败 {e}", sp.path));
                    let v2 = read_numeric(&c2, sp.path).unwrap();
                    assert!(
                        (v - v2).abs() <= 1e-12 * v.abs().max(1.0),
                        "{}: 读 {v} 写后读 {v2}",
                        sp.path
                    );
                }
                _ => {
                    assert!(
                        read_numeric(&cfg, sp.path).is_err(),
                        "{}: 非数值路径不应可读",
                        sp.path
                    );
                }
            }
        }
    }
}
