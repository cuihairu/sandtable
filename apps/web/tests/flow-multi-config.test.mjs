// WB-10.02 · 多配置项目闭环(节点侧,不经过渲染层):从真实 .sandtable 归档打开
// (两场景 + 一实验)→ 在文件树里逐个切换 → 分别编辑 → 保存 → 重开,核对
// 「没有丢条目」:路径集合不缩水、编辑值落盘、未编辑条目字节保真,
// 再保存一次字节不变。全部走工作台同一批纯函数。
import test from 'node:test'
import strictAssert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { packProject } from '../src/lib/project.ts'
import {
  baseContentOf, buildProjectSave, markSaved, openProject, resetDraft,
  unsavedKeys, writeDraft,
} from '../src/workbench/state/projectDoc.ts'

let assertions = 0
const assert = new Proxy(strictAssert, { get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => { assertions++; return value(...args) } : value } })

const read = (rel) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', rel), 'utf8').replaceAll('\r\n', '\n')

// 三份真实 YAML(带注释,用于验证字节保真不是只保了字段)
const BASE = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nmodel:\n  warrior:\n    attack: 100 # 基线档\n'
const STRESS = 'schema_version: "1"\nscenario: {population: 1200, duration: "30d", seed: 11}\nmodel:\n  warrior:\n    attack: 110 # 压力档\n'
const ATTACK = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nexperiment:\n  sweep:\n    replicates: 2\n    parameters:\n      model.warrior.attack: {min: 90, max: 110, step: 10}\n    targets:\n      - {metric: win_rate, min: 0.0, max: 1.0}\n'
const BASE_PATH = 'scenarios/base.yaml'
const STRESS_PATH = 'scenarios/stress.yaml'
const ATTACK_PATH = 'experiments/attack.yaml'
const BASE_EDITED = BASE.replace('population: 40', 'population: 48')
const STRESS_EDITED = STRESS.replace('population: 1200', 'population: 1500')

test('WB-10.02:多配置项目打开 → 逐个切换编辑 → 保存重开,没有丢条目', async () => {
  // 1 · 真实多配置归档:两场景 + 一实验(不塞任何运行产物)
  const bytes0 = await packProject({
    name: 'multi',
    configs: {
      scenarios: { [BASE_PATH]: BASE, [STRESS_PATH]: STRESS },
      experiments: { [ATTACK_PATH]: ATTACK },
    },
  })

  // 2 · 打开:三条都在场,原文逐字可读(含注释)
  const opened = await openProject(bytes0, 'multi.sandtable')
  assert.equal(opened.ok, true, '多配置归档通过校验')
  const doc = opened.doc
  const paths = doc.objects.map((o) => o.path).sort()
  assert.deepEqual(paths, [ATTACK_PATH, BASE_PATH, STRESS_PATH], '三条配置一个不少')
  assert.deepEqual(
    Object.fromEntries(doc.objects.map((o) => [o.path, o.kind])),
    { [BASE_PATH]: 'scenario', [STRESS_PATH]: 'scenario', [ATTACK_PATH]: 'experiment' },
    'kind 与目录一致(路径即身份,不看下标)',
  )
  assert.equal(baseContentOf(doc, BASE_PATH), BASE, '原文逐字(含注释)')
  assert.equal(baseContentOf(doc, STRESS_PATH), STRESS)
  assert.equal(baseContentOf(doc, ATTACK_PATH), ATTACK)

  // 3 · 切换第一个配置并编辑;切换走路径不用下标
  let drafts = writeDraft({}, BASE_PATH, baseContentOf(doc, BASE_PATH), BASE_EDITED)
  assert.deepEqual(unsavedKeys(drafts), [BASE_PATH], '未保存标记只落在该对象')

  // 4 · 切换到第二个配置再编辑:两个草稿各自独立,互不覆盖(WB-04.06)
  drafts = writeDraft(drafts, STRESS_PATH, baseContentOf(doc, STRESS_PATH), STRESS_EDITED)
  assert.equal(drafts[BASE_PATH].content, BASE_EDITED, '切换不丢掉先前的草稿')
  assert.equal(drafts[STRESS_PATH].content, STRESS_EDITED)
  assert.deepEqual(unsavedKeys(drafts).sort(), [BASE_PATH, STRESS_PATH], '两条未保存都在场')
  assert.equal(baseContentOf(doc, BASE_PATH), BASE, '草稿不改写项目文件原文')

  // 5 · 编辑内容相同不产生重复历史(线性历史语义)
  assert.equal(writeDraft(drafts, BASE_PATH, baseContentOf(doc, BASE_PATH), BASE_EDITED) === drafts, true)
  drafts = resetDraft(drafts, BASE_PATH)
  assert.deepEqual(unsavedKeys(drafts), [STRESS_PATH], '放弃一条不影响另一条')
  assert.equal(baseContentOf(doc, BASE_PATH), BASE, '放弃编辑回到原文,不是丢条目')
  drafts = writeDraft(drafts, BASE_PATH, baseContentOf(doc, BASE_PATH), BASE_EDITED)
  drafts = markSaved(drafts, [BASE_PATH, STRESS_PATH])
  assert.deepEqual(unsavedKeys(drafts), [], '保存后未保存清单为空')

  // 6 · 保存:全部配置一次进归档(选中与未选中)
  const bytes1 = await packProject(await buildProjectSave(doc, drafts))

  // 7 · 重开:条目不缩水,编辑值落盘,未编辑条目字节保真
  const reopened = await openProject(bytes1, 'multi.sandtable')
  assert.equal(reopened.ok, true, '保存后的归档通过校验')
  const doc2 = reopened.doc
  assert.deepEqual(doc2.objects.map((o) => o.path).sort(), paths, '重开后三条路径一个不少')
  assert.deepEqual(
    Object.fromEntries(doc2.objects.map((o) => [o.path, o.kind])),
    Object.fromEntries(doc.objects.map((o) => [o.path, o.kind])),
    '重开后每条路径的 kind 不变',
  )
  assert.equal(baseContentOf(doc2, BASE_PATH), BASE_EDITED, '编辑值随保存落盘')
  assert.equal(baseContentOf(doc2, STRESS_PATH), STRESS_EDITED)
  assert.equal(baseContentOf(doc2, ATTACK_PATH), ATTACK, '未编辑条目原文字节保真')

  // 8 · 再保存一次:字节不变——多配置项目反复保存不添噪、不丢条目
  const bytes2 = await packProject(await buildProjectSave(doc2, {}))
  assert.deepEqual([...bytes2], [...bytes1], '二次保存字节一致')
})

test('WB-10.02:多配置切换与保存在 UI 上有接线', () => {
  // 源级守卫:切换/编辑/保存都按归档路径寻址,保存覆盖全部条目
  const store = read('src/workbench/state/workbenchStore.ts')
  const app = read('src/workbench/WorkbenchApp.tsx')
  const panels = read('src/workbench/project/ProjectPanels.tsx')

  assert.ok(store.includes("objectDrafts: writeDraft(state.objectDrafts, action.key, baseContentOf(state.project, action.key)"), '编辑按对象路径写草稿')
  assert.ok(store.includes("markSaved(state.objectDrafts, Object.keys(state.objectDrafts))"), '保存状态按全部对象标记')
  assert.ok(
    /case 'object\/select':[\s\S]*?return \{\s*\n\s*\.\.\.state,[\s\S]*?paramKernelError: null,\s*\}/.test(store),
    '切换配置不触碰草稿(不覆盖、不清空)',
  )
  assert.ok(store.includes('scenarios.map((o) => ({\n      id: o.path,') || store.includes('scenarios.map((o) => ({ id: o.path,'), '文件树逐条列出全部场景配置')
  assert.ok(store.includes('experiments.map((o) => ({'), '文件树逐条列出全部实验配置')

  assert.ok(app.includes("buildProjectSave(doc, s.objectDrafts"), '保存时把全部配置(选中与未选中)打包')
  assert.ok(app.includes("type: 'project/mark-saved'"), '打包成功后才标记已保存')
  assert.ok(app.includes("dispatch({ type: 'object/select', kind: 'scenario', path: r.id })"), '文件树选择走归档路径')

  assert.ok(panels.includes("key: path, content: e.target.value"), '编辑器按路径提交草稿')
})
