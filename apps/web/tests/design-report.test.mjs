// 策划结论与报告守卫(WB-13 · todo L361,节点侧 + 真内核):
// 报告只吃真实 report.json;参数 diff 逐值对基线;不可用指标显式报因;
// HTML 可文本往返。不测截图。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(报告守卫在 CI 的构建后阶段跑)', () => { assert.ok(true) })
} else {
  const wasm = await import(pkgNode)
  const { designReport } = await import('../src/lib/designReport.ts')
  const { designReportHtml } = await import('../src/lib/designReportHtml.ts')

  const baseYaml = [
    'schema_version: "1"',
    'scenario: {population: 40, duration: "3d", seed: 7}',
    'sweep:',
    '  replicates: 2',
    '  parameters:',
    '    model.warrior.attack: {min: 100, max: 100, step: 10}',
    '  targets:',
    '    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}',
    '',
  ].join('\n')
  const candYaml = baseYaml.replace('min: 100, max: 100', 'min: 110, max: 110')
  const planOf = (yaml) => JSON.parse(wasm.sweep_plan(yaml, 0))
  const resultOf = (yaml) => planOf(yaml).candidates.map((candidate) => JSON.parse(wasm.sweep_candidate(yaml, 2, JSON.stringify(candidate))))[0]

  const basePlan = planOf(baseYaml)
  const candPlan = planOf(candYaml)
  const baseResult = resultOf(baseYaml)
  const candResult = resultOf(candYaml)
  const artifact = (runId, status, plan, result) => JSON.stringify({
    data_source: 'kernel',
    run_id: runId,
    status,
    version: { model_version: 'model-from-kernel', schema_version: '1' },
    source: { data_source: 'kernel', registered: true, experiment_id: 'exp_report0001', seed: 7, created_at_unix: 42 },
    spec: { kind: 'sweep', yaml: '' },
    plan,
    results: [result],
    export_scope: { scope: 'all', candidates: 1, total: 1 },
  })
  const parsedArtifact = (value) => JSON.parse(value)
  const source = {
    runId: 'run_report_candidate',
    runStatus: 'succeeded',
    artifactPath: 'results/run_report_candidate.report.json',
    artifactText: artifact('run_report_candidate', 'succeeded', candPlan, candResult),
    index: { experiment_id: 'exp_report0001', config_hash: 'candidate-hash', seed: 7, created_at_unix: 42 },
  }
  const baseline = {
    runId: 'run_report_baseline',
    artifactPath: 'results/run_report_baseline.report.json',
    artifactText: artifact('run_report_baseline', 'succeeded', basePlan, baseResult),
  }
  const baselineJson = parsedArtifact(baseline.artifactText)
  const candidateJson = parsedArtifact(source.artifactText)

  test('报告内容取自真实 run 产物:条件、统计与图表精确值逐项指回 report.json', () => {
    const report = designReport({ ...source, population: 40, days: 3 }, baseline)
    assert.deepEqual(report.conditions, { population: 40, days: 3, seed: 7, candidateSourceRunId: source.runId })
    assert.equal(report.conditionReason, null)
    const kernel = candResult.metric_stats.find(([metric]) => metric === 'win_rate')[1]
    const finding = report.metrics.find((row) => row.metric === 'win_rate')
    assert.deepEqual([finding.n, finding.mean, finding.sd, finding.ci95Lo, finding.ci95Hi],
      [kernel.n, kernel.mean, kernel.sd, kernel.ci95_lo, kernel.ci95_hi])
    assert.equal(finding.sourcePath, `${source.artifactPath}#results[0].metric_stats[].win_rate`)
    const chart = report.charts[0]
    assert.equal(chart.rows.length, candResult.metric_stats.length)
    for (const row of chart.rows) {
      const raw = candResult.metric_stats.find(([metric]) => metric === row.metric)[1]
      assert.equal(row.mean, raw.mean)
      assert.equal(row.ci95_lo, raw.ci95_lo)
      assert.equal(row.ci95_hi, raw.ci95_hi)
    }
    assert.ok(report.sources.some((row) => row.runId === baseline.runId && row.path === baseline.artifactPath))
  })

  test('缺运行条件逐项报因;统计只标注内核观测,不标 0 或插值代理', () => {
    const missingPopulation = designReport({ ...source, days: 3 }, baseline)
    assert.equal(missingPopulation.conditions, null)
    assert.deepEqual(missingPopulation.conditionMissingFields, ['population'])
    assert.match(missingPopulation.conditionReason, /缺 population/)

    const missingDays = designReport({ ...source, population: 40 }, baseline)
    assert.deepEqual(missingDays.conditionMissingFields, ['days'])
    assert.match(missingDays.conditionReason, /缺 days/)

    const missingBoth = designReport(source, baseline)
    assert.deepEqual(missingBoth.conditionMissingFields, ['population', 'days'])
    assert.ok(missingBoth.metrics.some((row) => row.metric === 'churn_rate' && row.mean === 0))
    assert.equal(missingBoth.metrics.some((row) => row.metric === 'churn_rate' && row.n === null), false)
    assert.equal(missingBoth.assumptions.some((line) => line.includes('不是插值、代理估计')), true)
  })

  test('基线缺失、损坏或 run 不匹配时,参数差异明示原因且不回退为相同值', () => {
    const missing = designReport(source, null)
    assert.deepEqual(missing.parameterDiff, [])
    assert.match(missing.parameterDiffReason, /未选择基线 run 产物/)

    const invalid = designReport({ ...source, artifactText: JSON.stringify(candidateJson) }, { ...baseline, artifactText: '{bad json' })
    assert.match(invalid.parameterDiffReason, /results\/run_report_baseline\.report\.json/)

    const mismatchText = JSON.stringify({ ...baselineJson, run_id: 'run_other' })
    const mismatch = designReport(
      { ...source, artifactText: JSON.stringify(candidateJson) },
      { ...baseline, artifactText: mismatchText },
    )
    assert.equal(mismatch.parameterDiffReason, null)
    assert.deepEqual(mismatch.parameterDiff, [{ path: 'model.warrior.attack', baseline: 100, candidate: 110 }])
    assert.match(mismatch.sources[1].path, /run_report_baseline/)
  })

  test('英文报告使用同一词典结构并保留可用统计与不可用原因', () => {
    const report = designReport(source, baseline, 'en-US')
    assert.match(report.summary.join(' '), /Parameter difference|参数差异/)
    assert.equal(report.assumptions.some((line) => line.includes('not interpolation, proxy estimates')), true)
    const html = designReportHtml(report)
    assert.match(html, /<html lang="en-US">/)
    assert.match(html, /Statistical results/)
    assert.match(html, /Kernel artifact lacks gacha_pulls_to_hit statistics\./)

    const noBaseline = designReport(source, null, 'en-US')
    assert.match(noBaseline.parameterDiffReason, /no baseline run artifact/)
  })

  test('参数差异与基线口径正确:同一路径、基线 run 的精确值', () => {
    const report = designReport(source, baseline)
    assert.deepEqual(report.parameterDiff, [{ path: 'model.warrior.attack', baseline: 100, candidate: 110 }])
    assert.equal(report.parameterDiffReason, null)
  })

  test('不可用指标显式标注内核原因;缺失 comparison 不补算', () => {
    const report = designReport(source, baseline)
    assert.ok(report.unavailableMetrics.some((row) => row.metric === 'gacha_pulls_to_hit' && row.reason.includes('缺少')))
    assert.ok(report.unavailableMetrics.some((row) => row.metric === 'loot_gold_per_player' && row.reason.includes('缺少')))
    assert.ok(report.metrics.every((row) => row.metric !== 'gacha_pulls_to_hit'))
    const comparison = { metric: 'win_rate', arm_a: { n: 2, mean: 1, sd: 0, ci95_lo: 1, ci95_hi: 1 }, arm_b: { n: 2, mean: 1, sd: 0, ci95_lo: 1, ci95_hi: 1 }, diff_mean: 0, diff_ci95_lo: 0, diff_ci95_hi: 0, effect_size_d: 0, verdict: 'NoDifference' }
    const ab = designReport({ ...source, artifactText: JSON.stringify({ ...JSON.parse(source.artifactText), comparison: [comparison], comparison_errors: [{ metric: 'retention_d7', message: 'kernel says unavailable' }] }) }, baseline)
    assert.ok(ab.metrics.some((row) => row.metric === 'win_rate'))
    assert.ok(ab.unavailableMetrics.some((row) => row.metric === 'retention_d7' && row.reason === 'kernel says unavailable'))
    assert.ok(ab.unavailableMetrics.some((row) => row.metric === 'gold_per_player' && row.reason.includes('未返回')))
  })

  test('损坏产物与 run 不匹配显式挂账,不编造报告', () => {
    const bad = designReport({ ...source, artifactText: '{bad json' }, baseline)
    assert.match(bad.summary[0], /解析失败/)
    assert.equal(bad.metrics.length, 0)
    assert.equal(bad.unavailableMetrics.length, 8)
    const mismatch = designReport({ ...source, artifactText: source.artifactText.replace('run_report_candidate', 'run_other') }, baseline)
    assert.match(mismatch.summary[0], /run_id/)
  })

  test('落盘 HTML 可从文本重新读取,数值与来源和报告模型一致', () => {
    const report = designReport(source, baseline)
    const html = designReportHtml(report)
    assert.match(html, /^<!doctype html>/)
    assert.ok(!/https?:\/\//.test(html))
    assert.ok(!/<script/.test(html))
    assert.match(html, /run_report_candidate/)
    assert.match(html, /results\/run_report_candidate\.report\.json#results\[0\]\.metric_stats\[\]\.win_rate/)
    assert.match(html, new RegExp(`<td>${candResult.metric_stats.find(([m]) => m === 'win_rate')[1].mean}</td>`))
    assert.match(html, /逐日均值\/CI 未实现/)
    assert.match(html, /PDF 暂未产出/)
    assert.match(html, /run_report_baseline/)
    assert.match(html, /model\.warrior\.attack/)
  })
}
