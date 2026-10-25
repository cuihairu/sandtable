// WB-08.13 · 跨 replicate 逐日聚合视图(P2):数据只走内核 daily_aggregate,
// CI 由内核 SampleStats 口径直出;前端不重算、不 0 填、绝不给单次运行套
// 置信带(<2 replicate 是内核明确报错拒绝的契约,UI 先行声明,不发无效调用)。
import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { DAILY_KPI, aggregateDailySeries } from '../../lib/analysisView.ts'
import type { AggregateDailySeries } from '../../lib/analysisView.ts'
import { METRIC_KEYS } from '../../lib/types.ts'
import type { AggregateMetricStats, DailyAggregation, MetricKey, RunMetrics } from '../../lib/types.ts'
import { metricLabel, metricUnit } from '../../lib/metricMeta.ts'
import { fmtNumber, fmtPercent } from '../../lib/i18n/format.ts'
import { localizeWasmErrorText } from '../../lib/i18n/errorText.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import { dailyAggregate } from '../../lib/wasm.ts'

function fmtValue(locale: 'zh-CN' | 'en-US', percent: boolean, value: number): string {
  return percent ? fmtPercent(locale, value) : fmtNumber(locale, value, { maxFractionDigits: 2 })
}

function chartDomain(values: readonly number[]): { min: number; max: number } {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  if (lo === hi) return hi > 0 ? { min: 0, max: hi * 1.05 } : { min: -0.1, max: 0.1 }
  const pad = (hi - lo) * 0.08
  return { min: lo - pad, max: hi + pad }
}

/** 聚合图:均值折线 + 内核 95% CI 带;缺席日不出点(不补 0)。 */
function AggChart({ locale, series, label, sourceTitle }: {
  locale: 'zh-CN' | 'en-US'
  series: AggregateDailySeries
  label: string
  sourceTitle: string
}): JSX.Element {
  const width = 520
  const height = 168
  const left = 58
  const right = 12
  const top = 24
  const bottom = 30
  const points = series.points
  const dayMin = Math.min(...points.map((p) => p.day))
  const dayMax = Math.max(...points.map((p) => p.day))
  const x0 = points.length === 1 ? dayMin - 0.5 : dayMin
  const x1 = points.length === 1 ? dayMin + 0.5 : dayMax
  const domain = chartDomain(points.flatMap((p) => [p.ci95_lo, p.ci95_hi]))
  const x = (day: number): number => left + ((day - x0) / (x1 - x0 || 1)) * (width - left - right)
  const y = (value: number): number => top + ((domain.max - value) / (domain.max - domain.min || 1)) * (height - top - bottom)
  const format = (value: number): string => fmtValue(locale, series.percent, value)
  const band = points.length > 1
    ? [
        ...points.map((p) => `${x(p.day)},${y(p.ci95_hi)}`),
        ...[...points].reverse().map((p) => `${x(p.day)},${y(p.ci95_lo)}`),
      ].join(' ')
    : null

  return <svg data-testid="daily-agg-chart" data-metric={series.id} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${points.length} days`}>
    <title>{sourceTitle}</title>
    {[0, 1, 2, 3].map((i) => {
      const value = domain.min + (domain.max - domain.min) * i / 3
      return <g key={i}>
        <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="chart-grid" />
        <text x={left - 8} y={y(value) + 4} textAnchor="end" className="chart-text">{format(value)}</text>
      </g>
    })}
    {band && <polygon className="agg-ci-band" points={band} />}
    {points.length > 1 && <polyline fill="none" className="agg-mean-line" points={points.map((p) => `${x(p.day)},${y(p.mean)}`).join(' ')} />}
    {points.map((p) => {
      const pointLabel = `${label} · day ${p.day}: ${format(p.mean)} [${format(p.ci95_lo)}, ${format(p.ci95_hi)}]`
      return <circle key={p.day} data-testid="daily-agg-point" data-metric={series.id} data-day={p.day}
        data-mean={p.mean} data-lo={p.ci95_lo} data-hi={p.ci95_hi} cx={x(p.day)} cy={y(p.mean)} r="3">
        <title>{pointLabel}</title>
      </circle>
    })}
    <text x={left} y={14} className="chart-label">{label}</text>
    <text x={(width + left - right) / 2} y={height - 6} textAnchor="middle" className="chart-text">day</text>
  </svg>
}

/** 运行级 KPI(retention/gacha/loot)跨 replicate 聚合;键缺席 ≠ 0。 */
const RUN_LEVEL_KPIS = [
  'retention_d1',
  'retention_d3',
  'retention_d7',
  'retention_d14',
  'retention_d30',
  'gacha_pulls_to_hit',
  'loot_gold_per_player',
] as const satisfies readonly (keyof DailyAggregation)[]

function runKpiLabel(key: string, locale: 'zh-CN' | 'en-US'): string {
  if (!(METRIC_KEYS as readonly string[]).includes(key)) return key
  const metric = key as MetricKey
  return `${metricLabel(metric, locale)} / ${metricUnit(metric, locale)}`
}

export interface CrossReplicateSectionProps {
  /** 当前 run(或当前臂)已跑完的 replicate 结果;<2 时只声明契约,不调用内核 */
  results: RunMetrics[] | null
  runId: string
}

export function CrossReplicateSection({ results, runId }: CrossReplicateSectionProps): JSX.Element {
  const locale = useLocale()
  // 已完成的聚合按「发起时的 results 引用」缓存;当前 results 不匹配 = 在途,
  // loading 由派生得出,effect 体内不做同步 setState(React Compiler 纪律)。
  const [done, setDone] = useState<{
    key: RunMetrics[]
    agg: DailyAggregation | null
    error: string | null
  } | null>(null)
  const hasEnough = results !== null && results.length >= 2

  useEffect(() => {
    if (!hasEnough || results === null) return
    let cancelled = false
    dailyAggregate(results).then(
      (out) => { if (!cancelled) setDone({ key: results, agg: out, error: null }) },
      (e) => { if (!cancelled) setDone({ key: results, agg: null, error: String(e) }) },
    )
    return () => { cancelled = true }
  }, [results, hasEnough])

  const fresh = done !== null && done.key === results
  const agg = fresh ? done.agg : null
  const error = fresh ? done.error : null
  const loading = hasEnough && !fresh

  const unavailable = t(locale, 'analysis.unavailable')
  const series = aggregateDailySeries(agg).filter((s) => s.points.length > 0)
  const sourceTitle = t(locale, 'analysis.aggTitle')
  const runRows: Array<{ key: string; label: string; stat: AggregateMetricStats }> = agg === null ? [] : RUN_LEVEL_KPIS.flatMap((key) => {
    const stat = agg[key] as AggregateMetricStats | undefined
    return stat === undefined ? [] : [{ key, label: runKpiLabel(key, locale), stat }]
  })

  return <section data-testid="cross-replicate-agg-section" data-run-id={runId}>
    <h3>{t(locale, 'analysis.aggTitle')}</h3>
    <p className="note">{t(locale, 'analysis.aggNote')}</p>
    {!hasEnough && <p className="note" role="status" data-testid="daily-agg-need-more">{t(locale, 'analysis.aggNeedMore', { n: results?.length ?? 0 })}</p>}
    {hasEnough && error !== null && <p className="note" role="alert" aria-live="assertive" data-testid="daily-agg-error">{localizeWasmErrorText(locale, error).text}</p>}
    {hasEnough && loading && <p className="note" data-testid="daily-agg-loading">{t(locale, 'analysis.aggLoading')}</p>}
    {hasEnough && agg !== null && <>
      <p className="note" data-testid="daily-agg-method">{t(locale, 'analysis.aggMethod', {
        replicates: agg.replicates, days: agg.common_days, ci: agg.ci_method, sd: agg.sd_method,
      })}</p>
      {agg.trim_warning !== '' && <p className="note" role="status" data-testid="daily-agg-trim">{agg.trim_warning}</p>}
      {series.length > 0
        ? <div className="mini-figures">{series.map((s) => <div key={s.id} className="mini-figure">
            <AggChart locale={locale} series={s} label={t(locale, s.labelKey)} sourceTitle={sourceTitle} />
          </div>)}</div>
        : <p className="note" role="alert" aria-live="assertive" data-testid="daily-agg-unavailable">{t(locale, 'analysis.aggEmpty')}</p>}
      {agg.day_stats.length > 0 && <>
        <h3>{t(locale, 'analysis.aggTableTitle')}</h3>
        <div className="candidate-table-wrap"><table className="candidate-table" data-testid="daily-agg-table">
          <thead><tr><th>day</th>{DAILY_KPI.map((m) => <th key={m.id}>{t(locale, m.labelKey)}</th>)}</tr></thead>
          <tbody>{agg.day_stats.map((row) => <tr key={row.day}>
            <td data-field="day" data-value={row.day}>{row.day}</td>
            {DAILY_KPI.map((m) => {
              const stat = row[m.id]
              return <td key={m.id} data-field={m.id}
                data-value={stat?.mean} data-lo={stat?.ci95_lo} data-hi={stat?.ci95_hi}>
                {stat ? `${fmtValue(locale, m.percent, stat.mean)} [${fmtValue(locale, m.percent, stat.ci95_lo)}, ${fmtValue(locale, m.percent, stat.ci95_hi)}]` : unavailable}
              </td>
            })}
          </tr>)}</tbody>
        </table></div>
      </>}
      {runRows.length > 0 && <>
        <h3>{t(locale, 'analysis.aggRunKpiTitle')}</h3>
        <div className="candidate-table-wrap"><table className="candidate-table" data-testid="daily-agg-run-kpi-table">
          <thead><tr><th>kpi</th><th>n</th><th>{t(locale, 'analysis.aggColMean')}</th><th>{t(locale, 'analysis.aggColCi')}</th></tr></thead>
          <tbody>{runRows.map(({ key, label, stat }) => {
            const percent = key.startsWith('retention')
            const fmt = (v: number): string => percent ? fmtPercent(locale, v) : fmtNumber(locale, v, { maxFractionDigits: 4 })
            return <tr key={key} data-kpi={key}>
              <td>{label}</td>
              <td data-field="n" data-value={stat.n}>{stat.n}</td>
              <td data-field="mean" data-value={stat.mean}>{fmt(stat.mean)}</td>
              <td data-field="ci" data-lo={stat.ci95_lo} data-hi={stat.ci95_hi}>{`[${fmt(stat.ci95_lo)}, ${fmt(stat.ci95_hi)}]`}</td>
            </tr>
          })}</tbody>
        </table></div>
      </>}
    </>}
  </section>
}
