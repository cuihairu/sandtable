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
