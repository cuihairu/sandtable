// WB-08: submitted context is immutable evidence; UI never consults the current designer.
import type { SweepPlan, MetricKey, SampleStats } from '../../lib/types.ts'
import { candidateViews } from '../../lib/sweepView.ts'
import type { CandidateView } from '../../lib/sweepView.ts'
import { overallOutcome, orderViews } from '../../lib/analysisView.ts'
import type { ResultOrder } from '../../lib/analysisView.ts'
import { METRIC_META } from '../../lib/metricMeta.ts'
import { metricUnit } from '../../lib/metricMeta.ts'
import { fmtNumber } from '../../lib/i18n/format.ts'
import { t } from '../../lib/i18n/index.ts'
import type { Locale, TranslationKey, InterpolationParams } from '../../lib/i18n/index.ts'

// WB-11.14:统计/状态文案可选带 locale;缺省 zh-CN(analysis-results
// 测试锁中文子串,与 WB-11.13 designerLogic 同一纪律)。
const LOGIC_FALLBACK: Locale = 'zh-CN'

function msg(locale: Locale | undefined, key: TranslationKey, params?: InterpolationParams): string {
  return t(locale ?? LOGIC_FALLBACK, key, params)
}
import { candidateIdFor, hashId, ID_PREFIXES } from '../ids.ts'
import type { BaselineId } from '../ids.ts'
import type { Job } from '../state/jobLogic.ts'
import { applyParamEdits, numericValuesOf, parseConfig } from '../params/configYaml.ts'

export type AnalysisContext = {
  readonly baselineId: BaselineId
  readonly baselineYaml: string
  readonly scenarioYaml: string
  readonly plan?: SweepPlan
  readonly modelVersion?: string
  readonly schemaVersion?: string
}

export type ResultRow = {
  id: string
  index: number
  values: Readonly<Record<string, number>>
  result: CandidateView | null
}

export function baselineIdOf(job: Job): BaselineId {
  const spec = job.exec!.spec
  return spec.analysis?.baselineId ?? hashId(ID_PREFIXES.baseline, spec.kind === 'ab' ? spec.baseYaml : spec.yaml) as BaselineId
}

export function fullValues(job: Job, values: Readonly<Record<string, number>>): Record<string, number> {
  const yaml = job.exec?.spec.analysis?.scenarioYaml
  return { ...(yaml ? numericValuesOf(parseConfig(yaml)) : {}), ...values }
}

/** Include every planned slot, including pending/failed/cancelled slots. */
export function resultRows(job: Job): ResultRow[] {
  const exec = job.exec
  if (!exec || exec.spec.kind !== 'sweep') return []
  const derive = (values: Readonly<Record<string, number>>) => candidateIdFor(baselineIdOf(job), fullValues(job, values))
  // Adapter only reads candidates from plan; legacy jobs deliberately have no invented metadata.
  const views = candidateViews({ candidates: [...exec.spec.plan.candidates] } as SweepPlan, exec.results, derive)
  const byIndex = new Map(views.map((v) => [v.index, v]))
  return exec.spec.plan.candidates.map((values, index) => ({
    id: derive(values), index, values, result: byIndex.get(index) ?? null,
  }))
}

export function orderedRows(rows: readonly ResultRow[], order: ResultOrder): ResultRow[] {
  if (order.by === 'status') {
    return orderedRows(rows, { ...order, by: 'index' }).sort((a, b) => {
      const status = (r: ResultRow): string => r.result === null ? 'pending' : typeof r.result.status === 'object' ? 'config_error' : 'ok'
      return status(a).localeCompare(status(b)) * order.dir || a.index - b.index
    })
  }
  const views = rows.flatMap((r) => r.result ? [r.result] : [])
  const sorted = orderViews(views, order)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const returned = sorted.map((v) => byId.get(v.id)!)
  const pending = order.filter === 'all' ? rows.filter((r) => !r.result) : []
  if (order.by === 'index') return [...returned, ...pending].sort((a, b) => (a.index - b.index) * order.dir)
  return [...returned, ...pending]
}

export function rowState(row: ResultRow, job: Job, locale?: Locale): string {
  if (!row.result) {
    return job.status === 'failed'
      ? msg(locale, 'analysis.rowFailed', { message: job.exec?.errorMessage ?? msg(locale, 'analysis.rowRunFailed') })
      : job.status === 'cancelled' ? msg(locale, 'analysis.rowCancelled') : msg(locale, 'analysis.rowPending')
  }
  return typeof row.result.status === 'object' ? `config_error · ${row.result.status.config_error}` : 'ok'
}

export function formatMetric(value: number | null | undefined, key: MetricKey, delta = false, locale?: Locale): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return msg(locale, 'analysis.unavailable')
  const meta = METRIC_META[key]
  const percent = meta.dimension === 'percent'
  // WB-11.18:数字走 lib/i18n/format(封顶不补零口径不变,locale 生效)
  return fmtNumber(locale ?? LOGIC_FALLBACK, percent ? value * 100 : value, { maxFractionDigits: meta.decimals + (delta ? 1 : 0) })
    + (percent ? delta ? ' pp' : '%' : ` ${metricUnit(key, locale)}`)
}

export function statText(stat: SampleStats | null | undefined, key: MetricKey, locale?: Locale): string {
  return stat
    ? `${formatMetric(stat.mean, key, false, locale)} · 95% CI [${formatMetric(stat.ci95_lo, key, false, locale)}, ${formatMetric(stat.ci95_hi, key, false, locale)}] · n=${stat.n}`
    : msg(locale, 'analysis.unavailableNoStat')
}

export function feasibility(row: ResultRow, locale?: Locale): string {
  if (!row.result) return msg(locale, 'analysis.notJudged')
  const o = overallOutcome(row.result)
  return msg(locale, 'analysis.feasibilitySummary', {
    hard: o.hard ?? msg(locale, 'analysis.noHardConstraint'),
    soft: o.soft ?? msg(locale, 'analysis.noSoftConstraint'),
    overall: o.overall ?? msg(locale, 'analysis.notJudged'),
  })
}

export type CandidateDraft = {
  id: string
  sourceRunId: string
  sourceCandidateId: string
  baselineId: BaselineId
  baselineYaml: string
  values: Readonly<Record<string, number>>
  yaml: string
}

/** Copy into a NEW draft. Existing scenario, input hash and result are untouched. */
export function copyCandidate(job: Job, row: ResultRow, id: string, locale?: Locale): CandidateDraft {
  const context = job.exec?.spec.analysis
  if (!context || !row.result || row.result.status !== 'ok') throw new Error(msg(locale, 'analysis.copyNeedsOkSnapshot'))
  const values = fullValues(job, row.values)
  const applied = applyParamEdits(context.scenarioYaml, Object.entries(row.values).map(([path, value]) => ({ path, text: String(value) })))
  if (!applied.ok) throw new Error(applied.error)
  return { id, sourceRunId: job.exec!.runId, sourceCandidateId: row.id,
    baselineId: context.baselineId, baselineYaml: context.baselineYaml,
    values: Object.freeze(values), yaml: applied.yaml }
}

/** Conservative proof of an actually run baseline, including structural fields. */
export function ranBaseline(job: Job, rows: readonly ResultRow[]): ResultRow | null {
  const c = job.exec?.spec.analysis
  if (!c) return null
  return rows.find((row) => {
    if (row.result?.status !== 'ok') return false
    const applied = applyParamEdits(c.scenarioYaml, Object.entries(row.values).map(([path, value]) => ({ path, text: String(value) })))
    return applied.ok && applied.yaml === c.baselineYaml
  }) ?? null
}
