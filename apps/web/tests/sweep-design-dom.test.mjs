// 扫描设计预演浏览器级走查(WB-12 · todo L364,jsdom + 真内核):
// 设计期预演(离散水平/组合预算/重复候选)与内核 sweep_plan 同账本——
// 预演出的候选数、每轴水平必须与内核计划逐项对齐,否则此测试红。
// 跑法(仓库根,先构建 pkg-node):
//   node --test apps/web/tests/sweep-design-dom.test.mjs
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
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://sandtable.test/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const storage = new Map()
  Object.defineProperty(dom.window, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
  })
  Object.defineProperty(dom.window.navigator, 'language', { configurable: true, value: 'zh-CN' })
  Object.defineProperty(dom.window.navigator, 'languages', { configurable: true, value: ['zh-CN'] })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })

  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { setLocale } = await import('../src/workbench/state/localeStore.ts')
  const { SweepDesignPreview } = await import('../src/workbench/designer/SweepDesignPreview.tsx')
  const wasm = await import(pathToFileURL(pkgNode).href)

  await act(async () => setLocale('zh-CN'))

  const design = (over) => ({
    name: 't', method: 'grid', sampling: 'lhc', samples: 12, reps: 2, targets: [],
    factors: [
      { path: 'model.warrior.attack', min: 90, max: 110, step: 10 },
      { path: 'model.warrior.defense', min: 70, max: 90, step: 10 },
    ],
    ...over,
  })
  const render = async (d, plan) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(SweepDesignPreview, { design: d, plan })) })
    return host
  }

  const YAML = [
    'schema_version: "1"',
    'scenario: {population: 40, duration: "7d", seed: 7}',
    'sweep:',
    '  replicates: 2',
    '  parameters:',
    '    model.warrior.attack: {min: 90, max: 110, step: 10}',
    '    model.warrior.defense: {min: 70, max: 90, step: 10}',
    '  targets:',
    '    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}',
    '',
  ].join('\n')
  const plan = JSON.parse(wasm.sweep_plan(YAML, 0))

  test('预演水平表 = 内核候选逐轴去重值,预算 = 内核候选数', async () => {
    const host = await render(design(), plan)
    const cells = [...host.querySelectorAll('[data-testid="preview-factors"] tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
    for (const row of cells) {
      const path = row[0]
      const kernel = [...new Set(plan.candidates.map((c) => c[path]))].sort((a, b) => a - b)
      assert.equal(row[1], kernel.join(', '), `${path} 水平表应与内核候选值一致`)
      assert.equal(Number(row[2]), kernel.length)
    }
    assert.match(host.querySelector('[data-testid="preview-budget"]').textContent, new RegExp(`组合预算 ${plan.candidates.length} 个候选`))
    // 真实计划无重复参数域 → 如实报「无重复」
    assert.match(host.querySelector('[data-testid="preview-duplicates"]').textContent, /无重复参数域/)
  })

  test('组合预算超内核上限:预演先算账并指出越界因子(不假装可提交)', async () => {
    const many = design({ factors: [
      { path: 'a', min: 0, max: 9, step: 1 },
      { path: 'b', min: 0, max: 9, step: 1 },
      { path: 'c', min: 0, max: 9, step: 1 },
      { path: 'd', min: 0, max: 9, step: 1 },
      { path: 'e', min: 0, max: 9, step: 1 },
    ] })
    const host = await render(many, null)
    const budget = host.querySelector('[data-testid="preview-budget"]').textContent
    assert.match(budget, /组合预算超限:e 一侧累计 10,001 已超过上限 10,000/)
    // 计划未出 → 重复候选如实等待,不猜
    assert.match(host.textContent, /等待内核计划/)
  })

  test('Random 采样:不编造离散水平表,按 samples 报采样预算;非法域仍逐因子报因', async () => {
    const host = await render(design({ method: 'random', samples: 12 }), null)
    assert.match(host.querySelector('[data-testid="preview-budget"]').textContent, /采样预算:12 个候选/)
    assert.match(host.textContent, /连续采样/)
    const bad = await render(design({ method: 'random', samples: 12, factors: [{ path: 'model.warrior.attack', min: 220, max: 20, step: 40 }] }), null)
    assert.match(bad.textContent, /取值域非法/)
    const badSamples = await render(design({ method: 'random', samples: 0 }), null)
    assert.match(badSamples.querySelector('[data-testid="preview-budget"]').textContent, /1…10,000/)
  })
}
