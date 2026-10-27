// WB-13 · 策划结论与报告模型(纯派生,不建状态库):
// 输入只能是真实 job / 运行索引 / 已落档 report.json。缺失来源显式转成原因;
// 不重算内核统计,不回填参数,不把 A/B comparison 或逐日单 replicate
// 数据伪装成跨 replicate 聚合。
import { METRIC_KEYS } from './types.ts'
import type { Comparison, MetricKey, SampleStats } from './types.ts'
import { abFacets } from './abEffect.ts'
import type { AbFacet } from './abEffect.ts'
import { METRIC_META, metricLabel } from './metricMeta.ts'
import { buildCaliberRows, REPORT_TEMPLATE_ID, REPORT_TEMPLATE_VERSION } from './reportTemplate.ts'
import type { CaliberRow } from './reportTemplate.ts'
import { t } from './i18n/index.ts'
import type { Locale } from './i18n/locales.ts'

export type ReportRunIndex = {
  experiment_id: string | null
  config_hash: string | null
  seed: number | string | null
  created_at_unix: number | null
}

export type ReportSource = {
  runId: string
  runStatus: string
  artifactPath: string
  artifactText: string
  index?: ReportRunIndex | null
  configAvailability?: readonly { metric: string; reason: string }[]
  population?: number | string | null
  days?: number | string | null
}

export type ReportBaseline = {
  runId: string
  artifactPath: string
  artifactText: string
} | null

export type MetricFinding = {
  metric: MetricKey
  label: string
  unit: 'ratio_0_1' | 'amount'
  n: number | null
  mean: number | null
  ci95Lo: number | null
  ci95Hi: number | null
  sd: number | null
  sourcePath: string
}

export type UnavailableMetric = {
  metric: MetricKey
  label: string
  reason: string
  source: 'configuration' | 'kernel-result'
}

export type ReportTableRow = Readonly<Record<string, string | number>>
export type ReportChart = {
  id: string
  title: string
  note: string
  sourcePath: string
  columns: readonly string[]
  rows: readonly ReportTableRow[]
}

export type DesignReportModel = {
  language: Locale
  summary: readonly string[]
  runStatus: string
  artifactStatus: string | null
  conditions: {
    population: number
    days: number
    seed: number | string | null
    candidateSourceRunId: string
  } | null
  conditionReason: string | null
  conditionMissingFields: readonly ('population' | 'days')[]
  parameterDiff: readonly { path: string; baseline: number; candidate: number }[]
  parameterDiffReason: string | null
  metrics: readonly MetricFinding[]
  charts: readonly ReportChart[]
  unavailableMetrics: readonly UnavailableMetric[]
  assumptions: readonly string[]
  sources: readonly { runId: string; path: string; schemaVersion: string | null; modelVersion: string | null }[]
  /** 报告模板身份(前端组版契约;模板演进可引用版本号) */
  template: { id: string; version: string }
  /** 模板与口径版本行(模板版本前端常量;其余内核回传,缺失 null) */
  caliber: readonly CaliberRow[]
}

type ComparisonError = { metric: MetricKey; message: string }

type RunEnvelope = {
  run_id?: unknown
  status?: unknown
  version?: { model_version?: unknown; schema_version?: unknown }
  source?: { seed?: unknown; experiment_id?: unknown }
  plan?: {
    base_seed?: unknown
    axes?: unknown
    candidates?: unknown
  }
  results?: unknown
  recommendation?: { elasticities?: unknown }
  comparison?: unknown
  comparison_errors?: unknown
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function parseReport(value: string | null | undefined): RunEnvelope | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as RunEnvelope
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function singleAxisInput(parsed: RunEnvelope | null): { path: string; candidate: Record<string, number> } | null {
  const axes = Array.isArray(parsed?.plan?.axes) ? parsed!.plan!.axes as { path?: unknown }[] : []
  const candidates = Array.isArray(parsed?.plan?.candidates) ? parsed!.plan!.candidates as Record<string, unknown>[] : []
  const results = Array.isArray(parsed?.results) ? parsed!.results : []
  if (axes.length !== 1 || candidates.length !== 1 || results.length !== 1) return null
  const path = text(axes[0]?.path)
  const raw = path ? candidates[0]?.[path] : undefined
  return path && finite(raw) ? { path, candidate: { [path]: raw } } : null
}

function singleResultStats(parsed: RunEnvelope | null, metric: MetricKey): SampleStats | null {
  const results = Array.isArray(parsed?.results) ? parsed!.results : []
  const result = results[0]
  const entries = result && typeof result === 'object' && Array.isArray((result as { metric_stats?: unknown }).metric_stats)
    ? (result as { metric_stats: unknown[] }).metric_stats
    : []
  const entry = entries.find((item): item is [MetricKey, Partial<SampleStats>] =>
    Array.isArray(item) && item[0] === metric && typeof item[1] === 'object' && item[1] !== null)
  const raw = entry?.[1]
  if (!entry || !raw) return null
  const stats: SampleStats = {
    n: finite(raw.n) ? raw.n : Number.NaN,
    mean: finite(raw.mean) ? raw.mean : Number.NaN,
    sd: finite(raw.sd) ? raw.sd : Number.NaN,
    ci95_lo: finite(raw.ci95_lo) ? raw.ci95_lo : Number.NaN,
    ci95_hi: finite(raw.ci95_hi) ? raw.ci95_hi : Number.NaN,
  }
  return [stats.n, stats.mean, stats.sd, stats.ci95_lo, stats.ci95_hi].every(finite) ? stats : null
}

function finding(metric: MetricKey, stats: SampleStats, sourcePath: string): MetricFinding {
  return {
    metric,
    label: metricLabel(metric, 'zh-CN'),
    unit: METRIC_META[metric].dimension === 'percent' ? 'ratio_0_1' : 'amount',
    n: stats.n,
    mean: stats.mean,
    ci95Lo: stats.ci95_lo,
    ci95Hi: stats.ci95_hi,
    sd: stats.sd,
    sourcePath,
  }
}

function abFinding(facet: AbFacet, sourcePath: string): MetricFinding {
  return finding(facet.metric, {
    n: facet.armA.n,
    mean: facet.armA.mean,
    sd: facet.armA.sd,
    ci95_lo: facet.armA.ci95_lo,
    ci95_hi: facet.armA.ci95_hi,
  }, sourcePath)
}

function chart(
  locale: Locale,
  id: string,
  titleKey: Parameters<typeof t>[1],
  noteKey: Parameters<typeof t>[1],
  sourcePath: string,
  rows: readonly ReportTableRow[],
): ReportChart {
  return {
    id,
    title: t(locale, titleKey),
    note: t(locale, noteKey),
    sourcePath,
    columns: ['candidate', 'metric', 'n', 'mean', 'ci95_lo', 'ci95_hi'],
    rows,
  }
}

function statRows(parsed: RunEnvelope | null, runId: string): ReportTableRow[] {
  const selection = singleAxisInput(parsed)
  return METRIC_KEYS.flatMap((metric) => {
    const stats = singleResultStats(parsed, metric)
    if (!stats) return []
    return [{
      candidate: `${runId}${selection ? `·${selection.path}=${selection.candidate[selection.path]}` : ''}`,
      metric,
      n: stats.n,
      mean: stats.mean,
      ci95_lo: stats.ci95_lo,
      ci95_hi: stats.ci95_hi,
    }]
  })
}

function unavailableReportLocale(
  source: ReportSource,
  reason: string,
  locale: Locale,
  dictVersion: string | null = null,
): DesignReportModel {
  return {
    language: locale,
    summary: [reason],
    runStatus: source.runStatus,
    artifactStatus: null,
    conditions: null,
    conditionReason: reason,
    conditionMissingFields: [],
    parameterDiff: [],
    parameterDiffReason: reason,
    metrics: [],
    charts: [],
    unavailableMetrics: METRIC_KEYS.map((metric) => ({ metric, label: metricLabel(metric, locale), reason, source: 'kernel-result' })),
    assumptions: [t(locale, 'report.assumptionScope')],
    sources: [],
    template: { id: REPORT_TEMPLATE_ID, version: REPORT_TEMPLATE_VERSION },
    caliber: buildCaliberRows([], dictVersion),
  }
}

export function designReport(
  source: ReportSource,
  baseline: ReportBaseline,
  locale: Locale = 'zh-CN',
  dictVersion: string | null = null,
): DesignReportModel {
  const parsed = parseReport(source.artifactText)
  if (!parsed) return unavailableReportLocale(source, t(locale, 'report.artifactInvalidJson', { path: source.artifactPath }), locale, dictVersion)
  if (text(parsed.run_id) !== source.runId) {
    return unavailableReportLocale(source, t(locale, 'report.artifactRunMismatch', { path: source.artifactPath, runId: source.runId }), locale, dictVersion)
  }

  const indexedSeed = source.index?.seed
  const seed = [indexedSeed, parsed.source?.seed, parsed.plan?.base_seed].find((value) =>
    finite(value) || text(value) !== null) ?? null
  const reportSeed: number | string | null = finite(seed) || text(seed) !== null ? seed as number | string : null
  const explicitPopulation = finite(source.population) ? source.population : null
  const explicitDays = finite(source.days) ? source.days : null
  const artifactStatus = text(parsed.status)
  const conditionMissingFields = [
    ...(explicitPopulation === null ? ['population' as const] : []),
    ...(explicitDays === null ? ['days' as const] : []),
  ]
  const conditions = explicitPopulation !== null && explicitDays !== null
    ? { population: explicitPopulation, days: explicitDays, seed: reportSeed, candidateSourceRunId: source.runId }
    : null

  const baselineParsed = parseReport(baseline?.artifactText)
  const baselineRunMatches = baseline !== null && baselineParsed !== null && text(baselineParsed.run_id) === baseline.runId
  const selection = singleAxisInput(parsed)
  const baselineSelection = singleAxisInput(baselineParsed)
  const parameterDiff = selection && baselineSelection && selection.path === baselineSelection.path
    ? [{ path: selection.path, baseline: baselineSelection.candidate[selection.path], candidate: selection.candidate[selection.path] }]
    : []
  const parameterDiffReason = parameterDiff.length === 0
    ? baseline === null
      ? t(locale, 'report.diffBaselineMissing')
      : !baselineRunMatches
        ? baselineParsed === null
          ? t(locale, 'report.artifactInvalidJson', { path: baseline.artifactPath })
          : t(locale, 'report.artifactRunMismatch', { runId: baseline.runId, path: baseline.artifactPath })
        : t(locale, 'report.diffNeedsSingleAxisBaseline')
    : null

  const comparisons = Array.isArray(parsed.comparison) ? parsed.comparison as Comparison[] : []
  const comparisonErrors = Array.isArray(parsed.comparison_errors) ? parsed.comparison_errors as ComparisonError[] : []
  const configAvailability = source.configAvailability ?? []
  const facets = abFacets(comparisons)
  const available = new Map(facets.map((facet) => [facet.metric, facet] as const))
  const errors = new Map(comparisonErrors.map((error) => [error.metric, error.message] as const))
  const configuredReasons = new Map(configAvailability.map((row) => [row.metric, row.reason] as const))
  const metrics: MetricFinding[] = []
  const unavailableMetrics: UnavailableMetric[] = []
  const sourceRows = statRows(parsed, source.runId)
  const hasComparison = comparisons.length > 0 || comparisonErrors.length > 0

  for (const metric of METRIC_KEYS) {
    const label = metricLabel(metric, locale)
    const facet = available.get(metric)
    if (facet) {
      metrics.push(abFinding(facet, `${source.artifactPath}#comparison[].${metric}`))
      continue
    }
    if (errors.has(metric)) {
      unavailableMetrics.push({ metric, label, reason: errors.get(metric)!, source: 'configuration' })
      continue
    }
    const stats = singleResultStats(parsed, metric)
    if (stats && !hasComparison) {
      metrics.push(finding(metric, stats, `${source.artifactPath}#results[0].metric_stats[].${metric}`))
      continue
    }
    if (!hasComparison && configuredReasons.has(metric)) {
      unavailableMetrics.push({ metric, label, reason: configuredReasons.get(metric)!, source: 'configuration' })
      continue
    }
    unavailableMetrics.push({
      metric,
      label,
      reason: hasComparison ? t(locale, 'report.metricNotReturned') : t(locale, 'report.metricMissingKernel', { metric }),
      source: 'kernel-result',
    })
  }

  const sources = reportSources(source, baseline, parsed, baselineParsed)
  return {
    language: locale,
    summary: buildSummary(source.runId, source.runStatus, locale, conditions, parameterDiff, parameterDiffReason, facets),
    runStatus: source.runStatus,
    artifactStatus,
    conditions,
    conditionReason: conditions ? null : t(locale, 'report.conditionsMissingFields', {
      fields: conditionMissingFields.join(', '),
    }),
    conditionMissingFields,
    parameterDiff,
    parameterDiffReason,
    metrics,
    charts: [chart(locale, 'response-points', 'report.chartResponse', 'report.chartResponseNote', `${source.artifactPath}#results[0].metric_stats`, sourceRows)],
    unavailableMetrics,
    assumptions: [
      t(locale, 'report.assumptionStatistics'),
      t(locale, 'report.assumptionProvenance'),
      t(locale, 'report.assumptionDailyNoCi'),
      t(locale, 'report.assumptionScope'),
    ],
    sources,
    template: { id: REPORT_TEMPLATE_ID, version: REPORT_TEMPLATE_VERSION },
    caliber: buildCaliberRows(sources, dictVersion),
  }
}

function buildSummary(
  runId: string,
  runStatus: string,
  locale: Locale,
  conditions: DesignReportModel['conditions'],
  parameterDiff: DesignReportModel['parameterDiff'],
  parameterDiffReason: string | null,
  comparisons: readonly AbFacet[],
): string[] {
  const summary = [t(locale, 'report.summarySource', { runId, runStatus })]
  if (conditions) summary.push(t(locale, 'report.summaryConditions', {
    population: conditions.population,
    days: conditions.days,
    seed: conditions.seed ?? 'unspecified',
  }))
  if (parameterDiff.length > 0) summary.push(t(locale, 'report.summaryDiff', {
    path: parameterDiff[0]!.path,
    baseline: parameterDiff[0]!.baseline,
    candidate: parameterDiff[0]!.candidate,
  }))
  if (parameterDiffReason) summary.push(parameterDiffReason)
  if (comparisons.length > 0) summary.push(t(locale, 'report.summaryComparisons', { count: comparisons.length }))
  return summary
}

function reportSources(
  source: ReportSource,
  baseline: ReportBaseline,
  parsed: RunEnvelope,
  baselineParsed: RunEnvelope | null,
): DesignReportModel['sources'] {
  const rows = [{
    runId: source.runId,
    path: source.artifactPath,
    schemaVersion: text(parsed.version?.schema_version),
    modelVersion: text(parsed.version?.model_version),
  }]
  if (baseline) rows.push({
    runId: baseline.runId,
    path: baseline.artifactPath,
    schemaVersion: text(baselineParsed?.version?.schema_version),
    modelVersion: text(baselineParsed?.version?.model_version),
  })
  return rows
}
