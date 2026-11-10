// WB-07.02/12/13/15/17 + ST-AUD-12/13/20/21 runManager 集成与队列(节点侧,CI web job 跑):
// 真实任务绑定 run ID、单活动任务门、排队自动续跑、取消/重试语义(同 run 引用)、
// 并发与内存预算调度、队列持久化恢复(版本/形状校验 + 伪造字段剥离)、终局统一释放、
// 语言无关性、activeJob 同源判定。注入假后端,不经真实 Worker。
// 跑法(仓库根):node --test apps/web/tests/runManager.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { activeJob } from '../src/workbench/state/execFsm.ts'
import { resetForTest, listJobs, enqueueRun, cancelJob, retryJob, getSchedulingConfig, setSchedulingConfig, restorePersistedQueue } from '../src/workbench/state/runManager.ts'
import { WAIT_REASON_LABEL } from '../src/workbench/state/jobLogic.ts'
import { QUEUE_STORAGE_KEY, SCHEDULE_STORAGE_KEY, persistQueueState, restoreQueueState, persistSchedulingState, restoreSchedulingState } from '../src/workbench/state/projectDoc.ts'
import { MAX_CANDIDATE_RESULTS_IN_MEMORY } from '../src/workbench/state/executor.ts'
import { fakeBackends, PLAN3, memoryStorage, persistedRealJob, read } from './execFixtures.mjs'

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

  // 多任务排队:第二个真实任务进入队列;WB-07.12 的执行槽仍保持单并发
  const second = enqueueRun({
    experimentId: 'exp_aaa', runId: 'run_ccc', name: '第二次', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 },
    backends,
  })
  assert.notEqual(second, null, '并发门改为排队:执行槽忙时仍接收任务')
  assert.equal(second.status, 'queued', '执行槽忙时新任务排队')

  await new Promise((r) => setTimeout(r, 10))
  const finished = listJobs().find((j) => j.id === job.id)
  assert.equal(finished.status, 'succeeded')
  assert.equal(finished.exec.results.length, 3)
  assert.equal(finished.done, 6)
  assert.equal(listJobs().find((j) => j.id === second.id).status, 'succeeded', '终态后队列自动续跑')

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
  assert.equal(retried.id, job.id, '失败点重试保持任务身份与执行快照')

  // 原位重试仍是 queued:取消请求按排队语义落终态,重复取消无副作用
  await cancelJob(job.id)
  await cancelJob(job.id)
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(listJobs().find((j) => j.id === job.id).status, 'cancelled', 'queued 重试取消后终态不改变')
  resetForTest()
})

test('WB-07.17 · ST-AUD-12:终局 promise 拒绝不得占死并发槽——失败分支清控制引用并续跑队列', async () => {
  resetForTest()
  // backend 解析自身 reject:startExec 内 `await backends` 抛错 ⇒ controls.promise 拒绝。
  // 无 .then(ok,err) 处理时 activeControls 永不删除,队列永久卡死(I-012)。
  const rejectBackends = Promise.reject(new Error('backend 初始化失败'))
  const job = enqueueRun({
    experimentId: 'exp_staud12', runId: 'run_staud12', name: '拒绝任务', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 },
    backends: rejectBackends,
  })
  await new Promise((r) => setTimeout(r, 10))
  const failed = listJobs().find((j) => j.id === job.id)
  assert.equal(failed.status, 'failed', '拒绝后端落 failed 终态,不永久卡 running')
  assert.equal(failed.exec.errorClass, 'run')

  // 队列须可继续:并发槽已释放,后续正常任务能执行到终态
  const { backends } = fakeBackends()
  const next = enqueueRun({
    experimentId: 'exp_staud12b', runId: 'run_staud12b', name: '后续任务', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 },
    backends,
  })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(listJobs().find((j) => j.id === next.id).status, 'succeeded', '拒绝后队列可继续')
  resetForTest()
})

test('批量重试:扫描只补首个失败点之后的候选,不重跑成功 replicate', async () => {
  resetForTest()
  let callIndex = 0
  const { backends, calls } = fakeBackends({
    candidate: async (yaml, replicates, values) => {
      calls.candidate.push({ values, replicates })
      const index = callIndex++
      if (index === 1) throw new Error('第二个候选失败')
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
  })
  const job = enqueueRun({
    experimentId: 'exp_retry_resume', runId: 'run_retry_resume', name: '扫描续跑', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'resume', plan: PLAN3 }, backends,
  })
  await new Promise((resolve) => setTimeout(resolve, 5))
  const failed = listJobs().find((item) => item.id === job.id)
  assert.equal(failed.status, 'failed')
  assert.equal(failed.exec.results.length, 1)

  const retried = retryJob(job.id)
  assert.equal(retried.id, job.id, '失败任务重试保持原身份,不新增任务')
  await new Promise((resolve) => setTimeout(resolve, 5))
  const resumed = listJobs().find((item) => item.id === job.id)
  assert.equal(resumed.status, 'succeeded')
  assert.equal(resumed.exec.results.length, 3)
  assert.deepEqual(calls.candidate.map((call) => call.values), [PLAN3.candidates[0], PLAN3.candidates[1], PLAN3.candidates[1], PLAN3.candidates[2]], '首个成功候选复用;失败点及之后按顺序续算')
  assert.equal(calls.candidate.at(2).replicates, PLAN3.replicates, '失败点从候选边界整体重跑;首个成功 replicate 不重复')
  resetForTest()
})

test('批量重试:A/B 只补缺失臂,已成功臂不重跑', async () => {
  resetForTest()
  const AB = { kind: 'ab', baseYaml: 'base', candYaml: 'cand', replicates: 2, metric: 'win_rate' }
  let failCandOnce = false
  const partialSim = { config_hash: 'partial', meta: { schema_version: 'v', model_version: 'v' }, days_csv: '', results: [] }
  const { backends, calls } = fakeBackends({
    sim: async (yaml) => {
      calls.sim.push(yaml)
      if (yaml === 'cand' && !failCandOnce) {
        failCandOnce = true
        throw new Error('候选臂首次失败')
      }
      return partialSim
    },
    compare: async (baseYaml, candYaml, metric, base, cand) => {
      calls.compare.push({ baseYaml, candYaml, metric, base, cand })
      return {
        metric, arm_a: { n: 2, mean: 1, sd: 0, ci95_lo: 1, ci95_hi: 1 },
        arm_b: { n: 2, mean: 2, sd: 0, ci95_lo: 2, ci95_hi: 2 },
        diff_mean: 1, diff_ci95_lo: 1, diff_ci95_hi: 1, effect_size_d: 1, verdict: 'BHigher',
      }
    },
  })
  const job = enqueueRun({
    experimentId: 'exp_ab_resume', runId: 'run_ab_resume', name: 'A/B 续跑', method: 'AB',
    spec: AB, backends,
  })
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(listJobs().find((item) => item.id === job.id).status, 'failed')
  assert.deepEqual(calls.sim, ['base', 'cand'])

  retryJob(job.id)
  await new Promise((resolve) => setTimeout(resolve, 5))
  const resumed = listJobs().find((item) => item.id === job.id)
  assert.equal(resumed.status, 'succeeded')
  assert.deepEqual(calls.sim, ['base', 'cand', 'cand'], 'base 臂结果复用,只补 cand 臂')
  assert.equal(calls.compare.at(0).base.config_hash, 'partial')
  resetForTest()
})

test('队列持久化:版本/形状损坏整体丢弃;载荷按序恢复且执行中项回队', async () => {
  resetForTest()
  const storage = memoryStorage()
  const jobs = [
    persistedRealJob('job_q000001', 'running', { kind: 'single', yaml: 'q0', replicates: 1 }),
    persistedRealJob('job_q000002', 'queued', { kind: 'single', yaml: 'q1', replicates: 1 }),
    persistedRealJob('job_q000003', 'queued', { kind: 'single', yaml: 'q2', replicates: 1 }),
  ]
  assert.equal(persistQueueState({ storage, jobs }), true)
  assert.deepEqual(restoreQueueState(storage).map((job) => [job.id, job.status]), [
    ['job_q000001', 'running'], ['job_q000002', 'queued'], ['job_q000003', 'queued'],
  ])

  storage.setItem(QUEUE_STORAGE_KEY, '{"version":"0","jobs":[]}')
  assert.equal(restoreQueueState(storage), null)
  storage.setItem(QUEUE_STORAGE_KEY, '{"version":"1","jobs":[{"id":"broken"}]}')
  assert.equal(restoreQueueState(storage), null)

  assert.equal(persistQueueState({ storage, jobs }), true)

  const fresh = await import(`../src/workbench/state/runManager.ts?restore=${Date.now()}`)
  let active = 0
  let peak = 0
  const calls = { sim: [] }
  const slowBackend = {
    mode: 'desktop',
    sim: async (yaml) => {
      active += 1
      peak = Math.max(peak, active)
      calls.sim.push(yaml)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return { config_hash: yaml, meta: {}, results: [], days_csv: yaml }
    },
    candidate: async (yaml, replicates, values) => ({ values, status: 'ok', metric_stats: [], target_outcomes: [] }),
    recommend: async () => ({ elasticities: [], recommendation: null }),
    kernelCancel: async () => true,
    compare: null,
  }
  const restored = fresh.restorePersistedQueue(storage, new Map([
    ['job_q000001', slowBackend],
    ['job_q000002', slowBackend],
    ['job_q000003', slowBackend],
  ]))
  assert.deepEqual(restored.map((job) => job.id), ['job_q000001', 'job_q000002', 'job_q000003'])
  await new Promise((resolve) => setTimeout(resolve, 1))
  const live = fresh.listJobs()
  assert.deepEqual(live.map((job) => [job.id, job.status]), [
    ['job_q000001', 'running'], ['job_q000002', 'queued'], ['job_q000003', 'queued'],
  ], '执行中项恢复为队首 queued 后由执行槽启动,其余保持顺序')
  await new Promise((resolve) => setTimeout(resolve, 12))
  assert.equal(peak, 1, '恢复后仍只有一个执行槽')
  assert.deepEqual(calls.sim, ['q0', 'q1', 'q2'])
  fresh.resetForTest()
})

test('队列持久化:执行规格形状损坏时整体拒收', () => {
  resetForTest()
  const storage = memoryStorage()
  const validJobs = [persistedRealJob('job_spec0001', 'queued', { kind: 'single', yaml: 'valid', replicates: 1 })]
  assert.equal(persistQueueState({ storage, jobs: validJobs }), true)
  assert.notEqual(restoreQueueState(storage), null)

  const invalidPayload = (spec) => {
    const payload = { version: '1', savedAt: 1, jobs: [persistedRealJob('job_spec0002', 'queued', spec)] }
    storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(payload))
    return restoreQueueState(storage)
  }
  assert.equal(invalidPayload({ kind: 'sweep', yaml: 'bad', plan: { candidates: [{}], replicates: 1, sims: 1 } }), null, 'sweep 缺候选值拒收')
  assert.equal(invalidPayload({ kind: 'sweep', yaml: 'bad', plan: { candidates: [{ a: 1 }], replicates: 2, sims: 1 } }), null, 'sims 与计划不一致拒收')
  assert.equal(invalidPayload({ kind: 'ab', baseYaml: 'a', candYaml: 'b', replicates: -1, metric: 'x' }), null, '负 replicate 拒收')
  assert.equal(invalidPayload({ kind: 'single', yaml: 's' }), null, 'single 缺 replicate 拒收')
  assert.equal(invalidPayload({ kind: 'unknown' }), null, '未知 kind 拒收')
  resetForTest()
})

test('批量调度:并发 2 同时执行且结果保持 FIFO 一致', async () => {
  resetForTest()
  setSchedulingConfig({ concurrency: 2 })
  let active = 0
  let peak = 0
  const calls = { candidate: [], sim: [] }
  const { backends } = fakeBackends({
    candidate: async (yaml, replicates, values) => {
      active += 1
      peak = Math.max(peak, active)
      calls.candidate.push(values['model.warrior.attack'])
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
    sim: async (yaml) => {
      active += 1
      peak = Math.max(peak, active)
      calls.sim.push(yaml)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return { config_hash: yaml, meta: {}, results: [], days_csv: yaml }
    },
  })
  const first = enqueueRun({
    experimentId: 'exp_parallel', runId: 'run_parallel_1', name: '并发一', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'parallel', plan: PLAN3 }, backends,
  })
  const second = enqueueRun({
    experimentId: 'exp_parallel', runId: 'run_parallel_2', name: '并发二', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'parallel', plan: PLAN3 }, backends,
  })
  const third = enqueueRun({
    experimentId: 'exp_parallel', runId: 'run_parallel_3', name: '并发三', method: 'SINGLE',
    spec: { kind: 'single', yaml: 'single-3', replicates: 1 }, backends,
  })

  await new Promise((resolve) => setTimeout(resolve, 1))
  let live = listJobs()
  assert.equal(live.find((job) => job.id === first.id).status, 'running')
  assert.equal(live.find((job) => job.id === second.id).status, 'running')
  assert.equal(live.find((job) => job.id === third.id).status, 'queued')
  await new Promise((resolve) => setTimeout(resolve, 15))
  live = listJobs()
  assert.equal(peak, 2, '并发配置生效且不超槽')
  assert.deepEqual(calls.candidate, [90, 90, 100, 100, 110, 110], '第一实验内部候选序不因并发交错')
  assert.equal(calls.sim.at(-1), 'single-3', '第三个任务在前两个槽释放后续跑')
  assert.deepEqual(live.map((job) => [job.name, job.status]), [
    ['并发一', 'succeeded'], ['并发二', 'succeeded'], ['并发三', 'succeeded'],
  ])
  resetForTest()
})

test('内存预算:超预算任务显式等待,预算放宽后自动续跑', async () => {
  resetForTest()
  setSchedulingConfig({ concurrency: 1, memoryBudget: 2 })
  const { backends, calls } = fakeBackends({
    candidate: async (yaml, replicates, values) => {
      calls.candidate.push(values)
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
  })
  const bigSpec = {
    kind: 'sweep', yaml: 'big',
    plan: { candidates: PLAN3.candidates.concat(PLAN3.candidates), replicates: 1, sims: 6 },
  }
  const waiting = enqueueRun({
    experimentId: 'exp_budget', runId: 'run_budget', name: '等预算', method: 'GRID',
    spec: bigSpec, backends,
  })
  await new Promise((resolve) => setTimeout(resolve, 1))
  const waited = listJobs().find((job) => job.id === waiting.id)
  assert.equal(waited.status, 'queued')
  assert.equal(waited.waitReason, 'memory-budget')
  assert.equal(waited.exec.errorClass, null)
  assert.deepEqual(calls.candidate, [])
  assert.equal(WAIT_REASON_LABEL['memory-budget'].zh, '等内存预算')
  assert.equal(WAIT_REASON_LABEL['memory-budget'].en, 'Waiting for memory budget')

  setSchedulingConfig({ memoryBudget: 6 })
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(listJobs().find((job) => job.id === waiting.id).status, 'succeeded')
  assert.equal(listJobs().find((job) => job.id === waiting.id).waitReason, undefined)
  assert.equal(calls.candidate.length, 6)
  resetForTest()
})

test('调度配置持久化:独立载荷恢复并驱动并发与预算', async () => {
  resetForTest()
  const storage = memoryStorage()
  assert.equal(persistSchedulingState({ storage, config: { concurrency: 2, memoryBudget: 2 } }), true)
  assert.deepEqual(restoreSchedulingState(storage), { concurrency: 2, memoryBudget: 2 })
  storage.setItem(SCHEDULE_STORAGE_KEY, '{"version":"0","concurrency":2,"memoryBudget":2}')
  assert.equal(restoreSchedulingState(storage), null)
  assert.equal(persistSchedulingState({ storage, config: { concurrency: 2, memoryBudget: 2 } }), true)

  const jobs = [
    persistedRealJob('job_sched01', 'queued', { kind: 'single', yaml: 'small', replicates: 1 }),
    persistedRealJob('job_sched02', 'queued', {
      kind: 'sweep', yaml: 'large',
      plan: { candidates: [1, 2, 3].map((value) => ({ 'model.warrior.attack': value })), replicates: 1, sims: 3 },
    }),
  ]
  persistQueueState({ storage, jobs })
  const started = []
  const backend = {
    mode: 'desktop',
    sim: async (yaml) => {
      started.push(yaml)
      return { config_hash: yaml, meta: {}, results: [], days_csv: yaml }
    },
    candidate: async (yaml, replicates, values) => {
      started.push(values)
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
    recommend: async () => ({ elasticities: [], recommendation: null }),
    kernelCancel: async () => true,
    compare: null,
  }
  const restored = restorePersistedQueue(storage, new Map([
    ['job_sched01', backend], ['job_sched02', backend],
  ]))
  assert.deepEqual(getSchedulingConfig(), { concurrency: 2, memoryBudget: 2 })
  await new Promise((resolve) => setTimeout(resolve, 1))
  const live = listJobs()
  assert.equal(live.find((job) => job.id === 'job_sched01').status, 'succeeded')
  assert.equal(live.find((job) => job.id === 'job_sched02').status, 'queued')
  assert.equal(live.find((job) => job.id === 'job_sched02').waitReason, 'memory-budget')
  assert.equal(restoreSchedulingState(storage).concurrency, 2)
  assert.equal(getSchedulingConfig().concurrency, 2)
  assert.notEqual(restored, null)
  resetForTest()
  setSchedulingConfig({ concurrency: 1, memoryBudget: MAX_CANDIDATE_RESULTS_IN_MEMORY })
  resetForTest()
})

test('批量队列:真实任务按 FIFO 自动续跑,同一时刻仅启动一项真实执行', async () => {
  resetForTest()
  const { backends, calls } = fakeBackends({
    candidate: async (yaml, replicates, values) => {
      calls.active = (calls.active ?? 0) + 1
      assert.equal(calls.active, 1, '候选执行时活动执行数不超过 1')
      calls.candidate.push({ yaml, replicates, values })
      await new Promise((resolve) => setTimeout(resolve, 1))
      calls.active = 0
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
  })
  const first = enqueueRun({
    experimentId: 'exp_queue', runId: 'run_q1', name: '队列一', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 }, backends,
  })
  await new Promise((resolve) => setTimeout(resolve, 1))
  const second = enqueueRun({
    experimentId: 'exp_queue', runId: 'run_q2', name: '队列二', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 }, backends,
  })
  const third = enqueueRun({
    experimentId: 'exp_queue', runId: 'run_q3', name: '队列三', method: 'GRID',
    spec: { kind: 'single', yaml: 's', replicates: 1 }, backends,
  })
  const snapshot = listJobs()
  assert.equal(snapshot.find((job) => job.id === first.id).status, 'running', '队首立即启动')
  assert.equal(snapshot.find((job) => job.id === second.id).status, 'queued', '后续任务排队')
  assert.equal(snapshot.find((job) => job.id === third.id).status, 'queued', '后续任务排队')

  await new Promise((resolve) => setTimeout(resolve, 20))
  const byId = (job) => listJobs().find((item) => item.id === job.id)
  assert.deepEqual(calls.candidate.map((call) => call.values), [...PLAN3.candidates, ...PLAN3.candidates], '候选严格按 FIFO 顺序')
  assert.deepEqual([byId(first).status, byId(second).status, byId(third).status], ['succeeded', 'succeeded', 'succeeded'])
  assert.equal(calls.candidate.length, 6, 'queued 项只有终态后才启动')
  resetForTest()
})

test('批量队列:取消排队项不影响当前运行', async () => {
  resetForTest()
  const { backends, calls } = fakeBackends({
    candidate: async (yaml, replicates, values) => {
      calls.candidate.push({ yaml, replicates, values })
      await new Promise((resolve) => setTimeout(resolve, 3))
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
  })
  const first = enqueueRun({
    experimentId: 'exp_queue', runId: 'run_current', name: '当前任务', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 }, backends,
  })
  await new Promise((resolve) => setTimeout(resolve, 1))
  const queued = enqueueRun({
    experimentId: 'exp_queue', runId: 'run_queued', name: '排队任务', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'e', plan: PLAN3 }, backends,
  })
  const beforeCancel = listJobs()
  assert.equal(beforeCancel.find((job) => job.id === first.id).status, 'running')
  assert.equal(beforeCancel.find((job) => job.id === queued.id).status, 'queued')
  await cancelJob(queued.id)
  assert.equal(listJobs().find((job) => job.id === queued.id).status, 'cancelled', 'queued 项取消即终态')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(listJobs().find((job) => job.id === first.id).status, 'succeeded', '排队项取消不影响当前运行')
  assert.equal(calls.candidate.length, 3, '取消排队项不派发其候选')
  resetForTest()
})

test('批量队列:取消队首排队项立刻腾槽启动下一项', async () => {
  resetForTest()
  let resolveFirst
  const firstGate = new Promise((resolve) => { resolveFirst = resolve })
  const { backends, calls } = fakeBackends({
    sim: async (yaml) => {
      calls.sim.push(yaml)
      await firstGate
      return { config_hash: yaml, meta: {}, results: [], days_csv: yaml }
    },
  })
  const head = enqueueRun({
    experimentId: 'exp_queue_cancel', runId: 'run_cancel_head', name: '取消队首', method: 'GRID',
    spec: { kind: 'single', yaml: 'cancel-head', replicates: 1 }, backends,
  })
  const next = enqueueRun({
    experimentId: 'exp_queue_cancel', runId: 'run_after_cancel', name: '取消后下一项', method: 'GRID',
    spec: { kind: 'single', yaml: 'after-cancel', replicates: 1 }, backends,
  })
  await cancelJob(head.id)
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(listJobs().find((job) => job.id === head.id).status, 'cancelled', 'queued 项取消即终态')
  assert.equal(listJobs().find((job) => job.id === next.id).status, 'running', '取消队首后 startNextQueued 腾出执行槽')
  assert.deepEqual(calls.sim, ['cancel-head', 'after-cancel'], '已派发项的启动句柄保留;队列下一项独立启动')
  resolveFirst()
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(listJobs().find((job) => job.id === next.id).status, 'succeeded')
  resetForTest()
})

test('批量队列:当前运行终态后才启动下一项 startExec', async () => {
  resetForTest()
  let resolveFirst
  let resolveSecond
  const firstGate = new Promise((resolve) => { resolveFirst = resolve })
  const secondGate = new Promise((resolve) => { resolveSecond = resolve })
  const { backends, calls } = fakeBackends({
    sim: async (yaml, replicates, onProgress) => {
      calls.sim.push({ yaml, replicates })
      await (calls.sim.length === 1 ? firstGate : secondGate)
      onProgress?.({ done: 1, total: 1 })
      return { config_hash: `hash-${calls.sim.length}`, meta: {}, results: [], days_csv: `rep-${calls.sim.length}` }
    },
    candidate: async (yaml, replicates, values) => {
      calls.candidate.push({ yaml, replicates, values })
      await (calls.candidate.length === 1 ? firstGate : secondGate)
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
  })
  const first = enqueueRun({
    experimentId: 'exp_queue', runId: 'run_gate1', name: '门一', method: 'GRID',
    spec: { kind: 'single', yaml: 's1', replicates: 1 }, backends,
  })
  await new Promise((resolve) => setTimeout(resolve, 1))
  const second = enqueueRun({
    experimentId: 'exp_queue', runId: 'run_gate2', name: '门二', method: 'GRID',
    spec: { kind: 'single', yaml: 's2', replicates: 1 }, backends,
  })
  assert.equal(calls.sim.length, 1, '第一项尚未派发 sim')
  assert.equal(listJobs().find((job) => job.id === second.id).status, 'queued', '第一项终态前第二项不启动')
  resolveFirst()
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(listJobs().find((job) => job.id === first.id).status, 'succeeded')
  assert.equal(calls.sim.length, 2, '第一项终态后才启动第二项')
  assert.deepEqual(calls.sim.map((call) => call.yaml), ['s1', 's2'], '按 FIFO 使用各自的执行快照')
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(listJobs().find((job) => job.id === first.id).status, 'succeeded')
  assert.equal(calls.sim.length, 2, '第一项终态后才启动第二项')
  assert.equal(listJobs().find((job) => job.id === second.id).status, 'running', '第二项已调用 startExec 并进入运行')
  resolveSecond()
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(listJobs().find((job) => job.id === second.id).status, 'succeeded')
  resetForTest()
})

test('批量队列:全链路候选调用遵守单并发约束', async () => {
  resetForTest()
  let active = 0
  let peak = 0
  const slow = fakeBackends({
    candidate: async (yaml, replicates, values) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return { values, status: 'ok', metric_stats: [], target_outcomes: [] }
    },
  })
  for (const index of [1, 2, 3]) {
    enqueueRun({
      experimentId: 'exp_queue', runId: `run_peak_${index}`, name: `并发 ${index}`, method: 'GRID',
      spec: { kind: 'sweep', yaml: `e${index}`, plan: PLAN3 }, backends: slow.backends,
    })
  }
  await new Promise((resolve) => setTimeout(resolve, 1))
  // 完成性用有界轮询,不用固定 25ms 窗口:9 个候选 ×2ms 休眠的串行下限
  // 18ms 贴着窗口上沿,高负载机器上「已全部完成」断言会假失败(本机
  // HEAD 复测 12 次 8 次假失败;并发不变量由 peak 断言独立把关,轮询
  // 不影响其语义)。超时后仍走断言,任务真挂起照常失败。
  const deadline = Date.now() + 2000
  while (Date.now() < deadline
    && listJobs().some((job) => !['succeeded', 'failed', 'cancelled'].includes(job.status))) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.equal(peak, 1, '三个任务始终最多一个候选执行')
  assert.equal(listJobs().every((job) => job.status === 'succeeded'), true)
  resetForTest()
})

test('批量队列:终态先落竞争后仍按 FIFO 自动续跑', async () => {
  resetForTest()
  let resolveFirstBackends
  const firstBackends = new Promise((resolve) => { resolveFirstBackends = resolve })
  const pending = fakeBackends()
  resolveFirstBackends(pending.backends)
  const first = enqueueRun({
    experimentId: 'exp_queue', runId: 'run_race_current', name: '竞争当前', method: 'GRID',
    spec: { kind: 'single', yaml: 'race-current', replicates: 1 }, backends: firstBackends,
  })
  const second = enqueueRun({
    experimentId: 'exp_queue', runId: 'run_race_next', name: '竞争下一项', method: 'GRID',
    spec: { kind: 'single', yaml: 'race-next', replicates: 1 }, backends: pending.backends,
  })
  await cancelJob(first.id)
  assert.equal(listJobs().find((job) => job.id === first.id).status, 'cancelled')
  assert.equal(listJobs().find((job) => job.id === second.id).status, 'running', 'queued 取消同步释放槽')
  await new Promise((resolve) => setTimeout(resolve, 1))
  assert.equal(listJobs().find((job) => job.id === second.id).status, 'succeeded')
  assert.deepEqual(pending.calls.sim.map((call) => call.yaml), ['race-current', 'race-next'], '当前任务已启动;竞争短路后只再启动下一项')
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

// —— ST-AUD-13/20/21 · 队列恢复与终局纪律(2026-11-09 批次) ——

test('ST-AUD-20:终局统一释放并 terminate 后端(成功与失败路径)', async () => {
  resetForTest()
  let terminated = 0
  const ok = fakeBackends({ terminate: () => { terminated++ } })
  const job = enqueueRun({
    experimentId: 'exp_aud20a', runId: 'run_aud20a', name: '终局释放-成功', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'y', plan: PLAN3 },
    backends: ok.backends,
  })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(listJobs().find((j) => j.id === job.id).status, 'succeeded')
  assert.equal(terminated, 1, '成功终局应 terminate 后端(不留 Worker)')
  resetForTest()

  let terminated2 = 0
  const fail = fakeBackends({
    candidate: async () => { throw new Error('boom') },
    terminate: () => { terminated2++ },
  })
  const job2 = enqueueRun({
    experimentId: 'exp_aud20b', runId: 'run_aud20b', name: '终局释放-失败', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'y', plan: PLAN3 },
    backends: fail.backends,
  })
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(listJobs().find((j) => j.id === job2.id).status, 'failed')
  assert.equal(terminated2, 1, '失败终局也应 terminate 后端')
  resetForTest()
})

test('ST-AUD-21:取消后执行器中途更新不得改写终态任务', async () => {
  resetForTest()
  // 门控后端:入队即被 startNextQueued 消费但状态尚未迁 running 的窗口内取消
  let resolveGate
  const gate = new Promise((r) => { resolveGate = r })
  const job = enqueueRun({
    experimentId: 'exp_aud21', runId: 'run_aud21', name: '终态闸-排队取消', method: 'GRID',
    spec: { kind: 'sweep', yaml: 'y', plan: PLAN3 },
    backends: gate,
  })
  assert.equal(listJobs().find((j) => j.id === job.id).status, 'queued')
  await cancelJob(job.id)
  assert.equal(listJobs().find((j) => j.id === job.id).status, 'cancelled', '排队项取消即终态')
  // 放行后端:执行器随后发出 {status:running} 与 {done,exec:{results}} 中途更新,
  // 均不得改写已终态的 cancelled 任务(旧守卫只拦带 status 的补丁)
  resolveGate(fakeBackends().backends)
  await new Promise((r) => setTimeout(r, 10))
  const live = listJobs().find((j) => j.id === job.id)
  assert.equal(live.status, 'cancelled')
  assert.equal(live.done, 0, '取消后进度不得再被中途更新改写')
  assert.deepEqual(live.exec.results, [], '取消后伪造/迟到结果不得写入终态任务')
  assert.equal(live.exec.candidatesDone, 0)
  resetForTest()
})

test('ST-AUD-13:队列恢复剥离伪造结果类字段,不冒充内核结果', () => {
  resetForTest()
  const storage = memoryStorage()
  // 终态伪造:合法形状容器但结果条目坏形(非对象/坏 status/坏 metric_stats)
  const forgedTerminal = persistedRealJob('job_forged_t1', 'succeeded', { kind: 'sweep', yaml: 'f', plan: PLAN3 })
  forgedTerminal.exec.results = [
    { values: { attack: 'not-a-number' }, status: 'evil', metric_stats: 'x', target_outcomes: 1 },
    'not-an-object',
  ]
  forgedTerminal.exec.recommendation = { recommendation: { param: 123 } }
  forgedTerminal.exec.arms = { base: [], cand: 'bad' }
  forgedTerminal.exec.sim = 'forged'
  forgedTerminal.done = 99
  // 非终态伪造:将重新执行,结果类字段一律由执行槽重建
  const forgedQueued = persistedRealJob('job_forged_q1', 'queued', { kind: 'single', yaml: 'q', replicates: 2 })
  forgedQueued.exec.results = [{ values: {}, status: 'ok', metric_stats: [], target_outcomes: [] }]
  forgedQueued.exec.sim = { config_hash: 'fake' }
  const payload = { version: '1', savedAt: 1, jobs: [forgedTerminal, forgedQueued] }
  storage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(payload))
  const restored = restorePersistedQueue(storage, new Map([
    [forgedQueued.id, fakeBackends().backends],
  ]))
  assert.equal(restored[0].status, 'succeeded')
  assert.deepEqual(restored[0].exec.results, [], '终态伪造的坏形结果不得冒充内核结果')
  assert.equal(restored[0].exec.sim, null, '终态伪造的坏形 sim 剥离')
  assert.equal(restored[0].exec.recommendation, null, '终态伪造的坏形推荐剥离')
  assert.equal(restored[0].exec.arms, null, '终态伪造的坏形双臂剥离')
  assert.equal(restored[1].status, 'queued')
  assert.deepEqual(restored[1].exec.results, [], '非终态伪造结果一律剥离由执行槽重建')
  assert.equal(restored[1].exec.sim, null)
  resetForTest()
})
