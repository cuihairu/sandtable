// P1 · 参数元信息层(todo 351 行项):逐参数可维护、可版本化的元信息——
// 显示名/单位/建议范围/步长/系统分组/标签/来源/影响 KPI 八项字段。纪律:
// - 纯编辑面:元信息不进内核语义(不写场景 YAML、不进实验输入),只服务
//   工作台的组织/筛选/检查器展示;
// - 缺失显式「未定义」:任何缺失字段在展示层给 UNDEFINED_TEXT,不留白、
//   不回退注册表值冒充元信息;
// - 复用 project/ 目录成果,不建平行状态库:持久化按项目隔离(载荷带
//   projectId 自检,与 scenarioVersions 同口径);每次元信息变更序列化成
//   元信息文档(内容寻址)写入既有版本簿 versionsSaveVersion(META_DOC_PATH),
//   同内容去重、追加有序,可随版本历史回溯;
// - 纯数据层不 import 演示模块,不依赖 wasm;React 组合在 ParamMetaPanel。
import type { ParamKind } from '../../lib/types.ts'
import type { StorageLike } from './projectRegistry.ts'
import { versionsSaveVersion } from './scenarioVersions.ts'

/** 八项元信息字段(逐项可选:缺失就是缺失,不给默认值)。 */
export type ParamMetaFields = {
  readonly displayName?: string
  readonly unit?: string
  readonly range?: ParamMetaRange
  readonly step?: number
  readonly group?: string
  readonly tags?: readonly string[]
  readonly source?: string
  readonly impactKpi?: string
}

export type ParamMetaRange = { readonly min: number; readonly max: number }

/** 单字段补丁 = 同型字段的可选子集;undefined 字段表示「不改动」。 */
export type ParamMetaPatch = ParamMetaFields

/** 字段清单(固定序;展示与序列化都用这个顺序)。 */
export const META_FIELD_KEYS = [
  'displayName', 'unit', 'range', 'step', 'group', 'tags', 'source', 'impactKpi',
] as const

export type MetaEntry = {
  readonly path: string
  readonly meta: ParamMetaFields
  /** 元信息最近修改时刻(unix 秒;「最近修改」筛选依据) */
  readonly updatedAt: number
}

export type ParamMetaStore = {
  /** 路径 → 元信息条目(仅包含至少定义过一个字段的路径) */
  readonly entries: Readonly<Record<string, MetaEntry>>
  /** 收藏:路径 → true(与元信息字段同文档版本化) */
  readonly favorites: Readonly<Record<string, true>>
}

export const EMPTY_META_STORE: ParamMetaStore = { entries: {}, favorites: {} }

/** 缺失字段的显式展示文本(②:不留白)。 */
export const UNDEFINED_TEXT = '未定义'

/** 元信息文档在版本簿中的保留路径(不是场景对象,只作版本簿键)。 */
export const META_DOC_PATH = 'meta/parameter-meta.yaml'

/** 「最近修改」窗口(秒;默认 7 天)。 */
export const RECENT_WINDOW_SEC = 7 * 24 * 3600

/* —— 展示层(②):缺失显式「未定义」 —— */

export function metaDisplay(
  value: string | number | readonly string[] | ParamMetaRange | undefined,
): string {
  if (value === undefined) return UNDEFINED_TEXT
  if (typeof value === 'string') {
    const s = value.trim()
    return s === '' ? UNDEFINED_TEXT : s
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : UNDEFINED_TEXT
  if (Array.isArray(value)) {
    const tags = value.map((v) => String(v).trim()).filter((v) => v !== '')
    return tags.length > 0 ? tags.join(', ') : UNDEFINED_TEXT
  }
  if (typeof value === 'object' && 'min' in (value as ParamMetaRange) && 'max' in (value as ParamMetaRange)) {
    const r = value as ParamMetaRange
    if (Number.isFinite(r.min) && Number.isFinite(r.max)) return `${r.min} – ${r.max}`
  }
  return UNDEFINED_TEXT
}

/* —— 纯操作:写入 / 收藏(幂等;改动才动 updatedAt) —— */

type CleanResult = { meta: ParamMetaFields; clear: ReadonlyArray<keyof ParamMetaFields>; any: boolean }

/**
 * 补丁清洗:字段在补丁中出现即有处置权——有效值入 meta;空串/空表/非法值
 * 入 clear(显式清除该字段);字段缺席( undefined )不动已有值。
 */
function cleanPatch(patch: ParamMetaPatch): CleanResult {
  const meta: { -readonly [K in keyof ParamMetaFields]: ParamMetaFields[K] } = {}
  const clear: Array<keyof ParamMetaFields> = []
  let any = false
  const takeStr = (k: 'displayName' | 'unit' | 'group' | 'source' | 'impactKpi'): void => {
    const v = patch[k]
    if (v === undefined) return
    const s = typeof v === 'string' ? v.trim() : ''
    if (s !== '') {
      meta[k] = s
      any = true
    } else {
      clear.push(k)
    }
  }
  takeStr('displayName')
  takeStr('unit')
  takeStr('group')
  takeStr('source')
  takeStr('impactKpi')
  if (patch.range !== undefined) {
    const r = patch.range
    if (r !== null && typeof r === 'object' && Number.isFinite(r.min) && Number.isFinite(r.max)) {
      meta.range = { min: r.min, max: r.max }
      any = true
    } else {
      clear.push('range')
    }
  }
  if (patch.step !== undefined) {
    if (typeof patch.step === 'number' && Number.isFinite(patch.step)) {
      meta.step = patch.step
      any = true
    } else {
      clear.push('step')
    }
  }
  if (patch.tags !== undefined) {
    const tags = Array.isArray(patch.tags)
      ? patch.tags.map((v) => String(v).trim()).filter((v) => v !== '')
      : []
    if (tags.length > 0) {
      meta.tags = tags
      any = true
    } else {
      clear.push('tags')
    }
  }
  return { meta, clear, any }
}

function metaEquals(a: ParamMetaFields, b: ParamMetaFields): boolean {
  return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b))
}

function normalizeForCompare(m: ParamMetaFields): unknown {
  return {
    displayName: m.displayName, unit: m.unit, range: m.range, step: m.step,
    group: m.group, tags: m.tags, source: m.source, impactKpi: m.impactKpi,
  }
}

/** 全空元信息(未定义任何字段):「缺元信息」筛选的判定口径。 */
export function metaHasContent(meta: ParamMetaFields | undefined): boolean {
  if (meta === undefined) return false
  return META_FIELD_KEYS.some((k) => meta[k] !== undefined)
}

export function isMissingMeta(store: ParamMetaStore, path: string): boolean {
  return !metaHasContent(store.entries[path]?.meta)
}

/**
 * 写入元信息补丁:逐字段合并(undefined = 不动;空串/空表 = 清除该字段;
 * 非法值丢弃)。没有任何实际改动时原 store 原样返回(不动 updatedAt)。
 */
export function upsertMetaEntry(
  store: ParamMetaStore,
  path: string,
  patch: ParamMetaPatch,
  now: number,
): { store: ParamMetaStore; changed: boolean } {
  const cleaned = cleanPatch(patch)
  const prev = store.entries[path]
  // 浅拷贝合并:不改写既有 meta 对象(不可变更新,误判幂等会在此暴露)
  const merged: { -readonly [K in keyof ParamMetaFields]: ParamMetaFields[K] } = { ...(prev?.meta ?? {}) }
  for (const k of cleaned.clear) delete merged[k]
  for (const k of META_FIELD_KEYS) {
    const v = cleaned.meta[k]
    if (v !== undefined) merged[k] = v as never
  }
  const meta: ParamMetaFields = metaHasContent(merged as ParamMetaFields)
    ? (merged as ParamMetaFields)
    : {}
  if (prev !== undefined && metaEquals(prev.meta, meta)) {
    return { store, changed: false }
  }
  // 全无效补丁且本就无条目:不凭空建空条目(缺失口径不被污染)
  if (!metaHasContent(meta) && prev === undefined) {
    return { store, changed: false }
  }
  return {
    store: {
      ...store,
      entries: { ...store.entries, [path]: { path, meta, updatedAt: now } },
    },
    changed: true,
  }
}

/** 收藏/取消收藏:幂等;收藏集与元信息同文档版本化。 */
export function setFavoriteMeta(
  store: ParamMetaStore,
  path: string,
  favorite: boolean,
): { store: ParamMetaStore; changed: boolean } {
  const has = store.favorites[path] === true
  if (favorite === has) return { store, changed: false }
  if (favorite) {
    return { store: { ...store, favorites: { ...store.favorites, [path]: true } }, changed: true }
  }
  const favorites = { ...store.favorites }
  delete favorites[path]
  return { store: { ...store, favorites }, changed: true }
}

/* —— 校验(③:范围/步长/类型不一致类规则;纯前端检查,不冒充内核校验) —— */

export type MetaIssue = { readonly path: string; readonly field: string; readonly message: string }

const NUMERIC_KINDS: ReadonlySet<string> = new Set(['u32', 'u64', 'i64', 'f64', 'mix'])

/** 单条元信息校验:范围需有限数且 min<max;步长需正数且不超区间宽度;
 * 范围/步长只允许数值通道参数(u32/u64/i64/f64/mix),其余为类型不一致。 */
export function metaIssues(meta: ParamMetaFields | undefined, kind: ParamKind | null): MetaIssue[] {
  const issues: MetaIssue[] = []
  if (meta === undefined) return issues
  const numericChannel = kind === null || NUMERIC_KINDS.has(kind)
  const where = (field: string, message: string): void => {
    issues.push({ path: '', field, message })
  }
  if (meta.range !== undefined) {
    if (!numericChannel) {
      where('range', `类型不一致:${String(kind)} 参数不支持建议范围(仅数值通道)`)
    } else if (
      typeof meta.range !== 'object' ||
      !Number.isFinite(meta.range.min) || !Number.isFinite(meta.range.max)
    ) {
      where('range', '建议范围需为有限数值')
    } else if (meta.range.min >= meta.range.max) {
      where('range', `建议范围需 min < max(当前 ${meta.range.min} ≥ ${meta.range.max})`)
    }
  }
  if (meta.step !== undefined) {
    if (!numericChannel) {
      where('step', `类型不一致:${String(kind)} 参数不支持步长(仅数值通道)`)
    } else if (!Number.isFinite(meta.step)) {
      where('step', '步长需为有限数值')
    } else if (meta.step <= 0) {
      where('step', `步长需为正数(当前 ${meta.step})`)
    } else if (
      meta.range !== undefined &&
      typeof meta.range === 'object' &&
      Number.isFinite(meta.range.min) && Number.isFinite(meta.range.max) &&
      meta.range.min < meta.range.max &&
      meta.step > meta.range.max - meta.range.min
    ) {
      where('step', `步长超出建议范围宽度(${meta.step} > ${meta.range.max - meta.range.min})`)
    }
  }
  if (meta.tags !== undefined && !Array.isArray(meta.tags)) {
    where('tags', '标签需为字符串列表')
  }
  return issues.map((i) => ({ ...i, path: '' }))
}

/** 校验错误路径集合(③「校验错误」筛选依据)。 */
export function metaIssuePaths(
  store: ParamMetaStore,
  kindOf: (path: string) => ParamKind | null,
): ReadonlySet<string> {
  const out = new Set<string>()
  for (const [path, entry] of Object.entries(store.entries)) {
    if (metaIssues(entry.meta, kindOf(path)).length > 0) out.add(path)
  }
  return out
}

/** 「最近修改」路径集合:updatedAt 落在窗口内的元信息条目(收藏不算修改)。 */
export function recentMetaPaths(
  store: ParamMetaStore,
  now: number,
  windowSec: number = RECENT_WINDOW_SEC,
): ReadonlySet<string> {
  const out = new Set<string>()
  for (const [path, entry] of Object.entries(store.entries)) {
    if (entry.updatedAt > 0 && entry.updatedAt <= now && now - entry.updatedAt <= windowSec) out.add(path)
  }
  return out
}

/** 以当前时刻取「最近修改」集合(组件渲染侧用,避免渲染中直接取时钟)。 */
export function recentMetaPathsNow(store: ParamMetaStore): ReadonlySet<string> {
  return recentMetaPaths(store, Math.floor(Date.now() / 1000))
}

/* —— 筛选(③:四件套,各自独立开关,AND 组合;不与文本搜索耦合) —— */

export type MetaFilterOpts = {
  readonly favoritesOnly: boolean
  readonly recentOnly: boolean
  readonly missingOnly: boolean
  readonly invalidOnly: boolean
  readonly favorites: ReadonlySet<string>
  readonly recent: ReadonlySet<string>
  readonly missing: ReadonlySet<string>
  readonly invalid: ReadonlySet<string>
}

export function metaFilter<T>(
  rows: readonly T[],
  opts: MetaFilterOpts,
  pathOf: (row: T) => string,
): T[] {
  return rows.filter((row) => {
    const p = pathOf(row)
    if (opts.favoritesOnly && !opts.favorites.has(p)) return false
    if (opts.recentOnly && !opts.recent.has(p)) return false
    if (opts.missingOnly && !opts.missing.has(p)) return false
    if (opts.invalidOnly && !opts.invalid.has(p)) return false
    return true
  })
}

/* —— 元信息文档序列化(内容寻址版本化的载荷;确定序,同内容恒等) —— */

export const META_DOC_VERSION = '1'

type MetaDocEntry = { path: string; updatedAt: number; meta: Record<string, unknown> }
type MetaDoc = { version: string; favorites: string[]; entries: MetaDocEntry[] }

function orderedMeta(meta: ParamMetaFields): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (meta.displayName !== undefined) out.displayName = meta.displayName
  if (meta.unit !== undefined) out.unit = meta.unit
  if (meta.range !== undefined) out.range = { min: meta.range.min, max: meta.range.max }
  if (meta.step !== undefined) out.step = meta.step
  if (meta.group !== undefined) out.group = meta.group
  if (meta.tags !== undefined) out.tags = [...meta.tags]
  if (meta.source !== undefined) out.source = meta.source
  if (meta.impactKpi !== undefined) out.impactKpi = meta.impactKpi
  return out
}

export function serializeMetaDoc(store: ParamMetaStore): string {
  const entries: MetaDocEntry[] = Object.keys(store.entries).sort().map((path) => {
    const e = store.entries[path]
    return { path, updatedAt: e.updatedAt, meta: orderedMeta(e.meta) }
  })
  const doc: MetaDoc = {
    version: META_DOC_VERSION,
    favorites: Object.keys(store.favorites).filter((p) => store.favorites[p] === true).sort(),
    entries,
  }
  return JSON.stringify(doc)
}

/** 反序列化:逐条清洗,非法条目/字段丢弃(不抛错、不部分污染)。 */
export function parseMetaDoc(text: string): ParamMetaStore {
  let parsed: MetaDoc
  try {
    parsed = JSON.parse(text) as MetaDoc
  } catch {
    return EMPTY_META_STORE
  }
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_META_STORE
  const entries: Record<string, MetaEntry> = {}
  for (const e of Array.isArray(parsed.entries) ? parsed.entries : []) {
    if (typeof e?.path !== 'string' || e.path === '') continue
    const { meta } = cleanPatch((e.meta ?? {}) as ParamMetaPatch)
    if (!metaHasContent(meta)) continue
    entries[e.path] = { path: e.path, meta, updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : 0 }
  }
  const favorites: Record<string, true> = {}
  for (const p of Array.isArray(parsed.favorites) ? parsed.favorites : []) {
    if (typeof p === 'string' && p !== '') favorites[p] = true
  }
  return { entries, favorites }
}

/* —— 持久化(按项目隔离;载荷带 projectId 自检,与版本簿同口径) —— */

const STORE_VERSION = '1'

export const metaStorageKey = (projectId: string): string => `sandtable-wb2-param-meta-${projectId}`

type PersistedStore = { version: string; projectId: string; savedAt: number; store: ParamMetaStore }

export function persistParamMeta(storage: StorageLike | null, projectId: string, store: ParamMetaStore): boolean {
  try {
    const payload: PersistedStore = { version: STORE_VERSION, projectId, savedAt: Date.now(), store }
    storage?.setItem(metaStorageKey(projectId), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/** 恢复:projectId 不一致(跨项目)、异版或损坏一律得空表,不抛错不串数据。 */
export function restoreParamMeta(storage: StorageLike | null, projectId: string): ParamMetaStore {
  let raw: string | null
  try {
    raw = storage?.getItem(metaStorageKey(projectId)) ?? null
  } catch {
    return EMPTY_META_STORE
  }
  if (!raw) return EMPTY_META_STORE
  let parsed: PersistedStore
  try {
    parsed = JSON.parse(raw) as PersistedStore
  } catch {
    return EMPTY_META_STORE
  }
  if (parsed.version !== STORE_VERSION || parsed.projectId !== projectId) return EMPTY_META_STORE
  const s = parsed.store
  if (typeof s !== 'object' || s === null) return EMPTY_META_STORE
  const entries: Record<string, MetaEntry> = {}
  for (const [path, e] of Object.entries(s.entries ?? {})) {
    if (typeof e?.path !== 'string' || e.path !== path) continue
    const { meta } = cleanPatch((e.meta ?? {}) as ParamMetaPatch)
    if (!metaHasContent(meta)) continue
    entries[path] = { path, meta, updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : 0 }
  }
  const favorites: Record<string, true> = {}
  for (const [p, v] of Object.entries(s.favorites ?? {})) {
    if (v === true) favorites[p] = true
  }
  return { entries, favorites }
}

export function clearParamMeta(storage: StorageLike | null, projectId: string): void {
  try {
    storage?.removeItem(metaStorageKey(projectId))
  } catch {
    // 存储不可用:清不掉就留着,不影响当前会话
  }
}

/* —— 模块级会话状态(scenarioVersions 同款订阅;变更入既有版本簿) —— */

let currentProjectId: string | null = null
let store: ParamMetaStore = EMPTY_META_STORE
const listeners = new Set<() => void>()

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

function emit(): void {
  for (const l of listeners) l()
}

/** 打开项目时加载该项目元信息(与 loadScenarioVersions 成对调用)。 */
export function loadParamMeta(projectId: string): void {
  currentProjectId = projectId
  store = restoreParamMeta(defaultStorage(), projectId)
  emit()
}

export function unloadParamMeta(): void {
  currentProjectId = null
  store = EMPTY_META_STORE
  emit()
}

export const paramMetaSnapshot = (): ParamMetaStore => store

export function subscribeParamMeta(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * 写入元信息(④):持久化 + 序列化文档写入既有版本簿
 * (versionsSaveVersion 内容寻址,同内容去重)。
 */
export function metaUpsert(path: string, patch: ParamMetaPatch): { ok: boolean; error?: string } {
  if (currentProjectId === null) return { ok: false, error: '没有打开的项目' }
  const out = upsertMetaEntry(store, path, patch, Math.floor(Date.now() / 1000))
  if (!out.changed) return { ok: true }
  store = out.store
  persistParamMeta(defaultStorage(), currentProjectId, store)
  versionsSaveVersion(META_DOC_PATH, serializeMetaDoc(store), { label: 'meta' })
  emit()
  return { ok: true }
}

/** 收藏/取消收藏(同走版本簿)。 */
export function metaSetFavorite(path: string, favorite: boolean): { ok: boolean; error?: string } {
  if (currentProjectId === null) return { ok: false, error: '没有打开的项目' }
  const out = setFavoriteMeta(store, path, favorite)
  if (!out.changed) return { ok: true }
  store = out.store
  persistParamMeta(defaultStorage(), currentProjectId, store)
  versionsSaveVersion(META_DOC_PATH, serializeMetaDoc(store), { label: 'meta' })
  emit()
  return { ok: true }
}
