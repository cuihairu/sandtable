import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { useRef, useState } from 'react'
import { GRAPH_EDGES, GRAPH_NODES, graphLayout } from './dependencyGraph.ts'
import type { GraphPos } from './dependencyGraph.ts'
import { useLocale } from '../state/localeStore.ts'

// 模型数据流依赖图(设计器向,ST-WB-011):手绘 SVG(无图库依赖)。
// 节点可拖拽 = 纯视觉整理(位置只在组件状态,不进 scenario/模型)。
// 拖拽用 setPointerCapture + 客户端位移×缩放比换算,viewBox 恒 720×300。

const VIEW_W = 720
const VIEW_H = 300
const NODE_W = 104
const NODE_H = 34

const NODE_LABELS: Record<string, { en: string; zh: string }> = {
  combat: { en: 'Combat', zh: '战斗' },
  economy: { en: 'Economy (gold)', zh: '经济(金币)' },
  gacha: { en: 'Gacha / pity', zh: '抽签/保底' },
  loot: { en: 'Loot tables', zh: '掉落表' },
  training: { en: 'Training', zh: '练级' },
  progression: { en: 'Progression', zh: '成长/升级' },
  churn: { en: 'Churn', zh: '流失' },
}

type DragState = {
  id: string
  startClientX: number
  startClientY: number
  startPos: GraphPos
} | null

export function DependencyGraph(): JSX.Element {
  const locale = useLocale()
  const en = locale.startsWith('en')
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<DragState>(null)
  const [pos, setPos] = useState<Record<string, GraphPos>>(() => graphLayout(VIEW_W, VIEW_H))

  const clamp = (value: number, min: number, max: number): number => Math.min(Math.max(value, min), max)

  const onNodePointerDown = (id: string) => (event: ReactPointerEvent<SVGGElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { id, startClientX: event.clientX, startClientY: event.clientY, startPos: pos[id] }
  }

  const onNodePointerMove = (event: ReactPointerEvent<SVGGElement>): void => {
    const drag = dragRef.current
    const svg = svgRef.current
    if (drag === null || svg === null) return
    const rect = svg.getBoundingClientRect()
    const scale = rect.width === 0 ? 1 : VIEW_W / rect.width
    setPos((prev) => ({
      ...prev,
      [drag.id]: {
        x: clamp(drag.startPos.x + (event.clientX - drag.startClientX) * scale, NODE_W / 2, VIEW_W - NODE_W / 2),
        y: clamp(drag.startPos.y + (event.clientY - drag.startClientY) * scale, NODE_H / 2, VIEW_H - NODE_H / 2),
      },
    }))
  }

  const onNodePointerUp = (): void => { dragRef.current = null }

  return (
    <svg ref={svgRef} className="mini-chart graph-canvas" data-testid="dependency-graph" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img"
      aria-label={en ? 'Model data flow graph' : '模型数据流图'} style={{ touchAction: 'none' }}>
      {GRAPH_EDGES.map((edge) => {
        const from = pos[edge.from]
        const to = pos[edge.to]
        return <line key={`${edge.from}->${edge.to}`} className="graph-edge" data-testid={`graph-edge-${edge.from}-${edge.to}`}
          x1={from.x} y1={from.y} x2={to.x} y2={to.y}>
          <title>{`${edge.from} → ${edge.to} (${edge.label})`}</title>
        </line>
      })}
      {GRAPH_NODES.map((node) => {
        const point = pos[node.id]
        const label = NODE_LABELS[node.id]
        return (
          <g key={node.id} className="graph-node" data-testid={`graph-node-${node.id}`}
            transform={`translate(${point.x},${point.y})`}
            onPointerDown={onNodePointerDown(node.id)}
            onPointerMove={onNodePointerMove}
            onPointerUp={onNodePointerUp}
            onPointerCancel={onNodePointerUp}>
            <rect x={-NODE_W / 2} y={-NODE_H / 2} width={NODE_W} height={NODE_H} rx="6" />
            <text className="graph-node-label" y="5" textAnchor="middle">{label ? (en ? label.en : label.zh) : node.id}</text>
            <title>{label ? (en ? label.en : label.zh) : node.id}</title>
          </g>
        )
      })}
    </svg>
  )
}
