// 自定义 KPI 编辑与呈现守卫(todo L381 批四):表达式在 UI 编辑,校验与求值都进
// 内核(core::kpi_custom)——前端不复制白名单、不重算统计。锁:
// - 界面接内核两桥(validate 先编译、eval 再求值),错误走内核原文;
// - 逐 replicate 值与内核逐字一致;缺席记「不可用」且不带 data-value(缺席 ≠ 0);
// - n_used < 2 不给统计区间;口径行记录 run / schema / sd / ci / 白名单规模,
//   构成可复现要素。
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

import { en } from '../src/lib/i18n/dict/en.ts'
import { zh } from '../src/lib/i18n/dict/zh.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

const KPI_KEYS = [
  'analysis.customKpiTitle',
  'analysis.customKpiNote',
  'analysis.customKpiNeedRun',
  'analysis.customKpiExprAria',
  'analysis.customKpiRun',
  'analysis.customKpiRunning',
  'analysis.customKpiUsedVars',
  'analysis.customKpiPerReplicateAria',
  'analysis.customKpiReplicate',
  'analysis.customKpiValue',
  'analysis.customKpiStats',
  'analysis.customKpiNoStats',
  'analysis.customKpiCaliber',
  'analysis.customKpiVarsHint',
]

test('P2 自定义 KPI 界面:双语词典键齐全(中英镜像)', () => {
  for (const key of KPI_KEYS) {
    assert.ok(key in zh, `zh 缺词条 ${key}`)
    assert.ok(key in en, `en 缺词条 ${key}`)
    assert.ok(zh[key].length > 0, `${key} zh 空串`)
    assert.ok(en[key].length > 0, `${key} en 空串`)
  }
})

test('P2 自定义 KPI 界面:AnalysisPage 挂载小节并喂已跑结果', () => {
  const src = readFileSync(join(here, '../src/workbench/pages/AnalysisPage.tsx'), 'utf8')
  assert.ok(/<CustomKpiSection results=\{sim\?\.results \?\? null\} runId=\{exec\.runId\} \/>/.test(src),
    'AnalysisPage 未按已跑结果的 results + runId 挂载 CustomKpiSection')
  assert.ok(/import \{ CustomKpiSection \} from '\.\.\/analysis\/CustomKpiSection\.tsx'/.test(src), '组件未导入')
})

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(自定义 KPI 界面走查在 CI 构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  register(new URL('./workspace-dom-loader.mjs', import.meta.url), pathToFileURL('./'))

  const wasm = await import(pathToFileURL(pkgNode).href)

  // 真内核结果:7 天 3 replicate(d7 有值)与 3 天 2 replicate(d7 缺席)
  const week = JSON.parse(wasm.run_simulation('schema_version: "1"\nscenario: {population: 40, duration: "7d", seed: 7}\n', 3))
  const short = JSON.parse(wasm.run_simulation('schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\n', 2))

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://sandtable.test/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(dom.window, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} },
  })
  Object.defineProperty(dom.window.navigator, 'language', { configurable: true, value: 'zh-CN' })
  Object.defineProperty(dom.window.navigator, 'languages', { configurable: true, value: ['zh-CN'] })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })

  // 注入同源内核(pkg-node),与 __testDailyAggregate 同一纪律:节点 DOM 测试无法 fetch 浏览器 wasm
  globalThis.__testKpiValidate = async (expression) => JSON.parse(wasm.kpi_validate(expression))
  globalThis.__testKpiEval = async (expression, results) => JSON.parse(wasm.kpi_eval(expression, JSON.stringify(results)))

  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { setLocale } = await import('../src/workbench/state/localeStore.ts')
  const { CustomKpiSection } = await import('../src/workbench/analysis/CustomKpiSection.tsx')

  await act(async () => setLocale('zh-CN'))

  const render = async (results) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(CustomKpiSection, { results, runId: 'run_381' })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    return host
  }

  const typeAndSubmit = async (host, expression) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
    await act(async () => {
      const input = host.querySelector('input[type="text"]')
      setter.call(input, expression)
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      host.querySelector('button[type="submit"]').click()
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 120)) })
  }

  test('DOM:表达式校验 + 求值,逐 replicate 与内核逐字一致,口径行可复现', async () => {
    const host = await render(week.results)
    await typeAndSubmit(host, 'clamp(win_rate, 0, 1) * 2')

    const kernel = JSON.parse(wasm.kpi_eval('clamp(win_rate, 0, 1) * 2', JSON.stringify(week.results)))
    const shape = JSON.parse(wasm.kpi_validate('clamp(win_rate, 0, 1) * 2'))
    assert.equal(host.querySelector('[role="alert"]'), null, '正常路径无 alert')

    assert.deepEqual(shape.used_vars, ['win_rate'])
    assert.ok(host.textContent.includes('引用指标(1)'), 'used_vars 计数上屏')
    assert.ok(host.textContent.includes('win_rate'))

    const table = host.querySelector('table')
    assert.equal(table.getAttribute('aria-label'), '自定义 KPI 逐 replicate 值')
    const cells = Array.from(table.querySelectorAll('tbody tr')).map((row) => row.querySelectorAll('td')[1])
    assert.equal(cells.length, kernel.per_replicate.length, '行数 = replicate 数')
    for (const [index, cell] of cells.entries()) {
      assert.equal(cell.dataset.value, String(kernel.per_replicate[index]), `第 ${index + 1} 行逐字内核值`)
    }

    const note = host.querySelector('.custom-kpi')
    assert.ok(note.textContent.includes(`n=${kernel.stats.n}`), 'n 上屏')
    assert.ok(note.textContent.includes('均值'), '均值上屏')
    assert.ok(note.textContent.includes('95% CI'), 'CI 上屏(内核 SampleStats,前端不重算)')
    assert.ok(note.textContent.includes('run run_381'), '口径行记录 run')
    assert.ok(note.textContent.includes(`schema ${kernel.schema_version}`), '口径行记录 KPI 定义版本')
    assert.ok(note.textContent.includes(`sd ${kernel.sd_method}`), '口径行记录 sd 方法')
    assert.ok(note.textContent.includes(`ci ${kernel.ci_method}`), '口径行记录 ci 方法')
    assert.ok(note.textContent.includes(`白名单 ${kernel.vars.length} 项`), '白名单规模上屏')
    assert.ok(shape.vars.every((name) => note.textContent.includes(name)), '白名单全集逐项上屏')
  })

  test('DOM:校验失败走内核原文,不渲染任何结果', async () => {
    const host = await render(week.results)
    await typeAndSubmit(host, 'win_rates * 2')
    const alert = host.querySelector('[role="alert"]')
    assert.ok(alert, '校验失败出 alert')
    assert.ok(alert.textContent.includes('win_rates'), '内核原文点名具体变量')
    assert.equal(host.querySelector('table'), null, '被拒的表达式不渲染结果表')
    assert.ok(!host.textContent.includes('均值'), '不渲染统计行')
  })

  test('DOM 红线:可用 replicate < 2 不给统计区间(缺席 ≠ 0)', async () => {
    const host = await render(week.results.slice(0, 1))
    await typeAndSubmit(host, 'retention_d7')
    const status = host.querySelector('[role="status"]')
    assert.ok(status, '缺区间出 status 说明')
    assert.match(status.textContent, /1 < 2|不可用|统计区间/)
    assert.ok(!host.textContent.includes('95% CI'), 'n=1 不套置信带')
    const cell = host.querySelector('table tbody tr td:last-child')
    assert.equal(cell.dataset.value, String(JSON.parse(wasm.kpi_eval('retention_d7', JSON.stringify(week.results.slice(0, 1)))).per_replicate[0]))
  })

  test('DOM 红线:指标缺席逐行记不可用且不写 data-value', async () => {
    const host = await render(short.results)
    await typeAndSubmit(host, 'retention_d7')
    const cells = Array.from(host.querySelectorAll('table tbody tr')).map((row) => row.querySelectorAll('td')[1])
    assert.equal(cells.length, short.results.length)
    for (const cell of cells) {
      assert.equal(cell.textContent, '不可用')
      assert.equal(cell.dataset.value, undefined, '缺席不填 0、不造 data-value')
    }
    assert.ok(host.textContent.includes('可用 replicate 0'), 'n_used = 0 明示')
  })

  test('DOM:没有已跑结果时提示并禁用提交', async () => {
    const host = await render(null)
    assert.ok(host.querySelector('[role="status"]'), '无结果提示上屏')
    assert.equal(host.querySelector('button[type="submit"]').disabled, true, '提交按钮禁用')
    assert.equal(host.querySelector('table'), null)
  })
}
