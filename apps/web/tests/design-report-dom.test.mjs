// 报告入口 jsdom 走查:真实 report.json → RealResult 渲染 → 下载动作
// 捕获 Blob URL 文本,核对报告来源与不可用原因。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(报告 jsdom 走查在 CI 构建后阶段跑)', () => { assert.ok(true) })
} else {
  register(new URL('./workspace-dom-loader.mjs', import.meta.url), pathToFileURL('./'))
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://sandtable.test/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const storage = new Map()
  Object.defineProperty(dom.window, 'localStorage', {
    configurable: true,
    value: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
  })
  Object.defineProperty(dom.window.navigator, 'language', { configurable: true, value: 'zh-CN' })
  Object.defineProperty(dom.window.navigator, 'languages', { configurable: true, value: ['zh-CN'] })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })

  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { setLocale } = await import('../src/workbench/state/localeStore.ts')
  const runManager = await import('../src/workbench/state/runManager.ts')
  const wasm = await import(pathToFileURL(pkgNode).href)
  const kpiAvailability = (yaml) => JSON.parse(wasm.kpi_availability(yaml))
  await act(async () => setLocale('zh-CN'))

  const yaml = [
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
  const plan = JSON.parse(wasm.sweep_plan(yaml, 0))
  const result = plan.candidates.map((candidate) => JSON.parse(wasm.sweep_candidate(yaml, plan.replicates, JSON.stringify(candidate))))[0]
  const runId = 'run_report_dom0001'
  const context = { baselineId: 'bls_reportdom001', baselineYaml: yaml, scenarioYaml: yaml, plan, modelVersion: 'model-from-kernel', schemaVersion: '1' }
  const entry = { run_id: runId, experiment_id: 'exp_report0001', scenario_path: 'scenarios/base.yaml', experiment_path: null, config_hash: 'candidate-hash', model_version: 'model-from-kernel', schema_version: '1', seed: 7, conditions: { base_config_hash: '' }, data_source: 'kernel', created_at_unix: 42, files: [`results/${runId}.report.json`] }
  const artifact = JSON.stringify({ run_id: runId, status: 'succeeded', version: context, source: { seed: 7 }, spec: { kind: 'sweep', yaml }, plan, results: [result] })
  const state = {
    page: 'analysis',
    selection: { source: 'kernel', run: runId },
    runs: [entry],
    runArtifacts: { [`results/${runId}.report.json`]: artifact },
    project: null,
  }
  const job = {
    id: 'job_reportdom001', name: 'report dom', demo: false, status: 'succeeded', createdAt: 42,
    total: 1, done: 1, method: 'GRID',
    exec: { runId, kind: 'sweep', spec: { kind: 'sweep', yaml, plan, analysis: context }, progressKind: 'candidates', replicates: plan.replicates, candidatesDone: 1, candidatesTotal: 1, results: [result], recommendation: null, recommendationError: null, comparison: null, comparisons: [], comparisonErrors: [], arms: null, sim: null, errorClass: null, errorMessage: null },
  }

  globalThis.__testKpiAvailabilityForReport = kpiAvailability

  test('生成报告入口产出可读离线 HTML,来源与不可用原因在正文', async () => {
    runManager.__testInjectJobsForDomGuard([job])
    const { AnalysisPage } = await import('../src/workbench/pages/AnalysisPage.tsx')
    const blobs = []
    dom.window.URL.createObjectURL = (value) => {
      assert.ok(value instanceof dom.window.Blob)
      blobs.push(value)
      return `blob:report-${blobs.length}`
    }
    dom.window.URL.revokeObjectURL = () => {}
    const downloads = []
    dom.window.HTMLAnchorElement.prototype.click = function click() {
      downloads.push({ href: this.href, download: this.download })
    }
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(createElement(AnalysisPage, { state, onExport: () => {} })))
    const button = [...host.querySelectorAll('button')].find((node) => node.textContent === '生成报告')
    assert.ok(button, 'report action is rendered for a real run')
    await act(async () => button.click())
    assert.match(downloads[0].download, /^run_report_dom0001\.design-report\.html$/)
    assert.equal(downloads[0].href, 'blob:report-1')
    assert.ok(blobs.length > 0, 'download creates a Blob')
    assert.equal(blobs[0].type, 'text/html;charset=utf-8')
    const text = await blobs.at(-1).text()
    assert.match(text, /^<!doctype html>/)
    assert.match(text, /<html lang="zh-CN">/)
    assert.match(text, new RegExp(runId))
    assert.match(text, /数据来源:KERNEL run run_report_dom0001/)
    assert.match(text, /results\/run_report_dom0001\.report\.json#results\[0\]\.metric_stats\[\]\.win_rate/)
    assert.match(text, /gacha_pulls_to_hit/)
    assert.match(text, /需要 model\.gacha 配置,当前未配置/)
    assert.match(text, /逐日均值\/CI 未实现/)
    await act(async () => root.unmount())
    host.remove()
  })
}
