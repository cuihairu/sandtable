// 跨 replicate 逐日聚合视图守卫(P2):数据只走内核 daily_aggregate。
// 红线:CI 由内核 SampleStats 直出,前端不重算;replicates <2 是内核明确
// 拒绝的契约,UI 先行声明不发无效调用;缺失日/指标显式缺席,禁 0 填。
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'

import { aggregateDailySeries } from '../src/lib/analysisView.ts'
import { en } from '../src/lib/i18n/dict/en.ts'
import { zh } from '../src/lib/i18n/dict/zh.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

const AGG_KEYS = [
  'analysis.aggTitle',
  'analysis.aggNote',
  'analysis.aggNeedMore',
  'analysis.aggLoading',
  'analysis.aggMethod',
  'analysis.aggEmpty',
  'analysis.aggTableTitle',
  'analysis.aggRunKpiTitle',
  'analysis.aggColMean',
  'analysis.aggColCi',
]

test('cross-replicate aggregation i18n is complete in zh and en and keeps the contract wording', () => {
  for (const key of AGG_KEYS) {
    assert.ok(zh[key] && en[key], `missing aggregation translation: ${key}`)
  }
  assert.match(zh['analysis.aggNeedMore'], /≥2/)
  assert.match(zh['analysis.aggNeedMore'], /单次运行不得套置信带/)
  assert.match(en['analysis.aggNeedMore'], /≥2/)
  assert.match(en['analysis.aggNeedMore'], /never gets a confidence band/i)
})

const stat = (mean, lo = mean - 0.1, hi = mean + 0.1) => ({
  n: 2, mean, sd: 0.1, ci95_lo: lo, ci95_hi: hi, min: mean - 0.05, max: mean + 0.05,
})

const AGG = {
  replicates: 2,
  common_days: 2,
  trimmed_days: [],
  trim_warning: '',
  ci_method: 't(df=n-1)',
  sd_method: 'sample',
  day_stats: [
    // day 1 的 win_rate 缺席:该日该键不入点列,不补 0
    { day: 1, active: stat(10), win_rate: stat(0.75) },
    { day: 2, active: stat(12), },
  ],
  retention_d7: stat(0.5, 0.32, 0.68),
}

test('aggregateDailySeries maps kernel stats verbatim and keeps absent days/keys out', () => {
  const series = aggregateDailySeries(AGG)
  assert.equal(series.length, 5, 'DAILY_KPI 五序列都在,缺席日在序列内为空点')
  const active = series.find((s) => s.id === 'active')
  assert.deepEqual(active.points, [
    { day: 1, mean: 10, ci95_lo: 9.9, ci95_hi: 10.1 },
    { day: 2, mean: 12, ci95_lo: 11.9, ci95_hi: 12.1 },
  ])
  const winRate = series.find((s) => s.id === 'win_rate')
  assert.deepEqual(winRate.points, [{ day: 1, mean: 0.75, ci95_lo: 0.65, ci95_hi: 0.85 }],
    'day2 缺 win_rate:该日不出点,不补 0')
  assert.deepEqual(aggregateDailySeries(null), [], '无聚合输出 = 空序列')
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
  const { CrossReplicateSection } = await import('../src/workbench/analysis/CrossReplicateSection.tsx')
  const wasm = await import(pathToFileURL(pkgNode).href)

  await act(async () => setLocale('zh-CN'))
  const render = async (props) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(CrossReplicateSection, props)) })
    await act(async () => { await Promise.resolve() })
    return host
  }
  const KERNEL_YAML = [
    'schema_version: "1"',
    'scenario: {population: 20, duration: "3d", seed: 42}',
    '',
  ].join('\n')
  const sim = JSON.parse(wasm.run_simulation(KERNEL_YAML, 2))
  const kernelAgg = () => JSON.parse(wasm.daily_aggregate(JSON.stringify(sim.results)))

  test('kernel contract: daily_aggregate rejects a single replicate explicitly', () => {
    assert.throws(
      () => wasm.daily_aggregate(JSON.stringify(sim.results.slice(0, 1))),
      /至少需要 2|置信带/,
    )
  })

  test('fewer than 2 replicates declares the contract and never calls the kernel', async () => {
    let calls = 0
    globalThis.__testDailyAggregate = async () => { calls += 1; return kernelAgg() }
    try {
      const host = await render({ results: sim.results.slice(0, 1), runId: 'run-single' })
      const note = host.querySelector('[data-testid="daily-agg-need-more"]')
      assert.match(note.textContent, /≥2/)
      assert.match(note.textContent, /单次运行不得套置信带/)
      assert.match(note.textContent, /当前 1/)
      assert.equal(host.querySelector('[data-testid="daily-agg-chart"]'), null)
      assert.equal(host.querySelector('[data-testid="daily-agg-table"]'), null)
      assert.equal(calls, 0, '<2 replicate 不发内核调用')
      const empty = await render({ results: null, runId: 'run-none' })
      assert.match(empty.querySelector('[data-testid="daily-agg-need-more"]').textContent, /当前 0/)
    } finally {
      delete globalThis.__testDailyAggregate
    }
  })

  test('kernel aggregation renders methods, CI band points, tables and run-level KPIs verbatim', async () => {
    globalThis.__testDailyAggregate = async (results) => JSON.parse(wasm.daily_aggregate(JSON.stringify(results)))
    try {
      const host = await render({ results: sim.results, runId: 'run-agg' })
      const agg = kernelAgg()
      const method = host.querySelector('[data-testid="daily-agg-method"]')
      assert.ok(method.textContent.includes(String(agg.replicates)), 'replicates 来自内核')
      assert.ok(method.textContent.includes(agg.ci_method), 'CI 口径来自内核')
      assert.ok(method.textContent.includes(agg.sd_method), 'sd 口径来自内核')
      assert.equal(host.querySelector('[data-testid="daily-agg-need-more"]'), null)

      const charts = [...host.querySelectorAll('[data-testid="daily-agg-chart"]')]
      assert.ok(charts.length > 0, '有可展示序列')
      assert.ok(host.querySelector('.agg-ci-band'), '3 天序列画内核 95% CI 带')
      for (const chart of charts) {
        const metric = chart.dataset.metric
        // workbench.css 把 .wb-app svg 收成 17×17 图标;图表 svg 必须挂
        // mini-chart 才能按 viewBox 宽度渲染,否则折线与 CI 带整体不可见。
        assert.match(chart.getAttribute('class'), /mini-chart/,
          `${metric} 图表 svg 缺 mini-chart,会被 17×17 图标规则裁掉`)
        const kernelDays = agg.day_stats.filter((d) => d[metric] !== undefined)
        const points = [...chart.querySelectorAll('[data-testid="daily-agg-point"]')]
        assert.equal(points.length, kernelDays.length, `${metric} 缺席日不出点`)
        for (const [index, point] of points.entries()) {
          const stat = kernelDays[index][metric]
          assert.equal(Number(point.dataset.day), kernelDays[index].day)
          assert.equal(Number(point.dataset.mean), stat.mean, `${metric} day${point.dataset.day} 均值逐字内核`)
          assert.equal(Number(point.dataset.lo), stat.ci95_lo)
          assert.equal(Number(point.dataset.hi), stat.ci95_hi)
        }
      }

      const table = host.querySelector('[data-testid="daily-agg-table"]')
      const rows = [...table.querySelectorAll('tbody tr')]
      assert.equal(rows.length, agg.day_stats.length)
      for (const [index, row] of rows.entries()) {
        assert.equal(Number(row.querySelector('td[data-field="day"]').dataset.value), agg.day_stats[index].day)
        for (const cell of row.querySelectorAll('td[data-field]:not([data-field="day"])')) {
          const stat = agg.day_stats[index][cell.dataset.field]
          assert.ok(stat, `${cell.dataset.field} 在该日应有内核统计`)
          assert.equal(Number(cell.dataset.value), stat.mean)
          assert.equal(Number(cell.dataset.lo), stat.ci95_lo)
          assert.equal(Number(cell.dataset.hi), stat.ci95_hi)
        }
      }

      const RUN_LEVEL = ['retention_d1', 'retention_d3', 'retention_d7', 'retention_d14', 'retention_d30', 'gacha_pulls_to_hit', 'loot_gold_per_player']
      const present = RUN_LEVEL.filter((key) => agg[key] !== undefined)
      const kpiRows = [...host.querySelectorAll('[data-testid="daily-agg-run-kpi-table"] tbody tr')]
      assert.equal(kpiRows.length, present.length, '运行级 KPI 行 = 内核真实缺席集合,不造行')
      for (const row of kpiRows) {
        const stat = agg[row.dataset.kpi]
        assert.equal(Number(row.querySelector('td[data-field="mean"]').dataset.value), stat.mean)
        assert.equal(Number(row.querySelector('td[data-field="ci"]').dataset.lo), stat.ci95_lo)
      }
    } finally {
      delete globalThis.__testDailyAggregate
    }
  })
}
