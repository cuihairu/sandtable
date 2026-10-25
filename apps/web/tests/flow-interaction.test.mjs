// WB-10.12 · 桌面/小屏、键盘焦点、图表点选、表格导航、错误提示与 reduced
// motion(真内核 + 样式/接线守卫):① 图表点选与表格选中共用同一稳定 id 面
// ——真内核扫描跑满后,主图可点候选点(resultPoints drawable)与候选表行
// 是同一批内容派生 id(同序),图表点选/表格点选/检查器读的是同一份选中态,
// 键盘步进在可见(筛选后)子集内进行、不可越界进被筛选隐藏的行;② 样式面:
// 小屏/桌面断点、reduced motion 全局降级、键盘焦点可见轮廓、跳转直达内容的
// skip-link 都在成品 CSS 里;③ 组件接线:图表点 role=button+tabIndex+Enter/
// Space/方向键+焦点跟随,分析页表格方向键步进+焦点落行按钮,错误就地播报
// (role=alert/aria-invalid,因子行/批量/分析页/任务队列)。键盘步进的纯逻辑
// 夹紧(08.07)、筛选/排序不隐藏选中(08.09)、全局快捷键(WB-02.14)已测不重复。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/flow-interaction.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(WB-10.12 真内核断言在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
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
  const runManager = await import('../src/workbench/state/runManager.ts')
  const { dispatch, getState } = await import('../src/workbench/state/workbenchStore.ts')
  const { resultRows, orderedRows } = await import('../src/workbench/analysis/resultModel.ts')
  const { analysisSnapshot, patchResultUI, defaultResultUI } = await import('../src/workbench/analysis/analysisStore.ts')
  const { responsePoints, stepSelection, overallOutcome } = await import('../src/lib/analysisView.ts')

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
  const kernelBackends = {
    mode: 'desktop',
    sim: async (y, r) => JSON.parse(wasm.run_simulation(y, r)),
    candidate: async (y, r, v) => JSON.parse(wasm.sweep_candidate(y, r, JSON.stringify(v))),
    recommend: async (y, rs) => JSON.parse(wasm.sweep_recommend(y, JSON.stringify(rs))),
    kernelCancel: async () => false,
    compare: null,
  }

  test('WB-10.12:图表点选与表格导航共用同一选中态——可见子集内步进,不越界', async () => {
    runManager.resetForTest()
    const plan = JSON.parse(wasm.sweep_plan(YAML, 0))
    const job0 = runManager.enqueueRun({
      experimentId: 'exp_ix001',
      runId: 'run_ix001',
      name: 'interaction parity',
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

    // —— 图表点与表格行是同一批内容派生 id(同序):点选/表选同源 ——
    const all = resultRows(job)
    const rows = orderedRows(all, defaultResultUI.order)
    const views = rows.flatMap((r) => (r.result ? [r.result] : []))
    const drawable = responsePoints(views, 'win_rate', 'model.warrior.attack').drawable
    assert.deepEqual(drawable.map((p) => p.id), rows.map((r) => r.id), '主图可点候选 = 候选表行(同 id 同序)')

    // —— 图表中点选中(点击/Enter 都走同一 onSelect):表格与检查器同读一份选中态 ——
    const midId = rows[1].id
    patchResultUI(job.id, { selectedId: midId })
    dispatch({ type: 'candidate/select', id: midId })
    const ui = analysisSnapshot().byJob[job.id] ?? defaultResultUI
    const selected = all.find((r) => r.id === ui.selectedId)
    assert.ok(selected, '检查器按选中 id 找到同一行')
    assert.equal(getState().selectedCandidateId, midId, '工作台候选选中同步')
    // 选中点恰是图上 aria-pressed 的那个:data-candidate 面与 selectedId 对位
    assert.ok(drawable.some((p) => p.id === ui.selectedId), '选中 id 在图上有点(焦点可落)')

    // —— 表格键盘步进在「可见」行集内:真内核判定 pass×1 + borderline×2,
    //    筛选后只走可见子集,不越进被筛掉的隐藏行 ——
    const verdictOf = (r) => r.result ? overallOutcome(r.result).overall : null
    assert.deepEqual(rows.map(verdictOf), ['pass', 'borderline', 'borderline'], '内核判定:attack=90 过界,其余 CI 触界临界')
    const visible = orderedRows(all, { filter: 'pass', by: 'index', dir: 1 })
    assert.deepEqual(visible.map((r) => r.id), [rows[0].id], 'pass 可见子集 = 1 行')
    const stepIn = (order, id, delta) => stepSelection(order.map((r) => ({ id: r.id })), id, delta)
    assert.equal(stepIn(visible, null, 1), rows[0].id, '空选中从首个可见行进入')
    assert.equal(stepIn(visible, rows[0].id, -1), rows[0].id, '单行子集两向夹紧')
    assert.equal(stepIn(visible, rows[0].id, 1), rows[0].id)
    const border = orderedRows(all, { filter: 'borderline', by: 'index', dir: 1 })
    assert.deepEqual(border.map((r) => r.id), [rows[1].id, rows[2].id], 'borderline 可见子集 = 2 行')
    assert.equal(stepIn(border, rows[1].id, 1), rows[2].id, '子集内前进')
    assert.equal(stepIn(border, rows[2].id, 1), rows[2].id, '子集末行夹紧(不回绕)')
    assert.equal(stepIn(border, rows[1].id, -1), rows[1].id, '子集首行向上夹紧——不越进被筛掉的隐藏行')
    const failView = orderedRows(all, { filter: 'fail', by: 'index', dir: 1 })
    assert.equal(failView.length, 0, '无 fail 判定行,fail 视图为空(隐藏行不进导航域)')
    assert.equal(stepIn(failView, null, 1), null, '空可见集步进不逃进隐藏行')

    runManager.resetForTest()
  })

  test('WB-10.12:小屏/桌面断点、reduced motion、焦点轮廓与 skip-link 在成品样式中', () => {
    const css = readFileSync(join(here, '../src/workbench/workbench.css'), 'utf8')
    // 小屏与桌面双档断点(440/760/1060/1250 收窄,761/1700 展宽)
    for (const bp of ['(max-width:440px)', '(max-width:760px)', '(max-width:1060px)', '(max-width:1250px)', '(min-width:761px)', '(min-width:1700px)']) {
      assert.ok(css.includes(`@media ${bp}`) || css.includes(`@media${bp}`), `断点 ${bp} 在场`)
    }
    // reduced motion:全局动画/过渡/滚动行为降级 + toast 单独降级
    const rm = css.match(/@media[^{]*prefers-reduced-motion:reduce\)[^{]*\{[^@]*/)
    assert.ok(rm, 'reduced motion 块在场')
    assert.match(rm[0], /animation:\s*none/, 'reduced motion 关动画')
    assert.match(rm[0], /transition:\s*none/, 'reduced motion 关过渡')
    assert.match(rm[0], /scroll-behavior:\s*auto/, 'reduced motion 关平滑滚动')
    // 键盘焦点可见:focus-visible 轮廓覆盖可交互元素
    assert.match(css, /:focus-visible\{[^}]*outline:/, '焦点可见轮廓在场')
    // skip-link:隐藏于屏外,获焦时浮现(键盘直达内容区)
    assert.match(css, /\.skip-link\{[^}]*position:\s*fixed/, 'skip-link 在场')
    assert.match(css, /\.skip-link:focus\{[^}]*top:\s*0/, 'skip-link 获焦浮现')
    // 桌面壳三栏网格,主区 minmax(0,1fr) 不被长内容撑爆
    assert.match(css, /grid-template-columns:\s*52px 220px minmax\(0,\s*1fr\)/, '桌面壳网格主区可收缩')
    // 分析页自身断点(小屏下图表/表格收窄)
    const acss = readFileSync(join(here, '../src/workbench/analysis/analysis.css'), 'utf8')
    assert.ok(acss.includes('@media (max-width: 1100px)'), '分析页小屏断点在场')
  })

  test('WB-10.12:键盘与错误接线——图表点可聚焦可回车,表格方向键焦点跟随,错误就地播报', () => {
    // 图表点:role=button + tabIndex + aria-pressed + Enter/Space + 方向键步进 + 焦点跟随
    const chart = readFileSync(join(here, '../src/workbench/analysis/ResponseChart.tsx'), 'utf8')
    assert.match(chart, /role="button"[^>]*tabIndex=\{onSelect \? 0 : -1\}/, '图表点可聚焦(有选中回调才进 tab 序)')
    assert.match(chart, /aria-pressed=\{selectedId === p\.id\}/, '选中态对读屏可辨')
    assert.match(chart, /e\.key === 'Enter' \|\| e\.key === ' '/, 'Enter/Space 触发点选')
    assert.match(chart, /\['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'\]/, '四方向键步进')
    assert.match(chart, /stepSelection\(points/, '步进用同一夹紧逻辑')
    assert.match(chart, /node\?\.focus\(\)/, '步进后焦点跟随到下一点')
    // 分析页表格:方向键步进落在可见行集,焦点移到行按钮
    const page = readFileSync(join(here, '../src/workbench/pages/AnalysisPage.tsx'), 'utf8')
    assert.match(page, /e\.key !== 'ArrowDown' && e\.key !== 'ArrowUp'/, '表格容器接上下方向键')
    assert.match(page, /stepSelection\(rows,/, '步进域 = 可见行集(筛选后)')
    assert.match(page, /button\?\.focus\(\)/, '步进后焦点落行按钮')
    // 错误就地播报:产生处可见,读屏即时
    assert.match(page, /role="alert"/, '分析页执行错误即时播报(role=alert)')
    const factor = readFileSync(join(here, '../src/workbench/designer/FactorTable.tsx'), 'utf8')
    assert.match(factor, /aria-invalid=\{samplesError !== undefined\}/, '采样数错误标记非法输入')
    assert.match(factor, /aria-invalid=\{row\.error !== undefined\}/, '因子行错误标记非法输入')
    const tasks = readFileSync(join(here, '../src/workbench/tasks/TaskList.tsx'), 'utf8')
    assert.match(tasks, /errorClassLabel\(cls, locale\)/, '队列错误分类就地显示')
    assert.match(tasks, /recoveryText\(ex\.errorClass, ex\.kind, locale\)/, '队列恢复提示就地显示')
    const paramTable = readFileSync(join(here, '../src/workbench/params/ParamTable.tsx'), 'utf8')
    assert.match(paramTable, /data-param-row=/, '参数表行有稳定焦点锚点')
    assert.match(paramTable, /ArrowDown/, '参数表容器接上下方向键')
    assert.match(paramTable, /onFocusRow\(path\)/, '方向键步进同步工作台选中态')
    assert.match(paramTable, /onCopyRows\(\)/, 'Ctrl/Cmd+C 走多选复制')
    assert.match(readFileSync(join(here, '../src/workbench/pages/ParametersPage.tsx'), 'utf8'), /scrollIntoView\(\{ block: 'center' \}\)/, '内核错误定位滚动到行')
    assert.match(readFileSync(join(here, '../src/workbench/WorkbenchApp.tsx'), 'utf8'), /if \(link\) requestNavigate\(link\.page\)/, 'hash 深链同样受未保存守卫')
    const taskList = readFileSync(join(here, '../src/workbench/tasks/TaskList.tsx'), 'utf8')
    assert.match(taskList, /role=\{job\.status === 'failed' \? 'alert' : undefined\}/, '失败任务就地 role=alert')
    assert.match(taskList, /recoveryText\(ex\.errorClass, ex\.kind, locale\)/, '失败任务带恢复提示')

    // WB-10.13 · 提交校验必须检查送达内核的同一份 YAML(sweep 实验不能
    // 只校验无 sweep 节的基线场景);A/B 分支的 view.cand 校验不在此行。
    const designer = readFileSync(join(here, '../src/workbench/pages/DesignerPage.tsx'), 'utf8')
    assert.match(designer, /kernelCheck\(snapYaml\)/, 'sweep 提交校验完整实验输入')
  })
}
