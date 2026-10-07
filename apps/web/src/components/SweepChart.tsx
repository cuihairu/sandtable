// 单轴扫描图(与 CLI report 扫描折线同视觉纪律:手绘 SVG、零图表库、零外链):
// 指标均值折线 + CI95 须 + 候选判定着色 + 推荐带(插值区间)与基线标记。
import type { ConstraintVerdict } from '../lib/types'

interface Props {
  title: string
  xs: number[]
  means: number[]
  los: number[]
  his: number[]
  verdicts: ConstraintVerdict[]
  band: [number, number] | null
  baseline: number
  fmt?: (v: number) => string
}

const W = 640
const H = 220
const PL = 56
const PR = 16
const PT = 30
const PB = 30

function fmtNum(v: number): string {
  if (v === 0) return '0'
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  if (Math.abs(v) >= 10) return v.toFixed(0)
  return v.toFixed(3)
}

export default function SweepChart({
  title,
  xs,
  means,
  los,
  his,
  verdicts,
  band,
  baseline,
  fmt = fmtNum,
}: Props) {
  const n = xs.length
  if (n < 2) return null
  const lo = Math.min(...los)
  const hi = Math.max(...his)
  const span = hi - lo || Math.abs(hi) || 1
  const yLo = lo - span * 0.1
  const yHi = hi + span * 0.1
  const xLo = Math.min(...xs, band ? band[0] : xs[0], baseline)
  const xHi = Math.max(...xs, band ? band[1] : xs[n - 1], baseline)
  const xSpan = xHi - xLo || 1
  const px = (v: number) => PL + ((v - xLo) / xSpan) * (W - PL - PR)
  const py = (v: number) => PT + (1 - (v - yLo) / (yHi - yLo)) * (H - PT - PB)
  const path = means.map((v, i) => `${i ? 'L' : 'M'}${px(xs[i]).toFixed(1)},${py(v).toFixed(1)}`).join('')
  const yTicks = [yHi, yLo + (yHi - yLo) / 2, yLo]

  return (
    <figure className="chart sweep-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <title>{title}</title>
        <text x={(PL + W - PR) / 2} y={16} textAnchor="middle" className="chart-title">
          {title}
        </text>
        {band && (
          <rect
            x={px(band[0])}
            y={PT}
            width={Math.max(px(band[1]) - px(band[0]), 1)}
            height={H - PT - PB}
            className="band"
          />
        )}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={py(t)} y2={py(t)} className="grid" />
            <text x={PL - 6} y={py(t) + 3} textAnchor="end" className="tick">
              {fmt(t)}
            </text>
          </g>
        ))}
        <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} className="axis" />
        {xs.map((v, i) => (
          <g key={xs[i]}>
            <text x={px(v)} y={H - 10} textAnchor="middle" className="tick">
              {fmtNum(v)}
            </text>
            <line
              x1={px(v)}
              x2={px(v)}
              y1={py(los[i])}
              y2={py(his[i])}
              className={verdicts[i] === 'fail' ? 'whisker whisker-fail' : 'whisker'}
            />
            <circle
              cx={px(v)}
              cy={py(means[i])}
              r={3.5}
              className={`dot dot-${verdicts[i]}`}
            />
          </g>
        ))}
        <line x1={px(baseline)} x2={px(baseline)} y1={PT} y2={H - PB} className="baseline" />
        <text x={px(baseline) + 4} y={PT + 10} className="tick">
          基线
        </text>
        <path d={path} className="line" />
      </svg>
    </figure>
  )
}
