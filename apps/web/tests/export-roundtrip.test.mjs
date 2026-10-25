// WB-10.08 · 导出物与 UI 数字同源、可再分析(真内核,pkg-node 组):真实扫描
// 跑满后走分析页/导出对话框同批函数——候选表 CSV 逐行逐数与内核 metric_stats
// 及 UI 数据源(resultRows 的 stats)精确一致(字符串往返不丢精度);机器
// JSON 的 results/recommendation 与任务保留产物逐值一致;导出的 results 再
//喂内核 sweep_recommend 得到与在跑时相同的推荐(导出物可再分析);days_csv
// 天序完整;SVG 标注携带与 CSV 同一 run_id(同源标注)。归档导出
// (打包→重开→产物字节可再导出)由 flow-loop/flow-multi-config 覆盖,不重复。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/export-roundtrip.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(WB-10.08 真内核断言在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  const wasm = await import(pathToFileURL(pkgNode).href)
  const runManager = await import('../src/workbench/state/runManager.ts')
  const { resultRows } = await import('../src/workbench/analysis/resultModel.ts')
  const { scopedRunCsv, scopedRunJson } = await import('../src/workbench/analysis/exportScope.ts')
  const { svgRunAnnotation } = await import('../src/workbench/analysis/svgExport.ts')

  const tick = () => new Promise((r) => setTimeout(r, 0))
  const YAML = [
    'schema_version: "1"',
    'scenario: {population: 40, duration: "3d", seed: 7}',
    'sweep:',
    '  replicates: 2',
    '  parameters:',
    '    model.warrior.attack: {min: 90, max: 110, step: 10}',
    '  targets:',
    '    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}',
    '',
  ].join('\n')
  const RUN_ID = 'run_export001'
  /** 真实内核后端(与 execution-kernel.test.mjs 同源绑定) */
  const kernelBackends = {
    mode: 'desktop',
    sim: async (y, r) => JSON.parse(wasm.run_simulation(y, r)),
    candidate: async (y, r, v) => JSON.parse(wasm.sweep_candidate(y, r, JSON.stringify(v))),
    recommend: async (y, rs) => JSON.parse(wasm.sweep_recommend(y, JSON.stringify(rs))),
    kernelCancel: async () => false,
    compare: null,
  }
  /** 独立 RFC4180 解析器(不与被测 toCsv 共享实现,交叉验证用) */
  const parseCsv = (text) => {
    const rows = []
    let field = '', row = [], inQ = false
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if (inQ) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ } else if (ch === '"') inQ = false
        else field += ch
      } else if (ch === '"' && field === '') inQ = true
      else if (ch === ',') { row.push(field); field = '' }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = '' }
      else if (ch !== '\r') field += ch
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row) }
    return rows
  }

  test('WB-10.08:候选表 CSV 与 UI/内核数字同源,JSON 结果可再喂内核分析', async () => {
    runManager.resetForTest()
    const plan = JSON.parse(wasm.sweep_plan(YAML, 0))
    assert.equal(plan.candidates.length, 3)
    const job0 = runManager.enqueueRun({
      experimentId: 'exp_export001',
      runId: RUN_ID,
      name: 'export parity',
      method: 'GRID',
      spec: { kind: 'sweep', yaml: YAML, plan: { candidates: plan.candidates, replicates: plan.replicates, sims: plan.sims } },
      backends: kernelBackends,
    })
    assert.ok(job0)
    let job = null
    for (let i = 0; i < 500; i++) {
      const j = runManager.listJobs().at(-1)
      if (j && j.status === 'succeeded') { job = j; break }
      if (j && ['failed', 'cancelled'].includes(j.status)) break
      await tick()
    }
    assert.ok(job, `真实扫描应成功: ${job?.exec?.errorMessage ?? 'timeout'}`)

    const ui = { selectedId: null, order: { filter: 'all', by: 'index', dir: 1 } }
    const entry = {
      run_id: RUN_ID,
      experiment_id: 'exp_export001',
      scenario_path: null,
      experiment_path: null,
      config_hash: 'ab'.repeat(32),
      model_version: 'unknown',
      schema_version: 'unknown',
      seed: 7,
      conditions: {},
      data_source: 'kernel',
      created_at_unix: 0,
      files: [],
    }

    // —— CSV:独立解析器读回,逐行逐数与内核/ UI 数据源精确一致 ——
    const csv = scopedRunCsv(job, ui, 'all', entry)
    assert.ok(csv.startsWith('﻿'), 'BOM 在场(Excel 中文)')
    const table = parseCsv(csv.replace(/^﻿/, ''))
    const [header, ...dataRows] = table
    assert.equal(dataRows.length, 3, '行数 = 候选数')
    const col = (name) => {
      const i = header.indexOf(name)
      assert.ok(i >= 0, `表头含 ${name}`)
      return i
    }
    const cIdx = col('candidate_index')
    const cStatus = col('status')
    const cRunId = col('run_id')
    const cAxis = col('model.warrior.attack')
    const cMean = col('win_rate.mean[ratio_0_1]')
    const cLo = col('win_rate.ci95_lo[ratio_0_1]')
    const cHi = col('win_rate.ci95_hi[ratio_0_1]')
    const cN = col('win_rate.n[count]')
    // UI 数据源(resultRows)与 CSV 同一行序同源对照
    const rows = resultRows(job)
    for (let i = 0; i < 3; i++) {
      const r = dataRows[i]
      assert.equal(Number(r[cIdx]), i)
      assert.equal(r[cRunId], RUN_ID)
      assert.equal(r[cStatus], 'ok')
      assert.equal(Number(r[cAxis]), plan.candidates[i]['model.warrior.attack'], '参数列 = 计划候选值')
      const kern = job.exec.results[i].metric_stats.find(([k]) => k === 'win_rate')[1]
      const uiStat = rows[i].result.stats.get('win_rate')
      // 三方精确一致:CSV 单元格(字符串往返)≡ UI stats ≡ 内核 metric_stats
      assert.equal(Number(r[cMean]), kern.mean, `候选 ${i}: CSV mean 精确一致`)
      assert.equal(Number(r[cLo]), kern.ci95_lo)
      assert.equal(Number(r[cHi]), kern.ci95_hi)
      assert.equal(Number(r[cN]), kern.n)
      assert.equal(uiStat.mean, kern.mean, 'UI 数据源与内核同对象口径')
      const cVerdict = col('verdict')
      assert.ok(['', 'pass', 'borderline', 'fail'].includes(r[cVerdict]), `判定列如内核机器口径: ${r[cVerdict]}`)
    }

    // —— JSON:信封 + results/recommendation 与任务产物逐值一致;可再分析 ——
    const parsed = JSON.parse(scopedRunJson(job, ui, 'all', entry))
    assert.equal(parsed.run_id, RUN_ID)
    assert.equal(parsed.version.input_config_hash, entry.config_hash, '配置版本随索引条目进信封')
    assert.equal(parsed.version.plan_config_hash, null, '无计划哈希时如实置空,不编值')
    assert.equal(parsed.source.registered, true, '索引条目在场即已注册')
    assert.equal(parsed.source.experiment_id, 'exp_export001')
    assert.deepEqual(parsed.results, job.exec.results, 'results = 任务保留的内核结果(逐值)')
    assert.deepEqual(parsed.recommendation, job.exec.recommendation)
    assert.equal(parsed.export_scope.candidates, 3)
    // 再分析:导出的 results 原样喂内核推荐器 ⇒ 与在跑时同一份推荐
    const reRec = JSON.parse(wasm.sweep_recommend(YAML, JSON.stringify(parsed.results)))
    assert.deepEqual(reRec, job.exec.recommendation, '导出物可再分析:同输入同推荐')

    // —— days_csv:3 天序完整(表头 + 每天一行),供 CLI report/query 继续 ——
    const baselineYaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\n'
    const days = JSON.parse(wasm.run_simulation(baselineYaml, 2)).days_csv
    const dayTable = parseCsv(days.trim())
    assert.equal(dayTable.length, 4, '表头 + 3 天')
    assert.deepEqual(dayTable.slice(1).map((r) => Number(r[0])), [1, 2, 3], '天序 1..3')
    assert.ok(dayTable[0].includes('win_rate') && dayTable[0].includes('inflation'))

    // —— SVG:标注携带与 CSV 同一 run_id(同源标注,双语) ——
    for (const locale of ['zh-CN', 'en-US']) {
      const ann = svgRunAnnotation(locale, 'win_rate', RUN_ID, 'succeeded')
      assert.ok(ann.title.includes(RUN_ID) || ann.desc.includes(RUN_ID), `${locale}: SVG 标注含同一 run_id`)
    }

    runManager.resetForTest()
  })
}
