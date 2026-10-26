import type { JSX } from 'react'
import type { SimOutput } from '../../lib/types.ts'
import {
  DAILY_KPI,
  cohortFacets,
  cohortFacetFigures,
  dailyTrendSeries,
  distributionRows,
  distributionSeries,
  selectedDailyRun,
} from '../../lib/analysisView.ts'
import type {
  CohortFacetFigure,
  DailyKpiKey,
  DailyTrendSeries,
  DistributionSeries,
} from '../../lib/analysisView.ts'
import { KERNEL_SOURCE } from '../../lib/dataSource.ts'
import { fmtNumber, fmtPercent } from '../../lib/i18n/format.ts'
import { t } from '../../lib/i18n/index.ts'
import type { TranslationKey } from '../../lib/i18n/index.ts'
import { useState } from 'react'
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

  // mini-chart 必须挂:workbench.css 把 .wb-app svg 收成 17×17 图标,不挂会被裁成不可见(同 CrossReplicateSection 教训)。
  return <svg className="mini-chart" data-testid="daily-trend-chart" data-metric={metric} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${label}: ${series.points.length} days`}>
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

function DistributionChart({ locale, series, label, sourceTitle }: {
  locale: 'zh-CN' | 'en-US'
  series: DistributionSeries
  label: string
  sourceTitle: string
}): JSX.Element {
  const [selectedDay, setSelectedDay] = useState<number | undefined>()
  const activeDay = selectedDay ?? series.points.at(-1)?.day
  const width = 520
  const height = 168
  const left = 58
  const right = 12
  const top = 24
  const bottom = 30
  const dayMin = Math.min(...series.points.map((point) => point.day))
  const dayMax = Math.max(...series.points.map((point) => point.day))
  const x0 = series.points.length === 1 ? dayMin - 0.5 : dayMin
  const x1 = series.points.length === 1 ? dayMin + 0.5 : dayMax
  const domain = chartDomain(series.points.map((point) => point.value))
  const x = (day: number): number => left + ((day - x0) / (x1 - x0 || 1)) * (width - left - right)
  const y = (value: number): number => top + ((domain.max - value) / (domain.max - domain.min || 1)) * (height - top - bottom)

  // 同上:mini-chart 缺挂会被 17×17 图标规则裁掉,分位曲线整体不可见。
  return <svg className="mini-chart" data-testid="daily-distribution-chart" data-quantile={series.id} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${label}: ${series.points.length} days`}>
    <title>{sourceTitle}</title>
    {[0, 1, 2, 3].map((index) => {
      const value = domain.min + (domain.max - domain.min) * index / 3
      return <g key={index}>
        <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="chart-grid" />
        <text x={left - 8} y={y(value) + 4} textAnchor="end" className="chart-text">{fmtNumber(locale, value, { maxFractionDigits: 2 })}</text>
      </g>
    })}
    {series.points.length > 1 && <polyline fill="none" className="trend-line" points={series.points.map((point) => `${x(point.day)},${y(point.value)}`).join(' ')} />}
    {series.points.map((point) => {
      const pointLabel = `${label} · day ${point.day}: ${fmtNumber(locale, point.value, { maxFractionDigits: 6 })}`
      const selected = point.day === activeDay
      return <g key={point.day} className={`daily-trend-point${selected ? ' selected' : ''}`}
        data-testid="daily-distribution-point" data-quantile={series.id} data-day={point.day} data-value={point.value}
        role="button" tabIndex={0} aria-label={pointLabel} aria-pressed={selected}
        onClick={() => setSelectedDay(point.day)}
        onFocus={() => setSelectedDay(point.day)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedDay(point.day); return }
          if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return
          event.preventDefault()
          const index = series.points.findIndex((candidate) => candidate.day === point.day)
          const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
          const next = series.points[(index + step + series.points.length) % series.points.length]
          event.currentTarget.parentElement?.querySelector<SVGGElement>(
            `[data-testid="daily-distribution-point"][data-quantile="${series.id}"][data-day="${next.day}"]`,
          )?.focus()
        }}
      ><title>{pointLabel}</title><circle cx={x(point.day)} cy={y(point.value)} r="3" /></g>
    })}
    <text x={left} y={14} className="chart-label">{label}</text>
    <text x={(width + left - right) / 2} y={height - 6} textAnchor="middle" className="chart-text">day</text>
  </svg>
}

function CohortFacetChart({ locale, figure, sourceTitle }: {
  locale: 'zh-CN' | 'en-US'
  figure: CohortFacetFigure
  sourceTitle: string
}): JSX.Element {
  const width = 520
  const height = 168
  const left = 58
  const right = 12
  const top = 24
  const bottom = 30
  const maxValue = Math.max(...figure.bars.map((bar) => bar.value ?? 0))
  // 同一物理量内的 cohort 共轴;不同指标分面轴域独立计算,不与其他单位混轴
  const domain: { min: number; max: number } = maxValue === 0
    ? { min: 0, max: 1 }
    : { min: 0, max: maxValue * 1.05 }
  const y = (value: number): number => top + ((domain.max - value) / domain.max) * (height - top - bottom)
  const label = t(locale, figure.labelKey)
  const format = (value: number): string => fmtNumber(locale, value, { maxFractionDigits: 2 })
  const barWidth = (width - left - right) / figure.bars.length * 0.48
  const centers = figure.bars.map((_, index) => {
    const slot = (width - left - right) / figure.bars.length
    return left + slot * (index + 0.5)
  })

  // 分面卡片内同靠 .cohort-facet svg 撑满;再挂 mini-chart 与趋势/分布图同一纪律,防 17×17 裁剪。
  return <svg className="mini-chart" data-testid="cohort-facet-chart" data-metric={figure.id} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${label}: ${figure.bars.length} cohorts`}>
    <title>{sourceTitle}</title>
    {[0, 1, 2, 3].map((index) => {
      const value = domain.max * index / 3
      return <g key={index}>
        <line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="chart-grid" />
        <text x={left - 8} y={y(value) + 4} textAnchor="end" className="chart-text">{format(value)}</text>
      </g>
    })}
    {figure.bars.map((bar, index) => {
      const barLabel = t(locale, bar.labelKey)
      const pointLabel = `${label} · ${barLabel}: ${bar.value === null ? t(locale, 'analysis.unavailable') : format(bar.value)}`
      return <g key={bar.cohort} data-cohort={bar.cohort}>
        <rect
          data-testid="cohort-facet-bar"
          data-metric={figure.id}
          data-cohort={bar.cohort}
          data-value={bar.value ?? undefined}
          x={centers[index] - barWidth / 2}
          y={bar.value === null ? y(0) : y(bar.value)}
          width={barWidth}
          height={bar.value === null ? 0 : y(0) - y(bar.value)}
        >
          <title>{pointLabel}</title>
        </rect>
        <text x={centers[index]} y={height - 10} textAnchor="middle" className="chart-text">{barLabel}</text>
      </g>
    })}
    <text x={left} y={14} className="chart-label">{label}</text>
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
  const cohortFigures = cohortFacetFigures(run)
  const distribution = distributionRows(run)
  const distributionCharts = distributionSeries(run)
  const unavailable = t(locale, 'analysis.unavailable')
  const source = `KERNEL_SOURCE:${KERNEL_SOURCE}`
  const sourceTitle = t(locale, 'analysis.dailySourceTitle', { source, run: runId, replicate })

  return <section data-testid="daily-cohort-section">
    <h2>{t(locale, 'analysis.dailyTrendTitle')}</h2>
    {run ? <p className="note" data-testid="daily-trend-conditions">{t(locale, 'analysis.dailyTrendConditions', {
      run: runId, replicate, seed: run.seed, players: run.players, days: run.days, source,
    })}</p> : <p className="note" role="alert" aria-live="assertive">{t(locale, 'analysis.dailyMissingRun', { run: runId, replicate })}</p>}
    <p className="note">{t(locale, 'analysis.dailyTrendNote')}</p>
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

    <h2>{t(locale, 'analysis.distributionTitle')}</h2>
    <p className="note" data-testid="daily-distribution-source">{t(locale, 'analysis.distributionSourceTitle', { source, run: runId, replicate })}</p>
    <p className="note">{t(locale, 'analysis.distributionNote')}</p>
    {distribution.length > 0 ? <>
      <div className="mini-figures">{distributionCharts.map((series) => <div key={series.id} className="mini-figure">
        <DistributionChart locale={locale} series={series} label={t(locale, series.labelKey)} sourceTitle={sourceTitle} />
      </div>)}</div>
      <h3>{t(locale, 'analysis.distributionTableTitle')}</h3>
      <p className="note">{t(locale, 'analysis.distributionTableNote')}</p>
      <div className="candidate-table-wrap"><table className="candidate-table" data-testid="daily-distribution-table">
        <thead><tr>
          <th>{t(locale, 'analysis.distribution.day')}</th>
          <th>{t(locale, 'analysis.distribution.n')}</th>
          <th>{t(locale, 'analysis.distribution.p50')}</th>
          <th>{t(locale, 'analysis.distribution.p90')}</th>
          <th>{t(locale, 'analysis.distribution.p99')}</th>
          <th>{t(locale, 'analysis.distribution.tailP90P50')}</th>
          <th>{t(locale, 'analysis.distribution.tailP99P90')}</th>
        </tr></thead>
        <tbody>{distribution.map((row) => <tr key={row.day}>
          <td data-field="day" data-value={row.day}>{formatExact(row.day)}</td>
          <td data-field="n" data-value={row.n}>{formatExact(row.n)}</td>
          <td data-field="p50" data-value={row.p50}>{formatExact(row.p50)}</td>
          <td data-field="p90" data-value={row.p90}>{formatExact(row.p90)}</td>
          <td data-field="p99" data-value={row.p99}>{formatExact(row.p99)}</td>
          <td data-field="tailP90OverP50" data-value={row.tailP90OverP50}>{formatExact(row.tailP90OverP50)}</td>
          <td data-field="tailP99OverP90" data-value={row.tailP99OverP90}>{formatExact(row.tailP99OverP90)}</td>
        </tr>)}</tbody>
      </table></div>
    </> : <p className="note" role="alert" aria-live="assertive" data-testid="daily-distribution-unavailable">{t(locale, 'analysis.distributionMissing')}</p>}

    <h2>{t(locale, 'analysis.cohortTitle')}</h2>
    <p className="note">{t(locale, 'analysis.cohortNote', { run: runId, replicate, source })}</p>
    <p className="note" data-testid="cohort-facet-note">{t(locale, 'analysis.cohortFacetNote')}</p>
    <p className="note" data-testid="cohort-facet-scope">{t(locale, 'analysis.cohortFacetScope')}</p>
    {cohortFigures.length > 0 ? <div className="cohort-facet-grid" role="group" aria-label={t(locale, 'analysis.cohortFacetAria', { count: cohortFigures.length })}>
      {cohortFigures.map((figure) => <figure key={figure.id} className="cohort-facet" data-metric={figure.id}>
        <CohortFacetChart locale={locale} figure={figure} sourceTitle={sourceTitle} />
      </figure>)}
    </div> : <p className="note" role="alert" aria-live="assertive" data-testid="cohort-facet-unavailable">{t(locale, 'analysis.cohortFacetMissing', { run: runId, replicate })}</p>}
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
