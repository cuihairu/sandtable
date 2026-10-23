import type { JSX } from 'react'
import type { SimOutput } from '../../lib/types.ts'
import {
  DAILY_KPI,
  cohortFacets,
  dailyTrendSeries,
  selectedDailyRun,
} from '../../lib/analysisView.ts'
import type { DailyKpiKey, DailyTrendSeries } from '../../lib/analysisView.ts'
import { KERNEL_SOURCE } from '../../lib/dataSource.ts'
import { fmtNumber, fmtPercent } from '../../lib/i18n/format.ts'
import { t } from '../../lib/i18n/index.ts'
import type { TranslationKey } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

const COHORT_LABEL: Record<'casual' | 'core' | 'whale', TranslationKey> = {
  casual: 'analysis.cohortName.casual',
  core: 'analysis.cohortName.core',
  whale: 'analysis.cohortName.whale',
}

function formatValue(locale: 'zh-CN' | 'en-US', key: DailyKpiKey, value: number): string {
  const percent = key === 'win_rate' || key === 'churn_rate'
  return percent ? fmtPercent(locale, value) : fmtNumber(locale, value, { maxFractionDigits: 2 })
}

function formatExact(value: number): string {
  return String(value)
}

function chartDomain(values: readonly number[]): { min: number; max: number } {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  if (lo === hi) return hi > 0 ? { min: 0, max: hi * 1.05 } : { min: -0.1, max: 0.1 }
  const pad = (hi - lo) * 0.08
  return { min: lo - pad, max: hi + pad }
}

function TrendChart({ locale, series, metric, label, sourceTitle }: {
  locale: 'zh-CN' | 'en-US'
  series: DailyTrendSeries
  metric: DailyKpiKey
  label: string
  sourceTitle: string
}): JSX.Element {
  const width = 520
  const height = 168
  const left = 58
  const right = 12
  const top = 24
  const bottom = 30
  const dayMin = Math.min(...series.points.map((p) => p.day))
  const dayMax = Math.max(...series.points.map((p) => p.day))
  const x0 = series.points.length === 1 ? dayMin - 0.5 : dayMin
  const x1 = series.points.length === 1 ? dayMin + 0.5 : dayMax
  const domain = chartDomain(series.points.map((p) => p.value))
  const x = (day: number): number => left + ((day - x0) / (x1 - x0 || 1)) * (width - left - right)
  const yPos = (value: number): number => top + ((domain.max - value) / (domain.max - domain.min || 1)) * (height - top - bottom)
  const format = (value: number): string => formatValue(locale, metric, value)
  const activeDay = series.points[0]?.day ?? -1

  return <svg data-testid="daily-trend-chart" data-metric={metric} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${label}: ${series.points.length} days`}>
    <title>{sourceTitle}</title>
    {Array.from({ length: 4 }, (_, i) => {
      const value = domain.min + (domain.max - domain.min) * i / 3
      return <g key={i}><line x1={left} x2={width - right} y1={yPos(value)} y2={yPos(value)} className="chart-grid" />
        <text x={left - 8} y={yPos(value) + 4} textAnchor="end" className="chart-text">{format(value)}</text></g>
    })}
    {series.points.length > 1 && <polyline fill="none" className="trend-line" points={series.points.map((p) => `${x(p.day)},${yPos(p.value)}`).join(' ')} />}
    {series.points.map((p) => {
      const pointLabel = `${label} · day ${p.day}: ${format(p.value)}`
      return <g key={p.day}
        className={`daily-trend-point${p.day === activeDay ? ' selected' : ''}`}
        data-testid="daily-trend-point"
        data-metric={metric}
        data-day={p.day}
        data-value={p.value}
        role="button"
        tabIndex={0}
        aria-label={pointLabel}
        aria-pressed={p.day === activeDay}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); return }
          if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return
          event.preventDefault()
          const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
          const index = series.points.findIndex((point) => point.day === p.day)
          const next = series.points[(index + step + series.points.length) % series.points.length]
          const node = event.currentTarget.parentElement!.querySelectorAll<SVGGElement>(
            `[data-testid="daily-trend-point"][data-metric="${metric}"][data-day="${next.day}"]`,
          ).item(0)
          node?.focus()
        }}
      ><title>{pointLabel}</title><circle cx={x(p.day)} cy={yPos(p.value)} r="3" /></g>
    })}
    <text x={left} y={14} className="chart-label">{label}</text>
    <text x={(width + left - right) / 2} y={height - 6} textAnchor="middle" className="chart-text">day</text>
  </svg>
}

export interface DailyCohortSectionProps {
  sim: SimOutput | null
  runId: string
  replicate: number
}

export function DailyCohortSection({ sim, runId, replicate }: DailyCohortSectionProps): JSX.Element {
  const locale = useLocale()
  const run = selectedDailyRun(sim, replicate, runId).run
  const trends = run ? dailyTrendSeries(run) : []
  const cohorts = cohortFacets(run)
  const unavailable = t(locale, 'analysis.unavailable')
  const source = `KERNEL_SOURCE:${KERNEL_SOURCE}`
  const sourceTitle = t(locale, 'analysis.dailySourceTitle', { source, run: runId, replicate })

  return <section data-testid="daily-cohort-section">
    <h2>{t(locale, 'analysis.dailyTrendTitle')}</h2>
    {run ? <p className="note" data-testid="daily-trend-conditions">{t(locale, 'analysis.dailyTrendConditions', {
      run: runId, replicate, seed: run.seed, players: run.players, days: run.days, source,
    })}</p> : <p className="note" role="alert" aria-live="assertive">{t(locale, 'analysis.dailyMissingRun', { run: runId, replicate })}</p>}
    <p className="note">{t(locale, 'analysis.dailyTrendNote')}</p>
    <p className="note" role="status">{t(locale, 'analysis.crossReplicateUnavailable')}</p>
    {run && run.day_stats.length > 0 ? <div className="mini-figures">{trends.map((series) => <div key={series.id} className="mini-figure">
      <TrendChart locale={locale} series={series} metric={series.id} label={t(locale, series.labelKey)} sourceTitle={sourceTitle} />
    </div>)}</div> : <p role="alert" aria-live="assertive" data-testid="daily-trend-unavailable">{t(locale, 'analysis.dailyMissingDays')}</p>}

    {run && run.day_stats.length > 0 && <>
      <h3>{t(locale, 'analysis.dailyTrendDataTableTitle')}</h3>
      <p className="note">{t(locale, 'analysis.dailyTrendDataTableNote')}</p>
      <div className="candidate-table-wrap"><table className="candidate-table" data-testid="daily-trend-table">
        <thead><tr><th>day</th>{DAILY_KPI.map((metric) => <th key={metric.id}>{t(locale, metric.labelKey)}</th>)}</tr></thead>
        <tbody>{run.day_stats.map((row) => <tr key={row.day}>
          <td>{row.day}</td>
          {DAILY_KPI.map((metric) => <td key={metric.id} data-field={metric.id} data-value={row[metric.id]}>{formatExact(row[metric.id])}</td>)}
        </tr>)}</tbody>
      </table></div>
    </>}

    <h2>{t(locale, 'analysis.cohortTitle')}</h2>
    <p className="note">{t(locale, 'analysis.cohortNote', { run: runId, replicate, source })}</p>
    <div className="candidate-table-wrap"><table data-testid="daily-cohort-table"><thead><tr>
      <th>{t(locale, 'analysis.cohort.group')}</th>
      <th>{t(locale, 'analysis.cohort.count')}</th>
      <th>{t(locale, 'analysis.cohort.churned')}</th>
      <th>{t(locale, 'analysis.cohort.meanPower')}</th>
      <th>{t(locale, 'analysis.cohort.meanGold')}</th>
      <th>{t(locale, 'analysis.cohort.meanLevel')}</th>
    </tr></thead><tbody>{cohorts.rows.map((row) => <tr key={row.cohort} data-cohort={row.cohort}>
      <td>{t(locale, COHORT_LABEL[row.cohort])}</td>
      {([[row.count, 'count'], [row.churned, 'churned'], [row.meanPower, 'mean_power'], [row.meanGold, 'mean_gold'], [row.meanLevel, 'mean_level']] as [number | null, string][]).map(([value, field]) => <td key={field} data-field={field} data-value={value ?? undefined}>
        {value === null ? unavailable : formatExact(value)}
      </td>)}</tr>)}</tbody></table></div>
  </section>
}
