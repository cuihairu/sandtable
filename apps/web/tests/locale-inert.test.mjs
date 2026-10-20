// WB-10.10 · 切换语言不改变机器面(真内核,pkg-node 组):运行中途切换语言,
// 配置内容(未保存参数草稿)、场景 seed、内容派生 run_id/config_hash、索引
// 条目、候选选中项、运行状态与真实进度都不被扰动;CSV/JSON 导出在切换前后
// 逐字节一致(导出机器 schema 不随 locale 变),sweep_plan 计划面复算逐值
// 一致;跑完后逐候选结果与直调内核 deepEqual(语言不进内核链路)。状态面
// 「切语言不丢工作台状态」(WB-11.09)与词条/格式层已测,不重复。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/locale-inert.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(WB-10.10 真内核断言在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  // workbenchStore / localeStore 在模块加载期读 window(同款桩)
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
  // localeStore 引导直接读全局 localStorage(非 window.localStorage),一并给桩
  globalThis.localStorage = storage

  const wasm = await import(pkgNode)
  const runManager = await import('../src/workbench/state/runManager.ts')
  const { dispatch, getState } = await import('../src/workbench/state/workbenchStore.ts')
  const { setLocale, localeSession } = await import('../src/workbench/state/localeStore.ts')
  const { snapshotRun, runIndexEntryOf } = await import('../src/workbench/state/projectDoc.ts')
  const { buildExperimentYaml } = await import('../src/workbench/designer/experimentYaml.ts')
  const { applyParamEdits } = await import('../src/workbench/params/configYaml.ts')
  const { scopedRunCsv, scopedRunJson } = await import('../src/workbench/analysis/exportScope.ts')

  const tick = () => new Promise((r) => setTimeout(r, 0))
  const SCENARIO = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nmodel:\n  warrior:\n    attack: 100\n'
  const DESIGN = {
    name: 'locale inert',
    method: 'grid',
    sampling: 'lhc',
    factors: [{ path: 'model.warrior.attack', min: 90, max: 110, step: 10 }],
    samples: 0,
    reps: 2,
    targets: [{ metric: 'win_rate', kind: 'hard', min: 0, max: 1 }],
  }
  /** 真内核 + 可控边界候选:测试决定候选何时收尾,语言切换确定性地落在候选在跑时 */
  const gatedBackends = {
    mode: 'desktop',
    sim: async (yaml, replicates) => JSON.parse(wasm.run_simulation(yaml, replicates)),
    candidate: async (yaml, replicates, values) => {
      const result = JSON.parse(wasm.sweep_candidate(yaml, replicates, JSON.stringify(values)))
      const i = started++
      await new Promise((resolve) => {
        pending[i] = resolve
      })
      return result
    },
    recommend: async (yaml, results) => JSON.parse(wasm.sweep_recommend(yaml, JSON.stringify(results))),
    kernelCancel: async () => false,
    compare: null,
  }
  let started = 0
  let finished = 0
  const pending = []
  const releaseNext = async () => {
    const i = finished
    assert.ok(pending[i], `第 ${i + 1} 个候选应已在内核在跑`)
    pending[i]()
    finished++
    await tick()
  }

  test('WB-10.10:运行中切换语言——配置/seed/哈希/选中/运行状态/导出机器 schema 全部不动', async () => {
    runManager.resetForTest()
    assert.equal(localeSession.get(), 'en-US', '引导基线:无存值无系统语言 → en-US')

    // —— 用户状态先行:参数草稿(配置内容)+ 候选选中 + 索引登记 ——
    const edited = applyParamEdits(SCENARIO, [{ path: 'model.warrior.attack', text: '120' }])
    assert.ok(edited.ok, '参数编辑应成功')
    dispatch({ type: 'param/write', yaml: edited.yaml })
    const beforeYaml = getState().paramDraft.yaml
    const selId = 'cnd_' + 'e1'.repeat(12)
    dispatch({ type: 'candidate/select', id: selId })

    const expYaml = buildExperimentYaml(SCENARIO, DESIGN)
    const plan = JSON.parse(wasm.sweep_plan(expYaml, 0))
    const check = JSON.parse(wasm.validate_config(SCENARIO))
    const snap = await snapshotRun({
      experimentId: 'exp_inert001',
      scenarioPath: 'scenarios/base.yaml',
      yaml: expYaml,
      modelVersion: check.model_version,
      schemaVersion: check.schema_version,
      conditions: { method: 'grid', replicates: plan.replicates, candidates: plan.candidates.length, sims: plan.sims },
    })
    const entry = runIndexEntryOf(snap, check.config_hash)
    const job = runManager.enqueueRun({
      experimentId: 'exp_inert001',
      runId: snap.runId,
      name: DESIGN.name,
      method: 'GRID',
      spec: {
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
      },
      backends: gatedBackends,
    })
    assert.ok(job)
    for (let i = 0; i < 500 && started < 1; i++) await tick()
    assert.equal(started, 1, '第 1 个候选已在内核在跑')
    const live = () => runManager.listJobs().at(-1)
    assert.equal(live().status, 'running', '任务已进运行态')
    // 切换前基线:导出机器产物(候选未齐,行如实标 pending)
    const ui = { selectedId: null, order: { filter: 'all', by: 'index', dir: 1 } }
    const beforeCsv = scopedRunCsv(live(), ui, 'all', entry)

    // —— 运行中切换语言(走应用同款 setLocale,持久化生效) ——
    setLocale('zh-CN')
    assert.equal(localeSession.get(), 'zh-CN')
    assert.equal(backing.get('sandtable-workbench-locale'), 'zh-CN', '选择写进持久化(刷新后恢复的原语)')

    // 机器面逐项对照:切换只是显示层事件,状态与数据零扰动
    assert.equal(getState().paramDraft.yaml, beforeYaml, '配置内容:未保存草稿原样')
    assert.ok(beforeYaml.includes('attack: 120') && beforeYaml.includes('seed: 7'), '草稿含编辑值与 seed 原文')
    const snapAgain = await snapshotRun({
      experimentId: 'exp_inert001',
      scenarioPath: 'scenarios/base.yaml',
      yaml: expYaml,
      modelVersion: check.model_version,
      schemaVersion: check.schema_version,
      conditions: { method: 'grid', replicates: plan.replicates, candidates: plan.candidates.length, sims: plan.sims },
    })
    assert.equal(snapAgain.runId, snap.runId, '实验哈希:同输入同 run_id(内容派生)')
    assert.equal(snapAgain.configHash, snap.configHash, 'config_hash 不随语言变')
    assert.equal(snapAgain.seed, snap.seed)
    assert.deepEqual(runIndexEntryOf(snapAgain, check.config_hash), entry, '索引条目逐值不变')
    assert.equal(getState().selectedCandidateId, selId, '候选选中项保留')
    assert.equal(live().status, 'running', '运行状态不被切换扰动')
    assert.equal(live().done, 0, '真实进度无假推进')
    assert.equal(scopedRunCsv(live(), ui, 'all', entry), beforeCsv, '导出 CSV 切换前后逐字节一致')
    assert.deepEqual(JSON.parse(wasm.sweep_plan(expYaml, 0)), plan, '计划面复算逐值一致')

    // —— 放完全部候选:结果 = 直调内核(语言不进内核链路) ——
    for (let i = 1; i < plan.candidates.length; i++) {
      for (let k = 0; k < 500 && started < i + 1; k++) await tick()
    }
    for (let i = 0; i < plan.candidates.length; i++) await releaseNext()
    let terminal = null
    for (let i = 0; i < 500; i++) {
      const j = live()
      if (j && ['succeeded', 'failed', 'cancelled'].includes(j.status)) { terminal = j; break }
      await tick()
    }
    assert.equal(terminal?.status, 'succeeded', `应跑满成功: ${terminal?.exec?.errorMessage ?? ''}`)
    assert.equal(terminal.done, plan.candidates.length * plan.replicates)
    for (let i = 0; i < plan.candidates.length; i++) {
      const direct = JSON.parse(wasm.sweep_candidate(expYaml, plan.replicates, JSON.stringify(plan.candidates[i])))
      assert.deepEqual(terminal.exec.results[i], direct, `候选 ${i} 结果 = 直调内核`)
    }
    assert.equal(terminal.exec.recommendation.recommendation.param, 'model.warrior.attack')

    // —— 终态后再切换往返:导出机器 schema(信封键集与 CSV 字节)不随 locale 变 ——
    const csvZh = scopedRunCsv(terminal, ui, 'all', entry)
    const jsonZh = JSON.parse(scopedRunJson(terminal, ui, 'all', entry))
    setLocale('en-US')
    assert.equal(localeSession.get(), 'en-US')
    const csvEn = scopedRunCsv(terminal, ui, 'all', entry)
    const jsonEn = JSON.parse(scopedRunJson(terminal, ui, 'all', entry))
    assert.equal(csvEn, csvZh, 'CSV 逐字节一致(表头机器名与数字不经 locale)')
    assert.deepEqual(jsonEn, jsonZh, 'JSON 信封+results+recommendation 逐值一致')
    assert.deepEqual(Object.keys(jsonEn), Object.keys(jsonZh), '机器 schema 键集不变')

    runManager.resetForTest()
  })
}
