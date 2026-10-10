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

export interface RunMetrics {
  config_hash: string
  day1_cohort: number
  churn_total: number
  churn_rate_total: number
  cohort_stats: CohortStat[]
  day_stats: DayStat[]
}

export interface SimOutput {
  meta: { schema_version: string; model_version: string }
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

export interface TargetOutcome {
  metric: string
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
  metric_stats: [string, SampleStats][]
  target_outcomes: TargetOutcome[]
}

export interface SweepPlan {
  config_hash: string
  players: number
  days: number
  base_seed: number
  replicates: number
  mode: string
  axes: SweepAxis[]
  candidates: Record<string, number>[]
  targets: { metric: string; kind: 'hard' | 'soft'; min: number | null; max: number | null }[]
  sims: number
}

export interface Recommendation {
  param: string
  baseline: number
  interval: [number, number] | null
  interpolated: [boolean, boolean]
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
}

export interface Elasticity {
  param: string
  metric: string
  e: number
  e_lo: number
  e_hi: number
  delta_eff: number
  significant: boolean
  note: string
}

export interface SweepRecOutput {
  elasticities: Elasticity[]
  recommendation: Recommendation
}

// —— 桌面 native 查询(apps/desktop `query` 命令,duckdb-rs 只读)——

/** 与 CLI `query` 输出同构:列名 + 行单元格(全部按显示文本返回) */
export interface LocalQueryResult {
  columns: string[]
  rows: string[][]
}
