// P1 · 参数元信息层(todo 351 行项)节点侧单测:
// ① 元信息读写与版本化(逐字段合并、幂等、收藏、内容寻址入既有版本簿);
// ② 缺失显式「未定义」(展示层不留白、不回退注册表值);
// ③ 工作台筛选四件套各自正反(收藏/最近修改/缺元信息/校验错误);
// ④ 回写闭环(元信息文档 → 版本簿持久化 → 反序列化还原同源)。
// 跑法(仓库根):node --test apps/web/tests/param-meta.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  EMPTY_META_STORE, META_DOC_PATH, META_FIELD_KEYS, UNDEFINED_TEXT,
  upsertMetaEntry, setFavoriteMeta, metaHasContent, isMissingMeta,
  metaDisplay, metaIssues, metaIssuePaths, recentMetaPaths, metaFilter,
  serializeMetaDoc, parseMetaDoc,
  persistParamMeta, restoreParamMeta, clearParamMeta, metaStorageKey,
  loadParamMeta, unloadParamMeta, paramMetaSnapshot, metaUpsert, metaSetFavorite,
} from '../src/workbench/project/paramMeta.ts'
import {
  loadScenarioVersions, unloadScenarioVersions, scenarioVersionsSnapshot, versionIdOf,
} from '../src/workbench/project/scenarioVersions.ts'

const memStorage = () => {
  const m = new Map()
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  }
}

const A = 'model.warrior.attack'
const B = 'model.gacha.base_rate'
const C = 'model.dungeon.tiers'

test('元信息读写:逐字段合并、幂等(无改动不动 updatedAt)、空值清除', () => {
  let store = EMPTY_META_STORE
  // 首写:显示名 + 单位 + 建议范围 + 步长
  const first = upsertMetaEntry(store, A, { displayName: '攻击力', unit: '点', range: { min: 1, max: 500 }, step: 5 }, 100)
  assert.equal(first.changed, true)
  store = first.store
  assert.equal(store.entries[A].meta.displayName, '攻击力')
  assert.deepEqual(store.entries[A].meta.range, { min: 1, max: 500 })
  assert.equal(store.entries[A].meta.step, 5)
  assert.equal(store.entries[A].updatedAt, 100)

  // 追写字段(undefined = 不动已写字段)
  const tagged = upsertMetaEntry(store, A, { tags: ['战斗', '输出'], impactKpi: 'DPS' }, 200)
  assert.equal(tagged.changed, true)
  assert.equal(tagged.store.entries[A].meta.unit, '点', '未提及字段保持')
  assert.deepEqual(tagged.store.entries[A].meta.tags, ['战斗', '输出'])
  assert.equal(tagged.store.entries[A].updatedAt, 200)

  // 同内容重写:幂等(原 store 原样,updatedAt 不漂移)
  const again = upsertMetaEntry(tagged.store, A, { displayName: '攻击力', tags: ['战斗', '输出'] }, 999)
  assert.equal(again.changed, false)
  assert.equal(again.store, tagged.store)
  assert.equal(again.store.entries[A].updatedAt, 200)

  // 空串/空表 = 清除该字段;清到全空后条目退化为空元信息(缺失口径)
  const cleared = upsertMetaEntry(again.store, A, { displayName: '  ', tags: [] }, 300)
  assert.equal(cleared.changed, true)
  assert.equal(cleared.store.entries[A].meta.displayName, undefined)
  assert.equal(metaHasContent(cleared.store.entries[A].meta), true, '还有其它字段在')
  assert.equal(isMissingMeta(cleared.store, B), true, '未写过的路径 = 缺元信息')

  // 非法值丢弃:非有限数 range/step 不入场
  const bad = upsertMetaEntry(cleared.store, B, { step: Number.NaN, range: { min: 3, max: Number.NaN } }, 400)
  assert.equal(bad.changed, false, '清洗后无有效字段 = 无改动')
  assert.equal(bad.store, cleared.store)

  // 收藏:幂等,取消即移除
  const fav = setFavoriteMeta(bad.store, A, true)
  assert.equal(fav.changed, true)
  assert.equal(fav.store.favorites[A], true)
  assert.equal(setFavoriteMeta(fav.store, A, true).changed, false, '重复收藏幂等')
  assert.equal(setFavoriteMeta(fav.store, A, true).store, fav.store)
  const unfav = setFavoriteMeta(fav.store, A, false)
  assert.equal(unfav.store.favorites[A], undefined)
  assert.equal(setFavoriteMeta(fav.store, C, false).store, fav.store, '未收藏再取消幂等')
})

test('元信息校验:范围/步长/类型不一致规则各自点名,合法元信息零问题', () => {
  // 全空不报错
  assert.deepEqual(metaIssues(undefined, 'f64'), [])
  assert.deepEqual(metaIssues({}, 'f64'), [])
  // 范围:min≥max;非有限数
  assert.ok(metaIssues({ range: { min: 100, max: 1 } }, 'i64').some((i) => i.field === 'range' && /min < max/.test(i.message)))
  assert.ok(metaIssues({ range: { min: Number.NaN, max: 5 } }, 'i64').some((i) => i.field === 'range'))
  // 步长:非正数;超区间宽度
  assert.ok(metaIssues({ step: 0 }, 'f64').some((i) => i.field === 'step' && /正数/.test(i.message)))
  assert.ok(metaIssues({ step: -1 }, 'f64').some((i) => i.field === 'step'))
  assert.deepEqual(metaIssues({ range: { min: 0, max: 1 }, step: 0.5 }, 'f64').filter((i) => i.field === 'step'), [], '步长 0.5 ≤ 区间宽 1:不报')
  assert.ok(metaIssues({ range: { min: 0, max: 1 }, step: 2 }, 'f64').some((i) => i.field === 'step' && /超出/.test(i.message)))
  // 类型不一致:table/expr 参数不支持范围/步长(仅数值通道)
  assert.ok(metaIssues({ range: { min: 0, max: 1 } }, 'table').some((i) => i.field === 'range' && /类型不一致/.test(i.message)))
  assert.ok(metaIssues({ step: 1 }, 'expr').some((i) => i.field === 'step' && /类型不一致/.test(i.message)))
  assert.deepEqual(metaIssues({ range: { min: 0, max: 1 }, step: 0.1 }, 'mix'), [], '数值通道(mix)合法不报')
  // 路径集合:按注册 kind 判定
  const store = upsertMetaEntry(
    upsertMetaEntry(EMPTY_META_STORE, A, { range: { min: 5, max: 5 } }, 1).store,
    B, { step: 0.01, range: { min: 0, max: 1 } }, 1,
  ).store
  const kindOf = (p) => (p === B ? 'f64' : 'table') // A 挂在 table 上 → 类型不一致
  const invalid = metaIssuePaths(store, kindOf)
  assert.equal(invalid.has(A), true)
  assert.equal(invalid.has(B), false)
})

test('未定义显示:缺失/空值一律显式「未定义」,在场值如实格式化', () => {
  assert.equal(UNDEFINED_TEXT, '未定义')
  assert.equal(metaDisplay(undefined), '未定义')
  assert.equal(metaDisplay('   '), '未定义')
  assert.equal(metaDisplay(''), '未定义')
  assert.equal(metaDisplay([]), '未定义')
  assert.equal(metaDisplay(['  ', '']), '未定义')
  assert.equal(metaDisplay(Number.NaN), '未定义')
  assert.equal(metaDisplay('点'), '点')
  assert.equal(metaDisplay(0.02), '0.02')
  assert.equal(metaDisplay(['战斗', '输出']), '战斗, 输出')
  assert.equal(metaDisplay({ min: 1, max: 500 }), '1 – 500')
  // 八项字段一个不缺地过 metaDisplay:缺了都是「未定义」,不留白
  for (const k of META_FIELD_KEYS) {
    assert.equal(metaDisplay(undefined), '未定义', `字段 ${k} 缺失显式未定义`)
  }
})

test('筛选四件套:收藏/最近修改/缺元信息/校验错误 各自正反(关 = 全量)', () => {
  const rows = [{ path: A }, { path: B }, { path: C }]
  const favorites = new Set([A])
  const recent = new Set([B])
  const missing = new Set([A, C])
  const invalid = new Set([C])
  const base = { favorites, recent, missing, invalid }
  const one = (over) => metaFilter(rows, { favoritesOnly: false, recentOnly: false, missingOnly: false, invalidOnly: false, ...base, ...over }, (r) => r.path)

  // 各自正向:只留集合内行
  assert.deepEqual(one({ favoritesOnly: true }).map((r) => r.path), [A])
  assert.deepEqual(one({ recentOnly: true }).map((r) => r.path), [B])
  assert.deepEqual(one({ missingOnly: true }).map((r) => r.path), [A, C])
  assert.deepEqual(one({ invalidOnly: true }).map((r) => r.path), [C])
  // 各自反向(关掉):全量行原样
  const all = one({})
  assert.deepEqual(all.map((r) => r.path), [A, B, C])
  // AND 组合:收藏 ∩ 最近修改 = 空
  assert.deepEqual(one({ favoritesOnly: true, recentOnly: true }), [])
  // 集合为空时正向筛出空集(与「关」区分)
  assert.deepEqual(one({ favoritesOnly: true, favorites: new Set() }), [])
})

test('版本化:序列化确定序、同内容恒等、反序列化清洗还原', () => {
  const store = upsertMetaEntry(
    setFavoriteMeta(
      upsertMetaEntry(EMPTY_META_STORE, B, { displayName: '抽卡基础命中率', unit: '概率', range: { min: 0, max: 1 }, step: 0.005, tags: ['gacha'], source: '策划案 v3', impactKpi: '出货率', group: 'gacha' }, 100).store,
      B, true,
    ).store,
    A, { displayName: '攻击力', range: { min: 1, max: 500 }, step: 5 }, 200,
  ).store
  const text = serializeMetaDoc(store)
  assert.equal(text, serializeMetaDoc(store), '同内容序列化恒等(确定序)')
  // 路径升序(文档序与写入顺序无关)
  const doc = JSON.parse(text)
  assert.deepEqual(doc.entries.map((e) => e.path), [B, A])
  assert.deepEqual(doc.favorites, [B])
  assert.equal(doc.version, '1')
  // 往返:反序列化还原逐值一致;非法条目被清洗丢弃
  assert.deepEqual(parseMetaDoc(text), store)
  assert.deepEqual(parseMetaDoc('{oops'), EMPTY_META_STORE)
  const dirty = JSON.parse(text)
  dirty.entries.push({ path: '', meta: { displayName: 'x' } }, { path: 'model.loot.tables', meta: 'oops' })
  const cleaned = parseMetaDoc(JSON.stringify(dirty))
  assert.deepEqual(Object.keys(cleaned.entries).sort(), [B, A], '非法条目整条丢弃')
  // 收藏改动也进文档(同内容恒等口径)
  const unfav = setFavoriteMeta(store, B, false).store
  assert.notEqual(serializeMetaDoc(unfav), text)
})

test('回写闭环:元信息变更 → 持久化 + 既有版本簿(内容寻址、同内容去重)→ 还原同源', () => {
  const storage = memStorage()
  const projectId = 'prj_meta_12345678'
  // 会话加载(节点侧 StorageLike 为 null 不入库,但状态机同路径)
  loadScenarioVersions(projectId)
  loadParamMeta(projectId)
  assert.deepEqual(paramMetaSnapshot(), EMPTY_META_STORE)

  // 首次写入:持久化 + 版本簿出现元信息文档
  const first = metaUpsert(A, { displayName: '攻击力', unit: '点' })
  assert.equal(first.ok, true)
  const snap1 = paramMetaSnapshot()
  assert.equal(snap1.entries[A].meta.displayName, '攻击力')
  const book1 = scenarioVersionsSnapshot()
  const versions = book1.versions[META_DOC_PATH] ?? []
  assert.equal(versions.length, 1, '元信息文档入既有版本簿')
  assert.equal(versions[0].versionId, versionIdOf(serializeMetaDoc(snap1)), '版本按内容寻址')
  assert.equal(versions[0].content, serializeMetaDoc(snap1))

  // 同内容重复写入:不产生新版本(去重)
  metaUpsert(A, { displayName: '攻击力', unit: '点' })
  assert.equal((scenarioVersionsSnapshot().versions[META_DOC_PATH] ?? []).length, 1)

  // 再变更:追加有序;收藏也入版本簿
  metaUpsert(A, { range: { min: 1, max: 500 }, step: 5 })
  metaSetFavorite(A, true)
  const book3 = scenarioVersionsSnapshot()
  const v = book3.versions[META_DOC_PATH]
  assert.equal(v.length, 3, '两次变更各记一版,追加有序')
  assert.equal(v[2].content, serializeMetaDoc(paramMetaSnapshot()))
  assert.deepEqual(Object.keys(paramMetaSnapshot().favorites), [A])

  // 还原同源:最新版本内容反序列化 = 当前元信息状态
  assert.deepEqual(parseMetaDoc(v[2].content), paramMetaSnapshot())

  // 持久化往返:按项目隔离,跨项目/坏载荷丢弃
  assert.equal(persistParamMeta(storage, projectId, paramMetaSnapshot()), true)
  assert.deepEqual(restoreParamMeta(storage, projectId), paramMetaSnapshot())
  assert.equal(restoreParamMeta(storage, 'prj_other_12345678'), EMPTY_META_STORE, '跨项目读取丢弃')
  const bad = memStorage()
  bad.setItem(metaStorageKey(projectId), '{oops')
  assert.deepEqual(restoreParamMeta(bad, projectId), EMPTY_META_STORE)
  clearParamMeta(storage, projectId)
  assert.deepEqual(restoreParamMeta(storage, projectId), EMPTY_META_STORE)

  // 未打开项目:显式拒绝
  unloadParamMeta()
  unloadScenarioVersions()
  assert.equal(metaUpsert(B, { unit: 'x' }).ok, false)
  assert.equal(metaSetFavorite(B, true).ok, false)
})

test('「最近修改」窗口:窗口内命中,窗口外/未来时间戳不命中', () => {
  const store = upsertMetaEntry(
    upsertMetaEntry(EMPTY_META_STORE, A, { unit: '点' }, 1000).store,
    B, { unit: '概率' }, 1000 + 7 * 24 * 3600 + 1,
  ).store
  const now = 1000 + 7 * 24 * 3600
  const recent = recentMetaPaths(store, now)
  assert.equal(recent.has(A), true, '恰在 7 天窗口边界(≤)算最近修改')
  assert.equal(recent.has(B), false, '未来时间戳不算(时钟不回拨造假)')
  // 自定义窗口
  assert.equal(recentMetaPaths(store, now, 60).has(A), false, '1 分钟窗口:老条目不算')
})
