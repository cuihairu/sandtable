// WB-10.06 · 结果候选复制为草稿再运行(节点侧,真内核,pkg-node 组):真实
// 扫描跑完 → 分析页 resultRows 选一个 ok 候选 → copyCandidate 复制为「新」
// 草稿(sourceRunId 指回来源运行)→ addCandidateDraft 入草稿层 → 用草稿
// 场景重组实验配置再提交(内核校验 → param/frozen → snapshotRun →
// run/register → 真实执行 → 终局落档)。全程核对不可改写契约:前一次运行
// 的索引条目(run_id/config_hash/conditions/created_at/files)与已落档产物
// 字节原样,新运行内容派生新 run_id 不覆盖旧档;同快照重复登记按 run_id
// 去重(同输入 ⇒ 同 run 引用)。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/flow-adopt-rerun.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(WB-10.06 真内核断言在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  // workbenchStore / analysisStore / runManager 在模块加载期读 window(同款桩)
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
  const { dispatch, getState } = await import('../src/workbench/state/workbenchStore.ts')
  const { snapshotRun, runIndexEntryOf } = await import('../src/workbench/state/projectDoc.ts')
  const { resultRows, copyCandidate } = await import('../src/workbench/analysis/resultModel.ts')
  const { analysisSnapshot, addCandidateDraft } = await import('../src/workbench/analysis/analysisStore.ts')
  const { buildExperimentYaml } = await import('../src/workbench/designer/experimentYaml.ts')
  const runManager = await import('../src/workbench/state/runManager.ts')

  const tick = () => new Promise((r) => setTimeout(r, 0))

  // 场景候选(默认攻击 100)+ 设计器同款实验组装(Grid 90/100/110 × 2 reps)
  const SCENARIO = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nmodel:\n  warrior:\n    attack: 100 # keep comment\n'
  const DESIGN = {
    name: 'adopt rerun',
    method: 'grid',
    sampling: 'lhc',
    factors: [{ path: 'model.warrior.attack', min: 90, max: 110, step: 10 }],
    samples: 0,
    reps: 2,
    targets: [{ metric: 'win_rate', kind: 'hard', min: 0, max: 1 }],
  }

  /** 真实内核后端(与 execution-kernel.test.mjs 同源绑定) */
  const kernelBackends = {
    mode: 'desktop',
    sim: async (yaml, replicates) => JSON.parse(wasm.run_simulation(yaml, replicates)),
    candidate: async (yaml, replicates, values) =>
      JSON.parse(wasm.sweep_candidate(yaml, replicates, JSON.stringify(values))),
    recommend: async (yaml, results) =>
      JSON.parse(wasm.sweep_recommend(yaml, JSON.stringify(results))),
    kernelCancel: async () => false,
    compare: null,
  }
  /** 等最后一个任务到终态(真实内核同步执行,轮询只是让出事件循环) */
  const waitTerminal = async () => {
    for (let i = 0; i < 500; i++) {
      const j = runManager.listJobs().at(-1)
      if (j && ['succeeded', 'failed', 'cancelled'].includes(j.status)) return j
      await tick()
    }
    throw new Error('任务未在预算内终态')
  }

  test('WB-10.06:候选复制为草稿再运行——前一次结果与输入快照不被改写', async () => {
    runManager.resetForTest()
    const expYaml1 = buildExperimentYaml(SCENARIO, DESIGN)

    // —— 第 1 次运行:提交链先快照(真实 run_id),再真实扫描跑完 ——
    const plan1 = JSON.parse(wasm.sweep_plan(expYaml1, 0))
    const check1 = JSON.parse(wasm.validate_config(SCENARIO))
    const snap1 = await snapshotRun({
      experimentId: 'exp_adopt001',
      scenarioPath: 'scenarios/base.yaml',
      yaml: expYaml1,
      modelVersion: check1.model_version,
      schemaVersion: check1.schema_version,
      conditions: {
        method: 'grid',
        replicates: plan1.replicates,
        candidates: plan1.candidates.length,
        sims: plan1.sims,
      },
    })
    const job1 = runManager.enqueueRun({
      experimentId: 'exp_adopt001',
      runId: snap1.runId,
      name: DESIGN.name,
      method: 'GRID',
      spec: {
        kind: 'sweep',
        yaml: expYaml1,
        plan: { candidates: plan1.candidates, replicates: plan1.replicates, sims: plan1.sims },
        analysis: {
          baselineId: 'bl_demo0001',
          baselineYaml: 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\n',
          scenarioYaml: SCENARIO,
          plan: plan1,
          modelVersion: check1.model_version,
          schemaVersion: check1.schema_version,
        },
      },
      backends: kernelBackends,
    })
    assert.ok(job1)
    const done1 = await waitTerminal()
    assert.equal(done1.status, 'succeeded', `第 1 次运行应成功: ${done1.exec?.errorMessage ?? ''}`)

    // —— 第 1 次运行的登记与终局落档(DesignerPage/WorkbenchApp 同款链)——
    const entry1 = runIndexEntryOf(snap1, check1.config_hash)
    dispatch({ type: 'run/register', entry: entry1 })
    const report1 = `{"run_id":"${snap1.runId}","kind":"sweep"}`
    dispatch({ type: 'run/artifacts', runId: snap1.runId, artifacts: { [`results/${snap1.runId}.report.json`]: report1 } })
    // 登记后的基准:深拷贝留底,后面逐步对照「不被改写」
    const entry1Frozen = JSON.parse(JSON.stringify(getState().runs.find((r) => r.run_id === snap1.runId)))
    const report1Frozen = getState().runArtifacts[`results/${snap1.runId}.report.json`]
    assert.equal(report1Frozen, report1)

    // —— 分析页:选一个非场景默认值的 ok 候选,复制为「新」草稿 ——
    const job1Now = runManager.listJobs()[0]
    const rows = resultRows(job1Now)
    assert.equal(rows.length, 3)
    assert.ok(rows.every((r) => r.result?.status === 'ok'), '三个候选全部 ok')
    const pick = rows.find((r) => r.values['model.warrior.attack'] !== 100)
    assert.ok(pick, '存在偏离场景默认值的候选')
    assert.ok(pick.result.stats.get('win_rate'), '候选带真实指标统计')
    const draftsBefore = analysisSnapshot().drafts.length
    const draft = copyCandidate(job1Now, pick, 'cnd_draft00001')
    assert.equal(draft.sourceRunId, snap1.runId, '草稿指回来源运行')
    assert.equal(draft.sourceCandidateId, pick.id)
    assert.ok(draft.yaml.includes(`attack: ${pick.values['model.warrior.attack']}`), '采纳值进草稿 YAML')
    assert.equal(draft.values['model.warrior.attack'], pick.values['model.warrior.attack'], 'values 是全参数平铺')
    addCandidateDraft(draft)
    assert.equal(analysisSnapshot().drafts.length, draftsBefore + 1, '草稿层新增一条')
    assert.equal(
      JSON.stringify(getState().runs.find((r) => r.run_id === snap1.runId)),
      JSON.stringify(entry1Frozen),
      '复制草稿不改写前一次运行的索引条目',
    )
    assert.equal(getState().runArtifacts[`results/${snap1.runId}.report.json`], report1Frozen, '复制草稿不动已落档产物')

    // —— 用草稿重组实验配置再提交(DesignerPage 提交链同款)——
    const expYaml2 = buildExperimentYaml(draft.yaml, DESIGN)
    assert.notEqual(expYaml2, expYaml1, '采纳值改变实验输入')
    const check2 = JSON.parse(wasm.validate_config(draft.yaml))
    assert.notEqual(check2.config_hash, check1.config_hash, '采纳候选 ≠ 原场景配置')
    assert.notEqual(draft.yaml, SCENARIO)
    // 冻结位换成新配置:运行集合是独立分区,前次登记不随之变化
    dispatch({ type: 'param/frozen', yaml: draft.yaml, configHash: String(check2.config_hash) })
    assert.equal(
      JSON.stringify(getState().runs.find((r) => r.run_id === snap1.runId)),
      JSON.stringify(entry1Frozen),
      '冻结新配置不改写前一次运行的索引条目',
    )
    const plan2 = JSON.parse(wasm.sweep_plan(expYaml2, 0))
    const snap2 = await snapshotRun({
      experimentId: 'exp_adopt001',
      scenarioPath: 'scenarios/base.yaml',
      yaml: expYaml2,
      modelVersion: check2.model_version,
      schemaVersion: check2.schema_version,
      conditions: {
        method: 'grid',
        replicates: plan2.replicates,
        candidates: plan2.candidates.length,
        sims: plan2.sims,
      },
    })
    assert.notEqual(snap2.runId, snap1.runId, '内容派生 run_id:新快照 ≠ 旧运行')
    assert.notEqual(snap2.configHash, snap1.configHash)
    const entry2 = runIndexEntryOf(snap2, check2.config_hash)
    dispatch({ type: 'run/register', entry: entry2 })
    assert.equal(getState().runs.length, 2, '登记追加,不覆盖')
    assert.equal(
      JSON.stringify(getState().runs.find((r) => r.run_id === snap1.runId)),
      JSON.stringify(entry1Frozen),
      '第二次登记不改写第一次的条目',
    )

    // —— 第 2 次运行真实执行 + 终局落档 ——
    const job2 = runManager.enqueueRun({
      experimentId: 'exp_adopt001',
      runId: snap2.runId,
      name: `${DESIGN.name} rerun`,
      method: 'GRID',
      spec: {
        kind: 'sweep',
        yaml: expYaml2,
        plan: { candidates: plan2.candidates, replicates: plan2.replicates, sims: plan2.sims },
        analysis: {
          baselineId: 'bl_demo0001',
          baselineYaml: SCENARIO,
          scenarioYaml: draft.yaml,
          plan: plan2,
          modelVersion: check2.model_version,
          schemaVersion: check2.schema_version,
        },
      },
      backends: kernelBackends,
    })
    assert.ok(job2)
    assert.notEqual(job2.id, job1Now.id)
    const done2 = await waitTerminal()
    assert.equal(done2.status, 'succeeded', `第 2 次运行应成功: ${done2.exec?.errorMessage ?? ''}`)
    const report2 = `{"run_id":"${snap2.runId}","kind":"sweep"}`
    dispatch({ type: 'run/artifacts', runId: snap2.runId, artifacts: { [`results/${snap2.runId}.report.json`]: report2 } })
    assert.equal(getState().runArtifacts[`results/${snap2.runId}.report.json`], report2, '新运行产物落档')
    assert.equal(getState().runArtifacts[`results/${snap1.runId}.report.json`], report1Frozen, '新运行不覆盖旧档产物')
    assert.equal(
      JSON.stringify(getState().runs.find((r) => r.run_id === snap1.runId)),
      JSON.stringify(entry1Frozen),
      'files 同步只动本 run,前次条目原样',
    )
    // 旧任务(含其结果与保留产物)也不被第二次运行改写
    assert.equal(runManager.listJobs().length, 2)
    assert.equal(runManager.listJobs()[0].id, job1Now.id)
    assert.deepEqual(runManager.listJobs()[0].exec.results, done1.exec.results, '第 1 次运行的候选结果原样')

    // —— 同快照重复登记 = 去重(同输入 ⇒ 同 run 引用,WB-04.09/07.16 口径)——
    dispatch({ type: 'run/register', entry: runIndexEntryOf(snap2, check2.config_hash) })
    assert.equal(getState().runs.length, 2, '同 run_id 不重复入列')

    runManager.resetForTest()
  })
}
