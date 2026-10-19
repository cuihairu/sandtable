// Optional browser acceptance: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
// Start apps/web's Vite dev server first. No test-only hooks are shipped to the UI.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
let chromium
try {
  ;({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright'))
} catch (err) {
  // Optional browser acceptance: without a playwright module this suite is skipped, not failed.
  console.log(`SKIP analysis-browser: playwright module unavailable (${err?.code ?? err?.message})`)
  process.exit(0)
}
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
let checks = 0
const check = (value, message) => { assert.ok(value, message); checks++ }
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
// Vite's apps/web dev fs boundary excludes the sibling crate. Serve the actual
// built WASM bytes at its requested URL; no API/result/plan is mocked.
await page.context().route('**/sandtable_wasm_bg.wasm', (route) => route.fulfill({
  path: fileURLToPath(new URL('../../../crates/sandtable-wasm/pkg/sandtable_wasm_bg.wasm', import.meta.url)),
  contentType: 'application/wasm',
}))
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await mkdir('/tmp/sandtable-wb08', { recursive: true })
try {
  await page.goto(process.env.WB08_URL ?? 'http://127.0.0.1:4338/#/workbench/analysis')
  await page.getByText('尚无真实执行结果。', { exact: false }).waitFor()
  await page.evaluate(async () => {
    const { dispatch } = await import('/src/workbench/state/workbenchStore.ts')
    dispatch({ type: 'param/write', yaml: 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nmodel:\n  warrior:\n    attack: 100\n' })
    dispatch({ type: 'design/set', patch: { name: 'WB08 real browser', method: 'grid', reps: 2,
      factors: [{ path: 'model.warrior.attack', min: 90, max: 110, step: 10 }],
      targets: [{ metric: 'win_rate', kind: 'hard', min: 0, max: 1 }, { metric: 'gold_per_player', kind: 'soft', min: 1, max: null }] } })
    dispatch({ type: 'navigate', page: 'designer' })
  })
  await page.getByRole('button', { name: '提交实验(绑定计划快照)', exact: true }).click()
  await page.evaluate(async () => (await import('/src/workbench/state/workbenchStore.ts')).dispatch({ type: 'navigate', page: 'analysis' }))
  await page.locator('#real-candidates').waitFor()
  await page.locator('.real-analysis').getByText('3/3 候选已返回', { exact: false }).waitFor({ timeout: 60000 })
  check(await page.locator('#real-candidates tbody tr').count() === 3, '3 real candidates')
  check((await page.locator('.real-analysis').innerText()).includes('3/3 候选已返回'), 'actual completion count')
  check(!(await page.locator('.real-analysis').innerText()).includes('synthetic_demo'), 'real source contains no demo results')
  const points = page.locator('.real-analysis .main-chart [data-candidate]')
  await points.nth(1).click()
  const selectedId = await points.nth(1).getAttribute('data-candidate')
  check(await page.locator('#real-candidates tr.selected').getAttribute('data-candidate') === selectedId, 'point selection reaches table')
  check((await page.locator('.real-inspector').innerText()).includes(selectedId), 'inspector uses same stable ID')
  await page.locator('#real-candidates tbody tr').first().locator('button').focus()
  await page.keyboard.press('ArrowDown')
  check(await page.locator('#real-candidates tr.selected').getAttribute('data-candidate') === selectedId, 'keyboard selection reaches chart')
  await page.locator('#real-candidates th .sort-button').first().click()
  await page.locator('#real-candidates th .sort-button').first().click()
  check(await page.locator('#real-candidates tr.selected').getAttribute('data-candidate') === selectedId, 'sort preserves selection')
  await page.selectOption('#real-filter', 'fail')
  await page.getByText('所选候选不在当前筛选中；', { exact: false }).waitFor()
  check((await page.locator('.real-inspector').innerText()).includes(selectedId), 'hidden selection preserved')
  await page.getByRole('button', { name: '显示全部以恢复' }).click()
  await page.selectOption('#real-metric', 'gold_per_player')
  check((await page.locator('.real-analysis .main-chart').getAttribute('aria-label')).includes('金币/玩家'), 'metric unit switches in accessible chart label')
  const before = await page.evaluate(async () => JSON.stringify((await import('/src/workbench/state/runManager.ts')).listJobs()))
  await page.getByRole('button', { name: '复制到新方案草稿' }).click()
  check(await page.locator('.result-draft textarea').count() === 1, 'new editable draft created')
  await page.locator('.result-draft textarea').fill('schema_version: "1"\nscenario: {population: 50, duration: "3d", seed: 7}\n')
  const after = await page.evaluate(async () => JSON.stringify((await import('/src/workbench/state/runManager.ts')).listJobs()))
  check(before === after, 'editing new draft leaves old run hash/input/results unchanged')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载真实结果 JSON' }).click()
  check((await downloadPromise).suggestedFilename().endsWith('.json'), 'real export is downloadable')
  await page.screenshot({ path: '/tmp/sandtable-wb08/desktop.png', fullPage: true })
  await page.setViewportSize({ width: 768, height: 1024 })
  check(await page.locator('#real-metric').isVisible(), 'metric control reachable at 768px')
  const layout = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, width: innerWidth,
    table: document.querySelector('#real-candidates').parentElement.scrollWidth,
    wrap: document.querySelector('#real-candidates').parentElement.clientWidth }))
  check(layout.doc <= layout.width, 'no document overflow at 768px')
  check(layout.table > layout.wrap, 'wide table has its own horizontal scroll')
  await page.screenshot({ path: '/tmp/sandtable-wb08/768.png', fullPage: true })
  await page.getByRole('button', { name: '打开合成演示（独立来源）' }).click()
  check((await page.locator('.workspace-toolbar').first().innerText()).includes('独立来源: synthetic_demo'), 'demo requires explicit source')
  await page.getByRole('button', { name: '返回真实运行' }).click()
  check(await page.locator('#real-metric').inputValue() === 'gold_per_player', 'source switch retains real metric')
  check((await page.locator('.real-inspector').innerText()).includes(selectedId), 'source switch retains real candidate')
  check(errors.length === 0, `no page errors: ${errors.join('\n')}`)
  console.log(`WB08_BROWSER_ASSERTIONS=${checks}; PAGE_ERRORS=${errors.length}; VIEWPORTS=1440,768`)
} catch (error) {
  console.error('RESULT_TEXT', await page.locator('.real-analysis').innerText().catch(() => 'unmounted'))
  await page.screenshot({ path: '/tmp/sandtable-wb08/failure.png', fullPage: true })
  throw error
} finally { await browser.close() }
