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
// 平移用增量 delta(每 move 相对上一位置),避免绝对 delta × functional setState
// 双重计位;y 轴 top=max 反转,拖下 → 域值增;plot 区内才可平移;拖后抑制一次
// click(防拖拽误选数据点);平移边界 clamp 在 lib/chartZoom.panByPixels。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, SVGProps } from 'react'
import {
  type Domain, clampDomain, panByPixels, valueAtPixelY,
  zoomAtPixel, zoomDomain, zoomFromAxisDrag, zoomStep,
} from '../../lib/chartZoom.ts'

export type ZoomGeom = { W: number; H: number; left: number; right: number; top: number; bottom: number }
export type ZoomPair = { x: Domain; y: Domain }

/** 滚轮灵敏度:deltaY → scale = exp(deltaY * K)(deltaY>0 缩小、<0 放大)。 */
const WHEEL_SCALE_K = 0.0015
/** 键盘 +/- 每按缩放因子(scale<1 放大、>1 缩小,对应 1/1.25 与 1.25)。 */
const KEY_STEP = 1.25
/** 拖拽超过该像素视为平移(否则按点击,不抑制后续 click)。 */
const PAN_DRAG_PX = 3

export function useChartZoom(opts: {
  bounds: ZoomPair
  geom: ZoomGeom
  minSpanRatio?: number
}): {
  xDomain: Domain
  yDomain: Domain
  panning: boolean
  axisDragging: boolean
  bind: SVGProps<SVGSVGElement>
} {
  const { bounds, geom } = opts
  const ratio = opts.minSpanRatio ?? 0.02
  const minSpanX = Math.max((bounds.x.max - bounds.x.min) * ratio, 1e-12)
  const minSpanY = Math.max((bounds.y.max - bounds.y.min) * ratio, 1e-12)

  const [domains, setDomains] = useState<ZoomPair>({ x: bounds.x, y: bounds.y })
  const [panning, setPanning] = useState(false)

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

  // —— 指针分区:plot 区 = 平移,底部 x 轴条 = 时间轴拖拽缩放 ——
  const [axisDragging, setAxisDragging] = useState(false)
  const modeRef = useRef<'none' | 'pan' | 'axis'>('none')
  const panStart = useRef<{ vx: number; vy: number } | null>(null)
  const panLast = useRef<{ vx: number; vy: number } | null>(null)
  const panMoved = useRef(false)
  const axisStart = useRef<number | null>(null)

  const clientToView = useCallback((clientX: number, clientY: number, el: SVGSVGElement): { vx: number; vy: number } => {
    const rect = el.getBoundingClientRect()
    return {
      vx: (clientX - rect.left) / (rect.width || 1) * geom.W,
      vy: (clientY - rect.top) / (rect.height || 1) * geom.H,
    }
  }, [geom.W, geom.H])

  const inPlot = useCallback((vx: number, vy: number): boolean => (
    vx >= geom.left && vx <= geom.W - geom.right &&
    vy >= geom.top && vy <= geom.H - geom.bottom
  ), [geom.left, geom.right, geom.top, geom.bottom, geom.W, geom.H])

  const onPointerDown = useCallback((e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const { vx, vy } = clientToView(e.clientX, e.clientY, e.currentTarget)
    // 底部 x 轴条(plot 之下)→ 时间轴拖拽缩放;否则 plot 区 → 平移
    if (vx >= geom.left && vx <= geom.W - geom.right && vy >= geom.H - geom.bottom) {
      modeRef.current = 'axis'
      axisStart.current = vx
      setAxisDragging(true)
      e.currentTarget.setPointerCapture?.(e.pointerId)
      return
    }
    if (!inPlot(vx, vy)) return
    modeRef.current = 'pan'
    panStart.current = { vx, vy }
    panLast.current = { vx, vy }
    panMoved.current = false
    setPanning(true)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }, [clientToView, inPlot, geom.left, geom.right, geom.W, geom.bottom, geom.H])

  const onPointerMove = useCallback((e: PointerEvent<SVGSVGElement>) => {
    const { vx, vy } = clientToView(e.clientX, e.clientY, e.currentTarget)
    // 时间轴拖拽缩放:锚=拖起点,拖左收窄(放大)、拖右放宽(缩小)
    if (modeRef.current === 'axis') {
      if (axisStart.current === null) return
      const { bounds, minSpanX, geom } = cfgRef.current
      setDomains((prev) => ({
        ...prev,
        x: zoomFromAxisDrag(prev.x, bounds.x, axisStart.current!, vx, geom.left, geom.W - geom.right, minSpanX),
      }))
      return
    }
    // 拖拽平移:增量 delta;y 轴 top=max 反转(拖下 → 域值增)
    const last = panLast.current
    if (!last || modeRef.current !== 'pan') return
    const dx = vx - last.vx
    const dy = vy - last.vy
    panLast.current = { vx, vy }
    if (panStart.current && Math.hypot(vx - panStart.current.vx, vy - panStart.current.vy) > PAN_DRAG_PX) {
      panMoved.current = true
    }
    if (dx === 0 && dy === 0) return
    const { bounds, minSpanX, minSpanY, geom } = cfgRef.current
    const pw = geom.W - geom.left - geom.right
    const ph = geom.H - geom.top - geom.bottom
    setDomains((prev) => ({
      x: panByPixels(prev.x, bounds.x, dx, pw, minSpanX),
      y: panByPixels(prev.y, bounds.y, -dy, ph, minSpanY),
    }))
  }, [clientToView])

  const onPointerUp = useCallback((e: PointerEvent<SVGSVGElement>) => {
    const wasDragging = panMoved.current
    modeRef.current = 'none'
    axisStart.current = null
    panStart.current = null
    panLast.current = null
    panMoved.current = false
    setPanning(false)
    setAxisDragging(false)
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    // 拖拽后抑制紧随的一次 click(防误选数据点);click 未跟随则超时兜底移除
    if (wasDragging) {
      const el = e.currentTarget
      const handler = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault() }
      el.addEventListener('click', handler, { capture: true, once: true })
      setTimeout(() => el.removeEventListener('click', handler, { capture: true }), 400)
    }
  }, [])

  const onPointerCancel = useCallback(() => {
    modeRef.current = 'none'
    axisStart.current = null
    panStart.current = null
    panLast.current = null
    panMoved.current = false
    setPanning(false)
    setAxisDragging(false)
  }, [])

  // —— 复位:双击回全幅;键盘 +/- 绕中心微调、0/Home 复位 ——
  const onDoubleClick = useCallback(() => {
    setDomains({ x: cfgRef.current.bounds.x, y: cfgRef.current.bounds.y })
  }, [])

  const onKeyDown = useCallback((e: KeyboardEvent<SVGSVGElement>) => {
    const { bounds, minSpanX, minSpanY } = cfgRef.current
    if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      setDomains((prev) => ({
        x: zoomStep(prev.x, bounds.x, 1 / KEY_STEP, minSpanX),
        y: zoomStep(prev.y, bounds.y, 1 / KEY_STEP, minSpanY),
      }))
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault()
      setDomains((prev) => ({
        x: zoomStep(prev.x, bounds.x, KEY_STEP, minSpanX),
        y: zoomStep(prev.y, bounds.y, KEY_STEP, minSpanY),
      }))
    } else if (e.key === '0' || e.key === 'Home') {
      e.preventDefault()
      setDomains({ x: bounds.x, y: bounds.y })
    }
  }, [])

  const bind = useMemo<SVGProps<SVGSVGElement>>(() => ({
    ref: svgRef,
    tabIndex: 0,
    style: { touchAction: 'none', cursor: axisDragging ? 'ew-resize' : panning ? 'grabbing' : 'grab' },
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    onKeyDown,
  }), [panning, axisDragging, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick, onKeyDown])

  return { xDomain: domains.x, yDomain: domains.y, panning, axisDragging, bind }
}
