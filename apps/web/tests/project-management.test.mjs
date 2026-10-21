// P1 · 项目与场景管理(todo 350 行项)节点侧单测:
// ① 项目创建/复制/归档(可恢复软态)/恢复/重命名/备注 + 注册表持久化;
// ② 项目文档创建与复制 + .sandtable 回写持久化闭环(buildProjectSave →
//    packProject → openProject,17c95fc 已验路径,本项目不另建状态库);
// ③ 每场景独立配置版本历史(同内容去重、版本备注、场景备注);
// ④ 基线切换(指定任意已存版本、按历史回切、退无可退回项目文件);
// ⑤ 多候选并排比较(字段级 diff、缺失显式、基线对照、YAML 数值口径)。
// 跑法(仓库根):node --test apps/web/tests/project-management.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  readRegistry, writeRegistry, createEntry, duplicateEntry,
  archiveEntry, restoreEntry, renameEntry, setEntryNote, upsertEntry, entryFor,
  REGISTRY_STORAGE_KEY,
} from '../src/workbench/project/projectRegistry.ts'
import { createProjectDoc, duplicateProjectDoc, projectNameError } from '../src/workbench/project/projectOps.ts'
import {
  saveVersion, updateVersionNote, setScenarioNote,
  setBaseline, revertBaseline, effectiveBaseline, versionIdOf,
  persistScenarioVersions, restoreScenarioVersions, clearScenarioVersions,
  EMPTY_VERSION_STORE, versionStorageKey,
} from '../src/workbench/project/scenarioVersions.ts'
import { compareCandidates } from '../src/workbench/project/candidateCompare.ts'
import { openProject, buildProjectSave, baseContentOf } from '../src/workbench/state/projectDoc.ts'
import { packProject } from '../src/lib/project.ts'
import { parseConfig, numericValuesOf } from '../src/workbench/params/configYaml.ts'

const memStorage = () => {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  }
}

const YAML_A = 'model:\n  warrior:\n    attack: 10\n'
const YAML_B = 'model:\n  warrior:\n    attack: 120\n'
const PATH = 'scenarios/base.yaml'

test('项目注册表:创建/重命名/备注/复制(新 ID,原条目不动)', () => {
  const made = createEntry('RPG Balance', '首轮调参', 100)
  assert.ok(made.ok)
  assert.match(made.entry.projectId, /^prj_/)
  assert.equal(made.entry.archived, false)
  assert.equal(createEntry('   ', '', 100).ok, false)

  const entries = [made.entry]
  const renamed = renameEntry(entries, made.entry.projectId, 'RPG Balance v2', 200)
  assert.equal(renamed[0].name, 'RPG Balance v2')
  assert.equal(renamed[0].projectId, made.entry.projectId, '改名不改项目 ID(创建型身份)')
  assert.equal(renameEntry(entries, made.entry.projectId, '   ', 200), entries, '空名拒绝,原表原样')

  const noted = setEntryNote(renamed, made.entry.projectId, '第二轮:攻击力扫描', 300)
  assert.equal(noted[0].note, '第二轮:攻击力扫描')

  const dup = duplicateEntry(noted, made.entry.projectId, 400)
  assert.ok(dup.ok)
  assert.equal(dup.entries.length, 2)
  assert.notEqual(dup.entry.projectId, made.entry.projectId, '副本是新项目 ID')
  assert.equal(dup.entry.name, 'RPG Balance v2 copy')
  assert.equal(dup.entry.note, '第二轮:攻击力扫描', '备注继承')
  assert.equal(dup.entry.archived, false, '归档软态不继承')
  assert.equal(dup.entries[0], noted[0], '原条目原样(不可变更新,未被动过)')
  assert.equal(duplicateEntry(noted, 'prj_nonexistent', 400).ok, false)
})

test('项目注册表:归档=可恢复软态(数据不动),恢复即翻回,均幂等', () => {
  const made = createEntry('RPG Balance', 'keep me', 100)
  const entries = [made.entry]
  const archived = archiveEntry(entries, made.entry.projectId, 200)
  assert.equal(archived[0].archived, true)
  assert.equal(archived[0].archivedAtUnix, 200)
  assert.equal(archived[0].name, 'RPG Balance', '归档不改名字')
  assert.equal(archived[0].note, 'keep me', '归档不改备注')
  assert.equal(archiveEntry(archived, made.entry.projectId, 300)[0].archivedAtUnix, 200, '重复归档幂等(时间戳不动)')
  const restored = restoreEntry(archived, made.entry.projectId, 400)
  assert.equal(restored[0].archived, false)
  assert.equal(restored[0].archivedAtUnix, null)
  const restoredAgain = restoreEntry(restored, made.entry.projectId, 500)[0]
  assert.equal(restoredAgain.archived, false, '未归档再恢复幂等')
  assert.equal(restoredAgain.archivedAtUnix, null)
  // 归档/恢复都不增删条目:数据无损
  assert.equal(archived.length, 1)
  assert.equal(restored.length, 1)
})

test('项目注册表:持久化往返 + 坏载荷防御 + 打开登记幂等', () => {
  const storage = memStorage()
  const made = createEntry('P1', '', 10).entry
  const made2 = createEntry('P2', 'n2', 20).entry
  const archived = archiveEntry([made, made2], made2.projectId, 30)
  assert.equal(writeRegistry(storage, archived), true)
  assert.deepEqual(readRegistry(storage), archived)
  // 空存储 = 空表;坏 JSON / 错版本 / 非法条目都整表或逐条丢弃
  assert.deepEqual(readRegistry(memStorage()), [])
  const bad = memStorage()
  bad.setItem('k', '{oops')
  assert.deepEqual(readRegistryWith(bad), [])
  const wrongVersion = memStorage()
  wrongVersion.setItem(
    readRegistryKey(),
    JSON.stringify({ version: '9', entries: [made] }),
  )
  assert.deepEqual(readRegistryWith(wrongVersion), [])
  const dirty = memStorage()
  dirty.setItem(
    readRegistryKey(),
    JSON.stringify({ version: '1', entries: [made, { projectId: 'prj_x', name: '' }, { name: 'no-id' }] }),
  )
  assert.deepEqual(readRegistryWith(dirty).map((e) => e.projectId), [made.projectId])
  // 打开登记:幂等,不覆盖既有备注/归档态
  const registered = upsertEntry(archived, made.projectId, 'P1-renamed', 40)
  assert.equal(registered.length, 2)
  assert.equal(entryFor(registered, made.projectId)?.name, 'P1', '登记不改既有条目')
  const fresh = upsertEntry([], 'prj_new_12345678', 'Fresh', 50)
  assert.equal(fresh.length, 1)
  assert.equal(fresh[0].name, 'Fresh')
})

// 辅助:注册表读写同一键
const readRegistryKey = () => REGISTRY_STORAGE_KEY
const readRegistryWith = (s) => readRegistry(s)

test('项目文档:创建(单场景默认配置起步)与复制(新 ID 同内容独立)', () => {
  assert.equal(projectNameError('  '), '项目名不能为空')
  const made = createProjectDoc('RPG Demo')
  assert.ok(made.ok)
  const doc = made.doc
  assert.match(doc.projectId, /^prj_/)
  assert.equal(doc.objects.length, 1)
  assert.equal(doc.objects[0].kind, 'scenario')
  assert.match(doc.objects[0].path, /^scenarios\/.+\.yaml$/)
  const yaml = new TextDecoder().decode(doc.files.get(doc.objects[0].path))
  assert.ok(yaml.length > 0, '初始场景内容非空(注册表默认配置)')
  assert.equal(parseConfig(yaml).errors.length, 0, '初始场景过 YAML 解析(可保存可运行)')

  const dup = duplicateProjectDoc(doc, 'RPG Demo copy')
  assert.ok(dup.ok)
  assert.notEqual(dup.doc.projectId, doc.projectId, '副本是新项目 ID')
  assert.equal(dup.doc.name, 'RPG Demo copy')
  assert.deepEqual(dup.doc.objects, doc.objects, '对象清单逐项相同')
  assert.deepEqual([...dup.doc.files], [...doc.files], '归档字节逐项相同')
  assert.deepEqual(dup.doc.resultStatus, doc.resultStatus)
  // 独立性:改副本不动原件
  assert.equal(doc.objects.length, 1)
  assert.equal(duplicateProjectDoc(doc, ' ').ok, false)
})

test('回写持久化:创建/复制/改名三条都走 packProject → openProject 闭环', async () => {
  const original = createProjectDoc('RPG Demo').doc
  const renamed = { ...original, name: 'RPG Renamed', sourceName: 'RPG Renamed' }
  const dup = duplicateProjectDoc(renamed, 'RPG Demo copy').doc
  for (const [expectName, doc] of [['RPG Renamed', renamed], ['RPG Demo copy', dup]]) {
    const build = await buildProjectSave(doc, {})
    const bytes = await packProject(build)
    const opened = await openProject(bytes, `${expectName}.sandtable`)
    assert.ok(opened.ok)
    assert.equal(opened.doc.name, expectName, 'manifest name 随文档名写回')
    assert.equal(opened.doc.objects.length, doc.objects.length)
    assert.equal(
      new TextDecoder().decode(opened.doc.files.get(doc.objects[0].path)),
      new TextDecoder().decode(doc.files.get(doc.objects[0].path)),
      '场景 YAML 字节保真回写',
    )
  }
  // 副本与原件归档互相独立:两份字节同名条目、各自 manifest name
  const bytesA = await packProject(await buildProjectSave(renamed, {}))
  const bytesB = await packProject(await buildProjectSave(dup, {}))
  const openA = await openProject(bytesA, 'a.sandtable')
  const openB = await openProject(bytesB, 'b.sandtable')
  assert.notEqual(openA.doc.projectId, openB.doc.projectId, '内容寻址项目 ID:名字不同 ⇒ ID 不同')
  assert.notDeepEqual([...openA.doc.files.keys()], [])
})

test('场景版本历史:同内容去重、追加有序、备注可编辑', () => {
  let store = EMPTY_VERSION_STORE
  const first = saveVersion(store, PATH, YAML_A, { now: 1 })
  store = first.store
  assert.equal(first.duplicated, false)
  assert.equal(first.version.label, 'v1')
  assert.equal(first.version.versionId, versionIdOf(YAML_A), '版本按内容寻址')
  assert.equal(first.version.content, YAML_A)
  assert.equal(first.version.note, '')

  const again = saveVersion(store, PATH, YAML_A, { now: 2 })
  assert.equal(again.duplicated, true, '同内容重复保存去重')
  assert.equal(again.version, first.version, '同内容 ⇒ 同版本对象')
  assert.equal(again.store, store, '去重不改历史')

  const second = saveVersion(store, PATH, YAML_B, { note: '攻击力 10 → 120', now: 3 })
  store = second.store
  assert.equal(second.version.label, 'v2')
  assert.equal(second.version.note, '攻击力 10 → 120')
  assert.deepEqual(store.versions[PATH].map((v) => v.content), [YAML_A, YAML_B], '历史追加有序')

  const noted = updateVersionNote(store, PATH, second.version.versionId, '攻击力 120(压力档)')
  assert.equal(noted.versions[PATH][1].note, '攻击力 120(压力档)')
  assert.equal(noted.versions[PATH][1].content, YAML_B, '备注编辑不改版本内容')
  assert.equal(noted.versions[PATH][1].versionId, second.version.versionId)
  assert.equal(updateVersionNote(store, PATH, 'ver_unknown', 'x'), store, '未知版本不改历史')

  const sn = setScenarioNote(store, PATH, '压力场景,注意留存指标')
  assert.equal(sn.notes[PATH], '压力场景,注意留存指标')
  assert.equal(setScenarioNote(sn, PATH, '  压力场景,注意留存指标  '), sn, '同备注(trim 后)不产生新状态')
})

test('基线切换:可指定任意已存版本、按历史回切、退无可退回项目文件', () => {
  const store = saveVersion(
    saveVersion(EMPTY_VERSION_STORE, PATH, YAML_A, { now: 1 }).store,
    PATH, YAML_B, { now: 2 },
  ).store
  const ids = store.versions[PATH].map((v) => v.versionId)

  // 默认参照系 = 项目文件原文
  const def = effectiveBaseline(store, PATH, 'FILE-ORIGINAL')
  assert.deepEqual(def, { content: 'FILE-ORIGINAL', versionId: null, source: 'file' })

  // 指定 v2 → 生效基线 = v2 内容;历史记录 [null]
  const setB = setBaseline(store, PATH, ids[1])
  assert.ok(setB.ok)
  assert.deepEqual(effectiveBaseline(setB.store, PATH, 'FILE-ORIGINAL'), {
    content: YAML_B, versionId: ids[1], source: 'version',
  })
  assert.deepEqual(setB.store.baselineHistory[PATH], [null])

  // 再指定 v1;同值重复指定不压栈
  const setA = setBaseline(setB.store, PATH, ids[0])
  assert.deepEqual(setA.store.baselineHistory[PATH], [ids[1], null])
  assert.equal(setBaseline(setA.store, PATH, ids[0]).store, setA.store, '同值指定幂等')
  const bad = setBaseline(setA.store, PATH, 'ver_unknown')
  assert.equal(bad.ok, false, '非法版本显式拒绝')
  assert.equal('store' in bad && bad.store, false, '拒绝时不返回状态(调用方保留原 store)')

  // 回切:v1 → v2 → 项目文件(退无可退再回切 = 原样)
  const back1 = revertBaseline(setA.store, PATH)
  assert.equal(back1.baseline[PATH], ids[1])
  const back2 = revertBaseline(back1, PATH)
  assert.equal(back2.baseline[PATH], null)
  assert.deepEqual(effectiveBaseline(back2, PATH, 'FILE-ORIGINAL').source, 'file')
  assert.equal(revertBaseline(back2, PATH), back2, '栈空且已指回文件:回切幂等')
  // 未指定过的场景回切 = 原样
  assert.equal(revertBaseline(store, 'scenarios/other.yaml'), store)
})

test('版本簿持久化:按项目隔离,跨项目/坏载荷一律丢弃;回写后版本内容仍在', async () => {
  const storage = memStorage()
  const store = saveVersion(
    saveVersion(EMPTY_VERSION_STORE, PATH, YAML_A, { now: 1 }).store,
    PATH, YAML_B, { note: 'n', now: 2 },
  ).store
  const withNotes = setScenarioNote(setBaseline(store, PATH, store.versions[PATH][1].versionId).store, PATH, '场景备注')
  assert.equal(persistScenarioVersions(storage, 'prj_a_12345678', withNotes), true)
  assert.deepEqual(restoreScenarioVersions(storage, 'prj_a_12345678'), withNotes, '同项目恢复逐值一致')
  assert.equal(restoreScenarioVersions(storage, 'prj_b_12345678'), EMPTY_VERSION_STORE, '跨项目读取丢弃(防串数据)')
  assert.deepEqual(restoreScenarioVersions(memStorage(), 'prj_a_12345678'), EMPTY_VERSION_STORE, '无记录 = 空表')
  const bad = memStorage()
  bad.setItem(versionStorageKey('prj_a_12345678'), '{oops')
  assert.deepEqual(restoreScenarioVersions(bad, 'prj_a_12345678'), EMPTY_VERSION_STORE)
  clearScenarioVersions(storage, 'prj_a_12345678')
  assert.deepEqual(restoreScenarioVersions(storage, 'prj_a_12345678'), EMPTY_VERSION_STORE, '清除后为空')

  // 回写闭环:草稿内容存版本 → 版本簿持久化 → 项目保存重开,三处内容一致
  const doc = createProjectDoc('Versioned').doc
  const draftPath = doc.objects[0].path
  const draftYaml = YAML_B
  const snap = saveVersion(EMPTY_VERSION_STORE, draftPath, draftYaml, { note: 'v', now: 5 })
  const persistStore = memStorage()
  persistScenarioVersions(persistStore, doc.projectId, snap.store)
  const build = await buildProjectSave(doc, { [draftPath]: { content: draftYaml, saved: false, history: [], future: [] } })
  const reopened = await openProject(await packProject(build), 'Versioned.sandtable')
  assert.ok(reopened.ok)
  assert.equal(baseContentOf(reopened.doc, draftPath), draftYaml, '草稿内容经归档回写后落盘')
  const restored = restoreScenarioVersions(persistStore, doc.projectId)
  assert.equal(restored.versions[draftPath][0].content, draftYaml, '版本快照内容与落盘内容一致(同源可追溯)')
  assert.equal(restored.versions[draftPath][0].versionId, versionIdOf(draftYaml))
})

test('多候选并排比较:字段级 diff、缺失显式 null、基线对照、YAML 数值口径', () => {
  const a = { id: 'a', label: 'A', values: { 'model.warrior.attack': 10, 'model.warrior.hp': 100 } }
  const b = { id: 'b', label: 'B', values: { 'model.warrior.attack': 120, 'model.warrior.hp': 100, 'model.dungeon.m_attack': 5 } }
  const c = { id: 'c', label: 'C', values: { 'model.warrior.hp': 100 } }
  const cmp = compareCandidates([a, b, c], { 'model.warrior.attack': 10, 'model.warrior.hp': 100 })
  // 字段并集升序
  assert.deepEqual(cmp.rows.map((r) => r.path), [
    'model.dungeon.m_attack', 'model.warrior.attack', 'model.warrior.hp',
  ])
  const attack = cmp.rows[1]
  assert.deepEqual(attack.values, { a: 10, b: 120, c: null }, '缺失显式 null,不用 0 冒充')
  assert.equal(attack.changed, true)
  assert.equal(attack.diffVsBase, true)
  const hp = cmp.rows[2]
  assert.equal(hp.changed, false, '三候选同值不算差异')
  assert.equal(hp.diffVsBase, false)
  assert.deepEqual(cmp.changedPaths, ['model.dungeon.m_attack', 'model.warrior.attack'])
  // 全同候选:零差异行集
  const same = compareCandidates([a, { ...a, id: 'a2' }])
  assert.deepEqual(same.changedPaths, [])
  // YAML 数值口径(与参数页同源):parseConfig + numericValuesOf
  const yamlA = numericValuesOf(parseConfig(YAML_A))
  const yamlB = numericValuesOf(parseConfig(YAML_B))
  const ycmp = compareCandidates([
    { id: 'base', label: 'base', values: yamlA },
    { id: 'cand', label: 'cand', values: yamlB },
  ])
  assert.deepEqual(ycmp.changedPaths, ['model.warrior.attack'], '恰只差一个参数路径')
  assert.equal(ycmp.rows[0].values.base, 10)
  assert.equal(ycmp.rows[0].values.cand, 120)
})
