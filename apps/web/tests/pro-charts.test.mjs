// 专业图型聚合模型守卫(WB-12 · todo L365,节点侧):双轴 Grid 离散热图、
// Random/LHS 散点、OAT 敏感性矩阵、可行候选 + Pareto 前沿。锁红线:
// ① 缺失候选/未产出指标 = 留空(格子缺失、点扣除),禁止 0 填空;
// ② config_error 候选不入图形但保留 id 与原因(不静默丢弃);
// ③ 口径原样:均值不乘 100、不舍入;
// ④ 每个可点元素携带内容寻址候选 ID(与候选表/检查器同一 ID 域)。
// 跑法(仓库根):node --test apps/web/tests/pro-charts.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { METRIC_KEYS } from '../src/lib/types.ts'
import { heatmapGrid, scatterPoints, oatMatrix, paretoFront } from '../src/lib/proChartsModel.ts'

const stat = (mean, n = 20) => ({ n, mean, sd: 0.02, ci95_lo: mean - 0.01, ci95_hi: mean + 0.01 })
const XA = { path: 'model.warrior.attack', min: 90, max: 110, step: 10 }
const YA = { path: 'model.warrior.defense', min: 70, max: 90, step: 10 }

/** 与 sweepView.ts 同形的 CandidateView 手工夹具 */
const view = (id, index, values, meanOrStatus, metric = 'win_rate', outcomes = []) => ({
  id,
  index,
  values,
  status: typeof meanOrStatus === 'object' ? meanOrStatus : 'ok',
  stats: typeof meanOrStatus === 'object' ? new Map() : new Map([[metric, stat(meanOrStatus)]]),
  outcomes,
})

const views = [
  view('c-90-70', 0, { 'model.warrior.attack': 90, 'model.warrior.defense': 70 }, 0.5),
  view('c-100-70', 1, { 'model.warrior.attack': 100, 'model.warrior.defense': 70 }, 0.6),
  view('c-110-70', 2, { 'model.warrior.attack': 110, 'model.warrior.defense': 70 }, 0.7),
  view('c-90-80', 3, { 'model.warrior.attack': 90, 'model.warrior.defense': 80 }, 0.55),
  view('c-100-80', 4, { 'model.warrior.attack': 100, 'model.warrior.defense': 80 }, 0.65),
  // 计划内 110-80 缺失(未返回)→ 热图该格必须留空
]

test('heatmapGrid:逐格聚合,缺失格留空,失败候选不入格但保留原因', () => {
  const withFail = [...views, view('c-bad', 5, { 'model.warrior.attack': 110, 'model.warrior.defense': 80 }, { config_error: '配置无效: x' })]
  const m = heatmapGrid(withFail, { xPath: 'model.warrior.attack', yPath: 'model.warrior.defense', metric: 'win_rate', xAxis: XA, yAxis: YA })
  assert.equal(m.cells.size, 5)
  assert.deepEqual(m.cells.get('90|70').ids, ['c-90-70'])
  // 缺失格:计划内但无结果 → 留空清单,绝不用 0 填(110-80 与整行 defense=90)
  assert.deepEqual(m.missing, [
    { x: 110, y: 80 },
    { x: 90, y: 90 }, { x: 100, y: 90 }, { x: 110, y: 90 },
  ])
  // config_error:不入格,保留 id 与原因
  assert.deepEqual(m.skipped, [{ id: 'c-bad', reason: 'config_error' }])
})

test('heatmapGrid:重复参数域按样本数加权聚合,不覆盖、ID 收敛', () => {
  const dup = [...views, view('c-90-70', 6, { 'model.warrior.attack': 90, 'model.warrior.defense': 70 }, 0.7, 'win_rate')]
  const m = heatmapGrid(dup, { xPath: 'model.warrior.attack', yPath: 'model.warrior.defense', metric: 'win_rate', xAxis: XA, yAxis: YA })
  const cell = m.cells.get('90|70')
  // (0.5×20 + 0.7×20) / 40 = 0.6,口径原样不乘 100 不舍入
  assert.equal(cell.mean, 0.6)
  assert.equal(cell.n, 40)
  assert.deepEqual(cell.ids, ['c-90-70']) // 内容寻址同域恒同 ID
})

test('heatmapGrid:未产出该指标的候选如实记因;域外坐标不落格', () => {
  const noMetric = [view('c-nm', 0, { 'model.warrior.attack': 90, 'model.warrior.defense': 70 }, { config_error: 'x' })]
  const m1 = heatmapGrid(noMetric, { xPath: 'model.warrior.attack', yPath: 'model.warrior.defense', metric: 'win_rate', xAxis: XA, yAxis: YA })
  assert.deepEqual(m1.skipped, [{ id: 'c-nm', reason: 'config_error' }])
  assert.equal(m1.missing.length, 9)
  const offGrid = [view('c-off', 0, { 'model.warrior.attack': 95, 'model.warrior.defense': 70 }, 0.5)]
  const m2 = heatmapGrid(offGrid, { xPath: 'model.warrior.attack', yPath: 'model.warrior.defense', metric: 'win_rate', xAxis: XA, yAxis: YA })
  assert.deepEqual(m2.skipped, [{ id: 'c-off', reason: 'off_grid' }])
  assert.equal(m2.cells.size, 0)
})

test('scatterPoints:连续采样不做分箱,失败/缺指标扣点且保留原因', () => {
  const pts = [
    view('r-1', 0, { 'model.warrior.attack': 92.3, 'model.warrior.defense': 71.7 }, 0.51),
    view('r-2', 1, { 'model.warrior.attack': 103.9, 'model.warrior.defense': 85.2 }, 0.66),
    view('r-bad', 2, { 'model.warrior.attack': 97, 'model.warrior.defense': 75 }, { config_error: '配置无效: y' }),
    view('r-nm', 3, { 'model.warrior.attack': 99, 'model.warrior.defense': 77 }, { config_error: 'z' }),
  ]
  const m = scatterPoints(pts, 'model.warrior.attack', 'model.warrior.defense', 'win_rate')
  assert.equal(m.drawable.length, 2)
  assert.deepEqual(m.drawable.map((p) => [p.x, p.y]), [[92.3, 71.7], [103.9, 85.2]])
  assert.deepEqual(m.withheld, [
    { id: 'r-bad', reason: 'config_error' },
    { id: 'r-nm', reason: 'config_error' },
  ])
  // 坐标与值都是原值(聚合 = 只取均值统计)
  assert.equal(m.drawable[0].value, 0.51)
})

test('oatMatrix:整理内核 elasticities,未覆盖组合留空,列序=METRIC_KEYS', () => {
  const e = (param, metric, ev, sig = true, note = 'ok') => ({ param, metric, e: ev, e_lo: ev - 0.1, e_hi: ev + 0.1, delta_eff: ev, significant: sig, note })
  const elasticities = [
    e('model.warrior.attack', 'win_rate', 0.02),
    e('model.warrior.attack', 'churn_rate', -0.01, false, 'no_bracket'),
  ]
  const m = oatMatrix(elasticities)
  assert.deepEqual(m.params, ['model.warrior.attack'])
  assert.deepEqual(m.metrics, [...METRIC_KEYS])
  assert.equal(m.rows[0].cells.length, METRIC_KEYS.length)
  const winCell = m.rows[0].cells[METRIC_KEYS.indexOf('win_rate')]
  assert.equal(winCell.e, 0.02)
  assert.equal(winCell.significant, true)
  const churnCell = m.rows[0].cells[METRIC_KEYS.indexOf('churn_rate')]
  assert.equal(churnCell.e, -0.01)
  assert.equal(churnCell.significant, false)
  assert.equal(churnCell.note, 'no_bracket')
  // 未覆盖组合 = null(留空,不 0 填)
  assert.equal(m.rows[0].cells[METRIC_KEYS.indexOf('retention_d7')], null)
  // 空输入:无行,不造参数名
  assert.deepEqual(oatMatrix([]).params, [])
})

test('oatMatrix:多参数按内核出现序去重成行', () => {
  const e = (param, metric, ev) => ({ param, metric, e: ev, e_lo: null, e_hi: null, delta_eff: null, significant: false, note: 'ok' })
  const m = oatMatrix([
    e('a.p', 'win_rate', 1),
    e('b.p', 'win_rate', 2),
    e('a.p', 'churn_rate', 3), // 重复参数不再成行
  ])
  assert.deepEqual(m.params, ['a.p', 'b.p'])
  assert.equal(m.rows[0].cells[METRIC_KEYS.indexOf('churn_rate')].e, 3)
})

const asView = (id, index, values, means, outcomes = []) => ({
  id, index, values, status: 'ok',
  stats: new Map(Object.entries(means).map(([k, v]) => [k, stat(v, 10)])),
  outcomes,
})
const goalFixture = [
  asView('p1', 0, { a: 1 }, { win_rate: 0.5, gold_per_player: 100 }),
  asView('p2', 1, { a: 2 }, { win_rate: 0.6, gold_per_player: 90 }),
  asView('p3', 2, { a: 3 }, { win_rate: 0.7, gold_per_player: 80 }),
  asView('dom', 3, { a: 4 }, { win_rate: 0.55, gold_per_player: 85 }),
]

test('paretoFront:max/max 双目标——非支配前沿,被支配点扣除', () => {
  const m = paretoFront(goalFixture, 'win_rate', 'gold_per_player', 'max', 'max')
  assert.equal(m.feasible.length, 4)
  assert.deepEqual(m.frontier.map((p) => p.id), ['p1', 'p2', 'p3'])
  assert.deepEqual(m.dominated.map((p) => p.id), ['dom'])
  assert.equal(m.excluded.length, 0)
  // 前沿按 x 排序(max 目标升序)
  assert.ok(m.frontier[0].x < m.frontier[1].x)
})

test('paretoFront:min 方向(churn 类目标)支配关系随之翻转', () => {
  const views = [
    asView('lo', 0, { a: 1 }, { churn_rate: 0.10, win_rate: 0.5 }),
    asView('hi', 1, { a: 2 }, { churn_rate: 0.30, win_rate: 0.5 }),
  ]
  const m = paretoFront(views, 'win_rate', 'churn_rate', 'max', 'min')
  assert.deepEqual(m.frontier.map((p) => p.id), ['lo'])
  assert.deepEqual(m.dominated.map((p) => p.id), ['hi'])
})

test('paretoFront:硬约束 fail / config_error / 缺指标 → 不入比较并记因', () => {
  const failView = asView('hardfail', 4, { a: 5 }, { win_rate: 0.99, gold_per_player: 999 },
    [{ metric: 'win_rate', kind: 'hard', min: 0.9, max: null, stats: stat(0.99, 10), verdict: 'fail' }])
  const errView = { ...asView('err', 5, { a: 6 }, { win_rate: 0.5, gold_per_player: 50 }), status: { config_error: '配置无效: e' }, stats: new Map() }
  const noMetric = asView('nometric', 6, { a: 7 }, { win_rate: 0.5 }) // 缺 gold_per_player
  const m = paretoFront([...goalFixture, failView, errView, noMetric], 'win_rate', 'gold_per_player', 'max', 'max')
  assert.deepEqual(m.excluded.map((x) => [x.id, x.reason]), [
    ['hardfail', 'hard_fail'],
    ['err', 'config_error'],
    ['nometric', 'metric_not_produced'],
  ])
  assert.equal(m.feasible.length, 4)
})

test('paretoFront:目标值完全相等的候选只保留计划序第一个', () => {
  const views = [
    asView('first', 0, { a: 1 }, { win_rate: 0.6, gold_per_player: 90 }),
    asView('twin', 1, { a: 2 }, { win_rate: 0.6, gold_per_player: 90 }),
  ]
  const m = paretoFront(views, 'win_rate', 'gold_per_player', 'max', 'max')
  assert.deepEqual(m.frontier.map((p) => p.id), ['first'])
  assert.deepEqual(m.dominated.map((p) => p.id), ['twin'])
})

test('paretoFront:无 feasible → 前沿为空(不造点)', () => {
  const m = paretoFront([], 'win_rate', 'gold_per_player', 'max', 'max')
  assert.deepEqual(m.frontier, [])
  assert.deepEqual(m.feasible, [])
})
