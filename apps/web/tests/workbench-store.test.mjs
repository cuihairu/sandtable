// WB-02.11/.12/.13 · 工作台共享状态守卫(节点侧,无需 wasm):
// - 四类分区:输入草稿(paramDraft/objectDrafts/design)/ 运行快照(runs)/
//   已完成结果(runArtifacts)/ 当前选择与页内 UI 状态(selection/metric/filter/…)
// - UI 状态动作(筛选/排序/激活 KPI/候选选择/检查器开关)不污染实验输入
// - 切页/切对象保留草稿;关项目后重开同一项目可从浏览器草稿层恢复
import test from 'node:test'
import assert from 'node:assert/strict'

// workbenchStore 在模块加载期读 window(initialState → parseHash + localStorage),
// 节点侧先装最小桩再动态导入;桩同时供 reduce(navigate) 与 dispatch 持久化使用
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

const { reduce, getState, dispatch, DEMO_BASE_YAML, hasUnsavedWork } = await import(
  '../src/workbench/state/workbenchStore.ts'
)
const { applyParamEdits } = await import('../src/workbench/params/configYaml.ts')
const { projectFromYaml } = await import('../src/workbench/state/projectDoc.ts')

/** 演示基线上的一个真实候选(攻击力改 115),模拟用户编辑后的草稿。 */
function editedYaml() {
  const applied = applyParamEdits(DEMO_BASE_YAML, [{ path: 'model.warrior.attack', text: '115' }])
  assert.ok(applied.ok, '演示基线上按注册表路径编辑应当成功')
  return applied.yaml
}

/** 最小运行快照条目(WB-04.09 形状;数值无关紧要,run_id 身份是关键)。 */
const RUN_ENTRY = {
  run_id: 'run_storetest0001',
  experiment_id: 'exp_demo',
  scenario_path: null,
  experiment_path: null,
  config_hash: 'aa'.repeat(32),
  model_version: 'unknown',
  schema_version: 'unknown',
  seed: 7,
  conditions: {},
  created_at_unix: 0,
  files: ['results/run_storetest0001.report.json'],
}

test('WB-02.11 输入草稿/运行快照/结果/当前选择四类分区互不覆盖', () => {
  const base = getState()
  // 编辑草稿:只动 paramDraft,不产生/不动快照与结果
  const s1 = reduce(base, { type: 'param/write', yaml: editedYaml() })
  assert.notEqual(s1.paramDraft.yaml, base.paramDraft.yaml)
  assert.equal(s1.paramDraft.saved, false)
  assert.equal(s1.runs.length, 0)
  assert.deepEqual(s1.runArtifacts, {})

  // 登记运行:快照与结果落位,输入草稿原样
  const artifacts = { 'results/run_storetest0001.report.json': '{"schema_version":"1"}' }
  const s2 = reduce(s1, { type: 'run/register', entry: RUN_ENTRY, artifacts })
  assert.equal(s2.runs.length, 1)
  assert.equal(s2.runs[0], RUN_ENTRY, '登记保留条目原身份(不复制不改动)')
  assert.deepEqual(s2.runArtifacts, artifacts)
  assert.equal(s2.paramDraft.yaml, s1.paramDraft.yaml)

  // 同 run_id 重复登记不产生重复条目(幂等)
  const s2b = reduce(s2, { type: 'run/register', entry: RUN_ENTRY })
  assert.equal(s2b.runs.length, 1)

  // 当前选择变化不碰草稿、快照、结果(引用与内容都不变)
  const pick = 'cnd_' + 'ab'.repeat(12)
  const s3 = reduce(s2, { type: 'candidate/select', id: pick })
  assert.equal(s3.selectedCandidateId, pick)
  assert.deepEqual(s3.paramDraft, s2.paramDraft)
  assert.equal(s3.runs, s2.runs)
  assert.equal(s3.runArtifacts, s2.runArtifacts)
})

test('WB-02.12 筛选/排序/激活 KPI/选择/检查器开关等 UI 动作不污染实验输入', () => {
  const base = getState()
  const s1 = reduce(base, { type: 'param/write', yaml: editedYaml() })
  const s2 = reduce(s1, { type: 'design/set', patch: { samples: 16 } })
  assert.equal(s2.design.samples, 16)
  assert.equal(s2.designDirty, true)

  const uiActions = [
    { type: 'candidate/filter', filter: 'pass' },
    { type: 'candidate/sort', key: 'verdict' },
    { type: 'candidate/metric', metric: 'win' },
    { type: 'candidate/select', id: null },
    { type: 'candidate/view', view: 'table' },
    { type: 'toggle-inspector' },
    { type: 'toggle-explorer' },
    { type: 'toggle-drawer' },
    { type: 'param/search', search: '攻击' },
    { type: 'param/group', group: 'all' },
    { type: 'param/changed-only', on: true },
    { type: 'param/errors-only', on: true },
    { type: 'param/focus', id: 'model.warrior.attack' },
    { type: 'param/select', ids: ['model.warrior.attack'] },
  ]
  let s = s2
  for (const action of uiActions) s = reduce(s, action)

  // 实验输入三层(演示候选 / 项目对象草稿 / 实验设计草稿)逐项不变
  assert.deepEqual(s.paramDraft, s2.paramDraft)
  assert.deepEqual(s.objectDrafts, s2.objectDrafts)
  assert.deepEqual(s.design, s2.design)
  assert.equal(s.designDirty, s2.designDirty)
  // 动作真实生效(测试不空转):抽查 UI 字段落位
  assert.equal(s.resultFilter, 'pass')
  assert.equal(s.sortKey, 'verdict')
  assert.equal(s.metric, 'win')
  assert.equal(s.inspectorOpen, !s2.inspectorOpen)
  assert.equal(s.paramSearch, '攻击')
  assert.equal(s.paramFocusId, 'model.warrior.attack')
})

test('WB-02.13 切换页面保留输入草稿(参数候选与实验设计)', () => {
  const base = getState()
  const s1 = reduce(base, { type: 'param/write', yaml: editedYaml() })
  const s2 = reduce(s1, { type: 'design/set', patch: { samples: 20 } })
  const away = reduce(s2, { type: 'navigate', page: 'analysis' })
  assert.equal(away.page, 'analysis')
  const back = reduce(away, { type: 'navigate', page: 'parameters' })
  assert.equal(back.page, 'parameters')
  assert.equal(back.paramDraft.yaml, s2.paramDraft.yaml)
  assert.equal(back.paramDraft.saved, false)
  assert.equal(back.design.samples, 20)
  assert.equal(back.designDirty, true)
})

test('WB-02.13 项目模式:切换页面对象保留草稿,撤销历史不丢', async () => {
  const doc = await projectFromYaml('wb-store-a', DEMO_BASE_YAML)
  const path = doc.objects[0].path
  const opened = reduce(getState(), { type: 'project/open', doc })
  assert.equal(opened.project?.projectId, doc.projectId)
  const modified = DEMO_BASE_YAML + '\n# edited'
  const d1 = reduce(opened, { type: 'object/draft', key: path, content: modified })
  assert.equal(d1.objectDrafts[path].content, modified)
  assert.equal(d1.objectDrafts[path].saved, false)
  // 切页再回:草稿仍在(导航不动 objectDrafts)
  const away = reduce(d1, { type: 'navigate', page: 'analysis' })
  assert.equal(away.objectDrafts[path].content, modified)
  // 撤销一步回到项目文件原文,重做栈压入修改内容
  const undone = reduce(away, { type: 'object/undo', key: path })
  assert.equal(undone.objectDrafts[path].content, DEMO_BASE_YAML)
  assert.equal(undone.objectDrafts[path].future.length, 1)
})

test('WB-02.13 关闭项目后重开同一项目,浏览器草稿层可恢复未保存修改', async () => {
  const doc = await projectFromYaml('wb-store-b', DEMO_BASE_YAML)
  const path = doc.objects[0].path
  dispatch({ type: 'project/open', doc })
  dispatch({ type: 'object/draft', key: path, content: DEMO_BASE_YAML + '\n# roundtrip' })
  assert.equal(hasUnsavedWork(getState()), true)
  dispatch({ type: 'project/close' })
  assert.equal(hasUnsavedWork(getState()), false)
  // 重开同一项目(同名同内容 ⇒ 同 projectId)→ 草稿从浏览器存储回来
  dispatch({ type: 'project/open', doc })
  const restored = getState().objectDrafts[path]
  assert.ok(restored, '重开同一项目应恢复持久化草稿')
  assert.equal(restored.content, DEMO_BASE_YAML + '\n# roundtrip')
  assert.equal(restored.saved, false)
})
