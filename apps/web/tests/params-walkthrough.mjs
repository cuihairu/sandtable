// ST-WB-011 designer walkthrough (optional, browser): build gacha + behavior
// purely from form editors (no hand-written YAML), let the live preview run the
// real WASM kernel, and drag the dependency graph. Screenshots land in
// /tmp/sandtable-wb11/. PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs
// Start apps/web's Vite dev server first. No test-only hooks are shipped to the UI.
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
let chromium
try {
  ;({ chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright'))
} catch (err) {
  // Optional browser acceptance: without a playwright module this suite is skipped, not failed.
  console.log(`SKIP params-walkthrough: playwright module unavailable (${err?.code ?? err?.message})`)
  process.exit(0)
}
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
let checks = 0
const check = (value, message) => { assert.ok(value, message); checks++ }
// 策划走查按中文界面展开(headless 默认 en-US,显式钉住 zh-CN 使按钮名确定)
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
// Vite's apps/web dev fs boundary excludes the sibling crate. Serve the actual
// built WASM bytes at its requested URL; no API/result/plan is mocked.
await page.context().route('**/sandtable_wasm_bg.wasm', (route) => route.fulfill({
  path: fileURLToPath(new URL('../../../crates/sandtable-wasm/pkg/sandtable_wasm_bg.wasm', import.meta.url)),
  contentType: 'application/wasm',
}))
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await mkdir('/tmp/sandtable-wb11', { recursive: true })
// 候选初始 YAML:含 scenario+model(战斗/行为/练级产出面),刻意不含 gacha 与
// loot——抽签与掉落全部由策划在表单里从零搭起来(验收要求①)。seed 必须与
// 演示基线一致(12345):实时预览走内核 abCompare,CRN 成对比较要求同种子。
const START_YAML = [
  'schema_version: "1"',
  'scenario: {population: 300, duration: "10d", seed: 12345}',
  'model:',
  '  warrior:',
  '    attack: 100',
  '    defense: 50',
  '    hp: 1000',
  '  behavior:',
  '    casual: {sessions_int: 1, sessions_frac: 0.5, p_dungeon: 0.7, p_upgrade: 0.2, p_training: 0.1}',
  '    core: {sessions_int: 2, sessions_frac: 0.5, p_dungeon: 0.6, p_upgrade: 0.3, p_training: 0.1}',
  '    whale: {sessions_int: 5, sessions_frac: 0.0, p_dungeon: 0.65, p_upgrade: 0.3, p_training: 0.05}',
  '  training: {xp: 400, gold: 150}',
].join('\n')
const candidateYaml = async () => {
  const view = await page.evaluate(async () => {
    const { getState, paramYamlView } = await import('/src/workbench/state/workbenchStore.ts')
    return paramYamlView(getState())
  })
  return view.cand
}
const checkAndWrite = async (section) => {
  // 编辑器可以同时开着两个,按钮必须按 section 收窄
  await page.locator(`section.${section}`).getByRole('button', { name: '预检并校验' }).click()
  const write = page.locator(`section.${section}`).getByRole('button', { name: '写入候选并存版本' })
  await write.waitFor()
  await page.waitForFunction(
    (selector) => !document.querySelector(selector)?.disabled,
    `section.${section} .growth-actions .btn.primary`,
    { timeout: 60000 },
  )
  await write.click()
}
try {
  await page.goto(process.env.WB11_URL ?? 'http://127.0.0.1:4338/#/workbench/parameters')
  await page.evaluate(async (yaml) => {
    const { dispatch } = await import('/src/workbench/state/workbenchStore.ts')
    dispatch({ type: 'param/write', yaml })
  }, START_YAML)
  await page.getByRole('button', { name: '抽签编辑器' }).waitFor()

  // —— ① 抽签编辑器:策划不写 YAML,纯表单把保底搭出来 ——
  check(!(await candidateYaml()).includes('gacha:'), 'candidate starts without gacha section')
  await page.getByRole('button', { name: '抽签编辑器' }).click()
  const fillField = async (field, value) => {
    const input = page.locator(`section.gacha-editor input[data-field="${field}"]`)
    await input.fill(value)
    await input.press('Tab')
  }
  await fillField('base_rate', '0.006')
  await fillField('pity_hard', '90')
  await fillField('pity_soft_start', '74')
  await fillField('pity_soft_step', '0.06')
  await fillField('featured_rate', '0.5')
  await fillField('featured_guarantee', '1')
  check((await page.locator('.gacha-editor .error-wall').count()) === 0, 'gacha form has no precheck errors')
  check((await page.locator('.gacha-editor .growth-review').innerText()).includes('base_rate'), 'gacha diff shows semantic fields')
  await page.locator('section.gacha-editor').screenshot({ path: '/tmp/sandtable-wb11/1-gacha-form.png' })
  await checkAndWrite('gacha-editor')
  const afterGacha = await candidateYaml()
  check(afterGacha.includes('gacha:'), 'gacha section written into candidate')
  check(afterGacha.includes('base_rate: 0.006'), 'gacha base_rate written from form')
  check(afterGacha.includes('featured_guarantee: 1'), 'featured guarantee written from form')
  check(afterGacha.includes('behavior:'), 'gacha write-back preserves sibling sections')

  // —— ② 行为画像编辑器:改 whale 群会话数,两段写回(behavior+training 保持) ——
  await page.getByRole('button', { name: '画像编辑器' }).click()
  await page.locator('section.behavior-editor input[data-field="whale.sessions_int"]').fill('6')
  await page.locator('section.behavior-editor input[data-field="whale.sessions_int"]').press('Tab')
  check((await page.locator('.behavior-editor .error-wall').count()) === 0, 'behavior form has no precheck errors')
  check((await page.locator('.behavior-editor .growth-review').innerText()).includes('whale.sessions_int'), 'behavior diff shows changed cohort field')
  await page.locator('section.behavior-editor').screenshot({ path: '/tmp/sandtable-wb11/2-behavior-form.png' })
  await checkAndWrite('behavior-editor')
  const afterBehavior = await candidateYaml()
  check(/whale:[\s\S]*?sessions_int: 6/.test(afterBehavior), 'whale sessions_int written into candidate')
  check(afterBehavior.includes('training:'), 'training section preserved through behavior write-back')

  // —— ③ 实时预览:换指标 + reps=8,内核跑完出直方图/CI95/配对差/verdict ——
  await page.locator('[data-testid="live-metric"]').selectOption('gacha_pulls_to_hit')
  await page.locator('[data-testid="live-reps"]').selectOption('8')
  await page.locator('[data-testid="live-verdict"]').waitFor({ timeout: 120000 })
  check((await page.locator('[data-testid="live-error"]').count()) === 0, 'kernel preview ran without error')
  check((await page.locator('.live-hist-bar').count()) > 0, 'histogram bars rendered')
  const widths = []
  for (const id of ['live-histogram', 'live-ci', 'live-paired']) {
    const box = await page.locator(`[data-testid="${id}"]`).boundingBox()
    widths.push(box?.width ?? 0)
    check((box?.width ?? 0) > 100, `${id} svg not collapsed (width=${box?.width})`)
  }
  const verdictText = await page.locator('[data-testid="live-verdict"]').innerText()
  check(verdictText.trim().length > 0, `verdict badge rendered: ${verdictText}`)
  const tableText = await page.locator('[data-testid="live-table"]').innerText()
  check(tableText.includes('基线') && tableText.includes('候选') && tableText.includes('配对差'), 'preview table shows both arms and CRN diff')
  await page.screenshot({ path: '/tmp/sandtable-wb11/3-live-preview.png', fullPage: true })

  // —— ④ 依赖图:7 节点 + 拖拽改位置(纯视觉,不进模型) ——
  await page.evaluate(async () => {
    const { dispatch } = await import('/src/workbench/state/workbenchStore.ts')
    dispatch({ type: 'navigate', page: 'designer' })
  })
  await page.locator('[data-testid="dependency-graph"]').waitFor()
  check(await page.locator('.graph-node').count() === 7, 'dependency graph renders 7 nodes')
  check(await page.locator('.graph-edge').count() === 7, 'dependency graph renders 7 edges')
  const node = page.locator('[data-testid="graph-node-combat"]')
  await node.scrollIntoViewIfNeeded()
  const before = await node.getAttribute('transform')
  const box = await node.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 - 50, { steps: 6 })
  await page.mouse.up()
  const after = await node.getAttribute('transform')
  check(before !== after, `drag moves node (${before} → ${after})`)
  await page.locator('[data-testid="dependency-graph"]').screenshot({ path: '/tmp/sandtable-wb11/4-dependency-graph.png' })

  check(errors.length === 0, `no page errors: ${errors.join('\n')}`)
  console.log(`WB11_WALKTHROUGH_ASSERTIONS=${checks}; PAGE_ERRORS=${errors.length}; SVG_WIDTHS=${widths.join(',')}`)
} catch (error) {
  console.error('CANDIDATE_YAML_TAIL', (await candidateYaml().catch(() => 'unavailable')).slice(-400))
  await page.screenshot({ path: '/tmp/sandtable-wb11/failure.png', fullPage: true })
  throw error
} finally { await browser.close() }
