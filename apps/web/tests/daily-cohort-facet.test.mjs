// 逐日 cohort 指标分面守卫(todo L373「群体分面」):真内核 cohort_stats → 模型派生 → jsdom 分面 SVG。
// 红线:单次 run/replicate 原值,不画均值与置信带;cohort_stats 缺席即整组缺席,不虚构群体数值;
// 0 是真实内核值(内核可为某 cohort 返回 count/mean_* = 0),必须原样画出而不是当缺失吞掉。
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'

import { cohortFacetFigures } from '../src/lib/analysisView.ts'
import { en } from '../src/lib/i18n/dict/en.ts'
import { zh } from '../src/lib/i18n/dict/zh.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')
const FIGURE_IDS = ['count', 'churned', 'mean_power', 'mean_gold', 'mean_level']
const COHORT_FACET_KEYS = [
  'analysis.cohortFacetNote',
  'analysis.cohortFacetScope',
  'analysis.cohortFacetAria',
  'analysis.cohortFacetMissing',
  'analysis.cohort.count',
  'analysis.cohort.churned',
  'analysis.cohort.meanPower',
  'analysis.cohort.meanGold',
  'analysis.cohort.meanLevel',
  'analysis.cohortName.casual',
  'analysis.cohortName.core',
  'analysis.cohortName.whale',
]

const runOf = (patch = {}) => ({
  day_stats: [],
  cohort_stats: [
    { cohort: 'casual', count: 12, churned: 1, mean_power: 448, mean_gold: 284.3333333333333, mean_level: 3 },
    { cohort: 'core', count: 8, churned: 0, mean_power: 470, mean_gold: 342.625, mean_level: 3.625 },
    { cohort: 'whale', count: 0, churned: 0, mean_power: 0, mean_gold: 0, mean_level: 0 },
  ],
  power_snapshots: [],
  replicate: 0,
  seed: 42,
  players: 20,
  days: 3,
  ...patch,
})

test('cohort facet model returns one facet per metric with raw kernel values, cohort order fixed', () => {
  const figures = cohortFacetFigures(runOf())
  assert.deepEqual(figures.map((figure) => figure.id), FIGURE_IDS, '一指标一分面,声明顺序')
  for (const figure of figures) {
    assert.equal(figure.bars.length, 3, `${figure.id} 分面 3 个 cohort`)
    assert.deepEqual(figure.bars.map((bar) => bar.cohort), ['casual', 'core', 'whale'], `${figure.id} 分面 cohort 序固定`)
    assert.equal(typeof figure.labelKey, 'string', `${figure.id} 带指标标签 key`)
  }
  const count = figures[0].bars
  const power = figures[2].bars
  assert.deepEqual(count.map((bar) => bar.value), [12, 8, 0], 'count 逐字内核值')
  assert.deepEqual(power.map((bar) => bar.value), [448, 470, 0], 'mean_power 逐字内核值')
})

test('cohort facet model treats 0 as a real kernel value, NaN as missing, and a missing cohort as absent', () => {
  const figures = cohortFacetFigures(runOf())
  const whaleCount = figures[0].bars[2]
  assert.equal(whaleCount.value, 0, '内核返回的 0 是真实值,不当缺失吞掉')
  assert.notEqual(whaleCount.value, null)

  const partial = cohortFacetFigures(runOf({
    cohort_stats: [runOf().cohort_stats[0], runOf().cohort_stats[1]],
  }))
  assert.equal(partial.length, 5, '缺一个 cohort 不减少分面数')
  assert.deepEqual(partial.map((figure) => figure.bars[2].value), [null, null, null, null, null], '缺席 cohort 整列为空')
  assert.equal(partial[0].bars[0].value, 12, '在库 cohort 原值不受影响')

  const nan = cohortFacetFigures(runOf({
    cohort_stats: [
      { cohort: 'casual', count: Number.NaN, churned: 0, mean_power: 448, mean_gold: 284.3333333333333, mean_level: 3 },
    ],
  }))
  assert.equal(nan[0].bars[0].value, null, '非有限值留空,不画 0 条')
  assert.equal(nan[2].bars[0].value, 448, '同一 cohort 内其它字段保留')
})

test('cohort facet model returns nothing when the kernel has no cohort_stats', () => {
  assert.deepEqual(cohortFacetFigures(null), [])
  assert.deepEqual(cohortFacetFigures(runOf({ cohort_stats: [] })), [])
  assert.deepEqual(cohortFacetFigures({ ...runOf(), cohort_stats: undefined }), [])
})

test('cohort facet i18n is complete and locks axis independence, no-CI scope and no fabrication', () => {
  for (const key of COHORT_FACET_KEYS) {
    assert.ok(zh[key], `missing zh translation: ${key}`)
    assert.ok(en[key], `missing en translation: ${key}`)
  }
  for (const locale of [zh, en]) {
    assert.match(locale['analysis.cohortFacetNote'], /不共轴|never share an axis/i, '声明不同单位不共轴')
    assert.match(locale['analysis.cohortFacetScope'], /不画均值与 CI 带|no mean and no CI band/i, '声明单次 run 不套置信带')
    assert.match(locale['analysis.cohortFacetScope'], /单次 run|single run\/replicate/i, '声明口径 = 单次 run/replicate 原值')
    assert.match(locale['analysis.cohortFacetMissing'], /不虚构|never fabricated/i, '缺失即缺席不虚构')
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
  const wasm = await import(pathToFileURL(pkgNode).href)

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
    'scenario: {population: 20, duration: 3d, seed: 42}',
    '',
  ].join('\n')
  const sim = JSON.parse(wasm.run_simulation(KERNEL_YAML, 1))
  const run = sim.results[0]

  test('cohort facet DOM draws one chart per metric with exact kernel bar values', async () => {
    const host = await render({ sim, runId: 'run-cohort-facet', replicate: 0 })
    const charts = host.querySelectorAll('[data-testid="cohort-facet-chart"]')
    assert.equal(charts.length, 5, '一指标一分面')
    assert.deepEqual([...charts].map((chart) => chart.dataset.metric), FIGURE_IDS)
    for (const stats of run.cohort_stats) {
      for (const chart of charts) {
        const bar = chart.querySelector(`[data-testid="cohort-facet-bar"][data-cohort="${stats.cohort}"]`)
        assert.ok(bar, `${chart.dataset.metric} 分面缺 ${stats.cohort} 条`)
        assert.equal(Number(bar.dataset.value), stats[chart.dataset.metric], `${chart.dataset.metric}/${stats.cohort} 逐字内核值`)
      }
    }
    const aria = host.querySelector('.cohort-facet-grid')
    assert.equal(aria.getAttribute('aria-label'), zh['analysis.cohortFacetAria'].replace('{count}', '5'))
    assert.equal(host.querySelectorAll('.cohort-facet').length, 5)
  })

  test('single-run daily section draws no confidence band anywhere (red line)', async () => {
    const host = await render({ sim, runId: 'run-cohort-facet', replicate: 0 })
    assert.equal(host.querySelector('.agg-ci-band'), null, '单次 run 不出现跨 replicate CI 带')
    for (const element of host.querySelectorAll('[class]')) {
      assert.ok(!/band|ci-95|ci95/i.test(element.getAttribute('class')), '单次 run 图元不带 CI/band 语义类名')
    }
    for (const trend of host.querySelectorAll('[data-testid="daily-trend-chart"]')) {
      assert.equal(trend.querySelector('path'), null, '趋势曲线只画折线,不画带')
    }
  })

  test('every daily/cohort chart svg carries mini-chart or sits in a facet card (17x17 icon rule would hide it)', async () => {
    const host = await render({ sim, runId: 'run-cohort-facet', replicate: 0 })
    const tests = [
      ['daily-trend-chart', 5],
      ['daily-distribution-chart', 3],
      ['cohort-facet-chart', 5],
    ]
    for (const [testId, expected] of tests) {
      const charts = host.querySelectorAll(`[data-testid="${testId}"]`)
      assert.equal(charts.length, expected, `${testId} 图数量`)
      for (const chart of charts) {
        assert.match(chart.getAttribute('class'), /mini-chart/,
          `${testId} 图表 svg 缺 mini-chart,会被 17×17 图标规则裁掉`)
      }
    }
  })

  test('cohort facet notes state raw single-run scope and are live in the DOM', async () => {
    const host = await render({ sim, runId: 'run-cohort-facet', replicate: 0 })
    assert.equal(host.querySelector('[data-testid="cohort-facet-note"]').textContent, zh['analysis.cohortFacetNote'])
    assert.equal(host.querySelector('[data-testid="cohort-facet-scope"]').textContent, zh['analysis.cohortFacetScope'])
    assert.match(host.querySelector('[data-testid="cohort-facet-scope"]').textContent, /不画均值与 CI 带/)
  })

  test('missing cohort_stats renders one unavailable alert and fabricates no facet', async () => {
    const host = await render({ sim: { ...sim, results: [{ ...run, cohort_stats: [] }] }, runId: 'run-empty', replicate: 0 })
    const alert = host.querySelector('[data-testid="cohort-facet-unavailable"]')
    assert.equal(alert.getAttribute('role'), 'alert')
    assert.match(alert.textContent, /不可用/)
    assert.match(alert.textContent, /不虚构/)
    assert.match(alert.textContent, /run-empty/)
    assert.equal(host.querySelector('[data-testid="cohort-facet-chart"]'), null)
    assert.equal(host.querySelector('.cohort-facet-grid'), null)
    assert.equal(host.querySelector('[data-testid="daily-cohort-table"]').querySelectorAll('tbody tr').length, 3,
      '原值表仍列 3 个 cohort 行,但每格显示不可用而非 0')
    assert.equal(host.querySelectorAll('[data-testid="daily-cohort-table"] td[data-value]').length, 0,
      '缺失 cohort 不得写出 data-value')
    for (const cell of host.querySelectorAll('[data-testid="daily-cohort-table"] tbody td[data-field]')) {
      assert.match(cell.textContent, /不可用/)
    }
  })

  test('a partially present cohort renders as an empty bar with an unavailable tooltip', async () => {
    const host = await render({
      sim: { ...sim, results: [{ ...run, cohort_stats: run.cohort_stats.slice(0, 2) }] },
      runId: 'run-partial', replicate: 0,
    })
    assert.equal(host.querySelectorAll('[data-testid="cohort-facet-chart"]').length, 5)
    for (const chart of host.querySelectorAll('[data-testid="cohort-facet-chart"]')) {
      const bar = chart.querySelector('[data-testid="cohort-facet-bar"][data-cohort="whale"]')
      assert.equal(bar.getAttribute('data-value'), null, `${chart.dataset.metric} 缺席 cohort 不写 data-value`)
      assert.equal(bar.getAttribute('height'), '0', `${chart.dataset.metric} 缺席 cohort 不出 0 值条`)
      assert.match(bar.querySelector('title').textContent, /不可用/)
      const present = chart.querySelector('[data-testid="cohort-facet-bar"][data-cohort="casual"]')
      assert.equal(Number(present.getAttribute('data-value')), run.cohort_stats[0][chart.dataset.metric])
    }
  })
}
