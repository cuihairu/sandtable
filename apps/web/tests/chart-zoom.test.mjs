// 图表缩放纯数学单测(2026-10-31):锚点缩放 / clamp / 平移边界 / 时间轴拖拽 / 键盘步进。
// 约定:scale<1 收窄(放大)、scale>1 放宽(缩小);锚点相对位置不变;bounds 是全幅。
// 跑法(仓库根):node --test apps/web/tests/chart-zoom.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  clamp, spanOf, zoomDomain, clampDomain, valueAtPixel, valueAtPixelY,
  zoomAtPixel, panByPixels, zoomFromAxisDrag, zoomStep,
} from '../src/lib/chartZoom.ts'

const rel = (d, v) => (v - d.min) / (d.max - d.min)
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

// 典型图:全幅 [0,100],plot 像素区 [90, 840](viewBox W=870,left=90,right=30)
const BOUNDS = { min: 0, max: 100 }
const PLOT_L = 90
const PLOT_R = 840
const PLOT_W = PLOT_R - PLOT_L
const MIN_SPAN = 1

test('clamp: 夹到区间', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-1, 0, 10), 0)
  assert.equal(clamp(11, 0, 10), 10)
})

test('spanOf: 非负跨度', () => {
  assert.equal(spanOf({ min: 0, max: 10 }), 10)
  assert.equal(spanOf({ min: 10, max: 0 }), 0)
})

test('zoomDomain: 锚点相对位置在缩放后不变(收窄 scale<1 与放宽 scale>1)', () => {
  const d = { min: 20, max: 80 }
  const anchor = 50
  for (const scale of [0.5, 2, 1.25]) {
    const z = zoomDomain(d, anchor, scale)
    assert.ok(approx(rel(z, anchor), rel(d, anchor)), `anchor preserved @scale=${scale}`)
    assert.ok(approx(spanOf(z), spanOf(d) * scale), `span × scale @scale=${scale}`)
  }
  // 收窄:span 变小
  assert.ok(spanOf(zoomDomain(d, 50, 0.5)) < spanOf(d))
})

test('zoomDomain: 锚点不在中心也保持(锚=1/4 处)', () => {
  const d = { min: 0, max: 100 }
  const z = zoomDomain(d, 25, 0.5)
  assert.ok(approx(rel(z, 25), 0.25))
  assert.ok(approx(spanOf(z), 50))
})

test('clampDomain: 跨度夹到 [minSpan, bounds 跨度]', () => {
  // 过小跨度 → 抬到 minSpan
  const s1 = clampDomain({ min: 50, max: 50.2 }, BOUNDS, MIN_SPAN)
  assert.ok(approx(spanOf(s1), MIN_SPAN))
  // 过大跨度 → 压到 bounds 跨度
  const s2 = clampDomain({ min: -50, max: 150 }, BOUNDS, MIN_SPAN)
  assert.ok(approx(spanOf(s2), 100))
  assert.deepEqual(s2, BOUNDS)
})

test('clampDomain: 平移边界钳住(域不越出 bounds)', () => {
  // 越左 → 贴左边
  const s = clampDomain({ min: -20, max: 40 }, BOUNDS, MIN_SPAN)
  assert.deepEqual(s, { min: 0, max: 60 })
  // 越右 → 贴右边(span=70)
  const s2 = clampDomain({ min: 60, max: 130 }, BOUNDS, MIN_SPAN)
  assert.deepEqual(s2, { min: 30, max: 100 })
  // 中间不动
  const s3 = clampDomain({ min: 30, max: 70 }, BOUNDS, MIN_SPAN)
  assert.deepEqual(s3, { min: 30, max: 70 })
})

test('clampDomain: 退化 bounds(min==max)返回原样', () => {
  const b = { min: 5, max: 5 }
  assert.deepEqual(clampDomain({ min: 5, max: 5 }, b, 1), b)
})

test('valueAtPixel: 线性像素→值', () => {
  assert.ok(approx(valueAtPixel(PLOT_L, PLOT_L, PLOT_R, BOUNDS), 0))
  assert.ok(approx(valueAtPixel(PLOT_R, PLOT_L, PLOT_R, BOUNDS), 100))
  assert.ok(approx(valueAtPixel((PLOT_L + PLOT_R) / 2, PLOT_L, PLOT_R, BOUNDS), 50))
})

test('valueAtPixelY: y 轴反向(顶=最大值)', () => {
  const T = 34, B = 274 // viewBox H=330, top=34, bottom=56
  assert.ok(approx(valueAtPixelY(T, T, B, BOUNDS), 100))
  assert.ok(approx(valueAtPixelY(B, T, B, BOUNDS), 0))
  assert.ok(approx(valueAtPixelY((T + B) / 2, T, B, BOUNDS), 50))
})

test('zoomAtPixel: 光标处像素的值在缩放后仍在该像素(锚点不动)', () => {
  const px = PLOT_L + PLOT_W * 0.25 // 25% 处,值=25
  const z = zoomAtPixel(BOUNDS, BOUNDS, px, PLOT_L, PLOT_R, 0.5, MIN_SPAN)
  assert.ok(approx(valueAtPixel(px, PLOT_L, PLOT_R, z), 25), '锚值不动')
  assert.ok(approx(spanOf(z), 50), '收窄一半')
})

test('zoomAtPixel: 连续滚轮缩放锚点稳定(多次收窄后光标仍指向同一数据点)', () => {
  const px = PLOT_L + PLOT_W * 0.7 // 70% 处
  let d = BOUNDS
  for (let i = 0; i < 5; i++) d = zoomAtPixel(d, BOUNDS, px, PLOT_L, PLOT_R, 0.6, MIN_SPAN)
  const anchor = valueAtPixel(px, PLOT_L, PLOT_R, BOUNDS) // 原始数据点
  assert.ok(approx(valueAtPixel(px, PLOT_L, PLOT_R, d), anchor, 1e-6), '光标下数据点稳定')
})

test('zoomAtPixel: 缩放极限 clamp(minSpan 与 bounds)', () => {
  // 疯狂收窄 → 到 minSpan
  let d = BOUNDS
  for (let i = 0; i < 100; i++) d = zoomAtPixel(d, BOUNDS, (PLOT_L + PLOT_R) / 2, PLOT_L, PLOT_R, 0.5, MIN_SPAN)
  assert.ok(approx(spanOf(d), MIN_SPAN))
  // 疯狂放宽 → 到 bounds
  let w = { min: 40, max: 60 }
  for (let i = 0; i < 100; i++) w = zoomAtPixel(w, BOUNDS, (PLOT_L + PLOT_R) / 2, PLOT_L, PLOT_R, 2, MIN_SPAN)
  assert.deepEqual(w, BOUNDS)
})

test('panByPixels: 拖右域向左移(内容随手指向右)', () => {
  const d = { min: 20, max: 80 }
  const p = panByPixels(d, BOUNDS, 10, PLOT_W, MIN_SPAN)
  assert.ok(approx(p.min, 20 - (10 / PLOT_W) * 60))
  assert.ok(approx(p.max, 80 - (10 / PLOT_W) * 60))
  // 拖左域向右移
  const q = panByPixels(d, BOUNDS, -10, PLOT_W, MIN_SPAN)
  assert.ok(approx(q.min, 20 + (10 / PLOT_W) * 60))
})

test('panByPixels: 平移边界钳住(拖到尽头域不再动)', () => {
  // 已在最左,继续拖右 → 不动
  const atLeft = { min: 0, max: 60 }
  assert.deepEqual(panByPixels(atLeft, BOUNDS, 500, PLOT_W, MIN_SPAN), atLeft)
  // 已在最右,继续拖左 → 不动
  const atRight = { min: 40, max: 100 }
  assert.deepEqual(panByPixels(atRight, BOUNDS, -500, PLOT_W, MIN_SPAN), atRight)
})

test('panByPixels: 平移保持跨度(不缩放)', () => {
  const d = { min: 20, max: 80 }
  const p = panByPixels(d, BOUNDS, 25, PLOT_W, MIN_SPAN)
  assert.ok(approx(spanOf(p), spanOf(d)))
})

test('zoomFromAxisDrag: 拖左收窄(放大)、拖右放宽(缩小),锚=拖起点', () => {
  const start = PLOT_L + PLOT_W * 0.4 // 起点 40% 处
  // 拖左 50px → 收窄
  const in1 = zoomFromAxisDrag(BOUNDS, BOUNDS, start, start - 50, PLOT_L, PLOT_R, MIN_SPAN)
  assert.ok(spanOf(in1) < 100, '拖左收窄')
  assert.ok(approx(valueAtPixel(start, PLOT_L, PLOT_R, in1), valueAtPixel(start, PLOT_L, PLOT_R, BOUNDS)), '锚点值不动')
  // 拖右 50px → 放宽
  const out1 = zoomFromAxisDrag({ min: 30, max: 70 }, BOUNDS, start, start + 50, PLOT_L, PLOT_R, MIN_SPAN)
  assert.ok(spanOf(out1) > 40, '拖右放宽')
  // 不拖 → 不变
  assert.deepEqual(zoomFromAxisDrag(BOUNDS, BOUNDS, start, start, PLOT_L, PLOT_R, MIN_SPAN), BOUNDS)
})

test('zoomFromAxisDrag: 极限钳住(狂拖不越界)', () => {
  const start = (PLOT_L + PLOT_R) / 2
  // 狂拖左 → 到 minSpan
  let d = BOUNDS
  for (let i = 0; i < 100; i++) d = zoomFromAxisDrag(d, BOUNDS, start, start - 100, PLOT_L, PLOT_R, MIN_SPAN)
  assert.ok(approx(spanOf(d), MIN_SPAN))
  // 狂拖右 → 到 bounds
  let w = { min: 40, max: 60 }
  for (let i = 0; i < 100; i++) w = zoomFromAxisDrag(w, BOUNDS, start, start + 100, PLOT_L, PLOT_R, MIN_SPAN)
  assert.deepEqual(w, BOUNDS)
})

test('zoomStep: 绕中心缩放,scale<1 放大、scale>1 缩小,锚=中心', () => {
  const d = { min: 20, max: 80 }
  const in1 = zoomStep(d, BOUNDS, 1 / 1.25, MIN_SPAN)
  assert.ok(approx(spanOf(in1), 60 / 1.25), '缩小(放大)到 span/1.25')
  assert.ok(approx((in1.min + in1.max) / 2, 50), '中心不动')
  const out1 = zoomStep(d, BOUNDS, 1.25, MIN_SPAN)
  assert.ok(approx(spanOf(out1), 60 * 1.25), '放大(缩小)到 span*1.25')
  // 极限钳住
  let z = d
  for (let i = 0; i < 100; i++) z = zoomStep(z, BOUNDS, 1 / 1.25, MIN_SPAN)
  assert.ok(approx(spanOf(z), MIN_SPAN))
})
