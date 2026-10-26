// 优化与代理视图守卫(todo L380):进化寻优 / Pareto 前沿 / 随机森林代理三算
// 各自独立标识;真实观测 / 插值 / 代理估计三层来源分行;RF 树间分歧只作描述性
// 散布呈现——红线:本小节任何地方不得出现置信带/CI 语义(类名、属性、± 表述),
// CI 带只属于「跨 replicate 逐日聚合」的内核聚合输出。
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { JSDOM } from 'jsdom'

import {
  importanceRows,
  interpolatedPoints,
  isGridPoint,
  observedPoints,
  optimizeHistoryRows,
  optimizeIdentity,
  pointKey,
  predictionRows,
  spreadText,
  surrogateIdentity,
  surrogatePoints,
  withPredictions,
} from '../src/lib/optimizeSurrogateModel.ts'
import { en } from '../src/lib/i18n/dict/en.ts'
import { zh } from '../src/lib/i18n/dict/zh.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

const stat = (mean, n = 2) => ({ n, mean, sd: 0.1, ci95_lo: mean - 0.1, ci95_hi: mean + 0.1, min: mean, max: mean })

const cand = (values, metricStats = [['win_rate', stat(0.8)]], status = 'ok', configError = null) => ({
  values,
  status: status === 'ok' ? 'ok' : { config_error: configError ?? 'bad yaml' },
  metric_stats: status === 'ok' ? metricStats : [],
  target_outcomes: [],
})

const REC = (interval, interpolated = [true, true]) => ({
  elasticities: [],
  recommendation: { param: 'model.warrior.attack', baseline: 100, interval, interpolated, confidence: 'medium', reasons: [] },
})

const row = (patch = {}) => ({
  id: 'r1', source: 'surrogate', label: 'x', params: { p: 1 },
  observed: null, observedN: null, predicted: null, spreadMin: null, spreadMax: null, trees: null, note: null,
  ...patch,
})

const PRED = (mean, lo, hi, trees = 20) => ({ metric: 'win_rate', mean, spread_min: lo, spread_max: hi, trees })

test('model: pointKey is strict and isGridPoint matches keys exactly, never by tolerance', () => {
  assert.equal(pointKey({ b: 2, a: 1 }), 'a=1,b=2', '键排序稳定')
  const grid = [{ 'model.warrior.attack': 90 }, { 'model.warrior.attack': 110 }]
  assert.equal(isGridPoint({ 'model.warrior.attack': 90 }, grid), true)
  assert.equal(isGridPoint({ 'model.warrior.attack': 95 }, grid), false, '95 不在格上,不得按容差折算成 90/110')
  assert.equal(isGridPoint({ 'model.warrior.attack': 110, extra: 1 }, grid), false, '键集不同 = 不同点')
})

test('model: importanceRows sorts by kernel importance desc and derives shares', () => {
  const out = {
    features: ['a', 'b', 'c'],
    importance: [0.1, 0.5, 0.4],
    spec: { trees: 10, max_depth: 4, min_samples_leaf: 2, seed: 1 },
    trained: 3, excluded: 0,
    model: { forest: [] },
    metric: 'win_rate',
  }
  const rows = importanceRows(out)
  assert.deepEqual(rows.map((r) => r.feature), ['b', 'c', 'a'])
  assert.ok(Math.abs(rows[0].share - 0.5) < 1e-12)
  const flat = importanceRows({ ...out, importance: [0, 0, 0] })
  assert.deepEqual(flat.map((r) => r.feature), ['a', 'b', 'c'], '全 0 保持声明序(排序不漂移)')
  assert.ok(flat.every((r) => r.share === 0))
})

test('model: observedPoints carry kernel mean + n, keep config-error notes, never 0-fill', () => {
  const results = [
    cand({ 'model.warrior.attack': 90 }, [['win_rate', stat(0.7, 4)], ['gold_per_player', stat(600, 4)]]),
    cand({ 'model.warrior.attack': 100 }, [['win_rate', stat(0.9, 4)]]),
    cand({ 'model.warrior.attack': 110 }, [], 'config_error', 'model.warrior.attack 越界'),
  ]
  const rows = observedPoints(results, 'win_rate')
  assert.equal(rows.length, 3)
  assert.equal(rows[0].source, 'observed')
  assert.equal(rows[0].observed, 0.7)
  assert.equal(rows[0].observedN, 4)
  assert.equal(rows[0].predicted, null, '观测行不预填代理值')
  assert.equal(rows[2].observed, null, '配置错误候选无内核真值,不补 0')
  assert.equal(rows[2].note, 'model.warrior.attack 越界', '内核原文备注保留')
  const absent = observedPoints(results, 'churn_rate')
  assert.ok(absent.every((r) => r.observed === null), '内核未产出的指标整列缺席')
})

test('model: interpolatedPoints come from the kernel recommendation interval endpoints only', () => {
  assert.deepEqual(interpolatedPoints(null), [], '无推荐 = 无插值行')
  assert.deepEqual(interpolatedPoints(REC(null)), [], '内核未给区间 = 无插值行,不自造')
  const rows = interpolatedPoints(REC([92.5, 107.5], [true, true]))
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r) => r.source === 'interpolated'))
  assert.equal(rows[0].params['model.warrior.attack'], 92.5)
  assert.equal(rows[1].params['model.warrior.attack'], 107.5)
  assert.deepEqual(rows.map((r) => r.note), ['interpolated', 'interpolated'])
  const onGrid = interpolatedPoints(REC([90, 110], [false, false]))
  assert.deepEqual(onGrid.map((r) => r.note), ['grid', 'grid'], '内核标注端点在格上时不冒充插值')
})

test('model: surrogate points drop grid members and fall back front0 -> best', () => {
  const grid = [{ a: 1 }, { a: 2 }]
  const pt = (a) => ({ values: { a }, status: 'ok', metric_stats: [['win_rate', stat(0.5)]] })
  const opt = { front0: [pt(1.5), pt(1)], best: pt(1.7), spec: { mode: 'pareto' } }
  const rows = surrogatePoints(opt, grid)
  assert.deepEqual(rows.map((r) => r.params.a), [1.5], '格上点不重复出现在代理层(已在观测层)')
  assert.equal(surrogatePoints({ ...opt, front0: [] }, grid)[0].params.a, 1.7, '无前沿回退最优解')
  assert.deepEqual(surrogatePoints(null, grid), [])
  assert.deepEqual(surrogatePoints({ front0: [], best: null, spec: { mode: 'pareto' } }, grid), [])
})

test('model: prediction rows keep the fixed three-layer order and withPredictions fills kernel values', () => {
  const observed = [row({ id: 'o', source: 'observed' })]
  const interpolated = [row({ id: 'i', source: 'interpolated' })]
  const surrogate = [row({ id: 's', source: 'surrogate' })]
  const all = predictionRows(observed, interpolated, surrogate)
  assert.deepEqual(all.map((r) => r.source), ['observed', 'interpolated', 'surrogate'], '三层顺序固定,测试锁死')
  const filled = withPredictions(all, [null, PRED(0.5, 0.4, 0.6, 20), PRED(0.7, 0.65, 0.75, 20)])
  assert.equal(filled[0].predicted, null, '缺预测保持 null')
  assert.equal(filled[1].predicted, 0.5)
  assert.equal(filled[1].spreadMin, 0.4)
  assert.equal(filled[1].trees, 20)
})

test('model: spreadText renders min~max and stays null without both ends', () => {
  assert.equal(spreadText(row({ spreadMin: 0.4, spreadMax: 0.6 })), '0.4~0.6')
  assert.equal(spreadText(row({ spreadMin: null, spreadMax: 0.6 })), null)
  assert.equal(spreadText(row({ spreadMin: 0.4, spreadMax: null })), null)
})

test('model: optimize identity spreads the whole spec and derives the budget', () => {
  const spec = {
    mode: 'pareto', population: 8, generations: 3, elite: 2,
    mutation_rate: 0.3, mutation_scale: 0.2, replicates: 4,
    parameters: [{ path: 'model.warrior.attack', min: 90, max: 110 }],
    targets: [{ metric: 'win_rate', kind: 'hard', min: 0, max: 1 }, { metric: 'gold_per_player', kind: 'soft', min: 1, max: null }],
    objective: null,
    objectives: [{ metric: 'win_rate', direction: 'maximize' }, { metric: 'gold_per_player', direction: 'minimize' }],
  }
  const id = optimizeIdentity({ spec, history: [], all: [], front0: [], best: null, best_fitness: null, evaluated: 0, total_sims: 0 })
  assert.deepEqual(id.parameters, ['model.warrior.attack'])
  assert.deepEqual(id.hardTargets, [{ metric: 'win_rate', kind: 'hard', min: 0, max: 1 }], 'hard 约束单列,soft 不混入')
  assert.equal(id.budget.candidates, 32, '预算 = 种群 × (代数+1)')
  assert.equal(id.budget.sims, 128, '预算 × replicates')
  assert.equal(id.objectives.length, 2, 'pareto 读 objectives')
  const evo = optimizeIdentity({ spec: { ...spec, mode: 'evolutionary', objectives: [], objective: { metric: 'win_rate', direction: 'maximize' } } })
  assert.deepEqual(evo.objectives, [{ metric: 'win_rate', direction: 'maximize' }], 'evolutionary 读单目标')
})

test('model: history rows pass kernel stats through and hide non-finite scores', () => {
  const history = [
    { generation: 0, evaluated: 8, feasible: 6, best: { hard_pass: 1, score: 0.75 }, front0: 3 },
    { generation: 1, evaluated: 6, feasible: 5, best: { hard_pass: 2, score: Number.NaN }, front0: 4 },
  ]
  const rows = optimizeHistoryRows({ history })
  assert.deepEqual(rows.map((r) => [r.generation, r.evaluated, r.feasible, r.bestHardPass]), [[0, 8, 6, 1], [1, 6, 5, 2]])
  assert.equal(rows[0].score, 0.75)
  assert.equal(rows[1].score, null, '非有限分数 = 缺席,不画 0')
})

test('model: surrogate identity spreads metric, hyper-params and the train ledger', () => {
  const out = {
    metric: 'win_rate', features: ['model.warrior.attack'], importance: [1],
    spec: { trees: 20, max_depth: 6, min_samples_leaf: 2, seed: 7 },
    trained: 3, excluded: 1, model: { forest: [] },
  }
  const id = surrogateIdentity(out)
  assert.deepEqual(id, {
    metric: 'win_rate', trees: 20, maxDepth: 6, minSamplesLeaf: 2, seed: 7,
    trained: 3, excluded: 1, featureCount: 1,
  })
})

test('i18n: every opt key exists in zh and en and locks the no-CI red line wording', () => {
  const keys = Object.keys(zh).filter((key) => /^analysis\.opt/.test(key))
  assert.ok(keys.length >= 49, `词典应有全量 opt 键(现 ${keys.length})`)
  for (const key of keys) {
    assert.ok(en[key], `missing en translation: ${key}`)
    assert.ok(zh[key].length > 0 && en[key].length > 0, `${key}: 非空`)
  }
  for (const locale of [zh, en]) {
    assert.match(locale['analysis.optSpreadNote'], /不是统计置信区间|not a statistical confidence interval/i, '树间分歧明确不是 CI')
    assert.match(locale['analysis.optSpreadNote'], /不能用于跨 replicate|not be used for cross-replicate/i, '禁止跨 replicate 推断')
    assert.match(locale['analysis.optSpreadNote'], /跨 replicate 逐日聚合|cross-replicate daily/i, 'CI 只在内核聚合小节')
    assert.match(locale['analysis.optSourceNote'], /真实观测|observed/i)
    assert.match(locale['analysis.optSourceNote'], /插值|interpolated/i)
    assert.match(locale['analysis.optSourceNote'], /代理|surrogate/i)
    assert.match(locale['analysis.optVsPareto'], /core::optimize/, '与扫描 Pareto 划清算法归属')
  }
  assert.notEqual(zh['analysis.optSourceObserved'], en['analysis.optSourceObserved'], '三源名称双语确乎两语')
  assert.notEqual(zh['analysis.optSourceInterpolated'], en['analysis.optSourceInterpolated'])
  assert.notEqual(zh['analysis.optSourceSurrogate'], en['analysis.optSourceSurrogate'])
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
  const { OptimizeSurrogateSection } = await import('../src/workbench/analysis/OptimizeSurrogateSection.tsx')
  const wasm = await import(pathToFileURL(pkgNode).href)

  await act(async () => setLocale('zh-CN'))

  // 真内核扫描:可行目标(win_rate 宽界)确保推荐区间在场,插值层有行。
  const SWEEP_YAML = [
    'schema_version: "1"',
    'scenario: {population: 30, duration: "5d", seed: 42}',
    '',
    'sweep:',
    '  replicates: 2',
    '  parameters:',
    '    model.warrior.attack: {min: 90, max: 110, step: 10}',
    '  targets:',
    '    - {metric: win_rate, min: 0.0, max: 2.0, kind: hard}',
    '    - {metric: gold_per_player, min: 1.0, kind: soft}',
    '',
  ].join('\n')
  const plan = JSON.parse(wasm.sweep_plan(SWEEP_YAML, 0))
  const kernelResults = plan.candidates.map((values) => JSON.parse(wasm.sweep_candidate(SWEEP_YAML, plan.replicates, JSON.stringify(values))))
  const rec = JSON.parse(wasm.sweep_recommend(SWEEP_YAML, JSON.stringify(kernelResults)))
  assert.ok(rec.recommendation.interval !== null, '夹具须产出推荐区间(否则插值层测不到)')

  // 注入点接线(同 __testDailyAggregate 先例):节点 DOM 测试无法 fetch 浏览器 wasm,
  // 注入同源内核桥(pkg-node binding)保持真数据源。
  globalThis.__testOptimizeRun = async (yaml) => JSON.parse(wasm.optimize(yaml))
  globalThis.__testSurrogateTrain = async (results, metric, params) => JSON.parse(wasm.surrogate_train(JSON.stringify(results), metric, params.trees, params.max_depth, params.min_samples_leaf, BigInt(params.seed)))
  globalThis.__testSurrogatePredict = async (model, params) => JSON.parse(wasm.surrogate_predict(JSON.stringify(model), JSON.stringify(params)))

  const execOf = (results, recommendation) => ({
    runId: 'run_opt380', kind: 'sweep', spec: { kind: 'sweep', yaml: SWEEP_YAML, plan: { candidates: plan.candidates, replicates: plan.replicates, sims: plan.sims } },
    progressKind: 'candidates', replicates: plan.replicates, candidatesDone: results.length, candidatesTotal: plan.candidates.length,
    results, recommendation, recommendationError: null, comparison: null, arms: null, sim: null, errorClass: null, errorMessage: null,
  })
  const isOnSweepGrid = (values, candidates) => candidates.some((candidate) => Object.entries(values).every(([path, value]) => candidate[path] === value))
  const render = async (props) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(OptimizeSurrogateSection, props)) })
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    return host
  }

  test('DOM: surrogate trains on real kernel candidates and spreads the train ledger + importance chart', async () => {
    const host = await render({ exec: execOf(kernelResults, rec), yaml: SWEEP_YAML })
    const identity = host.querySelector('[data-testid="opt-surrogate-identity"]')
    assert.ok(identity, '训练账表格在场')
    const trained = JSON.parse(wasm.surrogate_train(JSON.stringify(kernelResults), 'win_rate', 50, 8, 2, BigInt(7)))
    const dds = [...identity.querySelectorAll('dd')].map((dd) => dd.textContent)
    assert.ok(dds.some((text) => text === String(trained.trained)), `trained 来自内核(${trained.trained})`)
    assert.ok(dds.some((text) => text === String(trained.excluded)), 'excluded 来自内核')
    const chart = host.querySelector('[data-testid="surrogate-importance-chart"]')
    assert.ok(chart, '特征重要性图在场')
    assert.match(chart.getAttribute('class'), /mini-chart/, '图表 svg 必须挂 mini-chart,否则被 17×17 图标规则裁掉')
    const kernelFeatures = trained.features
    for (const feature of kernelFeatures) {
      assert.ok(chart.textContent.includes(feature), `特征 ${feature} 出现在重要性图`)
    }
  })

  test('DOM: three source layers stay distinct; only the observed layer carries kernel truth', async () => {
    const host = await render({ exec: execOf(kernelResults, rec), yaml: SWEEP_YAML })
    const table = host.querySelector('[data-testid="opt-prediction-table"]')
    assert.ok(table, '三层预测表在场')
    const groups = [...table.querySelectorAll('[data-testid="opt-source-group"]')].map((tr) => tr.dataset.source)
    assert.deepEqual(groups, ['observed', 'interpolated'],
      '跑寻优前只有观测层与插值层;代理层要到搜索产出格外点才出现')
    const rowsOf = (source) => [...table.querySelectorAll(`tr[data-source="${source}"]:not([data-testid])`)]
    const observedRows = rowsOf('observed')
    assert.equal(observedRows.length, kernelResults.length, '观测层一行一候选')
    for (const [index, tr] of observedRows.entries()) {
      const kernelStat = kernelResults[index].metric_stats.find(([key]) => key === 'win_rate')
      assert.equal(Number(tr.querySelector('[data-observed]').dataset.observed), kernelStat[1].mean, '观测值逐字内核均值')
      assert.ok(tr.querySelector('[data-predicted]'), '同一点的代理预测列在场')
      const spread = tr.querySelector('[data-testid="opt-spread"]')
      assert.ok(spread.dataset.spreadMin !== undefined && spread.dataset.spreadMax !== undefined, '树间分歧两端都在')
      const predicted = Number(tr.querySelector('[data-predicted]').dataset.predicted)
      assert.ok(Number(spread.dataset.spreadMin) <= predicted, '分歧下界 ≤ 均值')
      assert.ok(Number(spread.dataset.spreadMax) >= predicted, '均值 ≤ 分歧上界')
      assert.match(spread.textContent, /~/, '分歧呈现为 min~max,不是 ± 或区间记法')
    }
    const interpolatedRows = rowsOf('interpolated')
    assert.equal(interpolatedRows.length, 2, '推荐区间两端各一行')
    for (const tr of interpolatedRows) {
      assert.equal(tr.querySelector('[data-observed]'), null, '插值点没有内核真值,不得写 data-observed')
      assert.ok(tr.querySelector('[data-predicted]'), '插值点的代理估计在场')
    }
  })

  test('DOM: red line — no CI/band semantics anywhere in the section, spread note denies it in so many words', async () => {
    const host = await render({ exec: execOf(kernelResults, rec), yaml: SWEEP_YAML })
    const section = host.querySelector('[data-testid="opt-surrogate-section"]')
    for (const element of section.querySelectorAll('[class]')) {
      assert.doesNotMatch(element.getAttribute('class'), /(^|\s)(agg-)?ci-band|ci95|interval/i, '小节内图元不带 CI/band 语义类名')
    }
    for (const element of section.querySelectorAll('*')) {
      for (const attribute of element.getAttributeNames()) {
        assert.doesNotMatch(attribute, /ci95|confidence/i, `属性 ${attribute} 不得携带 CI 语义`)
      }
    }
    assert.equal(section.textContent.includes('±'), false, '分歧不用 ± 记法(那是误差棒/区间的视觉语义)')
    const note = host.querySelector('[data-testid="opt-spread-note"]')
    assert.ok(note, '分歧说明在场')
    assert.match(note.textContent, /不是统计置信区间/, '文案直接否认 CI 语义')
    assert.match(note.textContent, /跨 replicate 逐日聚合/, '并把 CI 指回内核聚合小节')
  })

  test('DOM: config-error candidate keeps an unavailable observed cell with the kernel note, never a fabricated value', async () => {
    const broken = JSON.parse(wasm.sweep_candidate(SWEEP_YAML, plan.replicates, JSON.stringify({ 'no.such.path': 1 })))
    assert.ok(broken.status.config_error, '夹具:坏候选确为配置错误')
    const results = [...kernelResults, broken]
    const host = await render({ exec: execOf(results, rec), yaml: SWEEP_YAML })
    const rows = [...host.querySelectorAll('tr[data-source="observed"]:not([data-testid])')]
    assert.equal(rows.length, results.length)
    const bad = rows[rows.length - 1]
    assert.equal(bad.querySelector('[data-observed]'), null, '缺真值不得写 data-observed')
    assert.match(bad.querySelector('[data-testid="opt-unavailable"]').textContent, /不可用/)
    assert.match(bad.textContent, /未知参数/, '内核原文备注透传(未知参数路径)')
  })

  test('DOM: optimize identity, history and points all come from one kernel call', async () => {
    const host = await render({ exec: execOf(kernelResults, rec), yaml: SWEEP_YAML })
    const run = host.querySelector('[data-testid="opt-run"]')
    assert.ok(run, '运行按钮在场')
    await act(async () => { run.click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    const identity = host.querySelector('[data-testid="opt-identity"]')
    assert.ok(identity, '寻优独立标识在场')
    const yamlText = host.querySelector('[data-testid="opt-yaml"]').textContent
    const kernel = JSON.parse(wasm.optimize(yamlText))
    assert.ok(yamlText.includes('optimize:'), '合成 YAML 含 optimize 节')
    assert.equal(yamlText.includes('sweep:'), false, '合成 YAML 不残留 sweep 节(DesignerPage 会拒)')
    const dds = [...identity.querySelectorAll('dd')].map((dd) => dd.textContent)
    assert.ok(dds.some((text) => text === String(kernel.evaluated)), `evaluated 逐字内核(${kernel.evaluated})`)
    assert.ok(dds.some((text) => text === String(kernel.total_sims)), 'total_sims 逐字内核')
    assert.ok(dds.some((text) => text.includes(kernel.spec.mode)), 'mode 逐字内核')
    const history = host.querySelector('[data-testid="opt-history"]')
    assert.equal(history.querySelectorAll('tbody tr').length, kernel.history.length, '逐代统计行数 = 内核')
    const points = host.querySelector('[data-testid="opt-points"]')
    const expected = kernel.front0.length > 0 ? kernel.front0.length : 1
    assert.equal(points.querySelectorAll('tbody tr').length, expected, '点表行数 = 前沿(或最优)')
    const vsPareto = host.querySelector('[data-testid="opt-vs-pareto"]')
    assert.match(vsPareto.textContent, /core::optimize/, '寻优与扫描 Pareto 的归属声明在场')

    // 搜索产出格外点 → 代理层出现,三层分立,代理点估计值逐字内核 RF
    const kernelPoint = kernel.front0.length > 0 ? kernel.front0[0] : kernel.best
    assert.ok(!isOnSweepGrid(kernelPoint.values, plan.candidates), '寻优点不在扫描格上,故属代理层')
    const table = host.querySelector('[data-testid="opt-prediction-table"]')
    const groupSources = [...table.querySelectorAll('[data-testid="opt-source-group"]')].map((tr) => tr.dataset.source)
    assert.deepEqual(groupSources, ['observed', 'interpolated', 'surrogate'], '寻优后三层来源分立,不合并成一类')
    const surrogateRows = [...table.querySelectorAll('tr[data-source="surrogate"]:not([data-testid])')]
    assert.ok(surrogateRows.length >= 1, '代理层至少一行')
    const hit = surrogateRows.find((tr) => Object.entries(kernelPoint.values).every(([, value]) => tr.textContent.includes(value.toFixed(2))))
    assert.ok(hit, '寻优点出现在代理层')
    assert.equal(hit.querySelector('[data-observed]'), null, '代理点没有内核真值,不得写 data-observed')
    const kernelPred = JSON.parse(wasm.surrogate_predict(
      JSON.stringify(JSON.parse(wasm.surrogate_train(JSON.stringify(kernelResults), 'win_rate', 50, 8, 2, BigInt(7))).model),
      JSON.stringify(kernelPoint.values),
    ))
    assert.equal(Number(hit.querySelector('[data-predicted]').dataset.predicted), kernelPred.mean, '代理估计逐字内核 RF 均值')
    assert.equal(Number(hit.querySelector('[data-testid="opt-spread"]').dataset.spreadMax), kernelPred.spread_max, '分歧上界逐字内核')
  })

  test('DOM: budget overrun is rejected by the kernel and shown as an alert, never a partial render', async () => {
    const host = await render({ exec: execOf(kernelResults, rec), yaml: SWEEP_YAML })
    // population/generations/replicates 三个输入在第二工具栏;粗筛超限组合
    await act(async () => {
      const set = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set
        setter.call(input, String(value))
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
      }
      const numbers = [...host.querySelectorAll('.optimize-surrogate input[type="number"]')]
      set(numbers[numbers.length - 3], 100)
      set(numbers[numbers.length - 2], 40)
      set(numbers[numbers.length - 1], 4)
    })
    await act(async () => { host.querySelector('[data-testid="opt-run"]').click() })
    await act(async () => { await new Promise((r) => setTimeout(r, 300)) })
    const alert = host.querySelector('[data-testid="opt-error"]')
    assert.ok(alert, '超限出 alert')
    assert.equal(alert.getAttribute('role'), 'alert')
    assert.match(alert.textContent, /超出 Web 预算|预算/, '内核原文(预算超限)透传')
    assert.equal(host.querySelector('[data-testid="opt-identity"]'), null, '被拒的寻优不渲染任何结果')
  })

  test('DOM: non-sweep exec renders the declared contract line only', async () => {
    const host = await render({ exec: { ...execOf(kernelResults, rec), kind: 'single', spec: { kind: 'single', yaml: SWEEP_YAML, replicates: 2 } }, yaml: SWEEP_YAML })
    assert.match(host.querySelector('[data-testid="opt-surrogate-section"]').textContent, /扫描|sweep/i)
    assert.equal(host.querySelector('[data-testid="opt-prediction-table"]'), null)
    assert.equal(host.querySelector('[data-testid="opt-run"]'), null)
  })
}
