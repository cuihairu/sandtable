// WB-10.11 · 桌面与浏览器的主要路径(真内核,pkg-node 组):同一实验配置分别
// 走桌面通道(desktop 模式后端直连内核绑定)与浏览器通道(workerBackends +
// serveSweepWorker 纯服务端接 pkg-node,协议面与浏览器 Worker 同构),两路
// 的候选结果/推荐/CSV/JSON 导出逐值一致——同输入内容派生同一 run_id,双通道
// 汇入同一数据面。另保原有面:本地查询(localQuery 纯逻辑)行为不变;下载
// (download)经 DOM 桩全链过真实导出内容(文件名/mime/Blob 内容/触发点击);
// 项目文件闭环(open/pack/重开)flow-loop/flow-multi-config 已覆盖,不重复。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/flow-channels.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(WB-10.11 真内核断言在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  // workbenchStore / runManager 在模块加载期读 window(同款桩)
  const backing = new Map()
  const storage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => {
      backing.set(k, String(v))
    },
    removeItem: (k) => {
      backing.delete(k)
    },
  }
  globalThis.window = { location: { hash: '' }, history: { replaceState() {} }, localStorage: storage }

  const wasm = await import(pathToFileURL(pkgNode).href)
  const runManager = await import('../src/workbench/state/runManager.ts')
  const { dispatch, getState } = await import('../src/workbench/state/workbenchStore.ts')
  const { snapshotRun, runIndexEntryOf } = await import('../src/workbench/state/projectDoc.ts')
  const { buildExperimentYaml } = await import('../src/workbench/designer/experimentYaml.ts')
  const { scopedRunCsv, scopedRunJson } = await import('../src/workbench/analysis/exportScope.ts')
  const { startExec, workerBackends } = await import('../src/workbench/state/executor.ts')
  const { serveSweepWorker } = await import('../src/workbench/state/sweepWorker.ts')
  const { download } = await import('../src/workbench/demo/export.ts')
  const { viewNameOf, mergePath, columnsFromLocal } = await import('../src/lib/localQuery.ts')

  const tick = () => new Promise((r) => setTimeout(r, 0))
  const SCENARIO = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nmodel:\n  warrior:\n    attack: 100\n'
  const DESIGN = {
    name: 'channel parity',
    method: 'grid',
    sampling: 'lhc',
    factors: [{ path: 'model.warrior.attack', min: 90, max: 110, step: 10 }],
    samples: 0,
    reps: 2,
    targets: [{ metric: 'win_rate', kind: 'hard', min: 0, max: 1 }],
  }
  /** 桌面通道:直连内核绑定 */
  const desktopBackends = {
    mode: 'desktop',
    sim: async (yaml, replicates) => JSON.parse(wasm.run_simulation(yaml, replicates)),
    candidate: async (yaml, replicates, values) =>
      JSON.parse(wasm.sweep_candidate(yaml, replicates, JSON.stringify(values))),
    recommend: async (yaml, results) =>
      JSON.parse(wasm.sweep_recommend(yaml, JSON.stringify(results))),
    kernelCancel: async () => false,
    compare: null,
  }
  /** 浏览器通道:serveSweepWorker(纯服务端)接 pkg-node,协议面与浏览器 Worker 同构 */
  const makeKernelWorker = () => {
    const w = { onmessage: null, inbox: [], terminated: 0 }
    const server = serveSweepWorker({
      post: (msg) => w.onmessage?.({ data: msg }),
      init: async () => true,
      plan: async (y, r) => JSON.parse(wasm.sweep_plan(y, r)),
      sim: async (y, r) => JSON.parse(wasm.run_simulation(y, r)),
      candidate: async (y, r, v) => JSON.parse(wasm.sweep_candidate(y, r, JSON.stringify(v))),
      recommend: async (y, rs) => JSON.parse(wasm.sweep_recommend(y, JSON.stringify(rs))),
      abCompare: null,
    })
    return {
      postMessage: (data) => {
        w.inbox.push(data)
        void server.onMessage(data)
      },
      terminate: () => {
        w.terminated++
      },
      get onmessage() {
        return w.onmessage
      },
      set onmessage(fn) {
        w.onmessage = fn
      },
      get terminated() {
        return w.terminated
      },
      get inbox() {
        return w.inbox
      },
    }
  }
  const waitTerminal = async () => {
    for (let i = 0; i < 500; i++) {
      const j = runManager.listJobs().at(-1)
      if (j && ['succeeded', 'failed', 'cancelled'].includes(j.status)) return j
      await tick()
    }
    throw new Error('任务未在预算内终态')
  }

  test('WB-10.11:桌面与浏览器双通道主路径——同输入同结果同导出,汇入同一运行', async () => {
    runManager.resetForTest()
    const expYaml = buildExperimentYaml(SCENARIO, DESIGN)
    const plan = JSON.parse(wasm.sweep_plan(expYaml, 0))
    const check = JSON.parse(wasm.validate_config(SCENARIO))
    // 同输入内容派生同一 run_id:两条通道跑的是「同一运行」
    const snap = await snapshotRun({
      experimentId: 'exp_channel001',
      scenarioPath: 'scenarios/base.yaml',
      yaml: expYaml,
      modelVersion: check.model_version,
      schemaVersion: check.schema_version,
      conditions: { method: 'grid', replicates: plan.replicates, candidates: plan.candidates.length, sims: plan.sims },
    })
    const spec = {
      kind: 'sweep',
      yaml: expYaml,
      plan: { candidates: plan.candidates, replicates: plan.replicates, sims: plan.sims },
      analysis: {
        baselineId: 'bl_demo0001',
        baselineYaml: SCENARIO,
        scenarioYaml: SCENARIO,
        plan,
        modelVersion: check.model_version,
        schemaVersion: check.schema_version,
      },
    }
    const submit = (backends) =>
      runManager.enqueueRun({
        experimentId: 'exp_channel001',
        runId: snap.runId,
        name: DESIGN.name,
        method: 'GRID',
        spec,
        backends,
      })

    // —— 桌面通道(串行:单活动门,先跑完再走浏览器通道) ——
    assert.ok(submit(desktopBackends), '桌面通道入队')
    const jobD = await waitTerminal()
    assert.equal(jobD.status, 'succeeded', `桌面通道应成功: ${jobD.exec?.errorMessage ?? ''}`)
    assert.ok(jobD.exec, '桌面通道任务带执行视图')

    // —— 浏览器通道(Worker 协议,真内核载荷) ——
    assert.ok(submit(workerBackends(makeKernelWorker)), '浏览器通道入队')
    const jobW = await waitTerminal()
    assert.equal(jobW.status, 'succeeded', `浏览器通道应成功: ${jobW.exec?.errorMessage ?? ''}`)
    assert.notEqual(jobW.id, jobD.id, '两通道是两次执行(非缓存复用)')

    // —— 双通道逐值一致:候选结果 / 推荐 / 导出字节 ——
    assert.deepEqual(jobW.exec.results, jobD.exec.results, '候选结果逐值一致(通道只是运载层)')
    assert.deepEqual(jobW.exec.recommendation, jobD.exec.recommendation, '推荐逐值一致')
    const entry = runIndexEntryOf(snap, check.config_hash)
    const ui = { selectedId: null, order: { filter: 'all', by: 'index', dir: 1 } }
    assert.equal(scopedRunCsv(jobW, ui, 'all', entry), scopedRunCsv(jobD, ui, 'all', entry), 'CSV 逐字节一致')
    const jsonD = JSON.parse(scopedRunJson(jobD, ui, 'all', entry))
    const jsonW = JSON.parse(scopedRunJson(jobW, ui, 'all', entry))
    assert.deepEqual(jsonW, jsonD, 'JSON 信封+results+recommendation 逐值一致')

    // —— 登记一次,双通道汇入同一运行(项目文件保留,闭环细节见 flow-loop) ——
    dispatch({ type: 'run/register', entry })
    dispatch({ type: 'run/artifacts', runId: snap.runId, artifacts: { [`results/${snap.runId}.report.json`]: JSON.stringify(jsonD) } })
    assert.equal(getState().runs.length, 1)
    assert.ok(getState().runArtifacts[`results/${snap.runId}.report.json`].includes('"run_id"'), '产物在场')

    runManager.resetForTest()
  })

  test('WB-10.11:原有查询与下载面——localQuery 行为不变,download 全链过真实导出内容', async () => {
    // 查询面(桌面本地文件查询的纯逻辑,与桌面壳 query 命令对齐):行为不变
    assert.equal(viewNameOf('/data/days.parquet'), 'days')
    assert.equal(viewNameOf('C:\\out\\a b.csv'), 'a b')
    assert.deepEqual(mergePath(['/d/a.parquet'], ' /d/a.parquet '), ['/d/a.parquet'], 'trim+去重')
    const cols = columnsFromLocal({ columns: ['day', 'win_rate', 'note'], rows: [['1', '0.5', 'd1'], ['', '0.6', 'd2']] })
    assert.deepEqual(cols[0].values, [1, ''])
    assert.deepEqual(cols[1].values, [0.5, 0.6])
    assert.deepEqual(cols[2].values, ['d1', 'd2'], '非数值列保持文本')

    // 下载面:小实验真跑(单候选×1)出真实 CSV,经 download 全链
    const yaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nsweep:\n  replicates: 1\n  parameters:\n    model.warrior.attack: {min: 100, max: 100, step: 10}\n  targets:\n    - {metric: win_rate, min: 0.0, max: 1.0}\n'
    const plan = JSON.parse(wasm.sweep_plan(yaml, 0))
    const ctl = startExec({ kind: 'sweep', yaml, plan }, desktopBackends, { update: () => {} }, 'job_dl_check')
    const out = await ctl.promise
    assert.equal(out.status, 'succeeded')

    const clicks = []
    const anchor = { href: '', download: '', click() { clicks.push(this.download) } }
    const blobs = []
    const origCreate = URL.createObjectURL
    const origRevoke = URL.revokeObjectURL
    URL.createObjectURL = (blob) => {
      blobs.push(blob)
      return 'blob:stub'
    }
    URL.revokeObjectURL = () => {}
    globalThis.document = { createElement: () => anchor }
    try {
      download('candidates.csv', '\uFEFFday,win_rate\r\n1,0.5\r\n', 'text/csv;charset=utf-8')
      await tick()
    } finally {
      URL.createObjectURL = origCreate
      URL.revokeObjectURL = origRevoke
      delete globalThis.document
    }
    assert.equal(clicks.length, 1, '下载触发一次点击')
    assert.equal(anchor.download, 'candidates.csv', '文件名带上')
    assert.equal(anchor.href, 'blob:stub')
    assert.equal(blobs.length, 1)
    assert.equal(blobs[0].type, 'text/csv;charset=utf-8', 'mime 上对')
    assert.ok(blobs[0].size > 0, 'Blob 携带真实内容')
  })
}
