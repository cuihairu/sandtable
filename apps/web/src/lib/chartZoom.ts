// 图表视图缩放纯数学(TradingView 对标,2026-10-31)。
// 全部为纯函数,可单测——锚点缩放 / clamp / 平移边界 / 时间轴拖拽 / 键盘步进。
// 红线:只做「视图窗口」缩放,不动数值量纲口径(METRIC_META/formatMetric 不在此);
// 不动内核 elasticities 与数据口径。桌面 Ctrl+滚轮整页缩放(ce5b7e9)由壳处理,
// 图表 wheel 处理只接管无修饰滚轮并 preventDefault(见 useChartZoom)。
//
// 域约定:1D 连续域 {min, max}(min < max);bounds = 数据/轴全幅,既是最大视野
// 也是平移与缩放-out 的边界;minSpan = 最小可视跨度(缩放-in 极限)。
//
// scale 约定:scale = 新跨度/旧跨度。scale<1 = 收窄(放大),scale>1 = 放宽(缩小),
// scale=1 = 不变。所有「缩放因子」参数均按此约定(滚轮 deltaY>0 → scale>1 → 缩小,
// deltaY<0 → scale<1 → 放大;时间轴拖左 → 收窄,拖右 → 放宽)。

export type Domain = { min: number; max: number }

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

const SPAN_EPS = 1e-12

/** 域跨度(非负) */
export function spanOf(d: Domain): number {
  return Math.max(0, d.max - d.min)
}

/** 缩放,anchor 保持不动(锚点相对位置不变);scale<1 收窄(放大),scale>1 放宽(缩小)。 */
export function zoomDomain(d: Domain, anchor: number, scale: number): Domain {
  return {
    min: anchor - (anchor - d.min) * scale,
    max: anchor + (d.max - anchor) * scale,
  }
}

/**
 * 把域钳制在 bounds 内:跨度 ∈ [minSpan, bounds 跨度],域不越出 bounds。
 * 平移边界与缩放极限都落在这里(先钳跨度,再按中心钳平移位置)。
 */
export function clampDomain(d: Domain, bounds: Domain, minSpan: number): Domain {
  const boundsSpan = bounds.max - bounds.min
  if (boundsSpan <= SPAN_EPS) return { min: bounds.min, max: bounds.max }
  const span = clamp(spanOf(d), minSpan, boundsSpan)
  const center = (d.min + d.max) / 2
  const min = clamp(center - span / 2, bounds.min, bounds.max - span)
  return { min, max: min + span }
}

/** 线性像素→值(plot 区 [plotLeft, plotRight])。 */
export function valueAtPixel(px: number, plotLeft: number, plotRight: number, d: Domain): number {
  const t = (px - plotLeft) / (plotRight - plotLeft || 1)
  return d.min + t * (d.max - d.min)
}

/** y 轴反向像素→值(SVG y 向下,plot 顶=最大值;plot 区 [plotTop, plotBottom])。 */
export function valueAtPixelY(px: number, plotTop: number, plotBottom: number, d: Domain): number {
  const t = (px - plotTop) / (plotBottom - plotTop || 1)
  return d.max - t * (d.max - d.min)
}

/** 滚轮锚点缩放:以光标所在像素位置的值为锚,按 scale 收/放宽窗口。 */
export function zoomAtPixel(
  d: Domain, bounds: Domain, px: number,
  plotLeft: number, plotRight: number, scale: number, minSpan: number,
): Domain {
  const anchor = valueAtPixel(px, plotLeft, plotRight, d)
  return clampDomain(zoomDomain(d, anchor, scale), bounds, minSpan)
}

/** 平移:pixelDelta 为 viewBox 像素位移(拖右为正),域反向移动,到边界钳住。 */
export function panByPixels(
  d: Domain, bounds: Domain, pixelDelta: number, plotWidth: number, minSpan: number,
): Domain {
  const span = spanOf(d)
  const delta = -(pixelDelta / (plotWidth || 1)) * span
  return clampDomain({ min: d.min + delta, max: d.max + delta }, bounds, minSpan)
}

/** 时间轴拖拽缩放:底部轴从 startPx 拖到 curPx,锚=拖起点;拖左收窄(放大)、拖右放宽(缩小)。 */
export function zoomFromAxisDrag(
  d: Domain, bounds: Domain, startPx: number, curPx: number,
  plotLeft: number, plotRight: number, minSpan: number,
): Domain {
  const plotWidth = plotRight - plotLeft
  const scale = plotWidth / (plotWidth - (curPx - startPx))
  return zoomAtPixel(d, bounds, startPx, plotLeft, plotRight, scale, minSpan)
}

/** 键盘步进:绕域中心按 scale 缩放(scale<1 放大、scale>1 缩小;如 +/- 微调)。 */
export function zoomStep(d: Domain, bounds: Domain, scale: number, minSpan: number): Domain {
  const center = (d.min + d.max) / 2
  return clampDomain(zoomDomain(d, center, scale), bounds, minSpan)
}
