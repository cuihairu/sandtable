// 逐日分布/分位数守卫:真内核快照 → 模型派生 → jsdom 图表/表格。
// 长尾比只在展示层计算,测试同时锁住“不是置信区间”的文案红线。
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'

import { distributionRows, distributionSeries } from '../src/lib/analysisView.ts'
import { en } from '../src/lib/i18n/dict/en.ts'
import { zh } from '../src/lib/i18n/dict/zh.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')
const DISTRIBUTION_KEYS = [
  'analysis.distributionTitle',
  'analysis.distributionSourceTitle',
  'analysis.distributionNote',
  'analysis.distributionTableTitle',
  'analysis.distributionTableNote',
  'analysis.distributionMissing',
  'analysis.distribution.day',
  'analysis.distribution.n',
  'analysis.distribution.p50',
  'analysis.distribution.p90',
  'analysis.distribution.p99',
  'analysis.distribution.tailP90P50',
  'analysis.distribution.tailP99P90',
]

const runOf = (patch = {}) => ({
  day_stats: [],
  cohort_stats: [],
  power_snapshots: [
    { day: 1, n: 20, p50: 100, p90: 300, p99: 900 },
    { day: 3, n: 20, p50: 200, p90: 1000, p99: 5000 },
  ],
  replicate: 1,
  seed: 42,
  players: 20,
  days: 3,
  ...patch,
})

test('distribution model keeps kernel n and exact quantiles, guards zero and bad snapshots', () => {
  const rows = distributionRows(runOf())
  assert.deepEqual(rows[0], {
    day: 1,
    n: 20,
    p50: 100,
    p90: 300,
    p99: 900,
    tailP90OverP50: 3,
    tailP99OverP90: 3,
  })
  assert.equal(rows[1].tailP90OverP50, 5)
  assert.equal(rows[1].tailP99OverP90, 5)
  const zero = distributionRows(runOf({
    power_snapshots: [{ day: 2, n: 1, p50: 0, p90: 10, p99: 20 }],
  }))[0]
  assert.ok(Number.isNaN(zero.tailP90OverP50), 'p50=0 时 p90/p50 如实 NaN')
  assert.equal(zero.tailP99OverP90, 2)
  const zeroTail = distributionRows(runOf({
    power_snapshots: [{ day: 2, n: 1, p50: 1, p90: 0, p99: 2 }],
  }))[0]
  assert.equal(zeroTail.tailP90OverP50, 0)
  assert.ok(Number.isNaN(zeroTail.tailP99OverP90), 'p90=0 时 p99/p90 如实 NaN')
  assert.deepEqual(distributionRows(runOf({
    power_snapshots: [{ day: 2, n: 1, p50: 1, p90: Number.NaN, p99: 2 }],
  })), [], '非有限内核快照不进入图/表')
  assert.deepEqual(distributionRows(null), [])
  const series = distributionSeries(runOf())
  assert.deepEqual(series.map((item) => item.id), ['p50', 'p90', 'p99'])
  assert.deepEqual(series[2].points, [{ day: 1, value: 900 }, { day: 3, value: 5000 }])
})

test('distribution i18n is complete in zh and en and marks ratios as non-CI', () => {
  for (const key of DISTRIBUTION_KEYS) {
    assert.ok(zh[key] && en[key], `missing distribution translation: ${key}`)
  }
  for (const locale of [zh, en]) {
    assert.match(locale['analysis.distributionNote'], /不是置信区间|not confidence intervals/i)
    assert.match(locale['analysis.distributionTableNote'], /均值|CI|mean/i)
    assert.match(locale['analysis.distributionMissing'], /不虚构|not fabricated|no quantiles/i)
  }
})

if (!existsSync(pkgNode)) {
  test('skip: pkg-node unavailable; model and i18n guards still ran', () => {
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
    value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)) },
  })
  Object.defineProperty(dom.window.navigator, 'language', { configurable: true, value: 'zh-CN' })
  Object.defineProperty(dom.window.navigator, 'languages', { configurable: true, value: ['zh-CN'] })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  globalThis.KeyboardEvent = dom.window.KeyboardEvent

  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { setLocale } = await import('../src/workbench/state/localeStore.ts')
  const { DailyCohortSection } = await import('../src/workbench/analysis/DailyCohortSection.tsx')
  const wasm = await import(pkgNode)

  await act(async () => setLocale('zh-CN'))
  const render = async (props) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(DailyCohortSection, props)) })
    return host
  }
  const KERNEL_YAML = [
    'schema_version: "1"',
    'scenario: {population: 20, duration: "3d", seed: 42}',
    '',
  ].join('\n')
  const sim = JSON.parse(wasm.run_simulation(KERNEL_YAML, 1))
  const run = sim.results[0]

  test('distribution DOM shows exact kernel values, ratios and non-CI note', async () => {
    const host = await render({ sim, runId: 'run-distribution', replicate: 0 })
    assert.equal(host.querySelectorAll('[data-testid="daily-distribution-chart"]').length, 3)
    assert.equal(host.querySelectorAll('[data-testid="daily-distribution-point"]').length, run.power_snapshots.length * 3)
    const table = host.querySelector('[data-testid="daily-distribution-table"]')
    const rows = [...table.querySelectorAll('tbody tr')]
    assert.equal(rows.length, run.power_snapshots.length)
    for (const [index, snapshot] of run.power_snapshots.entries()) {
      const fields = Object.fromEntries([...rows[index].querySelectorAll('td')].map((cell) => [cell.dataset.field, cell.dataset.value]))
      assert.equal(Number(fields.day), snapshot.day)
      assert.equal(Number(fields.n), snapshot.n)
      assert.equal(Number(fields.p50), snapshot.p50)
      assert.equal(Number(fields.p90), snapshot.p90)
      assert.equal(Number(fields.p99), snapshot.p99)
      assert.equal(Number(fields.tailP90OverP50), snapshot.p90 / snapshot.p50)
      assert.equal(Number(fields.tailP99OverP90), snapshot.p99 / snapshot.p90)
    }
    assert.match(host.textContent, /不是置信区间/)
  })

  test('distribution points are keyboard reachable and click or Enter selects with aria-pressed', async () => {
    const host = await render({ sim, runId: 'run-distribution', replicate: 0 })
    const first = host.querySelector('[data-testid="daily-distribution-point"][data-quantile="p99"][data-day="1"]')
    const second = host.querySelector('[data-testid="daily-distribution-point"][data-quantile="p99"][data-day="3"]')
    assert.equal(first.getAttribute('aria-pressed'), 'false')
    assert.equal(second.getAttribute('aria-pressed'), 'true')
    await act(async () => { second.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })) })
    await act(async () => { second.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })) })
    assert.equal(document.activeElement, first)
    assert.equal(first.getAttribute('aria-pressed'), 'true')
    await act(async () => { first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
    assert.equal(first.getAttribute('aria-pressed'), 'true')
    assert.equal(second.getAttribute('aria-pressed'), 'false')
  })

  test('missing power_snapshots renders one unavailable alert and fabricates nothing', async () => {
    const host = await render({ sim: { results: [{ ...run, power_snapshots: [] }] }, runId: 'run-empty', replicate: 0 })
    const alert = host.querySelector('[data-testid="daily-distribution-unavailable"]')
    assert.equal(alert.getAttribute('role'), 'alert')
    assert.match(alert.textContent, /不可用/)
    assert.match(alert.textContent, /不虚构/)
    assert.equal(host.querySelector('[data-testid="daily-distribution-chart"]'), null)
    assert.equal(host.querySelector('[data-testid="daily-distribution-table"]'), null)
    assert.match(host.textContent, /缺内核聚合/)
  })
}
