// WB-12 · 专业图型聚合模型(L365)· 纯函数,节点可测,先聚合后渲染(L370:
// 图表先用聚合数据 + SVG)。数据源 = WB-08.01 适配器视图(lib/sweepView.ts
// CandidateView)与计划轴(lib/types.ts SweepAxis);沿用同一批红线:
// - 缺失候选/未产出指标 = 留空(格子缺失、点扣除),禁止 0 填空;
// - config_error 候选不入图形,但保留 id 与原因(不静默丢弃);
// - 口径原样:均值不乘 100、不舍入(×100 只在显示层 i18n);
// - 选点联动:每个可点元素携带内容寻址候选 ID,与候选表/检查器同一 ID 域。
import { METRIC_KEYS } from './types.ts'
import type { Elasticity, MetricKey, SensNote } from './types.ts'
import type { CandidateView } from './sweepView.ts'
import { configErrorOf, overallOutcome, statOf } from './analysisView.ts'
import { gridLevels } from './sweepDesign.ts'
import type { AxisDomain } from './sweepDesign.ts'

/* ————— 双轴 Grid 离散热图 ————— */

export type HeatCell = {
  x: number
  y: number
  /** 落在该格的候选(重复参数域聚合;按计划序) */
  ids: string[]
  /** 指标均值(按样本数 n 加权;内核口径原样) */
  mean: number
  /** 汇总样本数(Σ 每候选 n) */
  n: number
}

export type HeatmapGridModel = {
  xPath: string
  yPath: string
  metric: MetricKey
  /** 离散水平(来自计划轴 grid_levels,内核 grid_points 同口径) */
  xLevels: number[]
  yLevels: number[]
  /** 有可用结果的格(键 `${x}|${y}`) */
  cells: Map<string, HeatCell>
  /** 计划内但没有可用结果的格:留空(缺失候选) */
  missing: Array<{ x: number; y: number }>
  /** 不入格的候选与原因(域外坐标/失败/未产出该指标) */
  skipped: Array<{ id: string; reason: 'config_error' | 'metric_not_produced' | 'off_grid' }>
}

export type HeatmapGridInput = {
  xPath: string
  yPath: string
  metric: MetricKey
  /** 两轴取值域(计划 axes;水平表由此推导,不由结果反推) */
  xAxis: AxisDomain
  yAxis: AxisDomain
}

export function heatmapGrid(views: readonly CandidateView[], input: HeatmapGridInput): HeatmapGridModel {
  const { xPath, yPath, metric, xAxis, yAxis } = input
  const xLevels = gridLevels(xAxis) ?? []
  const yLevels = gridLevels(yAxis) ?? []
  const cells = new Map<string, HeatCell>()
  const missing: Array<{ x: number; y: number }> = []
  const skipped: HeatmapGridModel['skipped'] = []
  for (const v of views) {
    const err = configErrorOf(v)
    if (err !== null) {
      skipped.push({ id: v.id, reason: 'config_error' })
      continue
    }
    const s = statOf(v, metric)
    const x = v.values[xPath]
    const y = v.values[yPath]
    if (s === null || x === undefined || y === undefined) {
      skipped.push({ id: v.id, reason: 'metric_not_produced' })
      continue
    }
    if (!xLevels.some((l) => l === x) || !yLevels.some((l) => l === y)) {
      // 非本计划网格坐标(如旧结果混入):不落格,如实记因
      skipped.push({ id: v.id, reason: 'off_grid' })
      continue
    }
    const key = `${x}|${y}`
    const cur = cells.get(key)
    if (cur) {
      // 重复参数域(同 ID 多槽返回):按样本数加权聚合,不覆盖
      const n = cur.n + s.n
      cur.mean = (cur.mean * cur.n + s.mean * s.n) / n
      cur.n = n
      if (!cur.ids.includes(v.id)) cur.ids.push(v.id)
    } else {
      cells.set(key, { x, y, ids: [v.id], mean: s.mean, n: s.n })
    }
  }
  for (const y of yLevels) {
    for (const x of xLevels) {
      if (!cells.has(`${x}|${y}`)) missing.push({ x, y })
    }
  }
  return { xPath, yPath, metric, xLevels, yLevels, cells, missing, skipped }
}

/* ————— Random / LHS 散点 ————— */

export type ScatterPoint = { id: string; x: number; y: number; value: number; n: number }

export type ScatterModel = {
  xPath: string
  yPath: string
  metric: MetricKey
  drawable: ScatterPoint[]
  withheld: Array<{ id: string; reason: 'config_error' | 'metric_not_produced' }>
}

/** 连续采样散点:不做分箱,坐标与值都是内核原值(聚合 = 只取均值统计)。 */
export function scatterPoints(views: readonly CandidateView[], xPath: string, yPath: string, metric: MetricKey): ScatterModel {
  const drawable: ScatterPoint[] = []
  const withheld: ScatterModel['withheld'] = []
  for (const v of views) {
    if (configErrorOf(v) !== null) {
      withheld.push({ id: v.id, reason: 'config_error' })
      continue
    }
    const s = statOf(v, metric)
    const x = v.values[xPath]
    const y = v.values[yPath]
    if (s === null || x === undefined || y === undefined) {
      withheld.push({ id: v.id, reason: 'metric_not_produced' })
      continue
    }
    drawable.push({ id: v.id, x, y, value: s.mean, n: s.n })
  }
  return { xPath, yPath, metric, drawable, withheld }
}

/* ————— OAT 敏感性矩阵 ————— */

export type OatCell = {
  /** 弹性系数;内核不可用 = null(note 说明原因,不 0 填空) */
  e: number | null
  e_lo: number | null
  e_hi: number | null
  significant: boolean
  note: SensNote
}

export type OatMatrixModel = {
  /** 行 = 参数(内核 elasticities 出现序去重) */
  params: string[]
  /** 列 = 指标(METRIC_KEYS 声明序) */
  metrics: MetricKey[]
  /** 行 × 列;内核未覆盖的组合 = null(留空) */
  rows: Array<{ param: string; cells: Array<OatCell | null> }>
}

/** 敏感性矩阵:直接整理内核 sweep_recommend 的 elasticities,不重算。 */
export function oatMatrix(elasticities: readonly Elasticity[]): OatMatrixModel {
  const params: string[] = []
  for (const e of elasticities) if (!params.includes(e.param)) params.push(e.param)
  const index = new Map<string, Elasticity>()
  for (const e of elasticities) index.set(`${e.param}|${e.metric}`, e)
  return {
    params,
    metrics: [...METRIC_KEYS],
    rows: params.map((param) => ({
      param,
      cells: METRIC_KEYS.map((m) => {
        const e = index.get(`${param}|${m}`)
        return e ? { e: e.e, e_lo: e.e_lo, e_hi: e.e_hi, significant: e.significant, note: e.note } : null
      }),
    })),
  }
}

/* ————— 可行候选 + Pareto 前沿 ————— */

export type ParetoGoal = 'max' | 'min'

export type ParetoPoint = { id: string; x: number; y: number }

export type ParetoModel = {
  xMetric: MetricKey
  yMetric: MetricKey
  xGoal: ParetoGoal
  yGoal: ParetoGoal
  /** 可行(硬约束未 fail)且两指标齐备的候选 */
  feasible: ParetoPoint[]
  /** 前沿点(非支配),按 x 排序 */
  frontier: ParetoPoint[]
  /** 可行但被支配 */
  dominated: ParetoPoint[]
  /** 不入比较的候选与原因(失败/缺指标/硬约束不可行) */
  excluded: Array<{ id: string; reason: 'config_error' | 'metric_not_produced' | 'hard_fail' }>
}

const better = (a: number, b: number, goal: ParetoGoal): boolean => (goal === 'max' ? a > b : a < b)

/**
 * Pareto 前沿:在可行候选(整体硬约束判定非 fail)内做二维非支配过滤。
 * 判定来源仍是内核 verdict,本层只做前沿几何;目标方向由调用方给
 * (如 retention 取 max、churn 取 min)。目标值完全相等的候选只保留计划序
 * 第一个,其余记 dominated(不重复画同一点)。
 */
export function paretoFront(
  views: readonly CandidateView[],
  xMetric: MetricKey,
  yMetric: MetricKey,
  xGoal: ParetoGoal,
  yGoal: ParetoGoal,
): ParetoModel {
  const feasible: ParetoPoint[] = []
  const dominated: ParetoPoint[] = []
  const excluded: ParetoModel['excluded'] = []
  for (const v of views) {
    if (configErrorOf(v) !== null) {
      excluded.push({ id: v.id, reason: 'config_error' })
      continue
    }
    const sx = statOf(v, xMetric)
    const sy = statOf(v, yMetric)
    if (sx === null || sy === null) {
      excluded.push({ id: v.id, reason: 'metric_not_produced' })
      continue
    }
    if (overallOutcome(v).overall === 'fail') {
      excluded.push({ id: v.id, reason: 'hard_fail' })
      continue
    }
    feasible.push({ id: v.id, x: sx.mean, y: sy.mean })
  }
  // 非支配过滤:存在他点(严格优一维且不劣另一维)→ 被支配;全等保首见。
  const frontier: ParetoPoint[] = []
  for (const p of feasible) {
    const beaten = feasible.some((q) => {
      if (q === p) return false
      const qx = better(q.x, p.x, xGoal) || q.x === p.x
      const qy = better(q.y, p.y, yGoal) || q.y === p.y
      const strictly = better(q.x, p.x, xGoal) || better(q.y, p.y, yGoal)
      return qx && qy && strictly
    })
      // 全等点:更靠前者赢(稳定,不随比较顺序漂移)
      || (feasible.some((q) => q !== p && q.x === p.x && q.y === p.y)
        && feasible.findIndex((q) => q.x === p.x && q.y === p.y) !== feasible.indexOf(p))
    ;(beaten ? dominated : frontier).push(p)
  }
  frontier.sort((a, b) => (xGoal === 'max' ? a.x - b.x : b.x - a.x))
  return { xMetric, yMetric, xGoal, yGoal, feasible, frontier, dominated, excluded }
}
