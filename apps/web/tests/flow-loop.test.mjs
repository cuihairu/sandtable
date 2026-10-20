// WB-10.01 · 端到端闭环(节点侧,真内核):裸 YAML 打开项目 → 编辑一个数值 →
// 组实验配置并真实运行 → 结果视图 → 导出 JSON/CSV → 保存 .sandtable → 重开核对。
// 与 UI 同口径:草稿 / 实验配置 / 运行登记 / 索引 / 终局落档 / 打包 / 重开
// 全部走工作台同一批纯函数,不经过渲染层。
import test from 'node:test'
import strictAssert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as wasm from '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js'
import { buildExperimentYaml } from '../src/workbench/designer/experimentYaml.ts'
import { packProject } from '../src/lib/project.ts'
import {
  auditRunArtifacts, baseContentOf, buildProjectSave, markSaved, openProject, projectFromYaml,
  resetDraft, restoreRunsFromArchive, runArtifactPaths, runIndexEntryOf, runsIndexFile,
  snapshotRun, unsavedKeys, writeDraft,
} from '../src/workbench/state/projectDoc.ts'
import { scopedRunCsv, scopedRunJson } from '../src/workbench/analysis/exportScope.ts'
import { fullValues, resultRows } from '../src/workbench/analysis/resultModel.ts'

let assertions = 0
const assert = new Proxy(strictAssert, { get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => { assertions++; return value(...args) } : value } })

const SCENARIO = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nmodel:\n  warrior:\n    attack: 100 # keep comment\n'
// 编辑一个非扫描轴数值:扫描轴仍是 model.warrior.attack 90/100/110
const EDITED = SCENARIO.replace('population: 40', 'population: 48')
const DESIGN = {
  name: 'flow sweep',
  method: 'grid',
  sampling: 'lhc',
  factors: [{ path: 'model.warrior.attack', min: 90, max: 110, step: 10 }],
  samples: 0,
  reps: 2,
  targets: [{ metric: 'win_rate', kind: 'hard', min: 0, max: 1 }],
}
const MODEL_VERSION = 'v-from-kernel-validation'

test('WB-10.01:打开真实 YAML → 编辑数值 → 运行 → 查看结果 → 导出 → 保存重开', async () => {
  // 1 · 打开真实 YAML(裸文件迁入工作台,原文字节保真)
  const doc = await projectFromYaml('flow.yaml', SCENARIO)
  const path = doc.objects[0].path
  assert.equal(doc.objects[0].kind, 'scenario')
  assert.equal(baseContentOf(doc, path), SCENARIO)

  // 2 · 编辑一个数值:草稿隔离原文,重置回原文
  let drafts = writeDraft({}, path, SCENARIO, EDITED)
  assert.deepEqual(unsavedKeys(drafts), [path], '未保存标记在位')
  assert.equal(baseContentOf(doc, path), SCENARIO, '草稿不改写归档原文')
  drafts = resetDraft(drafts, path)
  assert.deepEqual(unsavedKeys(drafts), [], '重置回到原文')
  drafts = markSaved(writeDraft({}, path, SCENARIO, EDITED), [path])

  // 3 · 组实验配置并真实运行(内核计划 + 逐候选仿真)
  const experiment = buildExperimentYaml(EDITED, DESIGN)
  assert.match(experiment, /population: 48/, '编辑值进入实验输入')
  assert.doesNotMatch(experiment, /population: 40/)
  const plan = JSON.parse(wasm.sweep_plan(experiment, 0))
  assert.equal(plan.candidates.length, 3, 'Grid 90/100/110 三个候选')
  const results = plan.candidates.map((values) =>
    JSON.parse(wasm.sweep_candidate(experiment, plan.replicates, JSON.stringify(values))))

  // 4 · 运行登记(与分析页信封 / 导出同一口径)
  const snap = await snapshotRun({
    experimentId: 'exp_flow0001',
    scenarioPath: path,
    yaml: experiment,
    modelVersion: MODEL_VERSION,
    schemaVersion: '1',
    conditions: { method: 'grid', replicates: plan.replicates, candidates: plan.candidates.length },
  })
  const entry = { ...runIndexEntryOf(snap), files: [] }
  const job = {
    id: 'job_flow0001',
    name: DESIGN.name,
    demo: false,
    status: 'succeeded',
    exec: {
      kind: 'sweep',
      runId: snap.runId,
      spec: {
        kind: 'sweep',
        yaml: experiment,
        plan,
        analysis: {
          baselineId: 'bls_flow0001', baselineYaml: EDITED, scenarioYaml: EDITED,
          plan, modelVersion: MODEL_VERSION, schemaVersion: '1',
        },
      },
      replicates: plan.replicates,
      results,
    },
  }

  // 5 · 查看结果:计划内候选全集在场,编辑值进结果视图
  const rows = resultRows(job)
  assert.equal(rows.length, plan.candidates.length)
  assert.ok(rows.every((r) => r.result !== null), '真实运行全部候选返回')
  assert.equal(fullValues(job, rows[0].values)['scenario.population'], 48, '编辑值进结果视图')

  // 6 · 导出:终局落档与分析页/导出对话框同一批函数
  const ui = { selectedId: null, order: { filter: 'all', by: 'index', dir: 1 } }
  const reportPath = runArtifactPaths(snap.runId, ['report.json'])[0]
  const report = scopedRunJson(job, ui, 'all', entry)
  const csv = scopedRunCsv(job, ui, 'all', entry)
  assert.equal(csv.split('\r\n').length - 1, plan.candidates.length, '候选表行数 = 计划候选数')
  entry.files.push(reportPath)
  const index = runsIndexFile([entry])

  // 7 · 保存 .sandtable 并重开:编辑值落盘,运行索引与产物可恢复
  const bytes = await packProject(await buildProjectSave(doc, drafts, {
    runArtifacts: { [reportPath]: report },
    runsIndex: index,
  }))
  const opened = await openProject(bytes, 'flow.sandtable')
  assert.equal(opened.ok, true, '重开归档通过校验')
  const doc2 = opened.doc
  assert.equal(baseContentOf(doc2, path), EDITED, '编辑值随保存落盘,不是原文')
  assert.equal(doc2.files.get(reportPath) !== undefined, true, '运行产物在归档内')

  // 8 · 重开后登记簿恢复、产物在场、缺件审计为空、字节可再次导出
  const restored = restoreRunsFromArchive(doc2.files)
  assert.equal(restored.error, null)
  assert.equal(restored.runs.length, 1)
  assert.equal(restored.runs[0].run_id, snap.runId)
  assert.equal(restored.runs[0].experiment_id, 'exp_flow0001')
  assert.equal(restored.runs[0].config_hash, snap.configHash)
  assert.deepEqual(auditRunArtifacts(restored.runs, new Set(restored.runs[0].files)), [], '终局落档后不缺件')
  assert.deepEqual(
    JSON.parse(new TextDecoder().decode(restored.artifacts[reportPath])),
    JSON.parse(report),
    '重开后产物字节可再次导出',
  )
  assert.equal(restored.runs[0].data_source, 'kernel')
})

test('WB-10.01:闭环里的每一步在 UI 上有对应接线', () => {
  // 源级守卫:闭环不是只在测试里成立——UI 各步走的是同一批函数
  const designer = read('src/workbench/pages/DesignerPage.tsx')
  const app = read('src/workbench/WorkbenchApp.tsx')
  const panels = read('src/workbench/project/ProjectPanels.tsx')
  const appBar = read('src/workbench/components/AppBar.tsx')
  assert.ok(designer.includes('buildExperimentYaml('), '配置表单组实验配置')
  assert.ok(designer.includes('snapshotRun('), '提交登记运行快照')
  assert.ok(designer.includes("type: 'run/register'"), '登记进运行登记簿')
  assert.ok(app.includes("results/${exec.runId}.report.json"), '终局落档')
  assert.ok(app.includes("type: 'run/artifacts'"), '落档进产物')
  assert.ok(app.includes('restoreRunsFromArchive(doc.files)'), '重开恢复登记簿')
  assert.ok(app.includes("type: 'run/register', entry, artifacts: own }"), '恢复后逐条再登记')
  assert.ok(panels.includes("if (data !== undefined) download("), '在场产物可再导出')
  assert.ok(appBar.includes('onSaveProject'), '保存入口挂在工具栏')
})

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8')
