// 优化与代理视图口径层(todo L380):进化寻优 / Pareto 前沿 / 随机森林代理的
// 独立标识 + 三层来源(真实观测 / 插值 / 代理估计)分行 + 树间分歧不标 CI。
// 纪律:全部数值来自内核(optimize / surrogate_train / surrogate_predict 桥接),
// 本层只做展示派生(排序、分组、缺失占位),不重算统计量、不 0 填缺席。

import type {
  CandidateResult,
  MetricKey,
  OptimResult,
  OptimSpec,
  SweepRecOutput,
  SurrogatePrediction,
  SurrogateTrainOutput,
} from './types.ts'

/** 参数点来源:观测 = 扫描格点(有内核真值);插值 = 内核标为插值的推荐端点;
 *  代理 = 不在扫描格上的参数点(其指标值只能是代理估计)。 */
export type SourceKind = 'observed' | 'interpolated' | 'surrogate'

/** 三层来源的词典键(测试锁定三源分立,不允许合并成「估计值」一类)。 */
export const SOURCE_KIND_KEY = {
  observed: 'analysis.optSourceObserved',
  interpolated: 'analysis.optSourceInterpolated',
  surrogate: 'analysis.optSourceSurrogate',
} as const satisfies Record<SourceKind, string>

/** 特征重要性行(内核原值,按重要性降序展示;全 0 保持声明序不排序漂移)。 */
export interface ImportanceRow {
  feature: string
  importance: number
  share: number
}

/** 代理预测行:一个参数点的来源 + 内核真值(仅观测点有)+ 代理估计与树间分歧。 */
export interface PredictionRow {
  id: string
  source: SourceKind
  label: string
  params: Record<string, number>
  /** 真实观测(内核候选指标均值);非观测点为 null,不补 0 */
  observed: number | null
  /** 观测 replicate 数(n) */
  observedN: number | null
  /** 代理估计(森林全树均值) */
  predicted: number | null
  /** 树间分歧下界(全部树最小预测)——描述性散布,不是统计置信区间 */
  spreadMin: number | null
  /** 树间分歧上界(全部树最大预测) */
  spreadMax: number | null
  /** 参与预测的树数 */
  trees: number | null
  /** 内核原文备注(不可用原因等) */
  note: string | null
}

/** 逐代统计行:pareto 模式读 front0 规模,evolutionary 读 score。 */
export interface OptimHistoryRow {
  generation: number
  evaluated: number
  feasible: number
  bestHardPass: number
  score: number | null
  front0: number
}

/** 寻优独立标识:把内核寻优 spec 的口径完整摊开,与扫描计划互不混用。 */
export interface OptimIdentity {
  mode: OptimSpec['mode']
  population: number
  generations: number
  elite: number
  mutationRate: number
  mutationScale: number
  replicates: number
  parameters: readonly string[]
  hardTargets: readonly { metric: MetricKey; min: number | null; max: number | null }[]
  objectives: readonly { metric: MetricKey; direction: 'maximize' | 'minimize' }[]
  /** 评估预算(种群 × (代数+1) × replicates);与内核 total_sims 上限一致 */
  budget: { candidates: number; sims: number }
}

/** 参数点键:参数路径 → 值,排序后拼接,用于「点是否在扫描格上」的严格判定。 */
export function pointKey(params: Readonly<Record<string, number>>): string {
  return Object.keys(params)
    .sort()
    .map((path) => `${path}=${params[path]}`)
    .join(',')
}

/** 候选点是否在扫描格上(严格键匹配,不做邻近/容差匹配)。 */
export function isGridPoint(
  point: Record<string, number>,
  grid: readonly Record<string, number>[],
): boolean {
  return grid.some((row) => pointKey(row) === pointKey(point))
}

/** 特征重要性:内核归一值原样,按重要性降序;全 0 时保持特征声明序。 */
export function importanceRows(output: SurrogateTrainOutput): ImportanceRow[] {
  const rows = output.features.map((feature, i) => ({
    feature,
    importance: Number.isFinite(output.importance[i]) ? output.importance[i] : 0,
    share: 0,
  }))
  const total = rows.reduce((sum, row) => sum + row.importance, 0)
  for (const row of rows) row.share = total > 0 ? row.importance / total : 0
  return rows.sort((a, b) => b.importance - a.importance || a.feature.localeCompare(b.feature))
}

/** 扫描候选的真实观测点:参数 + 内核指标均值(n = replicate 数)。
 *  指标缺席保持 null(内核未产出,不 0 填);配置错误候选如实留空。 */
export function observedPoints(
  results: readonly CandidateResult[],
  metric: MetricKey,
): PredictionRow[] {
  return results.map((result, index) => {
    const stat = result.metric_stats.find(([key]) => key === metric)
    return {
      id: `obs-${index}`,
      source: 'observed',
      label: String(index),
      params: { ...result.values },
      observed: stat ? stat[1].mean : null,
      observedN: stat ? stat[1].n : null,
      predicted: null,
      spreadMin: null,
      spreadMax: null,
      trees: null,
      note: result.status === 'ok' ? null : result.status.config_error,
    }
  })
}

/** 内核推荐区间端点 = 插值点:参数值由内核在两格点之间线性插值得到。
 *  内核 `interpolated` 标注每个端点是否真为插值(格点恰在边界上则不是)。 */
export function interpolatedPoints(rec: SweepRecOutput | null): PredictionRow[] {
  if (rec === null || rec.recommendation.interval === null) return []
  const [lo, hi] = rec.recommendation.interval
  const endpoints: [PredictionRow, PredictionRow] = [
    {
      id: 'interp-lo',
      source: 'interpolated',
      label: 'lo',
      params: { [rec.recommendation.param]: lo },
      observed: null,
      observedN: null,
      predicted: null,
      spreadMin: null,
      spreadMax: null,
      trees: null,
      note: rec.recommendation.interpolated[0] ? 'interpolated' : 'grid',
    },
    {
      id: 'interp-hi',
      source: 'interpolated',
      label: 'hi',
      params: { [rec.recommendation.param]: hi },
      observed: null,
      observedN: null,
      predicted: null,
      spreadMin: null,
      spreadMax: null,
      trees: null,
      note: rec.recommendation.interpolated[1] ? 'interpolated' : 'grid',
    },
  ]
  return endpoints
}

/** 代理估计点:不在扫描格上的参数点(寻优最优 + 前沿)。 */
export function surrogatePoints(
  result: OptimResult | null,
  grid: readonly Record<string, number>[],
): PredictionRow[] {
  if (result === null) return []
  const points = result.front0.length > 0 ? result.front0 : result.best !== null ? [result.best] : []
  const rows: PredictionRow[] = []
  for (const point of points) {
    if (isGridPoint(point.values, grid)) continue
    rows.push({
      id: `surg-${pointKey(point.values)}`,
      source: 'surrogate',
      label: pointKey(point.values),
      params: { ...point.values },
      observed: null,
      observedN: null,
      predicted: null,
      spreadMin: null,
      spreadMax: null,
      trees: null,
      note: null,
    })
  }
  return rows
}

/** 组装三层预测行:观测 → 插值 → 代理,顺序固定(测试锁定分组)。 */
export function predictionRows(
  observed: readonly PredictionRow[],
  interpolated: readonly PredictionRow[],
  surrogate: readonly PredictionRow[],
): PredictionRow[] {
  return [...observed, ...interpolated, ...surrogate]
}

/** 把内核预测结果填回指定行(缺预测 = null,不补 0)。 */
export function withPredictions(
  rows: readonly PredictionRow[],
  predictions: readonly (SurrogatePrediction | null)[],
): PredictionRow[] {
  return rows.map((row, i) => {
    const prediction = predictions[i]
    if (prediction === null) return row
    return {
      ...row,
      predicted: prediction.mean,
      spreadMin: prediction.spread_min,
      spreadMax: prediction.spread_max,
      trees: prediction.trees,
    }
  })
}

/** 树间分歧展示文案:明确是描述性散布,不是统计置信区间。 */
export function spreadText(row: PredictionRow): string | null {
  if (row.spreadMin === null || row.spreadMax === null) return null
  return `${row.spreadMin}~${row.spreadMax}`
}

/** 逐代统计行:evolutionary 模式读 score,pareto 模式读 front0 规模。 */
export function optimizeHistoryRows(result: OptimResult): OptimHistoryRow[] {
  return result.history.map((stat) => ({
    generation: stat.generation,
    evaluated: stat.evaluated,
    feasible: stat.feasible,
    bestHardPass: stat.best.hard_pass,
    score: Number.isFinite(stat.best.score) ? stat.best.score : null,
    front0: stat.front0,
  }))
}

/** 寻优独立标识:口径全部摊开,与扫描计划 / 代理训练互不混用。 */
export function optimizeIdentity(result: OptimResult): OptimIdentity {
  const spec = result.spec
  return {
    mode: spec.mode,
    population: spec.population,
    generations: spec.generations,
    elite: spec.elite,
    mutationRate: spec.mutation_rate,
    mutationScale: spec.mutation_scale,
    replicates: spec.replicates,
    parameters: spec.parameters.map((axis) => axis.path),
    hardTargets: spec.targets.filter((target) => target.kind === 'hard'),
    objectives: spec.mode === 'pareto' ? spec.objectives : spec.objective !== null ? [spec.objective] : [],
    budget: {
      candidates: spec.population * (spec.generations + 1),
      sims: spec.population * (spec.generations + 1) * spec.replicates,
    },
  }
}

/** 代理训练独立标识:指标 + 超参 + 训练账(入训/排除)全摊开。 */
export function surrogateIdentity(output: SurrogateTrainOutput): {
  metric: MetricKey
  trees: number
  maxDepth: number
  minSamplesLeaf: number
  seed: number
  trained: number
  excluded: number
  featureCount: number
} {
  return {
    metric: output.metric,
    trees: output.spec.trees,
    maxDepth: output.spec.max_depth,
    minSamplesLeaf: output.spec.min_samples_leaf,
    seed: output.spec.seed,
    trained: output.trained,
    excluded: output.excluded,
    featureCount: output.features.length,
  }
}
