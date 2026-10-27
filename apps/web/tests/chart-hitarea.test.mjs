// 图表性能守卫(todo「图表性能」项):真实 Chromium 测量结论先落地再改代码。
// 探针:单轴 grid,1 replicates,40 玩家 7 天,headless Chromium 1440×1200,图宽 635px。
// - 101 候选(攻击力步 2,x=10..210):初渲染 8352 DOM 节点,指标切换/图点选中/
//   表排序/滚动 max 帧 16.8–19.8ms(p50 16.6ms)——渲染不是瓶颈。但 24 viewBox 单位
//   的命中矩形在轴上间距 7.5 时互相压叠:100/100 相邻对重叠,101 个点里 97 个在
//   elementFromPoint 被邻居挡住(连第一个点都点不中)。
// - 195 候选(Web 预算上限 200,候选数 × replicates ≤ 200 由前端守住):15026 DOM
//   节点,帧成本仍稳(p50 16.7ms,单次 p95 尖峰 40.3ms)。轴上间距 3.87,24 宽命中区
//   必然越界。
// 修法:命中区、标记半径、CI 横线都只占相邻点间距,永不越界;间距塌缩时命中区
// 保底 0.5,点中心仍可选中。间距必须在 x() 映射后的 viewBox 坐标里算——用数据步长
// 会把标记缩小 3 倍(攻击力步 2 会被当成 2 而非 7.5),真 Chromium 探针抓到过一次。
// 这里锁:
// - 命中区宽度 = min(24, 轴上相邻点最小间距),间距走 viewBox 坐标,不出数据单位;
// - 每个点的中心只被自己的标记覆盖(可唯一命中,不误点);
// - 输入乱序不影响(间距按 x 排序算);重合 x 时宽度塌到 0.5 下界,
//   不出 NaN / 0 / 负数,点仍在场上(重合本就无从区分,顶层者胜出)。
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const CHART_SOURCE = join(here, '../src/workbench/analysis/ResponseChart.tsx')

test('P3 图表命中区:源码按轴上相邻间距收缩命中区与标记,间距走 viewBox 坐标', () => {
  const src = readFileSync(CHART_SOURCE, 'utf8')
  assert.match(src, /const HIT_WIDTH = 24/, '稀疏命中区宽度为常量,不散落魔法数')
  assert.match(src, /const MARK_RADIUS = 4/, '稀疏标记半径为常量,不散落魔法数')
  assert.match(src, /function adjacentGap\(xs: readonly number\[\]\): number/, '间距函数收坐标数组(非原始数据值)')
  assert.match(src, /adjacentGap\(points\.map\(\(p\) => x\(p\.x\)\)\)/, '间距在 x() 映射后的 viewBox 坐标上算,不拿数据步长当间距')
  assert.match(src, /sorted = \[\.\.\.xs\]\.sort\(\(a, b\) => a - b\)/, '间距按坐标排序(输入乱序不影响)')
  assert.match(src, /Math\.max\(0\.5, Math\.min\(HIT_WIDTH, adjacentGap\(points\.map\(\(p\) => x\(p\.x\)\)\)\)/, '命中区宽度 = min(24, 间距) 且下界 0.5')
  assert.match(src, /Math\.min\(MARK_RADIUS, hitWidth \* 0\.45\)/, '标记半径随命中区收缩,不超过半间距')
  assert.match(src, /Math\.min\(MARK_RADIUS, markRadius \* 1\.5\)/, 'CI 横线半宽随标记收缩,不越到邻点')
  assert.match(src, /width=\{hitWidth\}/, '命中矩形宽度用收缩后的值')
  assert.match(src, /x=\{x\(p\.x\) - hitWidth \/ 2\}/, '命中矩形以点为中心,不偏移到邻点')
  assert.match(src, /r=\{selectedId === p\.id \? markRadius \+ 2 : markRadius\}/, '选中放大基于收缩后的半径')
  assert.match(src, /h\$\{capHalf \* 2\}/, 'CI 横线长度用收缩后的半宽')
})

register(new URL('./workspace-dom-loader.mjs', import.meta.url), pathToFileURL('./'))

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://sandtable.test/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })

const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { setLocale } = await import('../src/workbench/state/localeStore.ts')
const { ResponseChart } = await import('../src/workbench/analysis/ResponseChart.tsx')

await act(async () => setLocale('zh-CN'))

// 命中区间几何对账:点中心被唯一标记覆盖才算可唯一命中。
// SVG viewBox → 屏像素是等比缩放,viewBox 单位不重叠 ⇔ 屏像素不重叠。
// 覆盖来源同时含命中矩形与标记圆(SVG 后画者在上,圆叠住中心同样挡命中)。
const coverageCount = (host) => {
  const elements = [...host.querySelectorAll('[data-candidate] rect')].map((rect) => ({
    id: rect.closest('[data-candidate]').dataset.candidate,
    left: Number(rect.getAttribute('x')),
    right: Number(rect.getAttribute('x')) + Number(rect.getAttribute('width')),
    isRect: true,
  })).concat([...host.querySelectorAll('[data-candidate] circle')].map((circle) => {
    const cx = Number(circle.getAttribute('cx'))
    const r = Number(circle.getAttribute('r'))
    return { id: circle.closest('[data-candidate]').dataset.candidate, left: cx - r, right: cx + r, isRect: false }
  }))
  const centers = [...host.querySelectorAll('[data-candidate] circle')].map((circle) => ({
    id: circle.closest('[data-candidate]').dataset.candidate,
    cx: Number(circle.getAttribute('cx')),
    radius: Number(circle.getAttribute('r')),
  }))
  return centers.map((center) => {
    const ownRect = elements.find((element) => element.isRect && element.id === center.id)
    return {
      id: center.id,
      radius: center.radius,
      rectWidth: ownRect ? ownRect.right - ownRect.left : null,
      covering: [...new Set(elements.filter((element) => center.cx > element.left && center.cx < element.right).map((element) => element.id))].sort(),
    }
  })
}

const metric = { id: 'win_rate', label: '战斗胜率', unit: '%', min: 0, max: 1, decimals: 2 }
const renderChart = async (points, selectedId = null) => {
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(ResponseChart, { metric, xAxis: { label: 'attack', path: 'model.warrior.attack' }, points, selectedId, onSelect: (id) => id }))
  })
  return host
}
// 真实验同款数据坐标:攻击力 10 起、步长 2(101 候选 x=10..210,195 候选 x=10..398)。
// 轴按数据范围精确拉伸到 750 viewBox 单位,等距点的轴上间距恒为 750/(n-1)——
// 与数据步长无关(101 点 → 7.5,195 点 → 3.866),命中区必须收缩到这一间距。
const grid = (n) => Array.from({ length: n }, (_, i) => ({
  id: `cnd_${i}`, x: 10 + i * 2, mean: 0.5, ci95_lo: 0.45, ci95_hi: 0.55,
}))
const axisGap = (n) => 750 / (n - 1)
const near = (actual, expected) => Math.abs(actual - expected) < 1e-9
const onlyOwn = (rows, label) => rows.every((row) => row.covering.length === 1 && row.covering[0] === row.id, `${label}:每个点中心只被自己覆盖(实得 ${rows.slice(0, 2).map((r) => JSON.stringify(r.covering))})`)

test('P3 图表命中区:密集 101 候选(轴上间距 7.5)命中区与标记收缩,每个点唯一可命中', async () => {
  const rows = coverageCount(await renderChart(grid(101)))
  assert.equal(rows.length, 101, '101 个点全在场上')
  assert.ok(rows.every((row) => near(row.rectWidth, 7.5)), `命中区收缩到轴上间距 7.5,而非数据步长 2(实得 ${[...new Set(rows.map((r) => r.rectWidth))]})`)
  assert.ok(rows.every((row) => near(row.radius, 3.375)), `标记半径收缩到 7.5×0.45(实得 ${[...new Set(rows.map((r) => r.radius))]})`)
  assert.ok(onlyOwn(rows, '密集 101 候选'))
})

test('P3 图表命中区:极端密集 195 候选(Web 预算上限,轴上间距 3.866)仍唯一可命中', async () => {
  const gap = axisGap(195)
  const rows = coverageCount(await renderChart(grid(195)))
  assert.equal(rows.length, 195, '195 个点全在场上')
  assert.ok(rows.every((row) => near(row.rectWidth, gap)), `命中区收缩到轴上间距 3.866(实得 ${[...new Set(rows.map((r) => r.rectWidth))]})`)
  assert.ok(rows.every((row) => near(row.radius, gap * 0.45)), `标记半径收缩到间距×0.45=1.740(实得 ${[...new Set(rows.map((r) => r.radius))]})`)
  assert.ok(onlyOwn(rows, '极端密集 195 候选'))
})

test('P3 图表命中区:稀疏点保留全宽命中区与全尺寸标记,不缩成针', async () => {
  const rows = coverageCount(await renderChart(grid(3)))
  assert.equal(rows.length, 3)
  assert.ok(rows.every((row) => near(row.rectWidth, 24)), `轴上间距 375 远大于 24 时保持全宽(实得 ${rows.map((r) => r.rectWidth)})`)
  assert.ok(rows.every((row) => near(row.radius, 4)), '间距远大于半径时保持全尺寸标记')
  assert.ok(onlyOwn(rows, '稀疏点'))
})

test('P3 图表命中区:24 宽度分界线与单点情形', async () => {
  const single = coverageCount(await renderChart(grid(1)))
  assert.ok(near(single[0]?.rectWidth, 24), '单点无邻居,保持全宽')
  assert.ok(near(single[0]?.radius, 4), '单点标记不收缩')

  const hold = coverageCount(await renderChart(grid(32)))
  assert.ok(hold.every((row) => near(row.rectWidth, 24)), `轴上间距 24.19 仍不小于 24,不收缩(实得 ${hold[0]?.rectWidth})`)
  assert.ok(hold.every((row) => near(row.radius, 4)), '未收缩时标记保持全尺寸')

  const shrink = coverageCount(await renderChart(grid(33)))
  assert.ok(shrink.every((row) => near(row.rectWidth, axisGap(33))), `轴上间距 23.4375 越过 24,开始收缩(实得 ${shrink[0]?.rectWidth})`)
  assert.ok(onlyOwn(hold, '间距 24.19') && onlyOwn(shrink, '间距 23.4375'))
})

test('P3 图表命中区:输入乱序不影响间距计算', async () => {
  const ordered = grid(101)
  const a = coverageCount(await renderChart(ordered))
  const b = coverageCount(await renderChart([...ordered].reverse()))
  assert.equal(a.length, b.length, '点数一致')
  // 浮点:同一间距在不同插入顺序下可能有 1e-13 级偏差,按容差逐点比对
  const sameValues = (bVals, aVals, label) => bVals.every((v, i) => near(v, aVals[i]), `${label}与有序一致(首点 ${bVals[0]} vs ${aVals[0]})`)
  assert.ok(sameValues(b.map((r) => r.rectWidth), a.map((r) => r.rectWidth), '乱序输入命中区宽度'), '乱序输入命中区宽度与有序一致')
  assert.ok(sameValues(b.map((r) => r.radius), a.map((r) => r.radius), '乱序输入标记半径'), '乱序输入标记半径与有序一致')
  assert.ok(onlyOwn(a, '有序') && onlyOwn(b, '乱序'))
})

test('P3 图表命中区:重合 x 塌到 0.5 下界,不出 NaN/0/负数', async () => {
  const coincident = [
    { id: 'a', x: 100, mean: 0.4, ci95_lo: 0.35, ci95_hi: 0.45 },
    { id: 'b', x: 100, mean: 0.6, ci95_lo: 0.55, ci95_hi: 0.65 },
  ]
  const rows = coverageCount(await renderChart(coincident))
  assert.equal(rows.length, 2, '重合点不丢弃')
  assert.ok(rows.every((row) => row.rectWidth === 0.5), `重合 x 命中区收缩到下界 0.5(实得 ${rows.map((r) => r.rectWidth)})`)
  assert.ok(rows.every((row) => near(row.radius, 0.225)), `重合 x 标记半径收缩到 0.225(实得 ${rows.map((r) => r.radius)})`)
  assert.ok(rows.every((row) => Number.isFinite(row.rectWidth) && row.rectWidth > 0), '命中区宽度有限且为正')
  assert.ok(rows.every((row) => row.covering.length >= 1), '点仍在可点击区域(同 x 无从区分,顶层者胜出)')
  assert.equal(rows[0]?.covering.length, 2, '重合 x 两个标记互相覆盖,已知退化')
})

test('P3 图表命中区:选中态与键盘属性随收缩后命中区保留', async () => {
  const host = await renderChart(grid(101), 'cnd_5')
  const groups = [...host.querySelectorAll('[data-candidate]')]
  assert.equal(groups.length, 101)
  const pressed = groups.filter((g) => g.getAttribute('aria-pressed') === 'true')
  assert.equal(pressed.length, 1, '选中态唯一')
  assert.equal(pressed[0]?.dataset.candidate, 'cnd_5')
  const rows = coverageCount(host)
  assert.ok(near(rows.find((row) => row.id === 'cnd_5')?.radius, 5.375), '选中点放大 2,基于收缩后的半径')
  assert.ok(rows.filter((row) => row.id !== 'cnd_5').every((row) => near(row.radius, 3.375)), '非选中点半径不变')
  assert.ok(groups.every((g) => g.getAttribute('role') === 'button' && g.getAttribute('tabindex') === '0'), '密集点全部可聚焦(键盘步进不受收缩影响)')
  assert.ok(groups.every((g) => g.querySelector('title') !== null), '密集点全部有 tooltip(精确值可读)')
})
