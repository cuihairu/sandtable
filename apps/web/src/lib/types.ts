// 结果形状与 core::metrics::RunMetrics / CLI report.json 同构
// (等价性由 Rust 侧 web_parity 测试锁死,前端只消费)

export interface CohortStat {
  cohort: 'casual' | 'core' | 'whale'
  count: number
  churned: number
  mean_power: number
  mean_gold: number
  mean_level: number
}

export interface DayStat {
  day: number
  alive_at_start: number
  active: number
  battles: number
  wins: number
  win_rate: number
  levelups: number
  upgrades: number
  gold_earned: number
  gold_spent: number
  gold_supply: number
  income_per_active: number
  spending_per_active: number
  sink_ratio: number
  inflation: number
  mean_power: number
  new_churned: number
  churn_rate: number
}

/** 功率分布快照(按采样天):p50/p90/p99 为该天全体存活玩家功率分位 */
export interface PowerSnapshot {
  day: number
  n: number
  p50: number
  p90: number
  p99: number
}

// 与 core::metrics::RunMetrics 逐键同构(WB-03.01 对照补全;原先只声明了
// 6/25 键)。窗口外留存指标(retention_d3/d7/d14/d30)内核以 null 表达不可
// 用,非 0 填空(完整可空语义是 WB-03.02);seed 为 u64,安全整数边界是
// WB-03.08。gacha_pulls_to_hit / loot_gold_per_player 是 skip_serializing_if
// 型 Option:配置未启用 gacha/loot 时整键省略(≠ null),故为可选字段。
export interface RunMetrics {
  config_hash: string
  players: number
  days: number
  seed: number
  replicate: number
  schema_version: string
  model_version: string
  day1_cohort: number
  retention_d1: number | null
  retention_d3: number | null
  retention_d7: number | null
  retention_d14: number | null
  retention_d30: number | null
  churn_total: number
  churn_rate_total: number
  win_rate: number
  gold_earned_total: number
  gold_spent_total: number
  sink_ratio_mean: number
  inflation_last: number
  inflation_daily_mean: number
  whale_gold_share: number
  gacha_pulls_to_hit?: number
  loot_gold_per_player?: number
  power_snapshots: PowerSnapshot[]
  cohort_stats: CohortStat[]
  day_stats: DayStat[]
}

export interface SimMeta {
  schema_version: string
  model_version: string
}

export interface SimOutput {
  meta: SimMeta
  config_hash: string
  /** replicate 1 按天 CSV,与 CLI simulate --out 写盘的 days.csv 逐字节一致(文档 09) */
  days_csv: string
  results: RunMetrics[]
}

export interface ValidateInfo {
  config_hash: string
  players: number
  days: number
  schema_version: string
  model_version: string
}

// —— 参数扫描(与 core::sweep / core::sensitivity / core::recommend 序列化同构)——

// KPI 内核 ID(= core::experiment::MetricKey::ALL 声明序,与 elasticities
// 全覆盖逐一对齐,tests/contracts.test.mjs 真跑内核锁漂移)。本地化显示
// 名是 WB-03.09,不在这里混入。
export const METRIC_KEYS = [
  'retention_d7',
  'retention_d3',
  'win_rate',
  'gold_per_player',
  'power_p50',
  'churn_rate',
  'gacha_pulls_to_hit',
  'loot_gold_per_player',
] as const
export type MetricKey = (typeof METRIC_KEYS)[number]

export const SWEEP_MODES = ['grid', 'random', 'latin_hypercube'] as const
export type SweepMode = (typeof SWEEP_MODES)[number]

export interface SampleStats {
  n: number
  mean: number
  sd: number
  ci95_lo: number
  ci95_hi: number
}

export interface SweepAxis {
  path: string
  min: number
  max: number
  step: number
}

export type ConstraintVerdict = 'pass' | 'borderline' | 'fail'

export interface SweepTarget {
  metric: MetricKey
  kind: 'hard' | 'soft'
  min: number | null
  max: number | null
}

export interface TargetOutcome {
  metric: MetricKey
  kind: 'hard' | 'soft'
  min: number | null
  max: number | null
  stats: SampleStats
  verdict: ConstraintVerdict
}

/** 'ok' 或 {config_error: 消息}(失败候选照常上报,不静默丢弃) */
export type CandidateStatus = 'ok' | { config_error: string }

export interface CandidateResult {
  values: Record<string, number>
  status: CandidateStatus
  metric_stats: [MetricKey, SampleStats][]
  target_outcomes: TargetOutcome[]
}

export interface SweepPlan {
  config_hash: string
  players: number
  days: number
  base_seed: number
  replicates: number
  mode: SweepMode
  axes: SweepAxis[]
  candidates: Record<string, number>[]
  targets: SweepTarget[]
  sims: number
}

export interface Recommendation {
  param: string
  baseline: number | null
  interval: [number, number] | null
  interpolated: [boolean, boolean]
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
}

export interface SweepRecOutput {
  elasticities: Elasticity[]
  recommendation: Recommendation
}

// 敏感性备注(= core::sensitivity::SensNote snake_case 序列化)
export type SensNote =
  | 'ok'
  | 'no_bracket'
  | 'not_isolated'
  | 'missing_metric'
  | 'zero_baseline'

// 指标在窗口内不可用/基线为零时 e 系列为 null(内核 NaN→null,禁止 0 填空)
export interface Elasticity {
  param: string
  metric: MetricKey
  e: number | null
  e_lo: number | null
  e_hi: number | null
  delta_eff: number | null
  significant: boolean
  note: SensNote
}

// —— 桌面 native 查询(apps/desktop `query` 命令,duckdb-rs 只读)——

/** 与 CLI `query` 输出同构:列名 + 行单元格(全部按显示文本返回) */
export interface LocalQueryResult {
  columns: string[]
  rows: string[][]
}

// —— 桌面长任务进度(apps/desktop `run_simulation` 的 Channel 事件)——
// done / total 为 replicate 计数;浏览器 wasm 路径同步阻塞主线程,无进度可用

/** `run_simulation` 逐 replicate 进度事件 */
export interface SimProgress {
  done: number
  total: number
}

// —— 参数定义(WB-03.01 对照 core::registry;桥接出口是 WB-03.04/05/06)——
// ParamSpec 本体非 serde,跨语言惯例(同 Python 绑定 params 导出):kind 为
// 小写变体名,default 以字符串表达(path 定位 + 源文本,不在此折算数值)。

export type ParamKind = 'u32' | 'u64' | 'i64' | 'f64' | 'dur' | 'mix' | 'expr' | 'table'

export interface ParamDefinition {
  path: string
  kind: ParamKind
  default: string
  desc: string
}

// —— 配置(WB-03.01 对照 core::config SimConfig 序列化面,即 config_hash 的
// 规范 JSON 形状;YAML 输入面的 scenario.population_mix/duration:"Nd" 映射是
// WB-03.07 回写契约的事)——
// 可选字段 = skip_serializing_if 型省略:training/loot/gacha 未配置、
// damage_model 未选、ratio_k==1.0、p_training==0、tier_table 未给、
// TierRow.gold/xp 未给时整键省略(≠ null)。「键在 = 功能开」。

export type DamageModel = 'difference' | 'ratio'

export interface WarriorConfig {
  attack: number
  defense: number
  hp: number
}

export interface CombatConfig {
  p_hit: number
  p_hit_monster: number
  dmg_var: number
  max_rounds: number
  damage_model?: DamageModel
  /** ==1.0 时内核省略该键 */
  ratio_k?: number
}

export interface TierRow {
  hp: number
  attack: number
  defense: number
  gold?: number
  xp?: number
}

export interface DungeonConfig {
  tiers: number
  m_hp: number
  m_attack: number
  m_defense: number
  tier_growth: number
  reward_gold: number
  reward_xp: number
  reward_gold_growth: number
  reward_xp_growth: number
  tier_table?: TierRow[]
}

export interface ActorBehaviorConfig {
  sessions_int: number
  sessions_frac: number
  p_dungeon: number
  p_upgrade: number
  /** ==0.0 时内核省略该键 */
  p_training?: number
}

/** 键固定为三群体(snake_case 即 casual/core/whale) */
export interface BehaviorConfig {
  casual: ActorBehaviorConfig
  core: ActorBehaviorConfig
  whale: ActorBehaviorConfig
}

export interface ProgressionConfig {
  xp_base: number
  xp_pow: number
  level_attack_gain: number
  level_defense_gain: number
  level_hp_gain: number
  upgrade_cost_base: number
  upgrade_cost_num: number
  upgrade_cost_den: number
  upgrade_attack_gain: number
}

/** 公式以表达式字符串跨界(内核 Formula AST 不出边界) */
export interface FormulaConfig {
  xp_needed: string
}

export interface ChurnConfig {
  p_base: number
  p_stall: number
  stall_days: number
}

export interface TrainingConfig {
  xp: number
  gold: number
}

export interface LootTableConfig {
  weights: Record<string, number>
}

export interface LootReward {
  gold: number
  xp: number
}

export interface LootConfig {
  rate_mult: number
  /** 命中的表名(tables 的键) */
  on_victory: string
  tables: Record<string, LootTableConfig>
  rewards: Record<string, LootReward>
}

export interface GachaConfig {
  base_rate: number
  pity_hard: number
  pity_soft_start: number
  pity_soft_step: number
}

export interface SimConfig {
  players: number
  days: number
  base_seed: number
  /** [casual, core, whale] 定长三元组 */
  cohort_weights: [number, number, number]
  warrior: WarriorConfig
  whale_gain_mult: number
  combat: CombatConfig
  dungeon: DungeonConfig
  behavior: BehaviorConfig
  training?: TrainingConfig
  progression: ProgressionConfig
  formulas: FormulaConfig
  churn: ChurnConfig
  loot?: LootConfig
  gacha?: GachaConfig
}

// —— A/B 比较(WB-03.01 对照 core::experiment::Comparison 序列化;桥接出口
// 是 WB-03.10/11,落地后 contracts 守卫升级运行时锁)——

/** 判定来自配对差 CI 与 0 的关系(内核枚举 PascalCase 原样序列化) */
export type CompareVerdict = 'BHigher' | 'AHigher' | 'NoDifference'

export interface Comparison {
  metric: MetricKey
  arm_a: SampleStats
  arm_b: SampleStats
  /** 配对差均值(CRN 同种子配对重复) */
  diff_mean: number
  diff_ci95_lo: number
  diff_ci95_hi: number
  /** 效应量 d = Δ / 合并 sd */
  effect_size_d: number
  verdict: CompareVerdict
}
