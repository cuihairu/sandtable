// WB-08.14 · 经济、掉落与抽卡分析(P2):数据只走内核 daily_aggregate,CI 由
// 内核 SampleStats 口径直出;前端不重算、不 0 填、绝不给单次运行套置信带
// (<2 replicate 是内核明确拒绝的契约,UI 先行声明,不发无效调用)。
// 产出/消耗是流量、存量是当日收盘 G(d)、吸收比与通胀是比率、人均按当日活跃
// 人数 —— 量级不同,每口径一张图单轴呈现,不做双轴。掉落切片与抽卡 E[T] 是
// 运行级标量,按数值行加口径注呈现;内核从未产出的量只列不可用与原因。
import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { ECONOMY_CALIBER_LABEL, ECONOMY_DAILY, economyDailySeries, economyRows, economyUnavailable } from '../../lib/economyView.ts'
import type { EconomySeries } from '../../lib/economyView.ts'
import type { DailyAggregation, RunMetrics } from '../../lib/types.ts'
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

/** 经济图:单口径单轴,均值折线 + 内核 95% CI 带;缺席日不出点(不补 0)。 */
function EconomyChart({ locale, series, sourceTitle }: {
  locale: 'zh-CN' | 'en-US'
  series: EconomySeries
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
  const label = `${t(locale, series.labelKey)} · ${t(locale, ECONOMY_CALIBER_LABEL[series.caliber])}`

  // mini-chart 必须挂:workbench.css 把 .wb-app svg 收成 17×17 图标,
  // 不挂类的图表 SVG 会被裁成 17×17 折线与 CI 带全看不见。
  return <svg className="mini-chart" data-testid="economy-chart" data-metric={series.id} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${points.length} days`}>
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
      return <circle key={p.day} data-testid="economy-point" data-metric={series.id} data-day={p.day}
        data-mean={p.mean} data-lo={p.ci95_lo} data-hi={p.ci95_hi} cx={x(p.day)} cy={y(p.mean)} r="3">
        <title>{pointLabel}</title>
      </circle>
    })}
    <text x={left} y={14} className="chart-label">{label}</text>
    <text x={(width + left - right) / 2} y={height - 6} textAnchor="middle" className="chart-text">day</text>
  </svg>
}

export interface EconomySectionProps {
  /** 当前 run(或当前臂)已跑完的 replicate 结果;<2 时只声明契约,不调用内核 */
  results: RunMetrics[] | null
  runId: string
}

export function EconomySection({ results, runId }: EconomySectionProps): JSX.Element {
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
  const series = economyDailySeries(agg).filter((s) => s.points.length > 0)
  const rows = economyRows(agg)
  const unavailableItems = economyUnavailable(agg)
  const sourceTitle = t(locale, 'analysis.econ.title')
  const rowFmt = (value: number): string => fmtNumber(locale, value, { maxFractionDigits: 4 })

  return <section data-testid="economy-analysis-section" data-run-id={runId}>
    <h3>{t(locale, 'analysis.econ.title')}</h3>
    <p className="note">{t(locale, 'analysis.econ.note')}</p>
    {!hasEnough && <p className="note" role="status" data-testid="economy-need-more">{t(locale, 'analysis.aggNeedMore', { n: results?.length ?? 0 })}</p>}
    {hasEnough && error !== null && <p className="note" role="alert" aria-live="assertive" data-testid="economy-error">{localizeWasmErrorText(locale, error).text}</p>}
    {hasEnough && loading && <p className="note" data-testid="economy-loading">{t(locale, 'analysis.aggLoading')}</p>}
    {hasEnough && agg !== null && <>
      {series.length > 0 && <>
        <h3>{t(locale, 'analysis.econ.dailyTitle')}</h3>
        <div className="mini-figures" data-testid="economy-figures">{series.map((s) => <div key={s.id} className="mini-figure">
          <EconomyChart locale={locale} series={s} sourceTitle={sourceTitle} />
        </div>)}</div>
        <h3>{t(locale, 'analysis.econ.tableTitle')}</h3>
        <div className="candidate-table-wrap"><table className="candidate-table" data-testid="economy-daily-table">
          <thead><tr><th>day</th>{ECONOMY_DAILY.map((m) => <th key={m.id}>{t(locale, m.labelKey)}</th>)}</tr></thead>
          <tbody>{agg.day_stats.map((row) => <tr key={row.day}>
            <td data-field="day" data-value={row.day}>{row.day}</td>
            {ECONOMY_DAILY.map((m) => {
              const stat = row[m.id]
              return <td key={m.id} data-field={m.id}
                data-value={stat?.mean} data-lo={stat?.ci95_lo} data-hi={stat?.ci95_hi}>
                {stat ? `${fmtValue(locale, m.percent, stat.mean)} [${fmtValue(locale, m.percent, stat.ci95_lo)}, ${fmtValue(locale, m.percent, stat.ci95_hi)}]` : unavailable}
              </td>
            })}
          </tr>)}</tbody>
        </table></div>
      </>}
      <h3>{t(locale, 'analysis.econ.rowsTitle')}</h3>
      <div className="candidate-table-wrap"><table className="candidate-table" data-testid="economy-slice-table">
        <thead><tr><th>{t(locale, 'analysis.econ.colMetric')}</th><th>{t(locale, 'analysis.econ.colCaliber')}</th><th>n</th><th>{t(locale, 'analysis.aggColMean')}</th><th>{t(locale, 'analysis.aggColCi')}</th></tr></thead>
        <tbody>{rows.map((row) => {
          const stat = row.stat
          return <tr key={row.id} data-kpi={row.id}>
            <td>{t(locale, row.labelKey)}</td>
            <td data-caliber={row.caliber}>{t(locale, ECONOMY_CALIBER_LABEL[row.caliber])}</td>
            <td data-field="n" data-value={stat?.n}>{stat?.n ?? unavailable}</td>
            <td data-field="mean" data-value={stat?.mean}>{stat ? rowFmt(stat.mean) : unavailable}</td>
            <td data-field="ci" data-lo={stat?.ci95_lo} data-hi={stat?.ci95_hi}>{stat ? `[${rowFmt(stat.ci95_lo)}, ${rowFmt(stat.ci95_hi)}]` : unavailable}</td>
          </tr>
        })}</tbody>
      </table></div>
      {rows.filter((row) => row.stat !== null).map((row) => <p key={row.id} className="note"
        data-testid={`economy-${row.id}-note`}>{t(locale, row.noteKey)}</p>)}
      <h3>{t(locale, 'analysis.econ.unavailableTitle')}</h3>
      <ul data-testid="economy-unavailable-list">{unavailableItems.map((item) => <li key={item.id} data-item={item.id}>
        {t(locale, item.labelKey)}:{t(locale, item.reasonKey)}
      </li>)}</ul>
    </>}
  </section>
}
