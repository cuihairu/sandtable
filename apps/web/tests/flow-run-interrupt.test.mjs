// WB-10.05 · 运行中切页/开抽屉/切语言并取消——真实内核中断闭环(pkg-node 组,
// CI 在 wasm-pack nodejs 构建后跑)。与 execution.test.mjs 的假后端不同,这里
// 注入「真内核 + 可控边界」的候选后端:候选由 pkg-node 真跑,只在测试放行时
// 返回执行器,于是切页/取消能确定性地落在候选之间。核对四件事:
// - 真实进度:done 只在候选边界推进(1 候选 × 2 reps 一格);
// - 取消边界:第 3 个候选在跑时发取消,停在第 3 个候选边界(6/8),不再派发
//   第 4 个,扫描取消绝不触碰内核取消令牌(WB-07.12);
// - 产物保留:已完成的真内核候选逐值保留、不出推荐(不完整候选集);
// - 切页/抽屉/语言:任务在模块级 runManager 里与页面解耦,终态后可再次提交,
//   旧任务产物不被新任务覆盖。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/flow-run-interrupt.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(WB-10.05 真内核断言在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  // workbenchStore 在模块加载期读 window(与 workbench-store.test.mjs 同款桩)
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
  const { getState, dispatch } = await import('../src/workbench/state/workbenchStore.ts')
  const { localeSession, setLocale } = await import('../src/workbench/state/localeStore.ts')
  const runManager = await import('../src/workbench/state/runManager.ts')
  const { activeJob, terminalOutcome } = await import('../src/workbench/state/execFsm.ts')
  const { statusLabel } = await import('../src/workbench/tasks/taskText.ts')

  const EXP_YAML = [
    'schema_version: "1"',
    'scenario: {population: 40, duration: "3d", seed: 7}',
    'sweep:',
    '  replicates: 2',
    '  parameters:',
    '    model.warrior.attack: {min: 90, max: 120, step: 10}',
    '  targets:',
    '    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}',
    '',
  ].join('\n')

  const tick = () => new Promise((r) => setTimeout(r, 0))

  test('WB-10.05:运行中切页/开抽屉/切语言并取消——真实进度、取消边界与产物保留', async () => {
    runManager.resetForTest()
    const plan = JSON.parse(wasm.sweep_plan(EXP_YAML, 0))
    assert.equal(plan.candidates.length, 4, '4 个候选(90..120 步长 10)')
    assert.equal(plan.sims, 8, '总任务数 = 4 候选 × 2 reps')

    // 真内核 + 可控边界:候选由 pkg-node 真跑,测试按序放行,落在候选之间
    const pending = []
    let started = 0
    let finished = 0
    let kernelCancelCalls = 0
    const backends = {
      mode: 'desktop',
      sim: async () => {
        throw new Error('本用例不走单次仿真')
      },
      candidate: async (yaml, replicates, values) => {
        const result = JSON.parse(wasm.sweep_candidate(yaml, replicates, JSON.stringify(values)))
        const i = started++
        await new Promise((r) => {
          pending[i] = r
        })
        finished++
        return result
      },
      recommend: async (y, results) => JSON.parse(wasm.sweep_recommend(y, JSON.stringify(results))),
      kernelCancel: async () => {
        kernelCancelCalls++
        return false
      },
      compare: null,
    }
    /** 放行下一个在跑候选,并等执行器的边界更新落地 */
    const releaseNext = async () => {
      const r = pending[finished]
      assert.ok(r, `第 ${finished + 1} 个候选应在跑(真内核已返回,停在边界前)`)
      r()
      await tick()
    }

    // 抽屉的订阅通道(useSyncExternalStore 同款):记录监听器眼里的进度轨迹
    const seen = []
    const unsubscribe = runManager.subscribe(() => {
      const j = runManager.listJobs()[0]
      if (j) seen.push([j.status, j.done])
    })

    const job = runManager.enqueueRun({
      experimentId: 'exp_wb1005',
      runId: 'run_wb1005',
      name: '中断闭环扫描',
      method: 'sweep',
      spec: { kind: 'sweep', yaml: EXP_YAML, plan },
      backends,
    })
    assert.ok(job, '空闲时入队成功')
    assert.equal(job.total, 8, '任务总量按内核计划 sims 计')
    await tick()
    assert.equal(started, 1, '第 1 个候选已进内核真跑')
    assert.deepEqual([runManager.listJobs()[0].status, runManager.listJobs()[0].done], ['running', 0])

    // 运行中切页:reducer 只动 page/selection,任务在模块级 runManager 里不丢
    const before = getState()
    dispatch({ type: 'navigate', page: 'parameters' })
    const navigated = getState()
    assert.equal(navigated.page, 'parameters')
    assert.notEqual(navigated.page, before.page)
    let running = runManager.listJobs()[0]
    assert.equal(running.id, job.id)
    assert.equal(running.status, 'running')
    assert.equal(running.done, 0, '切页不产生假进度')

    // 打开抽屉(WorkbenchApp 同款 dispatch):抽屉渲染的当前任务 = activeJob
    assert.equal(getState().drawerOpen, false)
    dispatch({ type: 'toggle-drawer' })
    assert.equal(getState().drawerOpen, true, '抽屉打开')
    assert.equal(activeJob(runManager.listJobs())?.id, job.id, '抽屉/状态栏/任务页同一 activeJob 判定')
    assert.equal(getState().paramDraft.yaml, navigated.paramDraft.yaml, '切页/开抽屉不动实验输入')

    // 运行中切语言:任务对象本身 locale 无关,状态文案按 locale 即时解析
    const zhBefore = localeSession.get()
    setLocale(zhBefore === 'zh-CN' ? 'en-US' : 'zh-CN')
    running = runManager.listJobs()[0]
    assert.equal(statusLabel(running.status, 'zh-CN'), '运行中')
    assert.equal(statusLabel(running.status, 'en-US'), 'Running')
    assert.equal(activeJob(runManager.listJobs())?.id, job.id, '切语言不丢后台任务')

    // 真实进度只在候选边界:放行 1 → done=2;放行 2 → done=4(每候选 2 reps)
    await releaseNext()
    running = runManager.listJobs()[0]
    assert.equal(running.done, 2)
    assert.equal(running.exec.results.length, 1)
    assert.equal(running.exec.results[0].metric_stats[0][1].n, 2, '候选结果携带真实 replicate 数')
    await releaseNext()
    running = runManager.listJobs()[0]
    assert.equal(running.done, 4)
    assert.equal(running.exec.results.length, 2)

    // 4/8 时取消:第 3 个候选已在内核真跑,取消落点在候选边界
    assert.equal(started, 3, '取消时第 3 个候选在跑')
    await runManager.cancelJob(job.id)
    running = runManager.listJobs()[0]
    assert.equal(running.status, 'cancelling')
    assert.equal(running.done, 4, '取消请求不产生假进度')
    assert.equal(kernelCancelCalls, 0, '扫描取消绝不触碰内核取消令牌(WB-07.12)')
    await runManager.cancelJob(job.id)
    assert.equal(runManager.listJobs()[0].status, 'cancelling', '重复取消幂等')

    // 边界落地:在跑的第 3 个候选跑完收尾,第 4 个不再派发
    await releaseNext()
    await tick()
    assert.equal(started, 3, '取消后不再派发新候选')
    const stopped = runManager.listJobs()[0]
    assert.equal(stopped.status, 'cancelled')
    assert.equal(stopped.done, 6, '真实停止边界 = 3 个 ok 候选 × 2 reps = 6/8')
    assert.equal(stopped.exec.results.length, 3, '已完成候选保留')
    assert.equal(stopped.exec.recommendation, null, '不完整候选集不出推荐(WB-07.07)')
    assert.equal(stopped.exec.errorMessage, null, '取消不是错误')
    assert.equal(terminalOutcome(stopped), 'partial', '终态产出 = partial(保留真实中间产物)')
    assert.equal(runManager.hasActiveJobs(), false, '终态解除占用,可再次提交')

    // 保留的是真内核结果:与直调 sweep_candidate 逐值一致(数据可追溯)
    const direct = JSON.parse(
      wasm.sweep_candidate(EXP_YAML, plan.replicates, JSON.stringify(plan.candidates[2])),
    )
    assert.deepEqual(JSON.parse(JSON.stringify(stopped.exec.results[2])), direct)

    // 订阅通道轨迹(抽屉的真实进度来源):done 0 → 2 → 4,取消不添假值
    const dones = [...new Set(seen.map(([, d]) => d))]
    assert.deepEqual(dones, [0, 2, 4, 6])
    unsubscribe()

    // 终态后再次提交:新任务照常跑,旧任务的保留产物不被覆盖
    const job2 = runManager.enqueueRun({
      experimentId: 'exp_wb1005',
      runId: 'run_wb1005b',
      name: '中断后重提',
      method: 'sweep',
      spec: { kind: 'sweep', yaml: EXP_YAML, plan },
      backends,
    })
    assert.ok(job2, '终态后可再次提交')
    assert.notEqual(job2.id, job.id)
    const both = runManager.listJobs()
    assert.equal(both.length, 2)
    assert.equal(both[0].id, job.id)
    assert.equal(both[0].status, 'cancelled')
    assert.equal(both[0].exec.results.length, 3, '旧任务产物原样保留')
    await tick()
    assert.equal(started, 4, '重提任务的第 1 个候选已进内核')
    for (let i = 0; i < 4; i++) await releaseNext()
    await tick()
    const done2 = runManager.listJobs()[1]
    assert.equal(done2.status, 'succeeded')
    assert.equal(done2.done, 8, '完整候选集 = 8/8')
    assert.equal(done2.exec.results.length, 4)
    assert.equal(done2.exec.recommendation.recommendation.param, 'model.warrior.attack', '完整候选集出真实推荐')
    assert.ok(done2.exec.recommendation.elasticities.length > 0)

    runManager.resetForTest()
  })
}
