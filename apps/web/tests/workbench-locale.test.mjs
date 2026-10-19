// WB-11.09 · 切换语言不丢工作台状态(节点侧跨模块锁):
// 未保存输入 / 候选选择 / 筛选排序 / 打开的标签(由 state 派生)/ 后台任务
// 全部留在各自 store,语言状态只在 localeStore 内变化;即时切换不刷新。
import test from 'node:test'
import assert from 'node:assert/strict'

// 与 workbench-store.test.mjs 同款最小桩(localeStore 引导与 navigate 持久化用)
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

const { localeSession, setLocale } = await import('../src/workbench/state/localeStore.ts')
const { dispatch, getState, deriveDocuments, DEMO_BASE_YAML } = await import(
  '../src/workbench/state/workbenchStore.ts'
)
const { applyParamEdits } = await import('../src/workbench/params/configYaml.ts')
const runManager = await import('../src/workbench/state/runManager.ts')

test('WB-11.09 切换语言即时生效,不丢未保存输入、候选选择、筛选排序、标签与后台任务', async () => {
  // 引导基线:节点无持久化、无浏览器语言 → 默认 en-US(WB-11.06)
  assert.equal(localeSession.get(), 'en-US')

  // 用户状态先行:草稿 + 选择 + 筛选 + 排序 + 页面 + 实验草稿 + 后台任务
  const edited = applyParamEdits(DEMO_BASE_YAML, [{ path: 'model.warrior.attack', text: '130' }])
  assert.ok(edited.ok, '演示基线上的编辑应当成功')
  dispatch({ type: 'param/write', yaml: edited.yaml })
  dispatch({ type: 'candidate/select', id: 'cnd_' + 'cd'.repeat(12) })
  dispatch({ type: 'candidate/filter', filter: 'border' })
  dispatch({ type: 'candidate/sort', key: 'verdict' })
  dispatch({ type: 'design/set', patch: { samples: 24 } })
  dispatch({ type: 'navigate', page: 'parameters' })
  const job = runManager.enqueueDemo({ experimentId: 'exp_demo', name: '隔离测试', method: 'grid', total: 3 })
  assert.ok(job, '演示任务应能入队')
  const docsBefore = deriveDocuments(getState()).map((d) => d.id)

  // 用户主动切换语言(走持久化路径),即时生效
  setLocale('zh-CN')
  assert.equal(localeSession.get(), 'zh-CN')

  const s = getState()
  assert.equal(s.paramDraft.yaml, edited.yaml, '未保存草稿原样')
  assert.equal(s.paramDraft.saved, false)
  assert.equal(s.selectedCandidateId, 'cnd_' + 'cd'.repeat(12), '候选选择保留')
  assert.equal(s.resultFilter, 'border', '筛选保留')
  assert.equal(s.sortKey, 'verdict', '排序保留')
  assert.equal(s.page, 'parameters', '当前页面保留')
  assert.equal(s.design.samples, 24, '实验设计草稿保留')
  assert.deepEqual(deriveDocuments(s).map((d) => d.id), docsBefore, '打开的标签不因语言切换变化')
  assert.equal(runManager.listJobs().some((j) => j.id === job.id), true, '后台任务仍在队列')

  // 再切回,状态依旧
  setLocale('en-US')
  assert.equal(getState().paramDraft.yaml, edited.yaml)
  assert.equal(runManager.listJobs().some((j) => j.id === job.id), true)

  // 清场:不留定时器与任务(防重复入队约束影响同文件后续测试)
  await runManager.cancelJob(job.id)
  runManager.resetForTest()
})
