// 指标字典 UI 守卫(todo L381):口径事实源在内核(core::kpi_dict),界面只呈现、
// 不复制。锁三件事:
// - 内核字典桥形状(条目数 / 顺序 / 版本 / 门槛字段);
// - 字典 ↔ 前端显示层不漂移(kind ↔ isRatioMetric、decimals、optional ↔ METRIC_META);
// - KPI 约束表下的折叠字典面板渲染内核原文(量纲 / 小数位 / 可用性门槛 / 可缺 /
//   版本),字典未加载时不占位。
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

const DICT_KEYS = [
  'experiment.dictSummary',
  'experiment.dictAria',
  'experiment.dictColKind',
  'experiment.dictColDecimals',
  'experiment.dictColGate',
  'experiment.dictColOptional',
  'experiment.dictKindRatio',
  'experiment.dictKindValue',
  'experiment.dictGateNone',
  'experiment.dictGateDays',
  'experiment.dictGateGacha',
  'experiment.dictGateLoot',
  'experiment.dictOptionalYes',
  'experiment.dictOptionalNo',
  'experiment.dictNote',
]

test('P2 指标字典界面:双语词典键齐全(中英镜像,不落下一个面板词条)', () => {
  for (const key of DICT_KEYS) {
    assert.ok(key in zh, `zh 缺词条 ${key}`)
    assert.ok(key in en, `en 缺词条 ${key}`)
    assert.equal(typeof zh[key], 'string')
    assert.equal(typeof en[key], 'string')
    assert.ok(zh[key].length > 0, `${key} zh 空串`)
    assert.ok(en[key].length > 0, `${key} en 空串`)
  }
})

test('P2 指标字典界面:DesignerPage 接内核字典桥并把字典喂给 KPI 约束表', () => {
  const src = readFileSync(join(here, '../src/workbench/pages/DesignerPage.tsx'), 'utf8')
  assert.ok(/from '\.\.\/\.\.\/lib\/wasm\.ts'/.test(src), 'DesignerPage 应引 wasm 桥')
  assert.ok(src.includes('metricDictionary'), 'DesignerPage 未调用 metricDictionary()')
  assert.ok(/useState<MetricDictionary \| null>\(null\)/.test(src), '字典状态未接')
  assert.ok(
    /<KpiConstraintTable[\s\S]*?dictionary=\{dictionary\}/.test(src),
    'KpiConstraintTable 未收到 dictionary',
  )
})

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(指标字典 UI 走查在 CI 构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  register(new URL('./workspace-dom-loader.mjs', import.meta.url), pathToFileURL('./'))

  const { METRIC_KEYS } = await import('../src/lib/types.ts')
  const { METRIC_META } = await import('../src/lib/metricMeta.ts')
  const { isRatioMetric } = await import('../src/workbench/designer/designerLogic.ts')
  const { t } = await import('../src/lib/i18n/index.ts')

  const wasm = await import(pathToFileURL(pkgNode).href)
  const dict = JSON.parse(wasm.metric_dictionary())

  test('P2 内核指标字典:条目数、声明序、版本与门槛字段', () => {
    assert.equal(dict.dict_version, '1')
    assert.equal(dict.metrics.length, METRIC_KEYS.length)
    assert.deepEqual(
      dict.metrics.map((def) => def.id),
      METRIC_KEYS,
      '字典顺序必须与 METRIC_KEYS 一致(内核 MetricKey::ALL)',
    )
    for (const def of dict.metrics) {
      assert.equal(def.id, METRIC_META[def.id].id)
      assert.ok(def.kind === 'ratio' || def.kind === 'value', `${def.id} 量纲非法`)
      assert.ok(Number.isInteger(def.decimals) && def.decimals >= 0, `${def.id} 小数位非法`)
      assert.equal(typeof def.optional, 'boolean')
      assert.ok(Number.isInteger(def.days_required) && def.days_required >= 0)
      assert.equal(typeof def.requires_gacha, 'boolean')
      assert.equal(typeof def.requires_loot, 'boolean')
    }
  })

  test('P2 字典 ↔ 前端显示层不漂移(量纲 / 小数位 / 可缺)', () => {
    for (const def of dict.metrics) {
      assert.equal(
        def.kind === 'ratio',
        isRatioMetric(def.id),
        `${def.id}:字典量纲与 isRatioMetric 不一致`,
      )
      assert.equal(
        def.decimals,
        METRIC_META[def.id].decimals,
        `${def.id}:字典小数位与 METRIC_META 不一致`,
      )
      assert.equal(
        def.optional,
        METRIC_META[def.id].nullable,
        `${def.id}:字典可缺与 METRIC_META.nullable 不一致`,
      )
      assert.equal(
        METRIC_META[def.id].dimension,
        def.kind === 'ratio' ? 'percent' : 'amount',
        `${def.id}:量纲分组与字典量纲不一致`,
      )
    }
  })

  test('P2 门槛字段:天数门槛只落在 D3/D7,gacha/loot 门槛只落在对应指标', () => {
    const days = Object.fromEntries(dict.metrics.map((def) => [def.id, def.days_required]))
    assert.equal(days.retention_d7, 7)
    assert.equal(days.retention_d3, 3)
    for (const id of METRIC_KEYS) {
      if (id === 'retention_d7' || id === 'retention_d3') continue
      assert.equal(days[id], 0, `${id} 不应有天数门槛`)
    }
    const gacha = Object.fromEntries(dict.metrics.map((def) => [def.id, def.requires_gacha]))
    const loot = Object.fromEntries(dict.metrics.map((def) => [def.id, def.requires_loot]))
    assert.equal(gacha.gacha_pulls_to_hit, true)
    assert.equal(loot.loot_gold_per_player, true)
    for (const id of METRIC_KEYS) {
      if (id === 'gacha_pulls_to_hit' || id === 'loot_gold_per_player') continue
      assert.equal(gacha[id], false, `${id} 不应要 gacha`)
      assert.equal(loot[id], false, `${id} 不应要 loot`)
    }
  })

  // —— DOM 走查(同源内核字典,与 __test* 注入点同一纪律)——
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

  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { setLocale } = await import('../src/workbench/state/localeStore.ts')
  const { MetricDictPanel, KpiConstraintTable } = await import('../src/workbench/designer/KpiConstraintTable.tsx')

  await act(async () => setLocale('zh-CN'))

  const render = async (element) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(element) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    return host
  }

  test('DOM:字典面板渲染内核量纲 / 小数位 / 可用性门槛 / 可缺 / 版本', async () => {
    const host = await render(createElement(MetricDictPanel, { dictionary: dict }))
    const panel = host.querySelector('details')
    assert.ok(panel, '字典面板应渲染为折叠 details')
    const summary = panel.querySelector('summary')
    assert.ok(
      summary.textContent.includes(`版本 ${dict.dict_version}`),
      `summary 应含内核字典版本,实得「${summary.textContent}」`,
    )
    const table = panel.querySelector('table')
    assert.equal(
      table.getAttribute('aria-label'),
      t('zh-CN', 'experiment.dictAria'),
      '面板 aria 应走词典',
    )
    assert.equal(table.querySelectorAll('thead th').length, 5)
    assert.equal(table.querySelectorAll('tbody tr').length, dict.metrics.length)

    const rows = Object.fromEntries(
      Array.from(table.querySelectorAll('tbody tr')).map((row) => {
        const cells = Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent.trim())
        return [cells[0], cells]
      }),
    )

    const d7 = rows.retention_d7
    assert.equal(d7[1], t('zh-CN', 'experiment.dictKindRatio'), 'retention_d7 量纲应为比例')
    assert.equal(d7[2], '1', 'retention_d7 小数位')
    assert.equal(d7[3], 'days ≥ 7', 'retention_d7 门槛应来自内核 days_required')
    assert.equal(d7[4], t('zh-CN', 'experiment.dictOptionalYes'), 'retention_d7 可缺')

    const wr = rows.win_rate
    assert.deepEqual(wr[1], t('zh-CN', 'experiment.dictKindRatio'))
    assert.equal(wr[3], t('zh-CN', 'experiment.dictGateNone'), 'win_rate 无门槛')
    assert.equal(wr[4], t('zh-CN', 'experiment.dictOptionalNo'), 'win_rate 不可缺')

    const gacha = rows.gacha_pulls_to_hit
    assert.deepEqual(gacha[1], t('zh-CN', 'experiment.dictKindValue'), '抽卡次数为绝对值')
    assert.equal(gacha[3], 'model.gacha', '抽卡次数门槛应为 model.gacha')

    const loot = rows.loot_gold_per_player
    assert.equal(loot[3], 'model.loot', 'Loot 指标门槛应为 model.loot')

    const note = panel.querySelector('p.note')
    assert.ok(note.textContent.includes(`版本 ${dict.dict_version}`), '注脚应记录字典版本')
  })

  test('DOM:字典未加载时 KPI 约束表不渲染面板(不占位)', async () => {
    const host = await render(createElement(KpiConstraintTable, {
      targets: [],
      availability: { win_rate: { ok: true, reason: null } },
      dictionary: null,
      onToggle: () => {},
      onKindChange: () => {},
      onThresholdChange: () => {},
    }))
    assert.equal(host.querySelector('details'), null, '无字典时不应出现字典面板')
    assert.equal(host.querySelectorAll('table').length, 1, '只剩约束表一张表')
  })
}
