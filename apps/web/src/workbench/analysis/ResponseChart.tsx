// WB-02.05 · 响应图:参数响应散点 + 95% CI + 约束/基线参考线。
// 可独立接数据:输入是 points(任意参数域)+ 轴/指标元数据,不依赖
// 演示数据模块。合成数据的"illustrative CI"口径由调用方的 source 标注
// 决定;本组件只画观测点,不做插值(与原型口径一致)。
import type { JSX } from 'react'

export type ResponsePoint = {
  /** 稳定 ID(候选 ID),不用下标 */
  id: string
  x: number
  mean: number
  /** 展示用对称半宽;真实 CI 由 WB-08 适配器给出后替换 */
  ciHalf: number
}

export type ResponseMetricMeta = {
  id: string
  label: string
  unit: string
  min: number
  max: number
  decimals: number
  target?: number
  op?: '≥' | '≤'
  baseline?: number
}

export type ResponseChartProps = {
  metric: ResponseMetricMeta
  xAxis: { label: string; path: string }
  points: readonly ResponsePoint[]
  selectedId: string | null
  onSelect?: (id: string) => void
  mini?: boolean
  sourceTitle?: string
}

const W_MAIN = 870
const H_MAIN = 287
const W_MINI = 420
const H_MINI = 86

export function ResponseChart({
  metric,
  xAxis,
  points,
  selectedId,
  onSelect,
  mini = false,
  sourceTitle,
}: ResponseChartProps): JSX.Element {
  const W = mini ? W_MINI : W_MAIN
  const H = mini ? H_MINI : H_MAIN
  const left = mini ? 35 : 49
  const right = mini ? 13 : 22
  const top = mini ? 9 : 28
  const bottom = mini ? 18 : 48
  const yMin = metric.min
  const yMax = metric.max
  const xMin = points.length > 0 ? Math.min(...points.map((p) => p.x)) : 0
  const xMax = points.length > 0 ? Math.max(...points.map((p) => p.x)) : 1
  const spanX = xMax - xMin || 1
  const x = (v: number): number => left + ((v - xMin) / spanX) * (W - left - right)
  const y = (v: number): number => top + ((yMax - v) / (yMax - yMin || 1)) * (H - top - bottom)
  const ticks = mini ? 2 : 6
  const fmt = (v: number): string => v.toFixed(metric.decimals)

  const gridLines: JSX.Element[] = []
  for (let i = 0; i <= ticks; i++) {
    const val = yMin + (yMax - yMin) * (i / ticks)
    gridLines.push(
      <g key={`grid-${i}`}>
        <line x1={left} x2={W - right} y1={y(val)} y2={y(val)} className="chart-grid" />
        <text x={left - 9} y={y(val) + 4} textAnchor="end" className="chart-text" style={{ fontSize: mini ? 9 : 11 }}>
          {val.toFixed(0)}
          {metric.unit}
        </text>
      </g>,
    )
  }

  const xTickStep = spanX / 6
  const xTicks = points.length > 0
    ? Array.from({ length: 7 }, (_, i) => xMin + xTickStep * i)
    : []

  const target = metric.target
  const passRegion = target !== undefined && metric.op === '≥'
    ? { y: y(target), height: y(target) - top, offset: 0 }
    : target !== undefined
      ? { y: y(yMax), height: H - bottom - y(target), offset: y(target) }
      : null

  const selected = points.find((p) => p.id === selectedId) ?? null

  return (
    <svg
      className={mini ? 'mini-chart' : 'main-chart'}
      viewBox={`0 0 ${W} ${H}`}
      role="group"
      aria-label={`${metric.label}随${xAxis.label}变化,${points.length} 个离散样例候选及其展示用置信区间`}
    >
      <title>{sourceTitle ?? `${metric.label}参数响应图,内置演示数据`}</title>
      {passRegion && <rect x={left} y={passRegion.y} width={W - left - right} height={passRegion.height} fill="#eff7f5" />}
      {gridLines}
      {xTicks.map((v, i) => (
        <g key={`xt-${i}`}>
          <text x={x(v)} y={H - bottom + 17} textAnchor="middle" className="chart-text" style={{ fontSize: mini ? 9 : 11 }}>
            {v.toFixed(0)}
          </text>
          {!mini && <line x1={x(v)} x2={x(v)} y1={top} y2={H - bottom} stroke="#f0f4f5" />}
        </g>
      ))}
      {target !== undefined && (
        <line x1={left} x2={W - right} y1={y(target)} y2={y(target)} stroke="#b48d49" strokeWidth={1} strokeDasharray="4 4" />
      )}
      {!mini && target !== undefined && (
        <>
          <text x={W - right - 3} y={y(target) - 7} textAnchor="end" style={{ fill: '#98713a', font: '10px sans-serif' }}>
            约束 {metric.op} {target}
            {metric.unit}
          </text>
          {metric.baseline !== undefined && (
            <>
              <line x1={left} x2={W - right} y1={y(metric.baseline)} y2={y(metric.baseline)} stroke="#b6c5ce" strokeDasharray="2 4" />
            </>
          )}
          <text x={left} y={14} className="chart-label">
            {metric.id}
            {metric.unit !== '' ? ` / ${metric.unit}` : ''}
          </text>
        </>
      )}
      {selected && !mini && (
        <>
          <rect
            x={x(selected.x) - 13}
            y={top}
            width={26}
            height={H - top - bottom}
            fill="#bc8b2210"
          />
          <line x1={x(selected.x)} x2={x(selected.x)} y1={top} y2={H - bottom} stroke="#c9ad7c" strokeDasharray="3 4" />
        </>
      )}
      {points.map((p) => {
        const isSelected = p.id === selectedId
        const yTop = y(p.mean + p.ciHalf)
        const yBottom = y(p.mean - p.ciHalf)
        return (
          <g
            key={p.id}
            className={`chart-candidate${isSelected ? ' selected' : ''}`}
            role="button"
            tabIndex={onSelect ? 0 : -1}
            data-candidate={p.id}
            aria-label={`${p.id},${xAxis.label} ${p.x},${metric.label} ${fmt(p.mean)}${metric.unit},展示区间 [${fmt(p.mean - p.ciHalf)}, ${fmt(p.mean + p.ciHalf)}]`}
            aria-pressed={isSelected}
            onClick={() => onSelect?.(p.id)}
            onKeyDown={(e) => {
              if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                onSelect(p.id)
              }
            }}
          >
            <title>
              {`${p.id} · ${xAxis.path} ${p.x}\n${metric.label} ${fmt(p.mean)}${metric.unit}\n展示区间 [${fmt(p.mean - p.ciHalf)}, ${fmt(p.mean + p.ciHalf)}]`}
            </title>
            <rect
              x={x(p.x) - 10}
              y={yTop - 8}
              width={20}
              height={Math.max(24, yBottom - yTop + 16)}
              fill="transparent"
            />
            <path
              className="chart-ci"
              d={`M${x(p.x)} ${yTop}V${yBottom}M${x(p.x) - 3} ${yTop}h6M${x(p.x) - 3} ${yBottom}h6`}
            />
            <circle className="chart-point" cx={x(p.x)} cy={y(p.mean)} r={mini ? (isSelected ? 4 : 2.6) : isSelected ? 6 : 4} />
          </g>
        )
      })}
      {!mini && selected && (
        <g pointerEvents="none">
          <rect
            x={Math.min(W - 140, Math.max(left + 5, x(selected.x) + 15))}
            y={Math.max(top + 7, y(selected.mean) - 53)}
            width={117}
            height={39}
            rx={3}
            fill="#fff"
            stroke="#c4d7da"
          />
          <text
            x={Math.min(W - 140, Math.max(left + 5, x(selected.x) + 15)) + 9}
            y={Math.max(top + 7, y(selected.mean) - 53) + 14}
            style={{ fill: '#647b85', font: '10px monospace' }}
          >
            {`${selected.id.slice(0, 11)} · ${xAxis.label} ${selected.x}`}
          </text>
          <text
            x={Math.min(W - 140, Math.max(left + 5, x(selected.x) + 15)) + 9}
            y={Math.max(top + 7, y(selected.mean) - 53) + 29}
            style={{ fill: '#176f73', font: '600 13px monospace' }}
          >
            {fmt(selected.mean) + metric.unit}
          </text>
        </g>
      )}
      {!mini && (
        <text x={(W + left - right) / 2} y={H - 6} textAnchor="middle" className="chart-label">
          {`${xAxis.label} · ${xAxis.path}`}
        </text>
      )}
    </svg>
  )
}
