// 图表视图缩放交互钩子(TradingView 对标,2026-10-31)。
// 消费纯数学 lib/chartZoom(锚点缩放/clamp/平移/时间轴拖拽/步进),把
// client 事件 → viewBox 像素 → 域更新,供 ScatterChart/ParetoChart 接线。
//
// 红线:
//  - 无修饰滚轮在图表内缩放并 preventDefault 吃掉事件;Ctrl/Cmd+滚轮不接管,
//    交给桌面壳整页缩放(ce5b7e9),二者不得叠加冲突。
//  - 只动视图窗口域,不动数值量纲口径与内核数据。
//
// 事件注记:React 17+ 将 onWheel 挂到根容器为 passive,preventDefault 不生效,
// 故滚轮用原生 addEventListener(wheel, {passive:false});指针/双击/键盘不在此列。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { SVGProps } from 'react'
import {
  type Domain, clampDomain, valueAtPixelY, zoomAtPixel, zoomDomain,
} from '../../lib/chartZoom.ts'

export type ZoomGeom = { W: number; H: number; left: number; right: number; top: number; bottom: number }
export type ZoomPair = { x: Domain; y: Domain }

/** 滚轮灵敏度:deltaY → scale = exp(deltaY * K)(deltaY>0 缩小、<0 放大)。 */
const WHEEL_SCALE_K = 0.0015

export function useChartZoom(opts: {
  bounds: ZoomPair
  geom: ZoomGeom
  minSpanRatio?: number
}): {
  xDomain: Domain
  yDomain: Domain
  bind: SVGProps<SVGSVGElement>
} {
  const { bounds, geom } = opts
  const ratio = opts.minSpanRatio ?? 0.02
  const minSpanX = Math.max((bounds.x.max - bounds.x.min) * ratio, 1e-12)
  const minSpanY = Math.max((bounds.y.max - bounds.y.min) * ratio, 1e-12)

  const [domains, setDomains] = useState<ZoomPair>({ x: bounds.x, y: bounds.y })

  // 数据/轴域变更 → 视图回全幅(React「调整 props 变化时的 state」render 期模式,
  // 用 boundsKey 判断;避免 useEffect 里 setState 级联渲染)。
  const boundsKey = `${bounds.x.min}:${bounds.x.max}:${bounds.y.min}:${bounds.y.max}`
  const [prevBoundsKey, setPrevBoundsKey] = useState(boundsKey)
  if (prevBoundsKey !== boundsKey) {
    setPrevBoundsKey(boundsKey)
    setDomains({ x: bounds.x, y: bounds.y })
  }

  const svgRef = useRef<SVGSVGElement | null>(null)

  // 每次渲染后把最新配置写入 ref(事件处理器读最新值;无 deps → 每渲染刷新,
  // 满足 exhaustive-deps;也为 rAF 合帧提供最新 config)。
  const cfgRef = useRef({ bounds, geom, minSpanX, minSpanY })
  useEffect(() => {
    cfgRef.current = { bounds, geom, minSpanX, minSpanY }
  })

  // 原生非 passive 滚轮监听(React onWheel 是 passive,preventDefault 无效)。
  // 滚轮锚点缩放:光标下数据点不动,scale<1 放大、scale>1 缩小;Ctrl/Cmd 交给壳。
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const h = (ev: WheelEvent): void => {
      if (ev.ctrlKey || ev.metaKey) return
      ev.preventDefault()
      const { bounds, geom, minSpanX, minSpanY } = cfgRef.current
      const rect = el.getBoundingClientRect()
      const vx = (ev.clientX - rect.left) / (rect.width || 1) * geom.W
      const vy = (ev.clientY - rect.top) / (rect.height || 1) * geom.H
      const scale = Math.exp(ev.deltaY * WHEEL_SCALE_K)
      setDomains((prev) => ({
        x: zoomAtPixel(prev.x, bounds.x, vx, geom.left, geom.W - geom.right, scale, minSpanX),
        y: clampDomain(zoomDomain(
          prev.y,
          valueAtPixelY(vy, geom.top, geom.H - geom.bottom, prev.y),
          scale,
        ), bounds.y, minSpanY),
      }))
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [])

  const bind = useMemo<SVGProps<SVGSVGElement>>(() => ({
    ref: svgRef,
    style: { touchAction: 'none' },
  }), [])

  return { xDomain: domains.x, yDomain: domains.y, bind }
}
