// WB-08: submitted context is immutable evidence; UI never consults the current designer.
import type { SweepPlan, MetricKey, SampleStats } from '../../lib/types.ts'
import { candidateViews } from '../../lib/sweepView.ts'
import type { CandidateView } from '../../lib/sweepView.ts'
import { overallOutcome, orderViews } from '../../lib/analysisView.ts'
import type { ResultOrder } from '../../lib/analysisView.ts'
import { METRIC_META } from '../../lib/metricMeta.ts'
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

export function rowState(row: ResultRow, job: Job): string {
  if (!row.result) return job.status === 'failed' ? `未执行 · ${job.exec?.errorMessage ?? '运行失败'}`
    : job.status === 'cancelled' ? '未执行 · 运行已取消' : '等待结果'
  return typeof row.result.status === 'object' ? `config_error · ${row.result.status.config_error}` : 'ok'
}

export function formatMetric(value: number | null | undefined, key: MetricKey, delta = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '不可用'
  const meta = METRIC_META[key]
  const percent = meta.dimension === 'percent'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: meta.decimals + (delta ? 1 : 0) }).format(percent ? value * 100 : value)
    + (percent ? delta ? ' pp' : '%' : ` ${meta.unit}`)
}

export function statText(stat: SampleStats | null | undefined, key: MetricKey): string {
  return stat ? `${formatMetric(stat.mean, key)} · 95% CI [${formatMetric(stat.ci95_lo, key)}, ${formatMetric(stat.ci95_hi, key)}] · n=${stat.n}` : '不可用 · 内核未产出该指标'
}

export function feasibility(row: ResultRow): string {
  if (!row.result) return '未判定'
  const o = overallOutcome(row.result)
  return `hard: ${o.hard ?? '无硬约束'} · soft: ${o.soft ?? '无软约束'} · 整体硬约束: ${o.overall ?? '未判定'}`
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
export function copyCandidate(job: Job, row: ResultRow, id: string): CandidateDraft {
  const context = job.exec?.spec.analysis
  if (!context || !row.result || row.result.status !== 'ok') throw new Error('缺少候选快照或候选未成功，不能复制')
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
