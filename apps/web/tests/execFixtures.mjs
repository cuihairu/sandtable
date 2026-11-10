// 共享脚手架:执行域测试(execFsm / workerProtocol / executor / runManager)共用的
// 假后端与常量。独立于 *.test.mjs 命名,node --test 不把它当测试文件跑;
// 仅本目录内测试引用,不进 src/。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export const read = (p) => readFileSync(join(here, '..', p), 'utf8')

// —— 测试脚手架:假后端(记录调用序与进度事件;无定时器) ——

export function fakeBackends(overrides = {}) {
  const calls = { candidate: [], sim: [], recommend: 0, kernelCancel: 0, plan: [], compare: [] }
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

export const PLAN3 = {
  candidates: [{ 'model.warrior.attack': 90 }, { 'model.warrior.attack': 100 }, { 'model.warrior.attack': 110 }],
  replicates: 2,
  sims: 6,
}

export function jobPatchSink() {
  const patches = []
  return {
    patches,
    hooks: { update: (id, patch) => patches.push({ id, patch }) },
  }
}

export const JOB = 'job_test0001'

export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
  }
}

export function persistedRealJob(id, status, spec, results = [], arms = null) {
  const kind = spec.kind
  return {
    id,
    experimentId: `exp_${id}`,
    name: `任务 ${id}`,
    method: 'GRID',
    total: kind === 'sweep' ? spec.plan.sims : (kind === 'ab' ? spec.replicates * 2 : spec.replicates),
    done: 0,
    status,
    demo: false,
    createdAt: 1,
    exec: {
      runId: `run_${id}`,
      kind,
      spec,
      progressKind: 'candidates',
      replicates: kind === 'sweep' ? spec.plan.replicates : spec.replicates,
      candidatesDone: kind === 'sweep' ? results.length : 0,
      candidatesTotal: kind === 'sweep' ? spec.plan.candidates.length : 0,
      results,
      recommendation: null,
      recommendationError: null,
      comparison: null,
      arms,
      sim: null,
      errorClass: null,
      errorMessage: null,
      resume: null,
    },
  }
}
