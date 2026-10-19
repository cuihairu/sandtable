// Observed parameter coordinates and asymmetric kernel CI. No interpolated line.
import type { JSX } from 'react'
import { xAxisDomain, stepSelection } from '../../lib/analysisView.ts'
import { fmtNumber, fmtNumberSig } from '../../lib/i18n/format.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type ResponsePoint = {
  id: string; x: number; mean: number
  ci95_lo?: number; ci95_hi?: number
  /** Only the explicitly separated synthetic demo uses symmetric intervals. */
  ciHalf?: number
}
export type ResponseMetricMeta = {
  id: string; label: string; unit: string; min: number; max: number; decimals: number
  target?: number; op?: '≥' | '≤'; baseline?: number
  targets?: readonly { min: number | null; max: number | null; kind: 'hard' | 'soft' }[]
  format?: (value: number) => string
}
export type ResponseChartProps = {
  metric: ResponseMetricMeta; xAxis: { label: string; path: string }
  points: readonly ResponsePoint[]; selectedId: string | null
  onSelect?: (id: string) => void; mini?: boolean; sourceTitle?: string
}
export function ResponseChart({ metric, xAxis, points, selectedId, onSelect, mini = false, sourceTitle }: ResponseChartProps): JSX.Element {
  // WB-11.14:aria/标题/空态随当前语言;label/unit 等显示名由调用方传词典值
  const locale = useLocale()
  const W = 870, H = mini ? 175 : 300
  const left = 95, right = 25, top = 30, bottom = 50
  const domain = xAxisDomain(points.map((p) => p.x))
  const xMin = domain?.min ?? 0, xMax = domain?.max ?? 1
  const x = (v: number): number => left + (v - xMin) / (xMax - xMin) * (W - left - right)
  const y = (v: number): number => top + (metric.max - v) / (metric.max - metric.min || 1) * (H - top - bottom)
  const fmt = metric.format ?? ((v: number) => `${fmtNumber(locale, v, { fractionDigits: metric.decimals })}${metric.unit}`)
  const lo = (p: ResponsePoint): number => p.ci95_lo ?? p.mean - (p.ciHalf ?? 0)
  const hi = (p: ResponsePoint): number => p.ci95_hi ?? p.mean + (p.ciHalf ?? 0)
  const targets = metric.targets ?? (metric.target === undefined ? [] : [{ min: metric.op === '≥' ? metric.target : null, max: metric.op === '≤' ? metric.target : null, kind: 'hard' as const }])
  return <svg className={mini ? 'mini-chart' : 'main-chart'} viewBox={`0 0 ${W} ${H}`} role="group"
    aria-label={t(locale, 'analysis.chart.aria', { label: metric.label, unit: metric.unit, count: points.length, axis: xAxis.path })}>
    <title>{sourceTitle ?? t(locale, 'analysis.chart.title', { label: metric.label })}</title>
    {Array.from({ length: 5 }, (_, i) => {
      const val = metric.min + (metric.max - metric.min) * i / 4
      return <g key={i}><line x1={left} x2={W - right} y1={y(val)} y2={y(val)} className="chart-grid" />
        <text x={left - 8} y={y(val) + 4} textAnchor="end" className="chart-text">{fmt(val)}</text></g>
    })}
    {domain && Array.from({ length: 5 }, (_, i) => {
      const val = xMin + (xMax - xMin) * i / 4
      return <text key={i} x={x(val)} y={H - bottom + 20} textAnchor="middle" className="chart-text">{fmtNumberSig(locale, val, 5)}</text>
    })}
    {targets.flatMap((t, i) => [t.min, t.max].flatMap((v, j) => v === null ? [] : [
      <g key={`${i}-${j}`}><line data-reference="target" x1={left} x2={W - right} y1={y(v)} y2={y(v)} stroke="var(--wb-amber)" strokeDasharray={t.kind === 'hard' ? '5 4' : '2 5'} />
        <title>{`${t.kind} ${j === 0 ? '≥' : '≤'} ${fmt(v)}`}</title></g>,
    ]))}
    {metric.baseline !== undefined && <line data-reference="baseline" x1={left} x2={W - right} y1={y(metric.baseline)} y2={y(metric.baseline)} stroke="var(--wb-muted)" strokeDasharray="3 4"><title>{t(locale, 'analysis.chart.baselineTitle', { value: fmt(metric.baseline) })}</title></line>}
    {points.map((p) => {
      const label = `${p.id} · ${xAxis.path}=${p.x} · ${metric.label} ${fmt(p.mean)} · 95% CI [${fmt(lo(p))}, ${fmt(hi(p))}]`
      return <g key={p.id} className={`chart-candidate${selectedId === p.id ? ' selected' : ''}`} role="button" tabIndex={onSelect ? 0 : -1}
        data-candidate={p.id} aria-label={label} aria-pressed={selectedId === p.id}
        onClick={() => onSelect?.(p.id)} onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(p.id) }
          if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) {
            e.preventDefault()
            const id = stepSelection(points, p.id, e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)
            if (id) { onSelect?.(id); const node = Array.from(e.currentTarget.parentElement!.querySelectorAll<SVGGElement>('[data-candidate]')).find((n) => n.dataset.candidate === id); node?.focus() }
          }
        }}><title>{label}</title>
        <rect x={x(p.x) - 12} y={Math.min(y(hi(p)), y(lo(p))) - 12} width={24} height={Math.max(24, Math.abs(y(lo(p)) - y(hi(p))) + 24)} fill="transparent" />
        <path className="chart-ci" d={`M${x(p.x)} ${y(hi(p))}V${y(lo(p))}M${x(p.x) - 4} ${y(hi(p))}h8M${x(p.x) - 4} ${y(lo(p))}h8`} />
        <circle className="chart-point" cx={x(p.x)} cy={y(p.mean)} r={selectedId === p.id ? 6 : 4} />
      </g>
    })}
    <text x={left} y={16} className="chart-label">{`${metric.label} / ${metric.unit}`}</text>
    <text x={(W + left - right) / 2} y={H - 7} textAnchor="middle" className="chart-label">{xAxis.path}</text>
    {!points.length && <text x={W / 2} y={H / 2} textAnchor="middle" className="chart-text">{t(locale, 'analysis.chart.empty')}</text>}
  </svg>
}
