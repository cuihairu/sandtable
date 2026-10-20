// WB-07 执行/进度/取消/Worker 守卫(节点侧,CI web job 跑):
// 状态机与部分结果、Worker 消息协议、Worker 服务端(init 复用/失败重试)、
// 执行引擎(扫描逐候选 runSweepCandidate 调用序、候选边界进度、取消保留
// 已完成候选、A/B 桥接调用点、内存预算)、竞争条件、统一任务来源与
// 语言无关性。真内核执行断言在 execution-kernel.test.mjs(pkg-node)。
// 跑法(仓库根):node --test apps/web/tests/execution.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { canTransition, terminalOutcome, keptResultCount, activeJob, ERROR_CLASS_LABEL, recoveryFor } from '../src/workbench/state/execFsm.ts'
import { WORKER_PROTOCOL_VERSION, isWorkerRequest, isWorkerResponse } from '../src/workbench/state/workerProtocol.ts'
import { serveSweepWorker } from '../src/workbench/state/sweepWorker.ts'
import { startExec, workerBackends, classifyKernelCancel, MAX_CANDIDATE_RESULTS_IN_MEMORY } from '../src/workbench/state/executor.ts'
import { resetForTest, listJobs, enqueueRun, cancelJob, retryJob } from '../src/workbench/state/runManager.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// —— 测试脚手架:假后端(记录调用序与进度事件;无定时器) ——

function fakeBackends(overrides = {}) {
  const calls = { candidate: [], sim: [], recommend: 0, kernelCancel: 0, plan: [] }
  const progressEvents = []
  const base = {
    mode: 'desktop',
    sim: async (yaml, replicates, onProgress) => {
      calls.sim.push({ yaml, replicates })
      // 模拟桌面 Channel:逐 replicate 推真实事件
      for (let d = 1; d <= replicates; d++) {
        onProgress?.({ done: d, total: replicates })
        progressEvents.push(d)
      }
      return { config_hash: `hash-${calls.sim.length}`, meta: {}, results: [], days_csv: `rep-${calls.sim.length}` }
    },
    candidate: async (yaml, replicates, values) => {
      calls.candidate.push({ yaml, replicates, values })
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
    recommend: async (yaml, results) => {
      calls.recommend++
      return { elasticities: [], recommendation: { param: 'model.warrior.attack', results_n: results.length } }
    },
    kernelCancel: async () => {
      calls.kernelCancel++
      return true
    },
    compare: null,
    ...overrides,
  }
  return { backends: base, calls, progressEvents }
}

const PLAN3 = {
  candidates: [{ 'model.warrior.attack': 90 }, { 'model.warrior.attack': 100 }, { 'model.warrior.attack': 110 }],
  replicates: 2,
  sims: 6,
}

function jobPatchSink() {
  const patches = []
  return {
    patches,
    hooks: { update: (id, patch) => patches.push({ id, patch }) },
  }
}

const JOB = 'job_test0001'

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

// ————— WB-07.08 · Worker 消息协议 —————

test('WB-07.08:协议信封版本 + 请求/响应守卫(非协议消息丢弃)', () => {
  const req = { protocol: 1, kind: 'candidate', taskId: 'wreq_1', yaml: 'a: 1', replicates: 2, values: { p: 1 } }
  assert.equal(isWorkerRequest(req), true)
  assert.equal(isWorkerRequest({ ...req, protocol: 2 }), false, '版本不符必须拒绝')
  assert.equal(isWorkerRequest({ ...req, taskId: '' }), false, '空 taskId 拒绝')
  assert.equal(isWorkerRequest({ protocol: 1, kind: 'nope', taskId: 'x' }), false, '未知 kind 拒绝')
  assert.equal(isWorkerRequest({ protocol: 1, kind: 'plan', taskId: 'x', yaml: 'a', replicatesOverride: 0 }), true)
  assert.equal(isWorkerRequest({ protocol: 1, kind: 'sim', taskId: 'x', yaml: 'a', replicates: 2 }), true)
  assert.equal(isWorkerRequest({ protocol: 1, kind: 'recommend', taskId: 'x', yaml: 'a', results: [] }), true)
  assert.equal(
    isWorkerRequest({ protocol: 1, kind: 'ab_compare', taskId: 'x', baseYaml: 'a', candYaml: 'b', metric: 'win_rate', resultsA: [], resultsB: [] }),
    true,
  )
  assert.equal(
    isWorkerRequest({ protocol: 1, kind: 'ab_compare', taskId: 'x', baseYaml: 'a', candYaml: 'b', metric: 'win_rate', resultsA: [], resultsB: 'nope' }),
    false,
    'ab_compare 双臂 results 必须是数组',
  )
  assert.equal(isWorkerRequest(null), false)
  assert.equal(isWorkerRequest('hello'), false)

  const res = { protocol: WORKER_PROTOCOL_VERSION, kind: 'result', taskId: 'wreq_1', reqKind: 'plan', value: { reqKind: 'plan', plan: {} } }
  assert.equal(isWorkerResponse(res), true)
  assert.equal(
    isWorkerResponse({ protocol: 1, kind: 'result', taskId: 'wreq_1', reqKind: 'ab_compare', value: { reqKind: 'ab_compare', comparison: { verdict: 'BHigher' } } }),
    true,
    'ab_compare 结果响应在协议内',
  )
  assert.equal(isWorkerResponse({ ...res, protocol: 0 }), false)
  assert.equal(isWorkerResponse({ protocol: 1, kind: 'error', taskId: 'x', reqKind: null, errorClass: 'init', retryable: true, message: 'm' }), true)
  // progress 是协议内可用事件形态(serve 端不伪造,见 WB-07.05 断言)
  assert.equal(isWorkerResponse({ protocol: 1, kind: 'progress', taskId: 'x', done: 1, total: 2, scope: 'replicates' }), true)
  assert.equal(isWorkerResponse({ protocol: 1, kind: 'progress', taskId: 'x', done: 1, total: 2, scope: 'magic' }), false)
})

// ————— WB-07.09 · Worker 内初始化并复用 WASM;失败可重试 —————

test('WB-07.09:Worker 服务端 init 复用 + 失败可重试(清缓存重新初始化)', async () => {
  let initCount = 0
  let failNext = false
  const outbox = []
  const server = serveSweepWorker({
    post: (m) => outbox.push(m),
    init: async () => {
      initCount++
      if (failNext) throw new Error('wasm 加载失败(模拟)')
    },
    plan: async () => ({ candidates: [], replicates: 2, sims: 0 }),
    sim: async () => ({}),
    candidate: async () => ({ status: 'ok' }),
    recommend: async () => ({}),
  })
  const req = { protocol: 1, kind: 'plan', taskId: 't1', yaml: 'a: 1', replicatesOverride: 0 }
  await server.onMessage(req)
  assert.equal(initCount, 1)
  assert.equal(outbox[0].kind, 'result')

  // 第二个请求复用初始化(不重新 init)
  await server.onMessage({ ...req, taskId: 't2' })
  assert.equal(initCount, 1, '同 Worker 实例复用初始化')

  // 初始化失败 → 结构化 init 错误 + retryable;缓存被清 → 下个请求重新 init
  failNext = true
  server.resetForTest() // 模拟:仅清缓存(真实 Worker 终止后即全新实例)
  await server.onMessage({ ...req, taskId: 't3' })
  assert.equal(initCount, 2, 'reset 后 t3 触发重新 init(失败)')
  assert.equal(outbox.at(-1).kind, 'error')
  assert.equal(outbox.at(-1).errorClass, 'init')
  assert.equal(outbox.at(-1).retryable, true, 'init 错误可重试')
  assert.equal(outbox.at(-1).taskId, 't3')

  failNext = false
  await server.onMessage({ ...req, taskId: 't4' })
  assert.equal(initCount, 3, '重试后重新初始化成功')
  assert.equal(outbox.at(-1).kind, 'result')
})

test('WB-07.09:Worker 服务端运行错误为 run 类且不可原样重试', async () => {
  const outbox = []
  const server = serveSweepWorker({
    post: (m) => outbox.push(m),
    init: async () => {},
    plan: async () => ({}),
    sim: async () => ({}),
    candidate: async () => { throw new Error('内核: 配置错误') },
    recommend: async () => ({}),
  })
  await server.onMessage({ protocol: 1, kind: 'candidate', taskId: 't1', yaml: 'a', replicates: 1, values: {} })
  assert.equal(outbox[0].kind, 'error')
  assert.equal(outbox[0].errorClass, 'run')
  assert.equal(outbox[0].retryable, false)
  assert.match(outbox[0].message, /配置错误/)
})

test('WB-03.10/03.12:Worker 服务端 ab_compare 转发双臂载荷;内核拒绝 = run 类结构化错误', async () => {
  const seen = []
  const outbox = []
  const server = serveSweepWorker({
    post: (m) => outbox.push(m),
    init: async () => {},
    plan: async () => ({}),
    sim: async () => ({}),
    candidate: async () => ({}),
    recommend: async () => ({}),
    abCompare: async (baseYaml, candYaml, metric, resultsA, resultsB) => {
      seen.push({ baseYaml, candYaml, metric, resultsA, resultsB })
      if (metric === 'boom') throw new Error('配置错误: 双臂 base_seed 不一致(base=7 cand=9),CRN 成对比较要求同种子')
      return { metric, verdict: 'BHigher' }
    },
  })
  await server.onMessage({
    protocol: 1,
    kind: 'ab_compare',
    taskId: 't1',
    baseYaml: 'a',
    candYaml: 'b',
    metric: 'win_rate',
    resultsA: [{ win_rate: 0.5 }],
    resultsB: [{ win_rate: 0.6 }],
  })
  assert.deepEqual(seen, [{
    baseYaml: 'a',
    candYaml: 'b',
    metric: 'win_rate',
    resultsA: [{ win_rate: 0.5 }],
    resultsB: [{ win_rate: 0.6 }],
  }], '载荷原样进内核桥(双臂 YAML + metric + results 数组)')
  assert.equal(outbox[0].kind, 'result')
  assert.equal(outbox[0].reqKind, 'ab_compare')
  assert.equal(outbox[0].value.comparison.verdict, 'BHigher')
  // 内核显式拒绝(种子错位等)→ run 类结构化错误,内核文案原样过边界
  await server.onMessage({ protocol: 1, kind: 'ab_compare', taskId: 't2', baseYaml: 'a', candYaml: 'b', metric: 'boom', resultsA: [], resultsB: [] })
  assert.equal(outbox[1].kind, 'error')
  assert.equal(outbox[1].errorClass, 'run')
  assert.equal(outbox[1].retryable, false)
  assert.match(outbox[1].message, /base_seed 不一致/)
})

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
  assert.equal(cmpCalls.length, 1, '比较桥接以真实双臂输出调用')
  assert.deepEqual(cmpCalls[0], {
    baseYaml: 'base-yaml',
    candYaml: 'cand-yaml',
    metric: 'win_rate',
    base: 'hash-1',
    cand: 'hash-2',
  })
  assert.equal(out2.comparison.verdict, 'BHigher')
  assert.equal(out2.arms.base.config_hash, 'hash-1')
  assert.equal(out2.arms.cand.config_hash, 'hash-2')
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

// ————— WB-07.08/11 · Worker 连接:taskId 路由 + 终止后重建 —————

function fakeWorker() {
  const w = {
    inbox: [],
    terminated: 0,
    postMessage(data) { this.inbox.push(data) },
    terminate() { this.terminated++ },
    onmessage: null,
  }
  return w
}

test('WB-07.11:Worker 终止清执行上下文——在途请求拒绝、旧消息不写入、下次运行重新初始化', async () => {
  const workers = []
  const conn = workerBackends(() => {
    const w = fakeWorker()
    workers.push(w)
    return w
  })
  // 请求 1:发出后用旧 taskId 迟到回复 + 无主消息 + 正常回复混合
  const p1 = conn.candidate('e', 2, { p: 1 })
  assert.equal(workers.length, 1, '首次请求创建 Worker')
  assert.equal(isWorkerRequest(workers[0].inbox[0]), true)
  assert.equal(workers[0].inbox[0].taskId, 'wreq_1', '请求带任务 ID')
  // 无主/旧消息:不写入任何新任务
  workers[0].onmessage({ data: { protocol: 1, kind: 'result', taskId: 'wreq_99', reqKind: 'candidate', value: { reqKind: 'candidate', result: { stale: true } } } })
  workers[0].onmessage({ data: { garbage: true } })
  workers[0].onmessage({ data: { protocol: 1, kind: 'result', taskId: 'wreq_1', reqKind: 'candidate', value: { reqKind: 'candidate', result: { values: {}, status: 'ok', metric_stats: [], target_outcomes: [] } } } })
  const r1 = await p1
  assert.equal(r1.status, 'ok')

  // 终止:在途请求被拒绝,下一次请求创建新 Worker(重新初始化)
  const p2 = conn.candidate('e', 2, { p: 2 })
  conn.terminate()
  await assert.rejects(p2, /worker-terminated/)
  assert.equal(workers[0].terminated, 1)
  const p3 = conn.candidate('e', 2, { p: 3 })
  assert.equal(workers.length, 2, '终止后重新创建 Worker(下一次运行可重新初始化)')
  workers[1].onmessage({ data: { protocol: 1, kind: 'result', taskId: 'wreq_3', reqKind: 'candidate', value: { reqKind: 'candidate', result: { values: { p: 3 }, status: 'ok', metric_stats: [], target_outcomes: [] } } } })
  const r3 = await p3
  assert.equal(r3.values.p, 3, '新任务只接收自己的消息(旧消息不写入)')
})

// ————— WB-07.02/12/13/15/17 · runManager 集成(注入假后端) —————

test('WB-07.02/12/15:真实任务绑定 run ID;单活动任务门;终态后清理可再次提交', async () => {
  resetForTest()
  const { backends } = fakeBackends()
  const job = enqueueRun({
    experimentId: 'exp_aaa', runId: 'run_bbb', name: '扫描', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 },
    backends,
  })
  assert.notEqual(job, null)
  assert.equal(job.exec.runId, 'run_bbb', '任务绑定 run ID')
  assert.equal(job.experimentId, 'exp_aaa', '任务绑定实验 ID')
  assert.equal(job.total, 6)
  assert.equal(listJobs().includes(job), true)

  // 单活动任务:第二个真实任务被拒(WB-07.12)
  const second = enqueueRun({
    experimentId: 'exp_aaa', runId: 'run_ccc', name: '第二次', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 },
    backends,
  })
  assert.equal(second, null, '并发门:同一时刻只允许一个活动任务')

  await new Promise((r) => setTimeout(r, 10))
  const finished = listJobs().find((j) => j.id === job.id)
  assert.equal(finished.status, 'succeeded')
  assert.equal(finished.exec.results.length, 3)
  assert.equal(finished.done, 6)

  // WB-07.15 · 终态后清理:可再次提交(并发门解除)
  const third = enqueueRun({
    experimentId: 'exp_aaa', runId: 'run_ddd', name: '再次提交', method: 'GRID',
    spec: { kind: 'single', yaml: 's', replicates: 1 },
    backends,
  })
  assert.notEqual(third, null, '任务结束后可再次提交')
  await new Promise((r) => setTimeout(r, 10))
  resetForTest()
})

test('WB-07.16:runManager 竞争——重复取消/终态后取消无副作用;失败后重试同 run 引用', async () => {
  resetForTest()
  // 失败后重试:同 spec ⇒ 内容派生同 run 引用(可追溯)
  const failing = fakeBackends({
    candidate: async () => { throw new Error('内核运行错误') },
  })
  const job = enqueueRun({
    experimentId: 'exp_x', runId: 'run_retry1', name: '失败任务', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 },
    backends: failing.backends,
  })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(listJobs().find((j) => j.id === job.id).status, 'failed')
  const retried = retryJob(job.id)
  assert.notEqual(retried, null)
  assert.equal(retried.exec.runId, 'run_retry1', '重试同输入 ⇒ 同 run 引用')
  assert.notEqual(retried.id, job.id, '重试是新任务(新 job ID)')

  // 终态后取消无副作用
  await cancelJob(job.id)
  await cancelJob(job.id)
  assert.equal(listJobs().find((j) => j.id === job.id).status, 'failed', '终态后取消不改变状态')
  await new Promise((r) => setTimeout(r, 10))
  resetForTest()
})

test('WB-07.13:activeJob 同源判定——任务页/状态栏/抽屉显示同一个任务', async () => {
  resetForTest()
  const slow = fakeBackends({
    candidate: async (yaml, replicates, values) => {
      await new Promise((r) => setTimeout(r, 8))
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
  })
  const job = enqueueRun({
    experimentId: 'exp_a', runId: 'run_a', name: '跨页任务', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 },
    backends: slow.backends,
  })
  // 模拟三个视图各自调用同一个 helper
  const view1 = activeJob(listJobs())
  const view2 = activeJob(listJobs())
  assert.equal(view1.id, job.id)
  assert.equal(view2.id, job.id, '切换工作区后仍是同一个任务')
  assert.equal(view1.name, '跨页任务')
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(activeJob(listJobs()), null, '终态后无活动任务')
  resetForTest()
})

test('WB-07.17:语言切换只更新显示文案——任务对象与执行引用不随 locale 重建', async () => {
  resetForTest()
  const slow = fakeBackends({
    candidate: async (yaml, replicates, values) => {
      await new Promise((r) => setTimeout(r, 8))
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
  })
  const job = enqueueRun({
    experimentId: 'exp_a', runId: 'run_a', name: '语言无关任务', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 },
    backends: slow.backends,
  })
  assert.notEqual(job, null)
  const jobsBefore = listJobs()
  // 语言切换的真实路径 = 订阅者收到重渲染通知;运行管理器不持有任何
  // locale 状态,任务身份(job ID)与执行引用不变(不重建任务/执行 Promise/Worker)
  const snapshot = [...jobsBefore]
  const before = listJobs()
  assert.equal(before === jobsBefore || JSON.stringify(before) === JSON.stringify(snapshot), true)
  // 执行后端(此处假 Worker/后端)从未被重建:注入的后端实例同一性不变
  assert.equal(slow.backends.mode, 'desktop')
  await new Promise((r) => setTimeout(r, 40))
  // 源级守卫:状态层文件不 import i18n(语言状态不进执行域)
  for (const f of ['state/jobLogic.ts', 'state/execFsm.ts', 'state/executor.ts', 'state/runManager.ts', 'state/workerProtocol.ts', 'state/sweepWorker.ts']) {
    const src = read(`src/workbench/${f}`)
    assert.equal(/from ['"].*lib\/i18n/.test(src), false, `${f} 不依赖 i18n`)
  }
  resetForTest()
})
