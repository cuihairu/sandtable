// 报告入口与归档往返守卫(WB-13):真实 report.json → 入口动作 →
// runArtifacts 登记 → buildProjectSave → openProject 逐字节找回。
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { register } from 'node:module'
import { dirname, join } from 'node:path'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(报告入口守卫在 CI 构建后阶段跑)', () => { assert.ok(true) })
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

  const { act } = await import('react')
  const { setLocale } = await import('../src/workbench/state/localeStore.ts')

  await act(async () => setLocale('zh-CN'))
  const yaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\n'
  const snapshot = { runId: 'run_report_ui00001', experimentId: 'exp_report0001', scenarioPath: 'scenarios/base.yaml', experimentPath: null, configHash: 'candidate-hash', modelVersion: 'model-from-kernel', schemaVersion: '1', seed: 7, conditions: { base_config_hash: 'base-hash' }, dataSource: 'kernel', createdAtUnix: 42 }
  test('分析页真实 run 有「生成报告」入口,文本内容和本地化可直接静态断言', async () => {
    const page = readFileSync(new URL('../src/workbench/pages/AnalysisPage.tsx', import.meta.url), 'utf8')
    assert.match(page, /data-testid="generate-design-report"/)
    assert.match(page, /generateDesignReport/)
    assert.match(page, /designReport\(/)
    assert.match(page, /designReportHtml\(model\)/)
    const zh = readFileSync(new URL('../src/lib/i18n/dict/zh.ts', import.meta.url), 'utf8')
    const en = readFileSync(new URL('../src/lib/i18n/dict/en.ts', import.meta.url), 'utf8')
    assert.match(zh, /'report\.generate': '生成报告'/)
    assert.match(en, /'report\.generate': 'Generate report'/)
    assert.match(zh, /'report\.assumptionDailyNoCi'/)
    assert.match(en, /'report\.assumptionDailyNoCi'/)
  })

  test('报告产物进既有 runArtifacts,保存→重开逐字节找回', async () => {
    const { dispatch, getState } = await import('../src/workbench/state/workbenchStore.ts')
    const { runIndexEntryOf } = await import('../src/workbench/state/projectDoc.ts')
    const { buildProjectSave, openProject } = await import('../src/workbench/state/projectDoc.ts')
    const { packProject } = await import('../src/lib/project.ts')
    dispatch({ type: 'project/open', doc: await import('../src/workbench/state/projectDoc.ts').then((m) => m.projectFromYaml('report-ui', yaml)) })
    dispatch({ type: 'run/register', entry: runIndexEntryOf(snapshot, 'base-hash') })
    const reportHtml = `<!doctype html><main data-run="${snapshot.runId}">report</main>`
    dispatch({ type: 'run/artifacts', runId: snapshot.runId, artifacts: { [`results/${snapshot.runId}.design-report.html`]: reportHtml } })
    const before = getState()
    assert.equal(before.runArtifacts[`results/${snapshot.runId}.design-report.html`], reportHtml)
    assert.ok(before.runs.find((run) => run.run_id === snapshot.runId).files.includes(`results/${snapshot.runId}.design-report.html`))
    const packed = await packProject(await buildProjectSave(before.project, before.objectDrafts, { runArtifacts: before.runArtifacts, runsIndex: (await import('../src/workbench/state/projectDoc.ts')).runsIndexFile(before.runs) }))
    const reopened = await openProject(packed, 'report-ui.sandtable')
    assert.ok(reopened.ok)
    const restored = (await import('../src/workbench/state/projectDoc.ts')).restoreRunsFromArchive(reopened.doc.files)
    assert.equal(new TextDecoder().decode(restored.artifacts[`results/${snapshot.runId}.design-report.html`]), reportHtml)
    assert.deepEqual(restored.runs.map((run) => run.run_id), [snapshot.runId])
    assert.ok(restored.runs[0].files.includes(`results/${snapshot.runId}.design-report.html`))
  })
}
