//! 静态参数注册表:路径 → 类型 / 默认值 / 说明的静态表(SCENARIO + MODEL 两节),
//! 以及运行期零字符串查找的 all / lookup。
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
