// 轻量 SVG 折线(与 CLI report 手绘 SVG 同风格;零图表库、零外链)
interface Props {
  title: string
  xs: number[]
  ys: number[]
  fmt?: (v: number) => string
}

const W = 460
const H = 160
const PL = 52
const PR = 12
const PT = 30
const PB = 24

function fmtNum(v: number): string {
  if (v === 0) return '0'
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`
  if (Math.abs(v) >= 10) return v.toFixed(0)
  return v.toFixed(3)
}

export default function LineChart({ title, xs, ys, fmt = fmtNum }: Props) {
  const n = xs.length
  if (n < 2) return null
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const lo = yMin === yMax ? yMin - 1 : yMin - (yMax - yMin) * 0.08
  const hi = yMin === yMax ? yMax + 1 : yMax + (yMax - yMin) * 0.08
  const px = (i: number) => PL + (i / (n - 1)) * (W - PL - PR)
  const py = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB)
  const path = ys.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join('')
  const ticks = [hi, lo + (hi - lo) / 2, lo]

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        <title>{title}</title>
        <text x={(PL + W - PR) / 2} y={16} textAnchor="middle" className="chart-title">
          {title}
        </text>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={py(t)} y2={py(t)} className="grid" />
            <text x={PL - 6} y={py(t) + 3} textAnchor="end" className="tick">
              {fmt(t)}
            </text>
          </g>
        ))}
        <line x1={PL} x2={W - PR} y1={H - PB} y2={H - PB} className="axis" />
        <text x={PL} y={H - 8} className="tick">
          D{xs[0]}
        </text>
        <text x={W - PR} y={H - 8} textAnchor="end" className="tick">
          D{xs[n - 1]}
        </text>
        <path d={path} className="line" />
      </svg>
    </figure>
  )
}
