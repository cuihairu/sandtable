// 专业图型浏览器级走查(WB-12 · todo L365,jsdom + 真内核):
// 真 sweep_plan → 真 sweep_candidate → candidateViews(应用同一条 candidateIdFor)
// → ProChartsSection 真渲染。锁的是渲染层的三条红线:
// ① 缺失候选留空(虚线空格),不 0 填;
// ② 每个可点元素携带内容寻址候选 ID,点击回调即候选表/运行记录同一条 select;
// ③ Random/LHS 计划默认散点,热图只对 Grid 如实出图(否则给出原因,不造格)。
// 跑法(仓库根,先构建 pkg-node):
//   node --test apps/web/tests/pro-charts-dom.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(浏览器级走查在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  register(new URL('./workspace-dom-loader.mjs', import.meta.url), pathToFileURL('./'))
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'https://sandtable.test/',
  })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  globalThis.import_meta_env = { DEV: false }
  const storage = new Map()
  Object.defineProperty(dom.window, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
  })
  Object.defineProperty(dom.window.navigator, 'language', { configurable: true, value: 'zh-CN' })
  Object.defineProperty(dom.window.navigator, 'languages', { configurable: true, value: ['zh-CN'] })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  for (const key of ['Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent']) globalThis[key] = dom.window[key]

  const { createElement, act, Profiler } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { setLocale } = await import('../src/workbench/state/localeStore.ts')
  const { ProChartsSection } = await import('../src/workbench/analysis/ProCharts.tsx')
  const { candidateViews } = await import('../src/lib/sweepView.ts')
  const { paretoFront, oatMatrix } = await import('../src/lib/proChartsModel.ts')
  const { fmtNumber } = await import('../src/lib/i18n/format.ts')
  const { METRIC_META } = await import('../src/lib/metricMeta.ts')
  const { candidateIdFor, hashId, ID_PREFIXES } = await import('../src/workbench/ids.ts')
  const wasm = await import(pathToFileURL(pkgNode).href)

  const EXP2 = (mode = 'grid', samples = 0) => [
    'schema_version: "1"',
    'scenario: {population: 40, duration: "7d", seed: 7}',
    'sweep:',
    `  mode: ${mode}`,
    ...(samples ? [`  samples: ${samples}`] : []),
    '  replicates: 2',
    '  parameters:',
    '    model.warrior.attack: {min: 90, max: 110, step: 10}',
    '    model.warrior.defense: {min: 70, max: 90, step: 10}',
    '  targets:',
    '    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}',
    '',
  ].join('\n')
  const EXP1 = EXP2().replace('    model.warrior.defense: {min: 70, max: 90, step: 10}\n', '')

  const baseline = hashId(ID_PREFIXES.baseline, 'pro-dom', EXP2())
  const derive = (values) => String(candidateIdFor(baseline, values))
  const paint = (yaml, plan) => candidateViews(
    plan,
    plan.candidates.map((c) => JSON.parse(wasm.sweep_candidate(yaml, plan.replicates, JSON.stringify(c)))),
    derive,
  )
  const rowsOf = (plan, views) => {
    const byIndex = new Map(views.map((v) => [v.index, v]))
    return plan.candidates.map((values, index) => ({ id: derive(values), index, values, result: byIndex.get(index) ?? null }))
  }

  await act(async () => setLocale('zh-CN'))

  // 渲染提交计数(React Profiler onRender):rAF 合帧测试用它断言「单次提交」,
  // 而非仅验证「累计收窄」。每次 commit(含初始 mount/复位)递增。
  const renderCount = { n: 0 }
  const onRender = () => { renderCount.n++ }
  const render = async (props) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(createElement(Profiler, { id: 'pro', onRender }, createElement(ProChartsSection, props)))
    })
    return host
  }
  const click = async (node) => {
    await act(async () => { node.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
  }
  const tabs = (host) => Array.from(host.querySelectorAll('[role="tab"]'))
  // rAF 合帧回退 16ms 定时(jsdom 无 global rAF);等待一帧让合帧 flush 提交域
  const frame = () => new Promise((r) => setTimeout(r, 40))

  // —— Grid:9 计划槽只返回 7(后 2 槽未跑完)+ 真推荐(单因子另跑) ——
  const plan = JSON.parse(wasm.sweep_plan(EXP2(), 0))
  const results = plan.candidates.slice(0, 7).map((c) => JSON.parse(wasm.sweep_candidate(EXP2(), plan.replicates, JSON.stringify(c))))
  const views = candidateViews(plan, results, derive)
  const rows = rowsOf(plan, views)
  const plan1 = JSON.parse(wasm.sweep_plan(EXP1, 0))
  const rec = JSON.parse(wasm.sweep_recommend(EXP1, JSON.stringify(plan1.candidates.map((c) => JSON.parse(wasm.sweep_candidate(EXP1, plan1.replicates, JSON.stringify(c)))))))
  const calls = []
  const onSelect = (id) => calls.push(id)
  const host = await render({
    job: { exec: { runId: 'run-pro-dom', recommendation: rec, recommendationError: null } },
    rows, views, plan, selectedId: views[0].id, onSelect,
  })

  test('Grid 热图:7 个已返回格 + 2 个缺失格留空,选中格指回内容寻址 ID', () => {
    assert.equal(host.querySelectorAll('.pro-heat-cell').length, 7)
    assert.equal(host.querySelectorAll('.pro-heat-missing').length, 2)
    const selected = host.querySelectorAll('.pro-heat-cell.selected')
    assert.equal(selected.length, 1)
    assert.equal(selected[0].dataset.candidate, views[0].id)
    // 缺失格不与任何候选 ID 绑定(留空,不是 0 值格)
    assert.equal([...host.querySelectorAll('.pro-heat-missing')].every((n) => !n.dataset.candidate), true)
    // 每格数值 = 内核该候选 win_rate 均值(显示层只做百分比换算)
    const v = views.find((x) => `${x.values['model.warrior.attack']}|${x.values['model.warrior.defense']}` === '90|70')
    const cell = [...host.querySelectorAll('.pro-heat-cell')].find((n) => n.dataset.candidate === v.id)
    const shown = fmtNumber('zh-CN', v.stats.get('win_rate').mean * 100, { maxFractionDigits: METRIC_META.win_rate.decimals })
    assert.ok(cell.textContent.includes(shown), `${cell.textContent} 应含内核均值显示 ${shown}`)
  })

  test('失败点追踪:ok 7 / 未返回 2 如实入表,不补 0', () => {
    const text = host.querySelector('[data-testid="pro-failure-tracking"]').textContent
    assert.match(text, /ok 7/)
    assert.match(text, /未返回 2/)
    assert.match(text, /槽位 7, 8/)
  })

  test('点选热图格 → onSelect 收到内核派生的内容寻址候选 ID', async () => {
    calls.length = 0
    const cell = [...host.querySelectorAll('.pro-heat-cell')].find((n) => n.dataset.candidate !== views[0].id)
    await click(cell)
    assert.deepEqual(calls, [cell.dataset.candidate])
    assert.ok(views.some((v) => v.id === calls[0]))
  })

  test('散点视图:7 个可绘点(连续读同一批内核候选),点选同一 ID 域', async () => {
    await click(tabs(host)[1])
    const points = [...host.querySelectorAll('.pro-scatter-point')]
    assert.equal(points.length, 7)
    // 无失败/缺指标候选时 withheld 为空 → 图中不存在「0 值兜底点」
    assert.equal(points.filter((n) => !n.dataset.candidate).length, 0)
    calls.length = 0
    await click(points[0])
    assert.deepEqual(calls, [points[0].dataset.candidate])
  })

  test('拖拽平移:先滚轮放大,plot 区内拖拽改域(点随内容移动),拖后不误选', async () => {
    await click(tabs(host)[1])
    const svg = host.querySelector('svg.pro-chart')
    assert.ok(svg, '散点 svg 存在')
    // jsdom getBoundingClientRect 全 0 → clientToView 用 (rect.width||1)=1,
    // clientX ∈ [0,1] 线性映射到 viewBox [0,870](y ∈ [0,330])。
    const cxOf = () => [...host.querySelectorAll('.pro-scatter-point')]
      .map((p) => Number(p.querySelector('circle').getAttribute('cx')))
    // ① 滚轮放大(deltaY<0 → 收窄):先放大才平移得动(全幅域下平移被 clamp 锁死)
    await act(async () => {
      svg.dispatchEvent(new dom.window.WheelEvent('wheel', {
        bubbles: true, cancelable: true, deltaY: -400, clientX: 0.5, clientY: 0.5,
      }))
      await frame() // 等 rAF 合帧 flush
    })
    const zoomed = cxOf()
    assert.ok(zoomed.some((cx) => cx !== undefined && true), '放大后可取点')
    // ② 拖左(viewBox 中心 → 左 150px):内容随手指左移 → 点 cx 变小
    const beforePan = cxOf()
    const pev = (type, clientX, clientY) => new dom.window.PointerEvent(type, {
      bubbles: true, cancelable: true, clientX, clientY, button: 0, pointerId: 1,
    })
    await act(async () => {
      svg.dispatchEvent(pev('pointerdown', 465 / 870, 154 / 330))
      svg.dispatchEvent(pev('pointermove', 315 / 870, 154 / 330))
      svg.dispatchEvent(pev('pointerup', 315 / 870, 154 / 330))
      await frame() // 等 rAF 合帧 flush
    })
    const afterPan = cxOf()
    const moved = afterPan.filter((cx, i) => cx !== beforePan[i])
    assert.ok(moved.length > 0, `拖左后点左移: ${beforePan} → ${afterPan}`)
    // ③ 拖后 click 抑制:拖拽释放后紧随的点上 click 不触发 onSelect(误选)
    calls.length = 0
    const aPoint = host.querySelector('.pro-scatter-point')
    await act(async () => {
      aPoint.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    assert.deepEqual(calls, [], '拖拽后的一次 click 被抑制,不误选')
  })

  test('时间轴拖拽缩放:底部 x 轴条拖左收窄(放大),点随锚点扩散', async () => {
    await click(tabs(host)[1])
    const svg = host.querySelector('svg.pro-chart')
    const cxOf = () => [...host.querySelectorAll('.pro-scatter-point')]
      .map((p) => Number(p.querySelector('circle').getAttribute('cx')))
    const before = cxOf()
    // 轴条 viewBox y=300(∈[274,330]) → client y=300/330;x 起点 viewBox 435(中心)
    // 拖左 87px → 收窄,锚=起点;点应扩散(离中心更远)
    const pev = (type, clientX, clientY) => new dom.window.PointerEvent(type, {
      bubbles: true, cancelable: true, clientX, clientY, button: 0, pointerId: 1,
    })
    await act(async () => {
      svg.dispatchEvent(pev('pointerdown', 435 / 870, 300 / 330))
      svg.dispatchEvent(pev('pointermove', 348 / 870, 300 / 330))
      svg.dispatchEvent(pev('pointerup', 348 / 870, 300 / 330))
      await frame() // 等 rAF 合帧 flush
    })
    const after = cxOf()
    const moved = after.filter((cx, i) => cx !== before[i])
    assert.ok(moved.length > 0, `轴条拖左后点扩散: ${before} → ${after}`)
  })

  test('双击复位 + 键盘微调:双击回全幅,键盘 +/- 绕中心缩放、0 复位', async () => {
    await click(tabs(host)[1])
    const svg = host.querySelector('svg.pro-chart')
    const cxOf = () => [...host.querySelectorAll('.pro-scatter-point')]
      .map((p) => Number(p.querySelector('circle').getAttribute('cx')))
    // 前一个测试可能留下缩放(tab 已激活不重挂载)→ 先双击复位取真全幅基线
    await act(async () => {
      svg.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 0.5, clientY: 0.5 }))
    })
    const full = cxOf()
    // 滚轮放大 → 点偏离全幅
    await act(async () => {
      svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -400, clientX: 0.5, clientY: 0.5 }))
      await frame() // 等 rAF 合帧 flush
    })
    assert.ok(cxOf().some((cx, i) => cx !== full[i]), '放大后点偏离全幅')
    // 双击复位 → 回全幅(即时,无合帧)
    await act(async () => {
      svg.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 0.5, clientY: 0.5 }))
    })
    assert.deepEqual(cxOf(), full, '双击后回全幅')
    // 键盘 '+' 放大(svg tabIndex=0 可聚焦)
    await act(async () => {
      svg.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true }))
      await frame() // 等 rAF 合帧 flush
    })
    assert.ok(cxOf().some((cx, i) => cx !== full[i]), '键盘 + 后点偏离全幅')
    // 键盘 '0' 复位(即时,无合帧)
    await act(async () => {
      svg.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: '0', bubbles: true, cancelable: true }))
    })
    assert.deepEqual(cxOf(), full, '键盘 0 后回全幅')
  })

  test('rAF 合帧:一帧内多次滚轮合并为单次提交,域为累计结果', async () => {
    await click(tabs(host)[1])
    const svg = host.querySelector('svg.pro-chart')
    const cxOf = () => [...host.querySelectorAll('.pro-scatter-point')]
      .map((p) => Number(p.querySelector('circle').getAttribute('cx')))
    // 先复位到全幅基线
    await act(async () => {
      svg.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 0.5, clientY: 0.5 }))
    })
    const full = cxOf()
    // 同帧内连发 10 次滚轮(不中途 await 帧)→ 应合并为单帧提交,域累计收窄;
    // 且 setDomains 只被 flush 调一次 → 渲染提交次数增量恰为 1(单次提交)。
    const commitsBefore = renderCount.n
    await act(async () => {
      for (let i = 0; i < 10; i++) {
        svg.dispatchEvent(new dom.window.WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: 0.5, clientY: 0.5 }))
      }
      await frame()
    })
    const commitsAfter = renderCount.n
    const after = cxOf()
    assert.ok(after.some((cx, i) => cx !== full[i]), '10 次滚轮累计收窄(一帧合帧提交)')
    assert.equal(
      commitsAfter - commitsBefore,
      1,
      `10 次滚轮应合并为 1 次渲染提交,实际 ${commitsAfter - commitsBefore} 次`,
    )
    // 再复位验证即时复位
    await act(async () => {
      svg.dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 0.5, clientY: 0.5 }))
    })
    assert.deepEqual(cxOf(), full, '合帧后仍可即时复位')
  })

  test('OAT 矩阵:只画内核给出弹性系数的格,缺失/不可用指标留空', async () => {
    await click(tabs(host)[2])
    const model = oatMatrix(rec.elasticities)
    const covered = model.rows.flatMap((r) => r.cells).filter((c) => c !== null && c.e !== null).length
    const cells = host.querySelectorAll('[data-oat-cell]')
    assert.equal(cells.length, covered)
    // 内核 note=missing_metric(e=null)与未覆盖组合都留空,不明写 0
    const blanks = host.querySelectorAll('[data-oat-blank]')
    assert.equal(blanks.length, model.rows.length * model.metrics.length - covered)
    assert.ok([...blanks].some((n) => n.dataset.oatBlank === 'model.warrior.attack|gacha_pulls_to_hit'))
  })

  test('Pareto:点集 = 可行候选,前沿折线只在 ≥2 点时出现,点选联动', async () => {
    await click(tabs(host)[3])
    const expected = paretoFront(views, 'win_rate', 'gold_per_player', 'max', 'max')
    assert.equal(host.querySelectorAll('.pro-pareto-point').length, expected.feasible.length)
    assert.equal(host.querySelectorAll('.pro-pareto-point.frontier').length, expected.frontier.length)
    assert.equal(host.querySelectorAll('.pro-pareto-front').length, expected.frontier.length > 1 ? 1 : 0)
    calls.length = 0
    const node = host.querySelector('.pro-pareto-point.frontier')
    await click(node)
    assert.deepEqual(calls, [node.dataset.candidate])
  })

  test('Random 计划默认散点;热图如实说明不适用(不造空格)', async () => {
    const rplan = JSON.parse(wasm.sweep_plan(EXP2('random', 6), 0))
    assert.equal(rplan.mode, 'random')
    const rviews = paint(EXP2('random', 6), rplan)
    const rhost = await render({
      job: { exec: { runId: 'run-pro-dom-random', recommendation: null, recommendationError: '内核只支持单参数轴' } },
      rows: rowsOf(rplan, rviews), views: rviews, plan: rplan, selectedId: null, onSelect: () => {},
    })
    // 默认视图 = 散点(连续采样不在网格上)
    assert.equal(rhost.querySelectorAll('.pro-scatter-point').length, rviews.length)
    assert.equal(rhost.querySelectorAll('.pro-heat-cell').length, 0)
    await click(tabs(rhost)[0])
    assert.equal(rhost.querySelectorAll('.pro-heat-cell').length, 0)
    assert.match(rhost.textContent, /离散热图只适用于 Grid/)
    // 推荐不可用 → OAT 不造行
    await click(tabs(rhost)[2])
    assert.equal(rhost.querySelectorAll('[data-oat-cell]').length, 0)
    assert.match(rhost.textContent, /OAT 敏感性矩阵不可用/)
  })
}
