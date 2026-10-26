// 经济 / 掉落 / 抽卡分析守卫(P2):数据只走内核 daily_aggregate。
// 红线:CI 由内核 SampleStats 直出,前端不重算;replicates <2 是内核明确拒绝
// 的契约,UI 先行声明不发无效调用;缺失日/指标显式缺席,禁 0 填;不同口径
// (流量/存量/比率/人均)量级不同,各成一图不共轴;内核从未产出的量(保底
// 分布、逐日抽卡、逐日掉落)只报不可用与原因,不造替代数字。
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'

import { ECONOMY_CALIBER_LABEL, ECONOMY_DAILY, ECONOMY_ROWS, economyDailySeries, economyRows, economyUnavailable } from '../src/lib/economyView.ts'
import { en } from '../src/lib/i18n/dict/en.ts'
import { zh } from '../src/lib/i18n/dict/zh.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

const UI_KEYS = [
  'analysis.econ.title',
  'analysis.econ.note',
  'analysis.econ.dailyTitle',
  'analysis.econ.tableTitle',
  'analysis.econ.rowsTitle',
  'analysis.econ.colMetric',
  'analysis.econ.colCaliber',
  'analysis.econ.unavailableTitle',
]

const stat = (mean, lo = mean - 0.1, hi = mean + 0.1) => ({
  n: 2, mean, sd: 0.1, ci95_lo: lo, ci95_hi: hi, min: mean - 0.05, max: mean + 0.05,
})

// 手造聚合:day 1 无 G(d−1) 故 inflation 缺席;income/spending 整键缺席
const AGG = {
  replicates: 2,
  common_days: 2,
  trimmed_days: [],
  trim_warning: '',
  ci_method: 't(df=n-1)',
  sd_method: 'sample',
  day_stats: [
    { day: 1, gold_earned: stat(100), gold_spent: stat(80), gold_supply: stat(200), sink_ratio: stat(0.8) },
    { day: 2, gold_earned: stat(120), gold_spent: stat(90), gold_supply: stat(230), sink_ratio: stat(0.75), inflation: stat(0.15, 0.1, 0.2) },
  ],
}

const AGG_WITH_OPTIONAL = { ...AGG, gacha_pulls_to_hit: stat(8.5), loot_gold_per_player: stat(1200) }

test('economy i18n is complete in zh and en, with no orphan or missing copy', () => {
  const consumed = new Set(UI_KEYS)
  for (const metric of ECONOMY_DAILY) consumed.add(metric.labelKey)
  for (const row of ECONOMY_ROWS) {
    consumed.add(row.labelKey)
    consumed.add(row.noteKey)
  }
  for (const key of Object.values(ECONOMY_CALIBER_LABEL)) consumed.add(key)
  for (const item of economyUnavailable(AGG)) {
    consumed.add(item.labelKey)
    consumed.add(item.reasonKey)
  }
  for (const key of consumed) {
    assert.ok(zh[key] && en[key], `中英文案缺: ${key}`)
    assert.ok(zh[key].length > 0 && en[key].length > 0, `空文案: ${key}`)
  }
  for (const key of Object.keys(zh).filter((k) => k.startsWith('analysis.econ.'))) {
    assert.ok(consumed.has(key), `孤儿 econ 文案: ${key}`)
  }
})

test('economy copy keeps the source, caliber and unavailability contract wording', () => {
  assert.match(zh['analysis.econ.note'], /内核 daily_aggregate/)
  assert.match(zh['analysis.econ.note'], /不共轴/)
  assert.match(zh['analysis.econ.note'], /不补 0/)
  assert.match(en['analysis.econ.note'], /daily_aggregate/)
  assert.match(en['analysis.econ.note'], /never filled with 0/i)
  assert.match(zh['analysis.econ.lootNote'], /不可相加/)
  assert.match(zh['analysis.econ.gachaNote'], /不是逐玩家抽数分布/)
  assert.match(zh['analysis.econ.pityDistReason'], /E\[T\]/)
  assert.match(zh['analysis.econ.day1InflationReason'], /整键缺席而非 0/)
  assert.match(zh['analysis.econ.gachaDailyReason'], /day=0/)
})

test('economyDailySeries copies kernel stats verbatim and keeps absent days out', () => {
  const series = economyDailySeries(AGG)
  assert.equal(series.length, ECONOMY_DAILY.length, '声明的口径全在')
  const earned = series.find((s) => s.id === 'gold_earned')
  assert.deepEqual(earned.points, [
    { day: 1, mean: 100, ci95_lo: 99.9, ci95_hi: 100.1 },
    { day: 2, mean: 120, ci95_lo: 119.9, ci95_hi: 120.1 },
  ])
  assert.deepEqual(series.find((s) => s.id === 'inflation').points,
    [{ day: 2, mean: 0.15, ci95_lo: 0.1, ci95_hi: 0.2 }],
    'day 1 无 G(d−1):该日不出点,不补 0')
  assert.deepEqual(series.find((s) => s.id === 'income_per_active').points, [],
    '整键缺席 = 空序列,不造 0 点')
  assert.deepEqual(economyDailySeries(null), [], '无聚合输出 = 空序列')
})

test('unconfigured gacha/loot stay null and every absence gets a reason', () => {
  assert.equal(economyRows(AGG).length, ECONOMY_ROWS.length, '口径行不随数据缺席而消失')
  assert.ok(economyRows(AGG).every((row) => row.stat === null), '未配置系统 → null,不是 0')
  assert.equal(economyRows(AGG_WITH_OPTIONAL).filter((row) => row.stat !== null).length, 2)

  const ids = economyUnavailable(AGG).map((item) => item.id)
  for (const id of ['pity_distribution', 'gacha_daily', 'loot_daily', 'day1_inflation', 'gacha_off', 'loot_off']) {
    assert.ok(ids.includes(id), `不可用原因缺 ${id}`)
  }
  assert.equal(economyUnavailable(AGG_WITH_OPTIONAL).filter((item) => item.id === 'gacha_off' || item.id === 'loot_off').length, 0,
    '配置了就报数值,不再报未配置')
  assert.equal(economyUnavailable(null).length, 4, '无聚合结果只列结构性缺席')
  assert.ok(economyUnavailable(AGG).every((item) => item.labelKey && item.reasonKey))
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
  const { EconomySection } = await import('../src/workbench/analysis/EconomySection.tsx')
  const wasm = await import(pathToFileURL(pkgNode).href)

  await act(async () => setLocale('zh-CN'))
  const render = async (props) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(EconomySection, props)) })
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
  const unavailableText = zh['analysis.unavailable']

  test('fewer than 2 replicates declares the contract and never calls the kernel', async () => {
    let calls = 0
    globalThis.__testDailyAggregate = async () => { calls += 1; return kernelAgg() }
    try {
      const host = await render({ results: sim.results.slice(0, 1), runId: 'run-econ-single' })
      const note = host.querySelector('[data-testid="economy-need-more"]')
      assert.match(note.textContent, /≥2/)
      assert.match(note.textContent, /当前 1/)
      assert.equal(host.querySelector('[data-testid="economy-chart"]'), null)
      assert.equal(host.querySelector('[data-testid="economy-daily-table"]'), null)
      assert.equal(host.querySelector('[data-testid="economy-unavailable-list"]'), null)
      assert.equal(calls, 0, '<2 replicate 不发内核调用')
      const empty = await render({ results: null, runId: 'run-econ-none' })
      assert.match(empty.querySelector('[data-testid="economy-need-more"]').textContent, /当前 0/)
    } finally {
      delete globalThis.__testDailyAggregate
    }
  })

  test('kernel economy series render one axis per caliber with verbatim means, CIs and tables', async () => {
    globalThis.__testDailyAggregate = async (results) => JSON.parse(wasm.daily_aggregate(JSON.stringify(results)))
    try {
      const host = await render({ results: sim.results, runId: 'run-econ-agg' })
      const agg = kernelAgg()

      const charts = [...host.querySelectorAll('[data-testid="economy-chart"]')]
      const expected = ECONOMY_DAILY.filter((metric) => agg.day_stats.some((day) => day[metric.id] !== undefined))
      assert.equal(charts.length, expected.length, '整键缺席的口径不画空图')
      assert.ok(charts.length > 0, '真内核有可展示经济序列')
      assert.ok(host.querySelector('.agg-ci-band'), '≥2 天序列画内核 95% CI 带')

      for (const chart of charts) {
        const metric = chart.dataset.metric
        const spec = ECONOMY_DAILY.find((m) => m.id === metric)
        assert.ok(spec, `${metric} 图来自声明口径`)
        // workbench.css 把 .wb-app svg 收成 17×17 图标;图表 svg 必须挂
        // mini-chart 才能按 viewBox 宽度渲染,否则折线与 CI 带整体不可见。
        assert.match(chart.getAttribute('class'), /mini-chart/,
          `${metric} 图表 svg 缺 mini-chart,会被 17×17 图标规则裁掉`)
        assert.ok(chart.getAttribute('aria-label').includes(zh[spec.labelKey]), `${metric} 图上标名`)
        assert.ok(chart.getAttribute('aria-label').includes(zh[ECONOMY_CALIBER_LABEL[spec.caliber]]),
          `${metric} 图上标出口径,不与其他口径同轴`)
        const kernelDays = agg.day_stats.filter((day) => day[metric] !== undefined)
        const points = [...chart.querySelectorAll('[data-testid="economy-point"]')]
        assert.equal(points.length, kernelDays.length, `${metric} 缺席日不出点`)
        for (const [index, point] of points.entries()) {
          const stat = kernelDays[index][metric]
          assert.equal(Number(point.dataset.day), kernelDays[index].day)
          assert.equal(Number(point.dataset.mean), stat.mean, `${metric} day${point.dataset.day} 均值逐字内核`)
          assert.equal(Number(point.dataset.lo), stat.ci95_lo)
          assert.equal(Number(point.dataset.hi), stat.ci95_hi)
        }
      }

      const table = host.querySelector('[data-testid="economy-daily-table"]')
      const rows = [...table.querySelectorAll('tbody tr')]
      assert.equal(rows.length, agg.day_stats.length)
      for (const [index, row] of rows.entries()) {
        assert.equal(Number(row.querySelector('td[data-field="day"]').dataset.value), agg.day_stats[index].day)
        for (const cell of row.querySelectorAll('td[data-field]:not([data-field="day"])')) {
          const stat = agg.day_stats[index][cell.dataset.field]
          if (stat === undefined) {
            assert.equal(cell.textContent, unavailableText, `${cell.dataset.field} 缺席日显示不可用,不补 0`)
            continue
          }
          assert.equal(Number(cell.dataset.value), stat.mean)
          assert.equal(Number(cell.dataset.lo), stat.ci95_lo)
          assert.equal(Number(cell.dataset.hi), stat.ci95_hi)
        }
      }
    } finally {
      delete globalThis.__testDailyAggregate
    }
  })

  test('run-level slices show caliber, and every unavailable metric carries its kernel reason', async () => {
    globalThis.__testDailyAggregate = async (results) => JSON.parse(wasm.daily_aggregate(JSON.stringify(results)))
    try {
      const host = await render({ results: sim.results, runId: 'run-econ-slice' })
      const agg = kernelAgg()

      const sliceRows = [...host.querySelectorAll('[data-testid="economy-slice-table"] tbody tr')]
      assert.equal(sliceRows.length, ECONOMY_ROWS.length, '运行级口径行不随数据缺席而消失')
      for (const row of sliceRows) {
        const stat = agg[row.dataset.kpi]
        const mean = row.querySelector('td[data-field="mean"]')
        if (stat === undefined) {
          assert.equal(mean.textContent, unavailableText, `${row.dataset.kpi} 未配置 → 不可用,不是 0`)
          assert.equal(mean.dataset.value, undefined, '不可用不写数值属性')
          assert.equal(host.querySelector(`[data-testid="economy-${row.dataset.kpi}-note"]`), null,
            '无数据不出口径注,原因走不可用列表')
        } else {
          assert.equal(Number(mean.dataset.value), stat.mean, `${row.dataset.kpi} 均值逐字内核`)
          assert.ok(host.querySelector(`[data-testid="economy-${row.dataset.kpi}-note"]`))
        }
        assert.ok(row.querySelector('[data-caliber]'), `${row.dataset.kpi} 标出口径`)
      }

      const items = [...host.querySelectorAll('[data-testid="economy-unavailable-list"] li')]
      assert.ok(items.length >= 4, '结构性不可用恒列')
      const pity = items.find((li) => li.dataset.item === 'pity_distribution')
      assert.ok(pity, '保底分布声明不可用')
      assert.match(pity.textContent, new RegExp(zh['analysis.econ.pityDistLabel'].slice(0, 4)))
      assert.match(pity.textContent, /E\[T\]/)
      const structural = items.map((li) => li.dataset.item)
      for (const id of ['pity_distribution', 'gacha_daily', 'loot_daily', 'day1_inflation']) {
        assert.ok(structural.includes(id), `结构性不可用缺 ${id}`)
      }
      if (agg.gacha_pulls_to_hit === undefined && agg.loot_gold_per_player === undefined) {
        assert.ok(structural.includes('gacha_off') && structural.includes('loot_off'),
          '样例运行未配置 gacha/loot,追加未配置原因')
      }
    } finally {
      delete globalThis.__testDailyAggregate
    }
  })
}
