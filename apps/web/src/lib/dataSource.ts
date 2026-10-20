// WB-03.16 · 数据来源与版本标记(单一出处)。
// - 真实运行集合(runs.json / 运行快照)只认 kernel;演示数据(synthetic_demo)
//   自成一体,不得混入——写闸(snapshotRun / runsIndexFile)与读闸
//   (readRunsIndex)双侧锁死,未知来源显式可读错误,不静默降级。
// - 版本标记沿用既有口径:运行条目 model_version / schema_version / seed,
//   索引本身 RUNS_INDEX_SCHEMA(projectDoc),报告 meta.schema_version(文档 09 章)。
export type DataSource = 'kernel' | 'synthetic_demo'

export const KERNEL_SOURCE: DataSource = 'kernel'
export const DEMO_SOURCE: DataSource = 'synthetic_demo'

const ALL: readonly DataSource[] = [KERNEL_SOURCE, DEMO_SOURCE]

/** 来源值合法性与展示双用:列表顺序即 docs 口径顺序 */
export function isDataSource(v: unknown): v is DataSource {
  return typeof v === 'string' && (ALL as readonly string[]).includes(v)
}
