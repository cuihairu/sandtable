// WB-07.03/05/07/04/06/16 执行引擎(节点侧,CI web job 跑):
// 扫描逐候选 runSweepCandidate 调用序与候选边界进度、单候选 config_error 留集、
// 取消保留已完成候选、内存预算开跑前拒绝、单次/双臂仿真 Channel 进度 + 内核
// cancelRun、A/B 桥接调用点(compare 防御分支与注入)、竞争条件(幂等取消/入队即取消)。
// 真内核执行断言在 execution-kernel.test.mjs(pkg-node)。
// 跑法(仓库根):node --test apps/web/tests/executor.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { startExec, classifyKernelCancel, MAX_CANDIDATE_RESULTS_IN_MEMORY } from '../src/workbench/state/executor.ts'
import { ERROR_CLASS_LABEL, recoveryFor } from '../src/workbench/state/execFsm.ts'
import { METRIC_KEYS } from '../src/lib/types.ts'
import { fakeBackends, PLAN3, jobPatchSink, JOB } from './execFixtures.mjs'

// ————— WB-07.03/05/07 · 扫描执行:逐候选 runSweepCandidate + 候选边界进度 —————

test('WB-07.03/05:扫描按已校验计划逐候选调用 runSweepCandidate;进度只在候选边界', async () => {
  const { backends, calls } = fakeBackends()
  const { hooks, patches } = jobPatchSink()
  const ctl = startExec({ kind: 'sweep', yaml: 'exp-yaml', plan: PLAN3 }, backends, hooks, JOB)
  const out = await ctl.promise
  assert.equal(out.status, 'succeeded')
  assert.equal(calls.candidate.length, 3, '每候选一次 runSweepCandidate')
  assert.deepEqual(calls.candidate.map((c) => c.values['model.warrior.attack']), [90, 100, 110])
  assert.ok(calls.candidate.every((c) => c.replicates === 2 && c.yaml === 'exp-yaml'))
  assert.equal(calls.recommend, 1, '全部候选完成后才生成推荐')
  assert.equal(out.recommendation.recommendation.param, 'model.warrior.attack')

  // 进度 = 候选边界跳变(2→4→6),无候选内中间值(WB-07.05 不推算;
  // 终态更新重复的 6 为同一值,去重后只允许边界值)
  const dones = patches.filter((p) => p.patch.done !== undefined).map((p) => p.patch.done)
  assert.deepEqual([...new Set(dones)], [2, 4, 6])
  // 状态推进:queued 由 runManager 表达;执行器发 running → succeeded
  assert.equal(patches[0].patch.status, 'running')
  assert.equal(patches.at(-1).patch.status, 'succeeded')
  // 候选计数与结果随边界推进(0 = 起始态)
  const cands = patches.filter((p) => p.patch.exec?.candidatesDone !== undefined).map((p) => p.patch.exec.candidatesDone)
  assert.deepEqual(cands.filter((c) => c > 0), [1, 2, 3])
  // 无定时器:进度补丁数 = 边界数(不随时间增长)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(patches.length, patches.length, '无定时器补丁(纯事件驱动)')
})

test('WB-07.14:单候选 config_error 留在结果集;推荐仍基于完整候选集', async () => {
  const { backends, calls } = fakeBackends({
    candidate: async (yaml, replicates, values) => ({
      values,
      status: values['model.warrior.attack'] === 100 ? { config_error: '非法配置' } : 'ok',
      metric_stats: [],
      target_outcomes: [],
    }),
  })
  const { hooks } = jobPatchSink()
  const ctl = startExec({ kind: 'sweep', yaml: 'e', plan: PLAN3 }, backends, hooks, JOB)
  const out = await ctl.promise
  assert.equal(out.status, 'succeeded', '候选配置错误不是任务失败')
  assert.equal(out.results.length, 3)
  assert.equal(out.results[1].status.config_error, '非法配置', 'config_error 留在结果集')
  assert.equal(calls.recommend, 1)
  // done 只计 ok 候选的 replicates(统计正确)
  assert.equal(out.results.filter((r) => r.status === 'ok').length, 2)
})

test('WB-07.07:扫描取消在候选边界停止,保留已完成候选,不生成完整推荐', async () => {
  // 可控后端:第 1 个候选立即完成;第 2 个候选阻塞在 gate,测试先发取消再放行
  let release2
  const gate2 = new Promise((r) => { release2 = r })
  let firstSeen = false
  const { backends, calls } = fakeBackends({
    candidate: async (yaml, replicates, values) => {
      calls.candidate.push({ yaml, replicates, values })
      if (!firstSeen) {
        firstSeen = true
        return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
      }
      await gate2
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
  })
  const { hooks } = jobPatchSink()
  const ctl = startExec({ kind: 'sweep', yaml: 'e', plan: PLAN3 }, backends, hooks, JOB)
  const settled = ctl.promise
  // 等第 1 个候选的边界补丁落地
  for (let i = 0; i < 50; i++) await Promise.resolve()
  // 取消请求已发出(边界停止);随后放行在途候选
  await ctl.cancel(false)
  release2()
  const out = await settled
  assert.equal(out.status, 'cancelled')
  assert.equal(out.results.length, 2, '已完成候选(含取消时在途、真完成的)保留')
  assert.equal(calls.candidate.length, 2, '边界检查生效:第 3 个候选不再派发')
  assert.equal(calls.recommend, 0, '不完整数据不生成完整推荐')
  assert.equal(out.boundary.kind, 'candidate')
  assert.equal(out.boundary.done, 2)
  assert.equal(out.boundary.total, 3)
  assert.equal(calls.kernelCancel, 0, '扫描取消绝不调用内核取消令牌(WB-07.12)')
})

test('WB-07.12:内存预算——候选数超限开跑前拒绝,内核零调用', async () => {
  const { backends, calls } = fakeBackends()
  const { hooks } = jobPatchSink()
  const big = { candidates: Array.from({ length: MAX_CANDIDATE_RESULTS_IN_MEMORY + 1 }, () => ({ p: 1 })), replicates: 1, sims: MAX_CANDIDATE_RESULTS_IN_MEMORY + 1 }
  const ctl = startExec({ kind: 'sweep', yaml: 'e', plan: big }, backends, hooks, JOB)
  const out = await ctl.promise
  assert.equal(out.status, 'failed')
  assert.equal(out.errorClass, 'budget')
  assert.equal(calls.candidate.length, 0)
  assert.equal(ERROR_CLASS_LABEL.budget, '超出内存预算')
  assert.match(recoveryFor('budget', 'sweep'), /缩小实验规模/)
})
// ————— WB-07.04/06 · 单次/双臂仿真:Channel 进度 + 内核 cancelRun —————

test('WB-07.04:桌面仿真进度来自内核 Channel 事件(done/total 真实计数),无定时器', async () => {
  const { backends, calls, progressEvents } = fakeBackends()
  const { hooks, patches } = jobPatchSink()
  const ctl = startExec({ kind: 'single', yaml: 'sim-yaml', replicates: 3 }, backends, hooks, JOB)
  const out = await ctl.promise
  assert.equal(out.status, 'succeeded')
  assert.equal(calls.sim.length, 1)
  assert.equal(out.sim.config_hash, 'hash-1')
  assert.deepEqual(progressEvents, [1, 2, 3], '逐 replicate 真实事件')
  const dones = [...new Set(patches.filter((p) => p.patch.done !== undefined).map((p) => p.patch.done))]
  assert.deepEqual(dones, [1, 2, 3], 'done 只随内核事件推进(终态重复值去重)')
  const runPatch = patches[0].patch.exec
  assert.equal(runPatch.progressKind, 'replicates')
})

test('WB-07.06:桌面取消接 cancelRun——「取消请求已发出」与「已在 replicate 边界停止」分两段表达', async () => {
  // 仿真在途时发取消 → 内核令牌置位 → 内核按契约返回取消错误(带真实计数)
  let release
  const gate = new Promise((_, reject) => {
    release = () => reject(new Error('已取消: 完成 2/5 replicate'))
  })
  let entered = false
  const { backends, calls, progressEvents } = fakeBackends({
    sim: async (yaml, replicates, onProgress) => {
      entered = true
      onProgress?.({ done: 1, total: 5 })
      progressEvents.push(1)
      onProgress?.({ done: 2, total: 5 })
      progressEvents.push(2)
      await gate
      return {}
    },
  })
  const { hooks, patches } = jobPatchSink()
  const ctl = startExec({ kind: 'single', yaml: 's', replicates: 5 }, backends, hooks, JOB)
  const settled = ctl.promise
  for (let i = 0; i < 50; i++) await Promise.resolve() // 等仿真进入在途
  assert.equal(entered, true)
  await ctl.cancel(false) // 「取消请求已发出」:内核 cancelRun 置位令牌
  release() // 内核在 replicate 边界落地
  const out = await settled
  assert.equal(calls.kernelCancel, 1, '桌面取消调用内核 cancelRun')
  assert.equal(out.status, 'cancelled')
  assert.equal(out.boundary.kind, 'replicate')
  assert.equal(out.boundary.done, 2, '边界落地的真实计数(已在 replicate 边界停止)')
  assert.equal(out.boundary.total, 5)
  assert.deepEqual(progressEvents, [1, 2], '取消前只完成了 2 个 replicate')
  // 分类器直接锁桌面契约错误串
  assert.deepEqual(classifyKernelCancel('已取消: 完成 2/5 replicate'), { done: 2, total: 5 })
  assert.equal(classifyKernelCancel('配置错误: x'), null)
  // 状态推进:running → cancelling(请求已发出);cancelled 终态由 runManager 落
  const statuses = patches.filter((p) => p.patch.status !== undefined).map((p) => p.patch.status)
  assert.deepEqual(statuses, ['running', 'cancelling'])
})

test('WB-07.03:A/B 双臂真跑 + 桥接调用点(compare = null 防御分支报 bridge;注入 = 真调用)', async () => {
  // 场景 1:compare = null(防御/测试注入分支)→ 如实 failed(bridge),双臂输出保留
  const plain = fakeBackends()
  const { hooks: h1 } = jobPatchSink()
  const c1 = startExec(
    { kind: 'ab', baseYaml: 'base-yaml', candYaml: 'cand-yaml', replicates: 2, metric: 'win_rate' },
    plain.backends,
    h1,
    JOB,
  )
  const out1 = await c1.promise
  assert.equal(out1.status, 'failed')
  assert.equal(out1.errorClass, 'bridge')
  assert.match(out1.message, /WB-03\.10\/11/)
  assert.deepEqual(plain.calls.sim.map((s) => s.yaml), ['base-yaml', 'cand-yaml'], '双臂各自真跑(基线快照 + 候选草稿)')
  assert.notEqual(out1.arms.base, null)
  assert.notEqual(out1.arms.cand, null)
  assert.equal(out1.comparison, null, '不冒充统计判定')
  assert.equal(recoveryFor('bridge', 'ab').includes('WB-03.10/11'), true)

  // 场景 2:桥接已注入(WB-03.12 双端同构)→ 以双臂 YAML + metric + 已跑输出真调
  const cmpCalls = []
  const withBridge = fakeBackends({
    compare: async (baseYaml, candYaml, metric, base, cand) => {
      cmpCalls.push({ baseYaml, candYaml, metric, base: base.config_hash, cand: cand.config_hash })
      return { metric, diff_mean: 0.02, verdict: 'BHigher' }
    },
  })
  const { hooks: h2 } = jobPatchSink()
  const c2 = startExec(
    { kind: 'ab', baseYaml: 'base-yaml', candYaml: 'cand-yaml', replicates: 2, metric: 'win_rate' },
    withBridge.backends,
    h2,
    JOB,
  )
  const out2 = await c2.promise
  assert.equal(out2.status, 'succeeded')
  assert.equal(cmpCalls.length, METRIC_KEYS.length, '比较桥接逐 KPI 调用:主指标 + 其余全部 KPI(A/B 分析视图)')
  assert.equal(cmpCalls[0].metric, 'win_rate', '首个调用是主指标')
  assert.ok(cmpCalls.slice(1).every((c) => c.metric !== 'win_rate'), '主指标不重复比较')
  assert.deepEqual(
    [...new Set(cmpCalls.map((c) => `${c.base}:${c.cand}`))],
    ['hash-1:hash-2'],
    '逐 KPI 比较都用同一对真实双臂输出',
  )
  assert.equal(out2.comparison.verdict, 'BHigher')
  assert.equal(out2.comparisons?.length, METRIC_KEYS.length, '逐 KPI Comparison 全量保留')
  assert.equal(out2.comparisonErrors, null, '注入后端无拒绝 → 无不可用记录')
  assert.equal(out2.arms.base.config_hash, 'hash-1')
  assert.equal(out2.arms.cand.config_hash, 'hash-2')

  // 场景 3:部分 KPI 被内核显式拒绝 → 逐条原文记录为不可用,任务仍成功
  const partialCompare = fakeBackends({
    compare: async (_b, _c, metric) => {
      if (metric === 'gold_per_player' || metric === 'power_p50') throw new Error(`配置错误: ${metric} 不可用`)
      return { metric, diff_mean: 0.01, verdict: 'NoDifference' }
    },
  })
  const { hooks: h3 } = jobPatchSink()
  const c3 = startExec(
    { kind: 'ab', baseYaml: 'base-yaml', candYaml: 'cand-yaml', replicates: 2, metric: 'win_rate' },
    partialCompare.backends,
    h3,
    JOB,
  )
  const out3 = await c3.promise
  assert.equal(out3.status, 'succeeded')
  assert.equal(out3.comparisons?.length, METRIC_KEYS.length - 2, '被拒 KPI 不混入比较集')
  assert.deepEqual(out3.comparisonErrors?.map((e) => e.metric), ['gold_per_player', 'power_p50'], '拒绝逐条记录')
  assert.match(out3.comparisonErrors?.[0].message ?? '', /配置错误/, '原文错误保留')
})
// ————— WB-07.16 · 竞争条件 —————

test('WB-07.16:终态后取消/重复取消幂等;取消晚于完成 = 完成生效', async () => {
  // 终态后取消:cancel 直接 no-op(settled)
  const done = fakeBackends()
  const { hooks: h1 } = jobPatchSink()
  const c1 = startExec({ kind: 'single', yaml: 's', replicates: 1 }, done.backends, h1, JOB)
  await c1.promise
  await c1.cancel(false) // 终态后 → 无操作(不炸、不改状态)
  assert.equal(done.calls.kernelCancel, 0, '终态后取消不碰内核令牌')

  // 重复取消:第二次幂等
  const slow = fakeBackends({
    candidate: async (yaml, replicates, values) => {
      await new Promise((r) => setTimeout(r, 10))
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
  })
  const { hooks: h2, patches } = jobPatchSink()
  const c2 = startExec({ kind: 'sweep', yaml: 'e', plan: PLAN3 }, slow.backends, h2, JOB)
  const p2 = c2.promise
  await c2.cancel(false)
  await c2.cancel(false) // 重复取消 = 幂等
  void p2
  const cancellingWrites = patches.filter((p) => p.patch.status === 'cancelling').length
  assert.ok(cancellingWrites <= 2, 'cancelling 写入有限(不随重复取消膨胀)')

  // 取消与完成同时发生:全部候选完成后取消请求不再改变结局
  const fast = fakeBackends()
  const { hooks: h3 } = jobPatchSink()
  const c3 = startExec({ kind: 'sweep', yaml: 'e', plan: PLAN3 }, fast.backends, h3, JOB)
  const p3 = c3.promise
  const out3 = await p3
  await c3.cancel(false) // 全部候选已完成后才请求取消
  assert.equal(out3.status, 'succeeded', '完成先到先得')
  assert.equal(fast.calls.recommend, 1)
})

test('WB-07.16:入队即取消(queued)——不触碰内核,任务落取消', async () => {
  let resolveBackends
  const backends = new Promise((r) => { resolveBackends = r })
  const { hooks } = jobPatchSink()
  const ctl = startExec({ kind: 'sweep', yaml: 'e', plan: PLAN3 }, backends, hooks, JOB)
  const p = ctl.promise
  const cancelP = ctl.cancel(false) // 后端尚未就绪就取消(不等待,防死锁)
  resolveBackends(fakeBackends().backends)
  await cancelP
  const out = await p
  assert.equal(out.status, 'cancelled')
  assert.equal(out.results.length, 0)
  assert.equal(out.boundary.done, 0)
  assert.equal(out.boundary.total, 3)
  assert.equal(out.errorClass, null)
})
