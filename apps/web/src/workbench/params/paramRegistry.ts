// WB-05.01 · 参数注册表(TS 侧全量镜像):逐字取自 crates/sandtable-core/
// src/registry.rs 的 spec(path, Kind, default, desc) 表——path/kind/default/
// desc 四字段一比一,不做增删改。内核读取桥接落地前(WB-03.04)这是注册表
// 的唯一前端来源;落地后本表仅作离线兜底,tests/params-config.test.mjs 用
// registry.rs 原文逐条锁漂移(路径数、逐字段一致),两侧不同步即测试红。
// 红线:参数表的定义/默认值只能来自这张表或内核桥接,不允许组件自带硬编码。
import type { ParamKind } from '../../lib/types.ts'

/** 注册项(与 core::registry::ParamSpec 同构;kind 为小写变体名)。 */
export interface RegistryParam {
  path: string
  kind: ParamKind
  /** 注册表默认值(源文本;table 类为 '—' = 无默认结构) */
  default: string
  /** 原始描述(zh,注册表原文;搜索与详情直接引用) */
  desc: string
}

const ROWS: readonly [string, ParamKind, string, string][] = [
  // —— scenario 节 ——
  ['scenario.population', 'u32', '10000', '玩家总数'],
  ['scenario.duration', 'dur', '30d', '仿真时长'],
  ['scenario.seed', 'u64', '12345', '基础种子'],
  ['scenario.population_mix.casual', 'mix', '0.60', 'casual 占比'],
  ['scenario.population_mix.core', 'mix', '0.30', 'core 占比'],
  ['scenario.population_mix.whale', 'mix', '0.10', 'whale 占比'],
  // —— model.warrior / economy ——
  ['model.warrior.attack', 'i64', '100', '初始攻击力(A/B 常用被扫参数)'],
  ['model.warrior.defense', 'i64', '80', '初始防御'],
  ['model.warrior.hp', 'i64', '1000', '初始生命(每场战斗满血)'],
  ['model.whale_gain_mult', 'i64', '2', 'whale 金币/经验获取倍率(无付费语义)'],
  // —— model.combat ——
  ['model.combat.p_hit', 'f64', '0.85', '玩家命中概率'],
  ['model.combat.p_hit_monster', 'f64', '0.85', '怪物命中概率'],
  ['model.combat.dmg_var', 'i64', '10', '伤害浮动半宽 ±'],
  ['model.combat.max_rounds', 'u32', '32', '最大战斗轮数(超过判负)'],
  ['model.combat.damage_model', 'table', 'difference', '战斗伤害口径(difference 缺省 / ratio;结构开关,不进数值通道)'],
  ['model.combat.ratio_k', 'f64', '1.0', '比值伤害比例参数(dmg = k·attack/(attack+defense),仅 damage_model: ratio 生效)'],
  // —— model.training ——
  ['model.training.xp', 'i64', '0', '每次练级会话经验产出(需 behavior.*.p_training > 0)'],
  ['model.training.gold', 'i64', '0', '每次练级会话金币产出(需 behavior.*.p_training > 0)'],
  // —— model.dungeon ——
  ['model.dungeon.tiers', 'u32', '8', '副本层数(0 起)'],
  ['model.dungeon.m_hp', 'i64', '300', '第 0 层怪物 hp'],
  ['model.dungeon.m_attack', 'i64', '45', '第 0 层怪物攻击'],
  ['model.dungeon.m_defense', 'i64', '20', '第 0 层怪物防御'],
  ['model.dungeon.tier_growth', 'f64', '1.5', '每层怪物数值倍率'],
  ['model.dungeon.reward_gold', 'i64', '40', '第 0 层金币产出'],
  ['model.dungeon.reward_xp', 'i64', '45', '第 0 层经验产出'],
  ['model.dungeon.reward_gold_growth', 'f64', '1.4', '每层金币产出倍率'],
  ['model.dungeon.reward_xp_growth', 'f64', '1.4', '每层经验产出倍率'],
  ['model.dungeon.tier_table', 'table', '—', '逐层怪物表(给出时覆盖几何推导,长度须等于 tiers)'],
  // —— model.behavior.{casual,core,whale} ——
  ['model.behavior.casual.sessions_int', 'u32', '1', 'casual 每日会话整数部分'],
  ['model.behavior.casual.sessions_frac', 'f64', '0.5', 'casual 补 1 概率'],
  ['model.behavior.casual.p_dungeon', 'f64', '0.7', 'casual 副本概率'],
  ['model.behavior.casual.p_upgrade', 'f64', '0.2', 'casual 升级概率'],
  ['model.behavior.casual.p_training', 'f64', '0.0', 'casual 练级概率(需 model.training 产出面)'],
  ['model.behavior.core.sessions_int', 'u32', '2', 'core 每日会话整数部分'],
  ['model.behavior.core.sessions_frac', 'f64', '0.5', 'core 补 1 概率'],
  ['model.behavior.core.p_dungeon', 'f64', '0.6', 'core 副本概率'],
  ['model.behavior.core.p_upgrade', 'f64', '0.3', 'core 升级概率'],
  ['model.behavior.core.p_training', 'f64', '0.0', 'core 练级概率(需 model.training 产出面)'],
  ['model.behavior.whale.sessions_int', 'u32', '5', 'whale 每日会话整数部分'],
  ['model.behavior.whale.sessions_frac', 'f64', '0.0', 'whale 补 1 概率'],
  ['model.behavior.whale.p_dungeon', 'f64', '0.65', 'whale 副本概率'],
  ['model.behavior.whale.p_upgrade', 'f64', '0.3', 'whale 升级概率'],
  ['model.behavior.whale.p_training', 'f64', '0.0', 'whale 练级概率(需 model.training 产出面)'],
  // —— model.progression ——
  ['model.progression.xp_base', 'i64', '60', '升级经验基数'],
  ['model.progression.xp_pow', 'f64', '1.3', '升级经验指数'],
  ['model.progression.level_attack_gain', 'i64', '5', '每次升级攻击增量'],
  ['model.progression.level_defense_gain', 'i64', '3', '每次升级防御增量'],
  ['model.progression.level_hp_gain', 'i64', '50', '每次升级生命增量'],
  ['model.progression.upgrade_cost_base', 'i64', '50', '首次强化成本'],
  ['model.progression.upgrade_cost_num', 'i64', '5', '成本链分子'],
  ['model.progression.upgrade_cost_den', 'i64', '4', '成本链分母'],
  ['model.progression.upgrade_attack_gain', 'i64', '2', '每次强化攻击增量'],
  // —— model.formulas ——
  ['model.formulas.xp_needed', 'expr', 'xp_base * level ^ xp_pow', '升级所需经验公式(变量: level, xp_base, xp_pow)'],
  // —— model.churn ——
  ['model.churn.p_base', 'f64', '0.003', '正常日流失概率'],
  ['model.churn.p_stall', 'f64', '0.05', '停滞日流失概率'],
  ['model.churn.stall_days', 'u32', '2', '连续无增长天数判停滞'],
  // —— model.loot ——
  ['model.loot.rate_mult', 'f64', '1.0', '掉落产出倍率(乘到金币/经验数额,不改表形状;loot 未配置时不生效)'],
  ['model.loot.tables', 'table', '—', '掉落加权表(表名 → 权重;结构性参数,改形状走 YAML 编辑)'],
  ['model.loot.on_victory', 'table', '—', '胜利结算用表名(须为 tables 中的键;结构开关,不进数值通道)'],
  ['model.loot.rewards', 'table', '—', '掉落条目数额表(条目 → {gold, xp};结构性参数,改形状走 YAML 编辑)'],
  // —— model.gacha ——
  ['model.gacha.base_rate', 'f64', '0.02', '抽卡单抽基础命中率(0, 1];扫它 = 扫出货概率强度)'],
  ['model.gacha.pity_hard', 'u64', '0', '硬保底抽数(第 N 抽必中;0 = 无保底)'],
  ['model.gacha.pity_soft_start', 'u64', '0', '软保底起点抽数(从第 N 抽起每抽 +step)'],
  ['model.gacha.pity_soft_step', 'f64', '0.0', '软保底起点后每抽概率增量(0 = 无软保底)'],
]

/** 全量注册项(顺序 = registry.rs 声明序;统计口径 64 项,tests 锁漂移)。 */
export const PARAM_REGISTRY: readonly RegistryParam[] = ROWS.map(([path, kind, def, desc]) => ({
  path, kind, default: def, desc,
}))

const REGISTRY_BY_PATH: ReadonlyMap<string, RegistryParam> = new Map(
  PARAM_REGISTRY.map((p) => [p.path, p]),
)

export function registryParam(path: string): RegistryParam | undefined {
  return REGISTRY_BY_PATH.get(path)
}

/* —— UI 分组:只做界面组织,不是注册表语义(同原型口径) —— */

const GROUP_BY_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ['scenario.', '场景'],
  ['model.warrior.', '角色'],
  ['model.whale_gain_mult', '角色'],
  ['model.combat.', '战斗'],
  ['model.training.', '训练'],
  ['model.dungeon.', '副本'],
  ['model.behavior.', '行为'],
  ['model.progression.', '成长'],
  ['model.formulas.', '公式'],
  ['model.churn.', '流失'],
  ['model.loot.', '掉落'],
  ['model.gacha.', '抽卡'],
]

/** 注册路径 → UI 分组名(前缀表未命中时回退首段,不丢项)。 */
export function paramGroup(path: string): string {
  for (const [prefix, group] of GROUP_BY_PREFIX) {
    if (path.startsWith(prefix)) return group
  }
  return path.split('.')[0]
}

/** 分组名列表(注册表全量派生,参数表筛选下拉用)。 */
export function paramGroups(): string[] {
  return [...new Set(PARAM_REGISTRY.map((p) => paramGroup(p.path)))]
}

/* —— 显示名与多语言搜索(WB-05.09) —— */

/** 英文显示名(按注册路径;缺词条回退原始描述)。WB-11 词典层不承载
 * 参数专名——参数表自持,避免与词典 key 体系耦合。 */
const EN_NAMES: Readonly<Record<string, string>> = {
  'scenario.population': 'Population',
  'scenario.duration': 'Duration',
  'scenario.seed': 'Base seed',
  'scenario.population_mix.casual': 'Casual share',
  'scenario.population_mix.core': 'Core share',
  'scenario.population_mix.whale': 'Whale share',
  'model.warrior.attack': 'Warrior attack',
  'model.warrior.defense': 'Warrior defense',
  'model.warrior.hp': 'Warrior HP',
  'model.whale_gain_mult': 'Whale gain multiplier',
  'model.combat.p_hit': 'Player hit chance',
  'model.combat.p_hit_monster': 'Monster hit chance',
  'model.combat.dmg_var': 'Damage variance half-width',
  'model.combat.max_rounds': 'Max combat rounds',
  'model.combat.damage_model': 'Damage model',
  'model.combat.ratio_k': 'Ratio damage k',
  'model.training.xp': 'Training XP per session',
  'model.training.gold': 'Training gold per session',
  'model.dungeon.tiers': 'Dungeon tiers',
  'model.dungeon.m_hp': 'Tier-0 monster HP',
  'model.dungeon.m_attack': 'Tier-0 monster attack',
  'model.dungeon.m_defense': 'Tier-0 monster defense',
  'model.dungeon.tier_growth': 'Tier growth factor',
  'model.dungeon.reward_gold': 'Tier-0 gold reward',
  'model.dungeon.reward_xp': 'Tier-0 XP reward',
  'model.dungeon.reward_gold_growth': 'Gold reward growth',
  'model.dungeon.reward_xp_growth': 'XP reward growth',
  'model.dungeon.tier_table': 'Per-tier monster table',
  'model.behavior.casual.sessions_int': 'Casual sessions (int)',
  'model.behavior.casual.sessions_frac': 'Casual extra session chance',
  'model.behavior.casual.p_dungeon': 'Casual dungeon chance',
  'model.behavior.casual.p_upgrade': 'Casual upgrade chance',
  'model.behavior.casual.p_training': 'Casual training chance',
  'model.behavior.core.sessions_int': 'Core sessions (int)',
  'model.behavior.core.sessions_frac': 'Core extra session chance',
  'model.behavior.core.p_dungeon': 'Core dungeon chance',
  'model.behavior.core.p_upgrade': 'Core upgrade chance',
  'model.behavior.core.p_training': 'Core training chance',
  'model.behavior.whale.sessions_int': 'Whale sessions (int)',
  'model.behavior.whale.sessions_frac': 'Whale extra session chance',
  'model.behavior.whale.p_dungeon': 'Whale dungeon chance',
  'model.behavior.whale.p_upgrade': 'Whale upgrade chance',
  'model.behavior.whale.p_training': 'Whale training chance',
  'model.progression.xp_base': 'XP base',
  'model.progression.xp_pow': 'XP exponent',
  'model.progression.level_attack_gain': 'Attack gain per level',
  'model.progression.level_defense_gain': 'Defense gain per level',
  'model.progression.level_hp_gain': 'HP gain per level',
  'model.progression.upgrade_cost_base': 'First upgrade cost',
  'model.progression.upgrade_cost_num': 'Cost chain numerator',
  'model.progression.upgrade_cost_den': 'Cost chain denominator',
  'model.progression.upgrade_attack_gain': 'Attack gain per upgrade',
  'model.formulas.xp_needed': 'XP needed formula',
  'model.churn.p_base': 'Baseline churn chance',
  'model.churn.p_stall': 'Stall churn chance',
  'model.churn.stall_days': 'Stall days threshold',
  'model.loot.rate_mult': 'Loot rate multiplier',
  'model.loot.tables': 'Loot weight tables',
  'model.loot.on_victory': 'On-victory table',
  'model.loot.rewards': 'Loot reward amounts',
  'model.gacha.base_rate': 'Gacha base rate',
  'model.gacha.pity_hard': 'Hard pity pulls',
  'model.gacha.pity_soft_start': 'Soft pity start',
  'model.gacha.pity_soft_step': 'Soft pity step',
}

/** 当前语言显示名:zh = 注册表原始描述,en = 英文表(缺词回退描述)。 */
export function displayParamName(path: string, locale: string): string {
  if (locale.startsWith('en')) return EN_NAMES[path] ?? REGISTRY_BY_PATH.get(path)?.desc ?? path
  return REGISTRY_BY_PATH.get(path)?.desc ?? path
}
