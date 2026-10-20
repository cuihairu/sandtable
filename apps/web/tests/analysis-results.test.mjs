import test, { after } from 'node:test'
import strictAssert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as wasm from '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js'
import { candidateViews } from '../src/lib/sweepView.ts'
import { METRIC_META } from '../src/lib/metricMeta.ts'
import { METRIC_KEYS } from '../src/lib/types.ts'
import { abView, availableMetrics, dailyRows, findCandidate, inspectorSources, interpolationText, orderViews, overallOutcome, recommendationView, responsePoints, sensitivityNoteLabel, stepSelection, targetSpan, xAxisDomain, yAutoDomain } from '../src/lib/analysisView.ts'
import { candidateIdFor } from '../src/workbench/ids.ts'
import { copyCandidate, feasibility, formatMetric, fullValues, orderedRows, ranBaseline, resultRows, rowState, statText } from '../src/workbench/analysis/resultModel.ts'
import { currentRealJob, scopeCounts, scopeRows, scopedRunJson } from '../src/workbench/analysis/exportScope.ts'
import { addCandidateDraft, analysisSnapshot, editCandidateDraft, patchResultUI, setAnalysisJob } from '../src/workbench/analysis/analysisStore.ts'

let assertions = 0
const assert = new Proxy(strictAssert, { get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => { assertions++; return value(...args) } : value } })
after(() => console.log(`WB08_ASSERTIONS=${assertions}`))
const yaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nmodel:\n  warrior:\n    attack: 100 # preserve comment\n'
const experiment = `${yaml}sweep:\n  replicates: 2\n  parameters:\n    model.warrior.attack: {min: 90, max: 110, step: 10}\n  targets:\n    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n    - {metric: gold_per_player, min: 1.0, kind: soft}\n`
const plan = JSON.parse(wasm.sweep_plan(experiment, 0))
const results = plan.candidates.map((values) => JSON.parse(wasm.sweep_candidate(experiment, plan.replicates, JSON.stringify(values))))
const context = { baselineId: 'bls_analysis0001', baselineYaml: yaml, scenarioYaml: yaml, plan, modelVersion: 'v-from-kernel-validation', schemaVersion: '1' }
const job = { id: 'job_analysis0001', name: 'real kernel', demo: false, status: 'succeeded', exec: { kind: 'sweep', runId: 'run_analysis0001', spec: { kind: 'sweep', yaml: experiment, plan, analysis: context }, replicates: plan.replicates, results } }
const all = resultRows(job)
const views = all.map((r) => r.result)
const cloneJob = (patch) => ({ ...job, ...patch, exec: { ...job.exec, ...patch.exec } })
const stat = (mean) => ({ n: 2, mean, sd: 0.1, ci95_lo: mean - 0.02, ci95_hi: mean + 0.08 })

test('08.02: every planned candidate has the same content ID before/after partial return', () => {
  const partial = resultRows(cloneJob({ status: 'running', exec: { results: [results[0]] } }))
  assert.equal(partial.length, plan.candidates.length)
  assert.deepEqual(partial.map((r) => r.id), all.map((r) => r.id))
  assert.equal(partial[1].result, null)
  assert.equal(all[0].id, candidateIdFor(context.baselineId, fullValues(job, all[0].values)))
  assert.equal(findCandidate(views, all[1].id).index, 1)
})
test('08.03: metric columns follow actual kernel stats and missing metrics stay unavailable', () => {
  const metrics = availableMetrics(views)
  assert.ok(metrics.includes('win_rate'))
  assert.ok(metrics.includes('gold_per_player'))
  assert.equal(views[0].stats.get('retention_d7'), undefined)
  assert.match(statText(undefined, 'retention_d7'), /不可用/)
  assert.match(statText(views[0].stats.get('win_rate'), 'win_rate'), /95% CI.*n=2/)
})
test('08.04: points exactly preserve real coordinates, mean and CI endpoints', () => {
  const points = responsePoints(views, 'win_rate', plan.axes[0].path).drawable
  assert.equal(points.length, 3)
  for (const [i, p] of points.entries()) {
    const raw = results[i].metric_stats.find(([k]) => k === 'win_rate')[1]
    assert.equal(p.x, plan.candidates[i][plan.axes[0].path])
    assert.equal(p.mean, raw.mean)
    assert.equal(p.ci95_lo, raw.ci95_lo)
    assert.equal(p.ci95_hi, raw.ci95_hi)
  }
})
test('08.04: singleton, constant and empty axis domains are safe', () => {
  assert.equal(xAxisDomain([]), null)
  assert.deepEqual(xAxisDomain([100]), { min: 99, max: 101 })
  assert.deepEqual(xAxisDomain([0, 0]), { min: -1, max: 1 })
  const y = yAutoDomain([stat(0.5)], [0, 1])
  assert.ok(y.min < 0 && y.max > 1)
  assert.equal(yAutoDomain([], [1]), null)
  const constant = yAutoDomain([{ mean: 0, ci95_lo: 0, ci95_hi: 0 }], [])
  assert.ok(constant.min < 0 && constant.max > 0)
})
test('08.05: only submitted constraints and an actually observed identical baseline are references', () => {
  assert.deepEqual(targetSpan(plan, 'win_rate'), { min: 0, max: 1, kind: 'hard' })
  assert.equal(targetSpan(plan, 'power_p50'), null)
  assert.equal(ranBaseline(job, all).values['model.warrior.attack'], 100)
  assert.equal(ranBaseline(job, [all[0], all[2]]), null)
  const structuralChange = cloneJob({ exec: { spec: { ...job.exec.spec, analysis: { ...context, baselineYaml: yaml + 'formulas: {xp_needed: "100"}\n' } } } })
  assert.equal(ranBaseline(structuralChange, all), null)
})
test('08.06/11: every KPI has consistent labels, dimensions, units and display-only conversion', () => {
  assert.deepEqual(Object.keys(METRIC_META).sort(), [...METRIC_KEYS].sort())
  assert.equal(formatMetric(0.0034, 'win_rate'), '0.3%')
  assert.equal(formatMetric(0.0034, 'win_rate', true), '0.34 pp')
  assert.match(formatMetric(120, 'gold_per_player'), /金币\/玩家/)
  assert.match(formatMetric(120, 'power_p50'), /功率/)
  assert.equal(formatMetric(null, 'win_rate'), '不可用')
  assert.equal(views[0].stats.get('win_rate').mean, results[0].metric_stats.find(([k]) => k === 'win_rate')[1].mean)
})
test('08.07: keyboard navigation follows displayed stable IDs, clamped at both ends', () => {
  const reversed = [...all].reverse()
  assert.equal(stepSelection(reversed, null, 1), all[2].id)
  assert.equal(stepSelection(reversed, all[2].id, 1), all[1].id)
  assert.equal(stepSelection(reversed, all[0].id, 1), all[0].id)
  assert.equal(stepSelection([], null, -1), null)
})
test('08.08: pass aggregation does not become null; soft failures do not overwrite hard verdict', () => {
  const v = { outcomes: [{ kind: 'hard', verdict: 'pass' }, { kind: 'soft', verdict: 'fail' }] }
  assert.deepEqual(overallOutcome(v), { hard: 'pass', soft: 'fail', overall: 'pass' })
  assert.deepEqual(overallOutcome({ outcomes: [] }), { hard: null, soft: null, overall: null })
  assert.equal(overallOutcome({ outcomes: [{ kind: 'hard', verdict: 'borderline' }, { kind: 'hard', verdict: 'pass' }] }).overall, 'borderline')
  assert.match(feasibility({ result: v }), /hard: pass.*soft: fail/)
})
test('08.08: arbitrary kernel verdict survives even when stats would suggest the opposite', () => {
  const outcome = { metric: 'win_rate', kind: 'hard', min: 0.5, max: null, stats: stat(0.9), verdict: 'fail' }
  const [v] = candidateViews(plan, [{ ...results[0], target_outcomes: [outcome] }], (values) => candidateIdFor(context.baselineId, values))
  assert.equal(overallOutcome(v).overall, 'fail')
  assert.equal(v.outcomes[0], outcome)
})
test('08.09: filter/sort are shared projection and do not erase hidden selection or mutate input', () => {
  const before = JSON.stringify(job)
  const id = all[1].id
  const sorted = orderedRows(all, { filter: 'all', by: 'metric:win_rate', dir: -1 })
  assert.equal(sorted.find((r) => r.id === id).result, all[1].result)
  patchResultUI(job.id, { selectedId: id, order: { filter: 'fail', by: 'index', dir: 1 } })
  assert.equal(analysisSnapshot().byJob[job.id].selectedId, id)
  const filtered = orderedRows(all, analysisSnapshot().byJob[job.id].order)
  assert.ok(!filtered.some((r) => r.id === id))
  patchResultUI(job.id, { order: { filter: 'all', by: 'index', dir: 1 } })
  assert.equal(orderedRows(all, analysisSnapshot().byJob[job.id].order).find((r) => r.id === id).id, id)
  assert.equal(JSON.stringify(job), before)
})
test('08.10: kernel config_error and cancelled/failed unfinished slots remain visible without zero points', () => {
  const error = JSON.parse(wasm.sweep_candidate(experiment, 2, JSON.stringify({ 'model.combat.p_hit': 2 })))
  assert.equal(typeof error.status, 'object')
  const partialJob = cloneJob({ status: 'cancelled', exec: { results: [error] } })
  const rows = resultRows(partialJob)
  assert.equal(rows.length, 3)
  assert.match(rowState(rows[0], partialJob), /config_error/)
  assert.match(rowState(rows[1], partialJob), /取消/)
  const points = responsePoints(rows.flatMap((r) => r.result ? [r.result] : []), 'win_rate', plan.axes[0].path)
  assert.equal(points.drawable.length, 0)
  assert.equal(points.withheld.length, 1)
  const failed = cloneJob({ status: 'failed', exec: { results: [], errorMessage: 'kernel failure' } })
  assert.match(rowState(resultRows(failed)[0], failed), /kernel failure/)
})
test('08.09/10: unavailable metrics sort last in both directions', () => {
  const missing = { ...views[0], id: 'missing', stats: new Map() }
  for (const dir of [1, -1]) assert.equal(orderViews([missing, views[1]], { filter: 'all', by: 'metric:win_rate', dir }).at(-1).id, 'missing')
})
test('08.12: Comparison fields pass through without computing independent or unpaired CI', () => {
  const raw = { metric: 'win_rate', arm_a: stat(0.3), arm_b: stat(0.4), diff_mean: 0.123456, diff_ci95_lo: -0.01234, diff_ci95_hi: 0.21, effect_size_d: 0.789, verdict: 'NoDifference' }
  const view = abView(raw)
  assert.equal(view.diffMean, raw.diff_mean)
  assert.equal(view.diffCi95Lo, raw.diff_ci95_lo)
  assert.equal(view.diffCi95Hi, raw.diff_ci95_hi)
  assert.equal(view.effectSizeD, raw.effect_size_d)
  assert.equal(view.verdict, raw.verdict)
  assert.equal(view.armA, raw.arm_a)
})
test('08.13: real kernel replicate indices are zero-based and daily selection is explicit', () => {
  const sim = JSON.parse(wasm.run_simulation(yaml, 2))
  assert.deepEqual(sim.results.map((r) => r.replicate), [0, 1])
  for (const replicate of [0, 1]) {
    const daily = dailyRows(sim, replicate)
    assert.equal(daily.ok, true)
    assert.equal(daily.rows.length, 3)
    assert.deepEqual(daily.rows.map((d) => d.win_rate), sim.results[replicate].day_stats.map((d) => d.win_rate))
    assert.ok(daily.rows.every((r) => !('ci95_lo' in r)))
  }
  assert.equal(dailyRows(sim, 99).ok, false)
  assert.equal(dailyRows(null, 0).ok, false)
})
test('03.03: daily kernel ratios render through the display-layer conversion, never bare', () => {
  // 存储与视图层保持内核 0–1 原始口径(上条 08.13 已锁原样透传);
  // ×100 只发生在显示层:win_rate 走 formatMetric,inflation 走 fmtPercent
  const day = JSON.parse(wasm.run_simulation(yaml, 1)).results[0].day_stats[0]
  assert.ok(day.win_rate <= 1, `内核逐日 win_rate 是 0–1 比例,实测 ${day.win_rate}`)
  const page = readFileSync(new URL('../src/workbench/pages/AnalysisPage.tsx', import.meta.url), 'utf8')
  const dailyCell = /<tr key=\{r\.day\}>[\s\S]{0,260}?<\/tr>/.exec(page)?.[0] ?? ''
  assert.match(dailyCell, /formatMetric\(r\.win_rate, 'win_rate'/, 'win_rate 单元格走 formatMetric 换算')
  assert.match(dailyCell, /fmtPercent\(locale, r\.inflation\)/, 'inflation 单元格走 fmtPercent 换算')
  assert.ok(!/>[{]r\.win_rate[}]</.test(dailyCell) && !/>[{]r\.inflation[}]</.test(dailyCell), '禁止裸渲染内核比例')
})
test('08.14: recommendation and sensitivities come directly from real recommendSweep', () => {
  const raw = JSON.parse(wasm.sweep_recommend(experiment, JSON.stringify(results)))
  const v = recommendationView(raw)
  assert.equal(v.interval, raw.recommendation.interval)
  assert.equal(v.elasticities, raw.elasticities)
  assert.equal(v.reasons, raw.recommendation.reasons)
  assert.ok(v.elasticities.length > 0)
  assert.match(interpolationText({ ...v, interval: [90, 110], interpolated: [true, false] }), /下端插值.*上端观测/)
  assert.match(interpolationText({ ...v, interval: null }), /无可推荐区间/)
})
test('08.15: copy keeps baseline, full domain and arbitrary YAML, creates editable independent draft', () => {
  const before = JSON.stringify(job)
  const draft = copyCandidate(job, all[2], 'cnd_newdraft0001')
  assert.equal(draft.baselineId, context.baselineId)
  assert.equal(draft.baselineYaml, yaml)
  assert.equal(draft.values['model.warrior.attack'], 110)
  assert.match(draft.yaml, /attack: 110 # preserve comment/)
  assert.equal(draft.sourceCandidateId, all[2].id)
  const validation = JSON.parse(wasm.validate_config(draft.yaml))
  assert.ok(validation.config_hash)
  addCandidateDraft(draft)
  editCandidateDraft(draft.id, draft.yaml.replace('attack: 110', 'attack: 120'))
  assert.match(analysisSnapshot().drafts.at(-1).yaml, /attack: 120/)
  assert.equal(JSON.stringify(job), before)
  assert.throws(() => copyCandidate(cloneJob({ exec: { spec: { ...job.exec.spec, analysis: undefined } } }), all[0], 'x'), /缺少/)
})
test('08.16: missing version/hash is explicit, not invented; n is replicate count', () => {
  const source = inspectorSources({ plan: { configHash: plan.config_hash, mode: plan.mode, baseSeed: plan.base_seed }, runEntry: { modelVersion: 'unknown' }, stats: { replicates: 2, n: 2 } })
  assert.equal(source.configHash, plan.config_hash)
  assert.equal(source.modelVersion, null)
  assert.equal(source.schemaVersion, null)
  assert.match(source.statUnit, /2 replicates.*n=2/)
})
test('08.17: independent result UI survives job switching and does not touch source results', () => {
  const before = JSON.stringify(results)
  setAnalysisJob(job.id)
  patchResultUI(job.id, { metric: 'gold_per_player', selectedId: all[2].id })
  setAnalysisJob('job_other0001')
  setAnalysisJob(job.id)
  assert.equal(analysisSnapshot().byJob[job.id].metric, 'gold_per_player')
  assert.equal(analysisSnapshot().byJob[job.id].selectedId, all[2].id)
  assert.equal(JSON.stringify(results), before)
})
test('08.15: draft persistence keeps source metadata and quota failure keeps editable buffer', async () => {
  const previousWindow = globalThis.window
  const data = new Map()
  globalThis.window = { localStorage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) } }
  try {
    const draft = copyCandidate(job, all[0], 'cnd_persist0001')
    addCandidateDraft(draft)
    editCandidateDraft(draft.id, draft.yaml + '# new draft edit\n')
    const { CANDIDATE_DRAFTS_KEY } = await import('../src/workbench/analysis/analysisStore.ts')
    const saved = JSON.parse(data.get(CANDIDATE_DRAFTS_KEY)).find((d) => d.id === draft.id)
    assert.equal(saved.baselineYaml, context.baselineYaml)
    assert.equal(saved.sourceRunId, job.exec.runId)
    assert.match(saved.yaml, /new draft edit/)
    const restored = await import('../src/workbench/analysis/analysisStore.ts?restore-test')
    assert.equal(restored.analysisSnapshot().drafts.find((d) => d.id === draft.id).sourceCandidateId, all[0].id)
    globalThis.window.localStorage.setItem = () => { throw new Error('quota') }
    editCandidateDraft(draft.id, '# current buffer\n')
    assert.equal(analysisSnapshot().drafts.find((d) => d.id === draft.id).yaml, '# current buffer\n')
    assert.match(analysisSnapshot().draftPersistenceError, /暂存失败/)
  } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow }
})

/* —— WB-11.14:统计文案 locale 线程(缺省 zh-CN 真值源,en-US 走英文词条) —— */
test('WB-11.14:statText/formatMetric/rowState/feasibility/插值文案随 locale 走词典', () => {
  // 缺省 zh-CN:上一批断言(中文子串/单位「金币/玩家」)即由缺省语义背书
  assert.equal(formatMetric(0.0034, 'win_rate'), '0.3%')
  assert.match(formatMetric(120, 'gold_per_player'), /金币\/玩家/)
  // en-US:数值不变,单位与状态走英文词条(不翻译契约名 pass/fail/config_error)
  assert.equal(formatMetric(0.0034, 'win_rate', false, 'en-US'), '0.3%')
  assert.match(formatMetric(120, 'gold_per_player', false, 'en-US'), /Gold\/player/)
  assert.match(statText(undefined, 'retention_d7', 'en-US'), /Unavailable/)
  const partial = resultRows(cloneJob({ status: 'running', exec: { results: [results[0]] } }))
  assert.equal(partial[1].result, null)
  assert.match(rowState(partial[1], cloneJob({ status: 'running', exec: { results: [results[0]] } }), 'en-US'), /Pending/)
  const cancelled = resultRows(cloneJob({ status: 'cancelled', exec: { results: [results[0]] } }))
  assert.match(rowState(cancelled[1], cloneJob({ status: 'cancelled', exec: { results: [results[0]] } }), 'en-US'), /Not run/)
  // 插值/观测表述:en 双端同词,无中文
  const recView = { param: 'model.warrior.attack', baseline: 100, interval: [90, 110], interpolated: [true, true], confidence: 'high', reasons: [], elasticities: [] }
  const en = interpolationText(recView, 'en-US')
  assert.ok(!/[一-鿿]/.test(en), `en 插值文案无中文:${en}`)
  assert.match(en, /interpolated/)
  assert.match(interpolationText(recView), /插值/)
  // 敏感性 note 标签 en(5 个 note 全覆盖无中文)
  for (const n of ['ok', 'no_bracket', 'not_isolated', 'missing_metric', 'zero_baseline']) {
    assert.ok(!/[一-鿿]/.test(sensitivityNoteLabel(n, 'en-US')), `sens note ${n} 无中文`)
  }
  // feasibility en
  const fe = feasibility(all[1], 'en-US')
  assert.ok(!/[一-鿿]/.test(fe), `feasibility en 无中文:${fe}`)
})

/* —— WB-09.01:导出绑定当前真实 run——范围计数、行对位与产物信封 —— */
test('WB-09.01:范围计数与行集合由当前 run 派生(全部/筛选/所选)', () => {
  const ui = { selectedId: all[1].id, order: { filter: 'all', by: 'index', dir: 1 } }
  const counts = scopeCounts(job, ui)
  assert.equal(counts.all, plan.candidates.length)
  assert.equal(counts.filtered, plan.candidates.length)
  assert.equal(counts.selected, 1)
  assert.deepEqual(scopeRows(job, ui, 'all').map((r) => r.index), all.map((r) => r.index))
  assert.deepEqual(scopeRows(job, ui, 'selected').map((r) => r.index), [1])
  // 筛选=分析页 orderViews 同一口径:overall 判定匹配的行才进入范围
  const fails = all.filter((r) => overallOutcome(r.result).overall === 'fail')
  const filteredUi = { selectedId: null, order: { filter: 'fail', by: 'index', dir: 1 } }
  assert.deepEqual(scopeRows(job, filteredUi, 'filtered').map((r) => r.index), fails.map((r) => r.index))
  assert.equal(scopeCounts(job, filteredUi).filtered, fails.length)
  // 选中不存在的候选 = 空范围,不虚构行;无选中时计数为 0
  assert.deepEqual(scopeRows(job, { selectedId: 'cnd_notthere0000', order: ui.order }, 'selected'), [])
  assert.equal(scopeCounts(job, { selectedId: null, order: ui.order }).selected, 0)
})

test('WB-09.01:绑定导出的 JSON 信封(run 元数据 + 下标对位 + 范围证据)', () => {
  const ui = { selectedId: all[2].id, order: { filter: 'all', by: 'index', dir: 1 } }
  const kept = JSON.parse(scopedRunJson(job, ui, 'selected'))
  assert.equal(kept.data_source, 'kernel')
  assert.equal(kept.run_id, 'run_analysis0001')
  assert.equal(kept.status, 'succeeded')
  assert.equal(kept.results.length, 1)
  assert.deepEqual(kept.results[0].values, results[2].values)
  assert.deepEqual(kept.export_scope, { scope: 'selected', candidates: 1, total: plan.candidates.length })
  const allJson = JSON.parse(scopedRunJson(job, ui, 'all'))
  assert.equal(allJson.results.length, plan.candidates.length)
  assert.deepEqual(allJson.export_scope, { scope: 'all', candidates: plan.candidates.length, total: plan.candidates.length })
  // 部分返回的真实运行:只导出已返回的槽位,范围证据仍记全集计划数
  const partial = JSON.parse(scopedRunJson(
    cloneJob({ status: 'running', exec: { results: [results[0]] } }),
    { selectedId: null, order: { filter: 'all', by: 'index', dir: 1 } },
    'all',
  ))
  assert.equal(partial.results.length, 1)
  assert.equal(partial.export_scope.candidates, plan.candidates.length)
})

test('WB-09.01:当前 run 解析口径(会话 job 优先 → 选择器 run → 最新;演示 job 永不取)', () => {
  const pool = [
    { ...job, id: 'job_demo', demo: true },
    cloneJob({ id: 'job_second', status: 'running' }),
    cloneJob({ id: 'job_third' }),
  ]
  assert.equal(currentRealJob(pool, 'job_second', null).id, 'job_second')
  assert.equal(currentRealJob(pool, 'job_missing', 'run_analysis0001').id, 'job_second')
  assert.equal(currentRealJob(pool, null, null).id, 'job_third')
  assert.equal(currentRealJob([{ ...job, id: 'job_demo', demo: true }], 'job_demo', null), null)
  assert.equal(currentRealJob([], null, null), null)
})
