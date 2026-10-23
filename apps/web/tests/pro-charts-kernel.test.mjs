// 专业图型 × 真实内核走查(WB-12 · todo L364/L365,节点侧,pkg-node 构建后跑):
// 真 sweep_plan → 逐候选真跑 sweep_candidate → WB-08.01 真适配器
// candidateViews(应用同一条 candidateIdFor)→ 四类图聚合模型 + 失败点
// 追踪。锁"接真实数据链路":模型里的每个数都能指回内核输出,缺失候选
// 留空、config_error 保留内核原文、推荐侧多因子如实不可用。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/pro-charts-kernel.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(真实内核走查在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  const wasm = await import(pkgNode)
  const { candidateViews } = await import('../src/lib/sweepView.ts')
  const { heatmapGrid, scatterPoints, oatMatrix, paretoFront } = await import('../src/lib/proChartsModel.ts')
  const { trackFailedPoints } = await import('../src/lib/sweepDesign.ts')
  const { candidateIdFor, hashId, ID_PREFIXES } = await import('../src/workbench/ids.ts')

  // 双因子 Grid:3 × 3 = 9 候选,硬约束 win_rate ∈ [0,1]
  const EXP2 = [
    'schema_version: "1"',
    'scenario: {population: 40, duration: "14d", seed: 7}',
    'sweep:',
    '  replicates: 2',
    '  parameters:',
    '    model.warrior.attack: {min: 90, max: 110, step: 10}',
    '    model.warrior.defense: {min: 70, max: 90, step: 10}',
    '  targets:',
    '    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}',
    '',
  ].join('\n')
  const EXP1 = EXP2.replace('    model.warrior.defense: {min: 70, max: 90, step: 10}\n', '')

  const baseline = hashId(ID_PREFIXES.baseline, 'walkthrough', EXP2)
  const derive = (values) => String(candidateIdFor(baseline, values))
  const runAll = (yaml, plan) => plan.candidates.map((c) => JSON.parse(wasm.sweep_candidate(yaml, plan.replicates, JSON.stringify(c))))

  const plan2 = JSON.parse(wasm.sweep_plan(EXP2, 0))
  assert.equal(plan2.mode, 'grid')
  assert.equal(plan2.candidates.length, 9)
  assert.equal(plan2.axes.length, 2)

  test('真实双因子 Grid → 热图:9 格全覆盖、均值逐格指回内核输出', () => {
    const results = runAll(EXP2, plan2)
    assert.ok(results.every((r) => r.status === 'ok'))
    const views = candidateViews(plan2, results, derive)
    const m = heatmapGrid(views, {
      xPath: 'model.warrior.attack', yPath: 'model.warrior.defense',
      metric: 'win_rate',
      xAxis: plan2.axes.find((a) => a.path === 'model.warrior.attack'),
      yAxis: plan2.axes.find((a) => a.path === 'model.warrior.defense'),
    })
    assert.equal(m.cells.size, 9)
    assert.deepEqual(m.missing, [])
    assert.deepEqual(m.skipped, [])
    // 逐格均值 = 内核该候选 win_rate 均值(口径原样,不乘 100 不舍入)
    for (const v of views) {
      const cell = m.cells.get(`${v.values['model.warrior.attack']}|${v.values['model.warrior.defense']}`)
      const kernelMean = v.stats.get('win_rate').mean
      assert.equal(cell.mean, kernelMean)
      assert.deepEqual(cell.ids, [v.id])
    }
  })

  test('真实部分返回 → 热图缺失格留空 + 失败点追踪三态', () => {
    const results = runAll(EXP2, plan2).slice(0, 7) // 后 2 槽未返回
    const views = candidateViews(plan2, results, derive)
    const m = heatmapGrid(views, {
      xPath: 'model.warrior.attack', yPath: 'model.warrior.defense',
      metric: 'win_rate',
      xAxis: plan2.axes.find((a) => a.path === 'model.warrior.attack'),
      yAxis: plan2.axes.find((a) => a.path === 'model.warrior.defense'),
    })
    assert.equal(m.cells.size, 7)
    assert.equal(m.missing.length, 2)
    const t = trackFailedPoints(plan2.candidates, results)
    assert.equal(t.ok, 7)
    assert.equal(t.missing.length, 2)
    assert.deepEqual(t.missing.map((x) => x.index), [7, 8])
    assert.equal(t.configErrors.length, 0)
  })

  test('真实散点:Grid 结果同样可作连续散点读(坐标=内核候选值)', () => {
    const results = runAll(EXP2, plan2)
    const views = candidateViews(plan2, results, derive)
    const m = scatterPoints(views, 'model.warrior.attack', 'model.warrior.defense', 'win_rate')
    assert.equal(m.drawable.length, 9)
    assert.equal(m.withheld.length, 0)
    const kernel = views[0]
    assert.equal(m.drawable[0].x, kernel.values['model.warrior.attack'])
    assert.equal(m.drawable[0].y, kernel.values['model.warrior.defense'])
    assert.equal(m.drawable[0].value, kernel.stats.get('win_rate').mean)
  })

  test('真实 Pareto:win_rate×gold_per_player 前沿来自内核观测(支配链自洽)', () => {
    const results = runAll(EXP2, plan2)
    const views = candidateViews(plan2, results, derive)
    const m = paretoFront(views, 'win_rate', 'gold_per_player', 'max', 'max')
    assert.ok(m.feasible.length >= 1)
    assert.equal(m.feasible.length + m.excluded.length, 9)
    // 前沿自洽:前沿上任一点不被任何可行点支配(max/max)
    for (const p of m.frontier) {
      for (const q of m.feasible) {
        const dom = q !== p && (q.x >= p.x || q.x === p.x) && (q.y >= p.y || q.y === p.y) && (q.x > p.x || q.y > p.y)
        assert.ok(!dom, `frontier point ${p.id} dominated by ${q.id}`)
      }
    }
  })

  test('真实单因子推荐 → OAT 矩阵:弹性来自 sweep_recommend,未覆盖留空', () => {
    const plan1 = JSON.parse(wasm.sweep_plan(EXP1, 0))
    const results = runAll(EXP1, plan1)
    const rec = JSON.parse(wasm.sweep_recommend(EXP1, JSON.stringify(results)))
    assert.ok(rec.elasticities.length >= 1)
    const m = oatMatrix(rec.elasticities)
    assert.deepEqual(m.params, ['model.warrior.attack'])
    const win = m.rows[0].cells.find((_, i) => m.metrics[i] === 'win_rate')
    const kernelE = rec.elasticities.find((e) => e.metric === 'win_rate')
    assert.equal(win.e, kernelE.e)
    assert.equal(win.significant, kernelE.significant)
    // 内核逐参数×逐指标给出弹性;矩阵行的空位只能是内核未覆盖的指标
    for (let i = 0; i < m.metrics.length; i++) {
      const cell = m.rows[0].cells[i]
      const kernel = rec.elasticities.find((e) => e.metric === m.metrics[i])
      if (kernel) { assert.equal(cell.e, kernel.e) } else { assert.equal(cell, null) }
    }
  })

  test('真实多因子推荐如实拒绝(内核只支持单参数轴)→ OAT 无数据即不造', () => {
    assert.throws(() => wasm.sweep_recommend(EXP2, JSON.stringify(runAll(EXP2, plan2))), /单参数轴/)
    // 矩阵层对空输入不造行(与 UI 的「推荐不可用」口径一致)
    const m = oatMatrix([])
    assert.deepEqual(m.params, [])
  })
}
