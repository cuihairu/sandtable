// WB-07.08 / I-024 / WB-07.09 / WB-07.08-11 Worker 消息协议与服务端(节点侧,CI web job 跑):
// 协议信封版本 + 请求/响应守卫、内核杂项 kind(optimize/surrogate/daily_aggregate/kpi_eval)
// 转发、Worker 内 init 复用与失败重试、双臂载荷桥接、taskId 路由与终止后重建。
// 真内核执行断言在 execution-kernel.test.mjs(pkg-node)。
// 跑法(仓库根):node --test apps/web/tests/workerProtocol.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { WORKER_PROTOCOL_VERSION, isWorkerRequest, isWorkerResponse } from '../src/workbench/state/workerProtocol.ts'
import { serveSweepWorker } from '../src/workbench/state/sweepWorker.ts'
import { workerBackends } from '../src/workbench/state/executor.ts'

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
  // I-024 · 内核杂项 kind 同一信封:逐字段校验
  assert.equal(isWorkerRequest({ protocol: 1, kind: 'optimize', taskId: 'x', yaml: 'a' }), true)
  assert.equal(isWorkerRequest({ protocol: 1, kind: 'optimize', taskId: 'x' }), false, 'optimize 必须带 yaml')
  assert.equal(
    isWorkerRequest({ protocol: 1, kind: 'surrogate_train', taskId: 'x', results: [], metric: 'gold_per_player', trees: 32, maxDepth: 6, minSamplesLeaf: 2, seed: 7 }),
    true,
  )
  assert.equal(
    isWorkerRequest({ protocol: 1, kind: 'surrogate_train', taskId: 'x', results: 'nope', metric: 'm', trees: 32, maxDepth: 6, minSamplesLeaf: 2, seed: 7 }),
    false,
    'surrogate_train results 必须是数组',
  )
  assert.equal(isWorkerRequest({ protocol: 1, kind: 'surrogate_predict', taskId: 'x', modelJson: '{}', paramsJson: '{}' }), true)
  assert.equal(isWorkerRequest({ protocol: 1, kind: 'daily_aggregate', taskId: 'x', results: [] }), true)
  assert.equal(isWorkerRequest({ protocol: 1, kind: 'kpi_eval', taskId: 'x', expression: 'gold_per_player*2', results: [] }), true)
  assert.equal(isWorkerRequest({ protocol: 1, kind: 'kpi_eval', taskId: 'x', expression: 'gold_per_player*2', results: 'nope' }), false)
  assert.equal(isWorkerRequest(null), false)
  assert.equal(isWorkerRequest('hello'), false)

  const res = { protocol: WORKER_PROTOCOL_VERSION, kind: 'result', taskId: 'wreq_1', reqKind: 'plan', value: { reqKind: 'plan', plan: {} } }
  assert.equal(isWorkerResponse(res), true)
  assert.equal(
    isWorkerResponse({ protocol: 1, kind: 'result', taskId: 'wreq_1', reqKind: 'ab_compare', value: { reqKind: 'ab_compare', comparison: { verdict: 'BHigher' } } }),
    true,
    'ab_compare 结果响应在协议内',
  )
  assert.equal(
    isWorkerResponse({ protocol: 1, kind: 'result', taskId: 'wreq_1', reqKind: 'kpi_eval', value: { reqKind: 'kpi_eval', output: {} } }),
    true,
    'I-024 · kpi_eval 结果响应在协议内',
  )
  assert.equal(
    isWorkerResponse({ protocol: 1, kind: 'error', taskId: 'x', reqKind: 'daily_aggregate', errorClass: 'run', retryable: false, message: 'm' }),
    true,
    'I-024 · 杂项 kind 的 run 错误在协议内',
  )
  assert.equal(
    isWorkerResponse({ protocol: 1, kind: 'result', taskId: 'wreq_1', reqKind: 'magic', value: {} }),
    false,
    '未知 reqKind 拒绝',
  )
  assert.equal(isWorkerResponse({ ...res, protocol: 0 }), false)
  assert.equal(isWorkerResponse({ protocol: 1, kind: 'error', taskId: 'x', reqKind: null, errorClass: 'init', retryable: true, message: 'm' }), true)
  // progress 是协议内可用事件形态(serve 端不伪造,见 WB-07.05 断言)
  assert.equal(isWorkerResponse({ protocol: 1, kind: 'progress', taskId: 'x', done: 1, total: 2, scope: 'replicates' }), true)
  assert.equal(isWorkerResponse({ protocol: 1, kind: 'progress', taskId: 'x', done: 1, total: 2, scope: 'magic' }), false)
})
// ————— I-024 · 内核杂项 kind(optimize/surrogate/daily_aggregate/kpi_eval) —————

test('I-024:五个内核杂项 kind 经服务端转发,结果与运行错误都过协议信封', async () => {
  const outbox = []
  const calls = []
  const server = serveSweepWorker({
    post: (m) => outbox.push(m),
    init: async () => {},
    plan: async () => ({}),
    sim: async () => ({}),
    candidate: async () => ({}),
    recommend: async () => ({}),
    abCompare: async () => ({}),
    optimize: async (yaml) => {
      calls.push(['optimize', yaml])
      return { best: null }
    },
    surrogateTrain: async (...args) => {
      calls.push(['surrogate_train', ...args])
      return { trained: 3 }
    },
    surrogatePredict: async (modelJson, paramsJson) => {
      calls.push(['surrogate_predict', modelJson, paramsJson])
      return { mean: 1.5 }
    },
    dailyAggregate: async (results) => {
      calls.push(['daily_aggregate', results])
      return { replicates: 2 }
    },
    kpiEval: async (expression, results) => {
      calls.push(['kpi_eval', expression, results])
      return { n_used: 2 }
    },
  })
  await server.onMessage({ protocol: 1, kind: 'optimize', taskId: 'o1', yaml: 'a: 1' })
  assert.deepEqual(calls[0], ['optimize', 'a: 1'])
  assert.equal(outbox.at(-1).reqKind, 'optimize')
  assert.deepEqual(outbox.at(-1).value, { reqKind: 'optimize', result: { best: null } })

  await server.onMessage({
    protocol: 1,
    kind: 'surrogate_train',
    taskId: 'o2',
    results: [{ status: 'ok' }],
    metric: 'gold_per_player',
    trees: 32,
    maxDepth: 6,
    minSamplesLeaf: 2,
    seed: 7,
  })
  assert.deepEqual(calls[1], ['surrogate_train', [{ status: 'ok' }], 'gold_per_player', 32, 6, 2, 7], '参数按序透传(entry 侧做 BigInt 转换)')
  assert.equal(outbox.at(-1).reqKind, 'surrogate_train')

  await server.onMessage({ protocol: 1, kind: 'surrogate_predict', taskId: 'o3', modelJson: '{"m":1}', paramsJson: '{"x":2}' })
  assert.deepEqual(calls[2], ['surrogate_predict', '{"m":1}', '{"x":2}'])
  assert.equal(outbox.at(-1).reqKind, 'surrogate_predict')

  const results = [{ churn_rate_total: 0.1 }]
  await server.onMessage({ protocol: 1, kind: 'daily_aggregate', taskId: 'o4', results })
  assert.deepEqual(calls[3], ['daily_aggregate', results])
  assert.equal(outbox.at(-1).reqKind, 'daily_aggregate')

  await server.onMessage({ protocol: 1, kind: 'kpi_eval', taskId: 'o5', expression: 'gold_per_player*2', results })
  assert.deepEqual(calls[4], ['kpi_eval', 'gold_per_player*2', results])
  assert.equal(outbox.at(-1).reqKind, 'kpi_eval')
  assert.equal(outbox.at(-1).value.output.n_used, 2)

  // 运行错误仍是 run 类结构化 error(reqKind 带回,主线程按错误分类恢复)
  const failing = serveSweepWorker({
    post: (m) => outbox.push(m),
    init: async () => {},
    plan: async () => ({}),
    sim: async () => ({}),
    candidate: async () => ({}),
    recommend: async () => ({}),
    abCompare: async () => ({}),
    optimize: async () => {
      throw new Error('内核寻优失败(模拟)')
    },
    surrogateTrain: async () => ({}),
    surrogatePredict: async () => ({}),
    dailyAggregate: async () => ({}),
    kpiEval: async () => ({}),
  })
  await failing.onMessage({ protocol: 1, kind: 'optimize', taskId: 'o6', yaml: 'a: 1' })
  const last = outbox.at(-1)
  assert.equal(last.kind, 'error')
  assert.equal(last.errorClass, 'run')
  assert.equal(last.retryable, false, 'run 错误不可原样重试')
  assert.equal(last.reqKind, 'optimize')
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
