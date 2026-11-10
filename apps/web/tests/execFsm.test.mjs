// WB-07.01 状态机与部分结果(节点侧,CI web job 跑):
// 六态迁移守卫、终态三分 complete/partial/empty、可保留结果计数。
// 真内核执行断言在 execution-kernel.test.mjs(pkg-node)。
// 跑法(仓库根):node --test apps/web/tests/execFsm.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { canTransition, terminalOutcome, keptResultCount } from '../src/workbench/state/execFsm.ts'
import { PLAN3, JOB } from './execFixtures.mjs'

// ————— WB-07.01 · 状态机与部分结果 —————

test('WB-07.01:六态迁移守卫——终态不可再变,cancelling 只落 cancelled/failed', () => {
  assert.equal(canTransition('queued', 'running'), true)
  assert.equal(canTransition('queued', 'cancelled'), true) // 未启动即取消 = 本地终态
  assert.equal(canTransition('running', 'cancelling'), true)
  assert.equal(canTransition('running', 'succeeded'), true)
  assert.equal(canTransition('running', 'failed'), true)
  assert.equal(canTransition('cancelling', 'cancelled'), true)
  assert.equal(canTransition('cancelling', 'succeeded'), true) // 取消与完成竞争:完成先落
  assert.equal(canTransition('cancelling', 'failed'), true)
  // 非法迁移
  assert.equal(canTransition('queued', 'cancelling'), false)
  assert.equal(canTransition('running', 'cancelled'), false) // 运行中取消必须经 cancelling
  assert.equal(canTransition('succeeded', 'failed'), false)
  assert.equal(canTransition('cancelled', 'running'), false)
  assert.equal(canTransition('failed', 'running'), false)
  assert.equal(canTransition('running', 'running'), false)
})

test('WB-07.01:终态三分 complete/partial/empty 区分有部分结果的状态', () => {
  const ex = (results, extra = {}) => ({
    runId: 'run_x', kind: 'sweep', spec: { kind: 'sweep', yaml: '', plan: PLAN3 },
    progressKind: 'candidates', replicates: 2, candidatesDone: results.length, candidatesTotal: 3,
    results, recommendation: null, recommendationError: null, comparison: null, arms: null, sim: null,
    errorClass: null, errorMessage: null, ...extra,
  })
  const ok = { status: 'ok' }
  const err = { status: { config_error: '参数错误' } }
  const mk = (status, results, extra = {}) => ({ id: JOB, status, done: 0, total: 6, demo: false, exec: ex(results, extra) })
  assert.equal(terminalOutcome(mk('succeeded', [ok, ok])), 'complete')
  // 取消但保留 2 个已完成候选 = partial(WB-07.07)
  assert.equal(terminalOutcome(mk('cancelled', [ok, ok])), 'partial')
  // 失败但保留双臂输出 = partial(WB-07.14 桥接未接入场景)
  assert.equal(terminalOutcome(mk('failed', [], { arms: { base: {}, cand: {} }, results: [] })), 'partial')
  // 失败且无任何保留 = empty
  assert.equal(terminalOutcome(mk('failed', [])), 'empty')
  // config_error 不算可用产物(但留在结果集)
  assert.equal(keptResultCount(mk('failed', [err])), 0)
  assert.equal(terminalOutcome(mk('failed', [err])), 'empty')
  // 非终态 → null
  assert.equal(terminalOutcome(mk('running', [ok])), null)
  assert.equal(terminalOutcome(mk('cancelling', [ok])), null)
  // 演示任务(无 exec)→ empty/complete 由状态决定,不炸
  assert.equal(terminalOutcome({ id: JOB, status: 'cancelled', done: 3, total: 6, demo: true }), 'empty')
})
