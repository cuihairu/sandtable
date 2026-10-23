// WB-08 · 真实结果分析语义层(纯函数,节点可测;WB-08.02–08.14/16)。
// 数据源 = WB-08.01 适配器(lib/sweepView.ts CandidateView)与内核类型
// (lib/types.ts);绝不引入合成样例结构,绝不覆写内核判定,绝不把不可
// 用画成 0(验收纪律同 sweepView.ts)。
// - 稳定 ID(08.02):identity 由适配器注入 deriveId(应用侧 candidateIdFor,
//   内容寻址);本层只按 id 定位/移动,排序/筛选/部分返回后选择所指不变;
// - 判定(08.08):pass/borderline/fail 原样来自内核 TargetOutcome.verdict,
//   本层只做 hard/soft 分组与整体聚合(不是数值重算);
// - 参考线(08.05):目标线只来自计划的真实约束;基线线只在基线参数域
//   被真实扫描包含时画,否则不画假参考线;
// - 逐日(08.13):来自显式选中的 replicate 的 RunMetrics.day_stats;
//   days_csv 只代表 replicate 1,本层不构造日级 CI。
import { METRIC_KEYS } from './types.ts'
import type {
  CohortStat,
  Comparison,
  Elasticity,
  MetricKey,
  RunMetrics,
  SampleStats,
  SensNote,
  SimOutput,
  SweepPlan,
  SweepRecOutput,
  TargetOutcome,
} from './types.ts'
import type { CandidateView } from './sweepView.ts'
import { METRIC_META, type MetricDimension } from './metricMeta.ts'
import { t } from './i18n/index.ts'
import type { Locale, TranslationKey, InterpolationParams } from './i18n/index.ts'

// WB-11.14:统计解释类文案可选带 locale;缺省 zh-CN(节点测试锁中文子串,
// 与 WB-11.13 designerLogic 同一纪律)。
const LOGIC_FALLBACK: Locale = 'zh-CN'

function msg(locale: Locale | undefined, key: TranslationKey, params?: InterpolationParams): string {
  return t(locale ?? LOGIC_FALLBACK, key, params)
}

/* —— WB-08.02/08.07 · 稳定 ID 定位与选择 —— */

/** 按稳定 ID 定位候选:排序/筛选/部分返回后同一 ID 仍指同一候选。 */
export function findCandidate(
  views: readonly CandidateView[],
  id: string | null | undefined,
): CandidateView | null {
  if (id === null || id === undefined) return null
  return views.find((v) => v.id === id) ?? null
}

/** 当前选择是不是"活的"(所在集合里有该候选);不在 = 提示/恢复的判定依据。 */
export function selectionAlive(
  views: readonly CandidateView[],
  id: string | null | undefined,
): boolean {
  return findCandidate(views, id) !== null
}

/**
 * WB-08.07 · 键盘移动:在给定展示序(表序/图表序——同一数组)上 ±delta,
 * 越界停在边界;无初始选择时取第一个(>0)或最后一个(<0);空集 → null。
 */
export function stepSelection(
  order: readonly { id: string }[],
  id: string | null,
  delta: 1 | -1,
): string | null {
  if (order.length === 0) return null
  const at = order.findIndex((v) => v.id === id)
  if (at === -1) return delta === 1 ? order[0].id : order[order.length - 1].id
  const next = Math.min(order.length - 1, Math.max(0, at + delta))
  return order[next].id
}

/* —— WB-08.03 · 动态指标列(均值 / CI / 判定 / 不可用原因) —— */

/** 本次结果里真产出过的指标(METRIC_KEYS 序;未产出的指标不成列,不造空列)。 */
export function availableMetrics(views: readonly CandidateView[]): MetricKey[] {
  const present = new Set<MetricKey>()
  for (const v of views) {
    if (typeof v.status === 'object') continue // 失败候选无统计
    for (const key of v.stats.keys()) present.add(key)
  }
  return METRIC_KEYS.filter((k) => present.has(k))
}

/** 候选某指标的统计;未产出 = null(不可用,不许 0 填空)。 */
export function statOf(view: CandidateView, metric: MetricKey): SampleStats | null {
  return view.stats.get(metric) ?? null
}

/** 非法配置候选的错误消息;正常候选 = null。 */
export function configErrorOf(view: CandidateView): string | null {
  return typeof view.status === 'object' ? view.status.config_error : null
}

/* —— WB-08.08 · 内核判定透传:hard/soft 分组与整体聚合 —— */

export type KernelVerdict = 'pass' | 'borderline' | 'fail'

export type OverallVerdict = {
  /** 硬约束聚合:fail > borderline > pass;无硬约束 = null(不编造) */
  hard: KernelVerdict | null
  soft: KernelVerdict | null
  /** 整体可行 = 全部硬约束通过;取舍由内核判定聚合,不由前端重算 */
  overall: KernelVerdict | null
}

const RANK: Record<KernelVerdict, number> = { pass: 0, borderline: 1, fail: 2 }
const worst = (a: KernelVerdict | null, b: KernelVerdict): KernelVerdict =>
  a !== null && RANK[a] >= RANK[b] ? a : b

export function splitConstraints(outcomes: readonly TargetOutcome[]): {
  hard: TargetOutcome[]
  soft: TargetOutcome[]
} {
  const hard: TargetOutcome[] = []
  const soft: TargetOutcome[] = []
  for (const o of outcomes) (o.kind === 'hard' ? hard : soft).push(o)
  return { hard, soft }
}

/** 整体判定:内核逐约束 verdict 的 hard/soft 聚合(判定来源仍是内核)。 */
export function overallOutcome(view: Pick<CandidateView, 'outcomes'>): OverallVerdict {
  const { hard, soft } = splitConstraints(view.outcomes)
  const agg = (list: readonly TargetOutcome[]): KernelVerdict | null => {
    let cur: KernelVerdict | null = null
    for (const o of list) cur = worst(cur, o.verdict as KernelVerdict)
    return cur
  }
  const h = agg(hard)
  const s = agg(soft)
  return { hard: h, soft: s, overall: h }
}

/* —— WB-08.10 · 非法配置/失败/部分完成候选保留:图上不画成 0,不静默删 —— */

export type WithheldPoint = {
  id: string
  reason: 'config_error' | 'metric_not_produced'
  /** config_error 时为内核错误消息;其余不可用不编造原因 */
  message: string | null
}

/**
 * WB-08.04/08.10 · 主图数据点:非法配置候选与未产出该指标的候选不入点列
 * (不画成 0),但在 returned 里保住位置与原因,表格/摘要据此表达。
 */
export function responsePoints(
  views: readonly CandidateView[],
  metric: MetricKey,
  axisPath: string,
): { drawable: Array<{ id: string; x: number; mean: number; ci95_lo: number; ci95_hi: number; n: number }>; withheld: WithheldPoint[] } {
  const drawable: Array<{ id: string; x: number; mean: number; ci95_lo: number; ci95_hi: number; n: number }> = []
  const withheld: WithheldPoint[] = []
  for (const v of views) {
    const err = configErrorOf(v)
    if (err !== null) {
      withheld.push({ id: v.id, reason: 'config_error', message: err })
      continue
    }
    const s = statOf(v, metric)
    if (s === null) {
      withheld.push({ id: v.id, reason: 'metric_not_produced', message: '' })
      continue
    }
    const x = v.values[axisPath]
    if (x === undefined || !Number.isFinite(x)) {
      withheld.push({ id: v.id, reason: 'metric_not_produced', message: '' })
      continue
    }
    drawable.push({ id: v.id, x, mean: s.mean, ci95_lo: s.ci95_lo, ci95_hi: s.ci95_hi, n: s.n })
  }
  return { drawable, withheld }
}

/* —— WB-08.04 · 坐标范围:仅一个点 / 相同值 / 无结果 —— */

/** x 轴范围:单点或全部同值 → ±1 收窄不影响散点可读;空 → null(调用方画空态)。 */
export function xAxisDomain(xs: readonly number[]): { min: number; max: number } | null {
  if (xs.length === 0) return null
  const min = Math.min(...xs)
  const max = Math.max(...xs)
  if (max > min) return { min, max }
  return { min: min - 1, max: max + 1 }
}

/**
 * y 轴范围 = 观测均值 ± 真实 CI 的包络,再加 10% 余量;参考线(目标/基线)
 * 在包络外则并入;单点/同值(全同)给最小可见跨度 ±1e-9 档位扩大,不为画
 * 精确点伪造范围数字(余量与扩档都是轴设置,不落在数据上)。
 */
export function yAutoDomain(
  points: ReadonlyArray<{ mean: number; ci95_lo: number; ci95_hi: number }>,
  refs: ReadonlyArray<number | null>,
): { min: number; max: number } | null {
  if (points.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    min = Math.min(min, p.ci95_lo)
    max = Math.max(max, p.ci95_hi)
  }
  for (const r of refs) {
    if (r === null) continue
    min = Math.min(min, r)
    max = Math.max(max, r)
  }
  const pad = (max - min) * 0.1
  if (max - min <= Number.EPSILON) return { min: min - 1, max: max + 1 }
  return { min: min - pad, max: max + pad }
}

/* —— WB-08.05 · 真实约束线与基线线 —— */

/** 计划内该指标的真实约束;无 = null(不画假目标线)。 */
export function targetSpan(
  plan: Pick<SweepPlan, 'targets'>,
  metric: MetricKey,
): { min: number | null; max: number | null; kind: 'hard' | 'soft' } | null {
  const t = plan.targets.find((t) => t.metric === metric)
  if (t === undefined) return null
  return { min: t.min, max: t.max, kind: t.kind }
}

/**
 * 基线线:只在基线参数域被真实扫描包含(有真实结果)时返回该候选的
 * 指标均值;否则 null——不画假参考线(基线未运行就没有基线数据)。
 */
export function baselineEntry(
  views: readonly CandidateView[],
  baselineValues: Readonly<Record<string, number>>,
): CandidateView | null {
  const keys1 = Object.keys(baselineValues)
  if (keys1.length === 0) return null
  for (const v of views) {
    if (v.status !== 'ok') continue
    const keys2 = Object.keys(v.values)
    if (keys1.length !== keys2.length) continue
    if (keys1.every((k) => v.values[k] === baselineValues[k])) return v
  }
  return null
}

/* —— WB-08.06 · 量纲分组(percent 不与绝对量混轴) —— */

export function metricDimension(metric: MetricKey): MetricDimension {
  return METRIC_META[metric].dimension
}

export function metricsByDimension(metrics: readonly MetricKey[]): {
  percent: MetricKey[]
  amount: MetricKey[]
} {
  const percent: MetricKey[] = []
  const amount: MetricKey[] = []
  for (const m of metrics) (METRIC_META[m].dimension === 'percent' ? percent : amount).push(m)
  return { percent, amount }
}

/* —— WB-08.09 · 筛选/排序与选择同步 —— */

export type ResultFilter = 'all' | KernelVerdict
/** 排序键:'index' = 计划序;'metric:<id>' = 该指标均值(缺失排最后);'verdict' = 整体判定。 */
export type ResultSortKey = string

export type ResultOrder = { filter: ResultFilter; by: ResultSortKey; dir: 1 | -1 }

/** WB-08.09 · 筛选/排序:统一作用于视图,选择由稳定 ID 语义保持。 */
export function orderViews(views: readonly CandidateView[], order: ResultOrder): CandidateView[] {
  const filtered = views.filter((v) => {
    if (order.filter === 'all') return true
    const o = overallOutcome(v).overall
    // 失败候选(无约束产出)不落入任一判定筛选(保留在"全部")
    return o === order.filter
  })
  const metricOf = (by: string): MetricKey | null => {
    const m = /^metric:(.+)$/.exec(by)
    if (m === null) return null
    return (METRIC_KEYS as readonly string[]).includes(m[1]) ? (m[1] as MetricKey) : null
  }
  const numeric = (v: CandidateView, by: string): number | null => {
    if (by === 'index') return v.index
    if (by === 'verdict') {
      const outcome = overallOutcome(v).overall
      return outcome === null ? null : RANK[outcome]
    }
    if (by.startsWith('ci:')) {
      const key = metricOf(`metric:${by.slice(3)}`)
      return key === null ? null : statOf(v, key)?.ci95_lo ?? null
    }
    if (by.startsWith('outcome:')) {
      const outcomes = v.outcomes.filter((o) => o.metric === by.slice(8))
      return outcomes.length ? Math.max(...outcomes.map((o) => RANK[o.verdict])) : null
    }
    const m = metricOf(by)
    if (m !== null) return statOf(v, m)?.mean ?? null
    const path = by.startsWith('param:') ? by.slice(6) : null
    if (path !== null && typeof v.values[path] === 'number') return v.values[path]
    return null
  }
  return [...filtered].sort((a, b) => {
    const av = numeric(a, order.by)
    const bv = numeric(b, order.by)
    // 不可用(null)恒落最后,不让 0 参与排序
    if (av === null && bv === null) return a.index - b.index
    if (av === null) return 1
    if (bv === null) return -1
    return (av > bv ? 1 : av < bv ? -1 : 0) * order.dir
  })
}

/* —— WB-08.12 · A/B 视图:真实配对差/CI/效应量(与扫描绝对值视图分开) —— */

export type AbView = {
  metric: MetricKey
  armA: SampleStats
  armB: SampleStats
  /** 配对差均值与 95% CI(CRN 同种子配对;内核直出,不前端重算) */
  diffMean: number
  diffCi95Lo: number
  diffCi95Hi: number
  /** 效应量 d = Δ / 合并 sd */
  effectSizeD: number
  /** 内核判定原样(BHigher/AHigher/NoDifference) */
  verdict: Comparison['verdict']
}

export function abView(comparison: Comparison): AbView {
  return {
    metric: comparison.metric,
    armA: comparison.arm_a,
    armB: comparison.arm_b,
    diffMean: comparison.diff_mean,
    diffCi95Lo: comparison.diff_ci95_lo,
    diffCi95Hi: comparison.diff_ci95_hi,
    effectSizeD: comparison.effect_size_d,
    verdict: comparison.verdict,
  }
}

/* —— WB-08.13 · 逐日数据:显式 run/replicate;days_csv 只代表 replicate 1 —— */

export type DailyRow = { day: number; win_rate: number | null; inflation: number | null }

/**
 * 显式选中 replicate 的逐日数据:来自该 replicate 的 RunMetrics.day_stats
 * (单次仿真输出,无日级 CI,不虚构)。replicate 不在输出中 → ok:false,
 * 给可读原因(days_csv 只含 replicate 1)不编数据。
 */
export function dailyRows(
  sim: SimOutput | null,
  replicate: number,
  locale?: Locale,
): { ok: true; rows: readonly DailyRow[] } | { ok: false; reason: string } {
  if (sim === null) return { ok: false, reason: msg(locale, 'analysis.noSimulationOutput') }
  if (!Number.isInteger(replicate) || replicate < 0) return { ok: false, reason: msg(locale, 'analysis.badReplicateIndex') }
  const run: RunMetrics | undefined = sim.results.find((r) => r.replicate === replicate)
  if (run === undefined) {
    const have = sim.results.map((r) => r.replicate)
    return { ok: false, reason: msg(locale, 'analysis.replicateMissingDetail', { replicate, have: have.join(',') }) }
  }
  return {
    ok: true,
    rows: run.day_stats.map((d) => ({ day: d.day, win_rate: d.win_rate, inflation: d.inflation })),
  }
}

/* —— WB-XX · 逐日趋势与 cohort 分面:同一 selected run 的内核原值 —— */

export type DailyKpiKey = 'active' | 'win_rate' | 'gold_supply' | 'mean_power' | 'churn_rate'

export type DailyTrendPoint = { day: number; value: number }

export type DailyTrendSeries = {
  id: DailyKpiKey
  labelKey: TranslationKey
  percent: boolean
  points: readonly DailyTrendPoint[]
}

const COHORT_ORDER: readonly CohortStat['cohort'][] = ['casual', 'core', 'whale']

export function selectedDailyRun(
  sim: SimOutput | null,
  replicate: number,
  runId: string,
): { runId: string; run: RunMetrics | null } {
  return { runId, run: sim?.results.find((run) => run.replicate === replicate) ?? null }
}

export const DAILY_KPI = [
  { id: 'active', labelKey: 'analysis.daily.active', percent: false },
  { id: 'win_rate', labelKey: 'analysis.daily.winRate', percent: true },
  { id: 'gold_supply', labelKey: 'analysis.daily.goldSupply', percent: false },
  { id: 'mean_power', labelKey: 'analysis.daily.meanPower', percent: false },
  { id: 'churn_rate', labelKey: 'analysis.daily.churnRate', percent: true },
] as const satisfies readonly {
  id: DailyKpiKey
  labelKey: TranslationKey
  percent: boolean
}[]

export function dailyTrendSeries(run: RunMetrics | null): readonly DailyTrendSeries[] {
  return DAILY_KPI.map((metric) => ({
    id: metric.id,
    labelKey: metric.labelKey,
    percent: metric.percent,
    points: run?.day_stats.map((day) => ({ day: day.day, value: day[metric.id] })) ?? [],
  }))
}

export type CohortFacetRow = {
  cohort: CohortStat['cohort']
  count: number | null
  churned: number | null
  meanPower: number | null
  meanGold: number | null
  meanLevel: number | null
}

export function cohortFacets(run: RunMetrics | null): { rows: readonly CohortFacetRow[] } {
  const byCohort = new Map(run?.cohort_stats.map((row) => [row.cohort, row]))
  return {
    rows: COHORT_ORDER.map((cohort) => {
      const row = byCohort.get(cohort)
      return {
        cohort,
        count: row?.count ?? null,
        churned: row?.churned ?? null,
        meanPower: row?.mean_power ?? null,
        meanGold: row?.mean_gold ?? null,
        meanLevel: row?.mean_level ?? null,
      }
    }),
  }
}

/* —— WB-08.14 · 推荐:敏感性/单轴推荐 + 插值与观测区分 —— */

const SENS_NOTE_KEY: Record<SensNote, 'analysis.sens.ok' | 'analysis.sens.no_bracket' | 'analysis.sens.not_isolated' | 'analysis.sens.missing_metric' | 'analysis.sens.zero_baseline'> = {
  ok: 'analysis.sens.ok',
  no_bracket: 'analysis.sens.no_bracket',
  not_isolated: 'analysis.sens.not_isolated',
  missing_metric: 'analysis.sens.missing_metric',
  zero_baseline: 'analysis.sens.zero_baseline',
}

export function sensitivityNoteLabel(note: SensNote, locale?: Locale): string {
  return msg(locale, SENS_NOTE_KEY[note])
}

export type RecommendationView = {
  param: string
  /** 基线值;内核未给 = null(不编造) */
  baseline: number | null
  /** 推荐区间;不完整结果/无括号 = null,如实不可推荐 */
  interval: [number, number] | null
  /** 两端是否插值(内核判定):插值点 ≠ 观测点,展示口径区分 */
  interpolated: readonly [boolean, boolean]
  confidence: 'high' | 'medium' | 'low'
  reasons: readonly string[]
  /** 面板 elasticities:敏感性证据(e/e_lo/e_hi、显著性、note)——局限如实保留 */
  elasticities: readonly Elasticity[]
}

export function recommendationView(rec: SweepRecOutput): RecommendationView {
  return {
    param: rec.recommendation.param,
    baseline: rec.recommendation.baseline,
    interval: rec.recommendation.interval,
    interpolated: rec.recommendation.interpolated,
    confidence: rec.recommendation.confidence,
    reasons: rec.recommendation.reasons,
    elasticities: rec.elasticities,
  }
}

/** 插值与观测的准确表述:区间两端哪个是插值(内核 interpolated 位)。 */
export function interpolationText(rec: RecommendationView, locale?: Locale): string {
  if (rec.interval === null) return msg(locale, 'analysis.interpNone')
  const [loInterp, hiInterp] = rec.interpolated
  const lo = loInterp ? msg(locale, 'analysis.interpInterpolated') : msg(locale, 'analysis.interpObserved')
  const hi = hiInterp ? msg(locale, 'analysis.interpInterpolated') : msg(locale, 'analysis.interpObserved')
  return lo === hi
    ? msg(locale, 'analysis.interpBoth', { kind: lo })
    : msg(locale, 'analysis.interpSplit', { lo, hi })
}

/* —— WB-08.16 · 检查器来源元数据:缺失字段不编造 —— */

export type InspectorSourcesInput = {
  /** 计划元数据(字段可缺:旧任务/测试快照没带就不显示) */
  plan?: {
    configHash?: string
    mode?: string
    baseSeed?: number
    replicates?: number
    players?: number
    days?: number
  } | null
  /** 运行登记(可缺;版本 unknown = 内核未给,如显示"未知"但注明缺省) */
  runEntry?: {
    configHash?: string
    modelVersion?: string
    schemaVersion?: string
  } | null
  /** 统计单位:replicates 与样本 n(可缺) */
  stats?: { replicates?: number | null; n?: number | null } | null
}

export type InspectorSources = {
  configHash: string | null
  modelVersion: string | null
  schemaVersion: string | null
  randomStrategy: string | null
  statUnit: string | null
}

const UNKNOWN = 'unknown'

export function inspectorSources(input: InspectorSourcesInput): InspectorSources {
  const p = input.plan ?? null
  const e = input.runEntry ?? null
  const s = input.stats ?? null
  const unknownToNull = (v: string | undefined): string | null =>
    v === undefined || v === '' || v === UNKNOWN ? null : v
  return {
    configHash: e?.configHash ?? p?.configHash ?? null,
    modelVersion: unknownToNull(e?.modelVersion),
    schemaVersion: unknownToNull(e?.schemaVersion),
    randomStrategy:
      p?.mode === undefined ? null : `${p.mode} · base_seed ${String(p?.baseSeed ?? 'unspecified')}`,
    statUnit:
      s === null
        ? null
        : [
            s.replicates !== null && s.replicates !== undefined ? `${s.replicates} replicates` : null,
            s.n !== null && s.n !== undefined ? `n=${s.n}` : null,
          ]
            .filter((x): x is string => x !== null)
            .join(' × ') || null,
  }
}
