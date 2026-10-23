// 多维扫描设计守卫(WB-12 · todo L364,节点侧):设计期纯逻辑与内核
// core::sweep 同口径——grid_levels 不补尾点、组合预算先算账后物化、
// Random/LHS samples 预算、重复候选内容寻址归组、失败点三态追踪
// (ok / config_error 原文逐字保留 / 未返回留空不补 0)。
// 跑法(仓库根):node --test apps/web/tests/sweep-design.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_CANDIDATES,
  checkDomain,
  gridLevels,
  factorLevels,
  combinationBudget,
  samplingBudget,
  candidateDomainKey,
  duplicateGroups,
  trackFailedPoints,
} from '../src/lib/sweepDesign.ts'

test('checkDomain:合法域通过,非有限/max<min/step≤0 各自报因', () => {
  assert.deepEqual(checkDomain({ path: 'a', min: 0, max: 10, step: 5 }), { ok: true })
  assert.equal(checkDomain({ path: 'a', min: Number.NaN, max: 10, step: 5 }).error, 'not_finite')
  assert.equal(checkDomain({ path: 'a', min: Infinity, max: 10, step: 5 }).error, 'not_finite')
  assert.equal(checkDomain({ path: 'a', min: 0, max: -1, step: 5 }).error, 'max_lt_min')
  assert.equal(checkDomain({ path: 'a', min: 0, max: 10, step: 0 }).error, 'step_not_positive')
  assert.equal(checkDomain({ path: 'a', min: 0, max: 10, step: -5 }).error, 'step_not_positive')
  // 报因携带因子路径,便于设计器逐行定位
  const bad = checkDomain({ path: 'model.warrior.attack', min: 10, max: 0, step: 1 })
  assert.equal(bad.path, 'model.warrior.attack')
})

test('gridLevels:内核 grid_points 同口径——min + k·step,不补尾点', () => {
  assert.deepEqual(gridLevels({ path: 'a', min: 90, max: 110, step: 10 }), [90, 100, 110])
  // (max−min) 不是 step 整数倍 → 不补尾点(110 不会出现)
  assert.deepEqual(gridLevels({ path: 'a', min: 0, max: 10, step: 4 }), [0, 4, 8])
  // 浮点步长容差:0.1×3 恰好到 0.3
  const eps = gridLevels({ path: 'a', min: 0, max: 0.3, step: 0.1 })
  assert.equal(eps.length, 4)
  assert.ok(Math.abs(eps[3] - 0.3) < 1e-9)
  // 单点域:min = max
  assert.deepEqual(gridLevels({ path: 'a', min: 5, max: 5, step: 1 }), [5])
  // 非法域 = null(不编造水平表)
  assert.equal(gridLevels({ path: 'a', min: 10, max: 0, step: 1 }), null)
})

test('factorLevels:逐因子给出水平表,非法因子位置为 null', () => {
  const axes = [
    { path: 'p1', min: 0, max: 10, step: 5 },
    { path: 'p2', min: 10, max: 0, step: 5 },
  ]
  const levels = factorLevels(axes)
  assert.deepEqual(levels[0], { path: 'p1', levels: [0, 5, 10] })
  assert.equal(levels[1], null)
})

test('combinationBudget:逐维水平数乘积;超上限拒绝并给出累计值', () => {
  const ok = combinationBudget([
    { path: 'a', min: 90, max: 110, step: 10 },
    { path: 'b', min: 70, max: 90, step: 10 },
  ])
  assert.equal(ok.ok, true)
  assert.equal(ok.total, 9)
  assert.deepEqual(ok.perAxis, [{ path: 'a', levels: 3 }, { path: 'b', levels: 3 }])
  // 上限:水平数饱和乘积恰好 MAX_CANDIDATES 仍可,再加一维即拒
  const atLimit = combinationBudget([{ path: 'a', min: 0, max: MAX_CANDIDATES - 1, step: 1 }])
  assert.equal(atLimit.ok, true)
  assert.equal(atLimit.total, MAX_CANDIDATES)
  const over = combinationBudget([
    { path: 'a', min: 0, max: MAX_CANDIDATES - 1, step: 1 },
    { path: 'b', min: 0, max: 1, step: 1 },
  ])
  assert.equal(over.ok, false)
  assert.equal(over.reason, 'over_budget')
  assert.equal(over.detail, 'b')
  assert.equal(over.total, MAX_CANDIDATES + 1) // 饱和值,不真算天文数字
  // 非法域:拒绝并指认因子
  const invalid = combinationBudget([{ path: 'bad', min: 5, max: 0, step: 1 }])
  assert.equal(invalid.ok, false)
  assert.equal(invalid.reason, 'invalid_domain')
  assert.equal(invalid.detail, 'bad')
})

test('samplingBudget:Random/LHS samples ∈ [1, MAX_CANDIDATES]', () => {
  assert.deepEqual(samplingBudget(1), { ok: true })
  assert.deepEqual(samplingBudget(12), { ok: true })
  assert.deepEqual(samplingBudget(MAX_CANDIDATES), { ok: true })
  assert.equal(samplingBudget(0).reason, 'not_positive')
  assert.equal(samplingBudget(-3).reason, 'not_positive')
  assert.equal(samplingBudget(1.5).reason, 'not_positive')
  assert.equal(samplingBudget(MAX_CANDIDATES + 1).reason, 'over_budget')
})

test('candidateDomainKey:规范键按路径排序,同域恒同键', () => {
  const k1 = candidateDomainKey({ 'model.warrior.attack': 90, 'model.warrior.defense': 70 })
  const k2 = candidateDomainKey({ 'model.warrior.defense': 70, 'model.warrior.attack': 90 })
  assert.equal(k1, k2)
  assert.equal(k1, 'model.warrior.attack=90|model.warrior.defense=70')
  assert.notEqual(k1, candidateDomainKey({ 'model.warrior.attack': 100, 'model.warrior.defense': 70 }))
})

test('duplicateGroups:参数域全同的计划槽归组,unique/重复计数正确', () => {
  const cands = [
    { a: 90, b: 70 },
    { a: 100, b: 70 },
    { a: 90, b: 70 }, // 与槽 0 同域
    { a: 110, b: 90 },
    { a: 100, b: 70 }, // 与槽 1 同域
  ]
  const rep = duplicateGroups(cands)
  assert.equal(rep.uniqueCount, 3)
  assert.equal(rep.duplicateSlots, 2)
  assert.equal(rep.groups.length, 2)
  assert.deepEqual(rep.groups.map((g) => g.indices), [[0, 2], [1, 4]])
  // 无重复:空组表
  const clean = duplicateGroups([{ a: 1 }, { a: 2 }])
  assert.equal(clean.uniqueCount, 2)
  assert.equal(clean.duplicateSlots, 0)
  assert.equal(clean.groups.length, 0)
})

test('trackFailedPoints:ok 计数、config_error 原文保留、未返回槽位不补 0', () => {
  const cands = [
    { a: 90 },
    { a: 100 },
    { a: 110 },
    { a: 120 },
  ]
  const results = [
    { status: 'ok' },
    { status: { config_error: '配置无效: sweep.parameters: path 不在参数注册表' } },
    null, // 尚未返回
    // 槽 3 完全没有返回位(results 更短)
  ]
  const t = trackFailedPoints(cands, results)
  assert.equal(t.ok, 1)
  assert.equal(t.configErrors.length, 1)
  assert.equal(t.configErrors[0].index, 1)
  assert.equal(t.configErrors[0].message, '配置无效: sweep.parameters: path 不在参数注册表')
  assert.deepEqual(t.configErrors[0].values, { a: 100 })
  assert.equal(t.missing.length, 2)
  assert.deepEqual(t.missing.map((m) => m.index), [2, 3])
})

test('trackFailedPoints:全部返回且全部 ok → 无失败点', () => {
  const t = trackFailedPoints([{ a: 1 }, { a: 2 }], [{ status: 'ok' }, { status: 'ok' }])
  assert.equal(t.ok, 2)
  assert.equal(t.configErrors.length, 0)
  assert.equal(t.missing.length, 0)
})
