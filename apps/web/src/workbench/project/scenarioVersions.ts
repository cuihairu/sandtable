// P1-02/03/05 · 场景配置版本(项目与场景管理 ②③⑤):每场景独立的配置
// 版本历史、可指定可回切的当前基线、场景与版本级改动备注。纪律:
// - 基线保持只读语义(与 projectDoc.baselineOfProject 同一红线):「切换
//   基线」只是把只读参照系指定到某个已存版本,候选派生关系不变;回切 =
//   回到上一个指定(或项目文件原文),历史版本永不改写;
// - 版本按内容寻址(同内容 ⇒ 同 versionId):重复保存去重,不产生同义版本;
// - 持久化按项目隔离(键含 projectId,载荷带 projectId 自检):跨项目
//   读取一律丢弃,防串数据(与 WB-04.11 草稿持久化同口径);
// - 纯数据层不 import 演示模块,不依赖 wasm;React 组合在 ScenarioVersionsPanel。
import { stableHash } from '../ids.ts'
import type { StorageLike } from './projectRegistry.ts'

export type ScenarioVersion = {
  /** 内容派生:同内容恒等,重复保存去重 */
  readonly versionId: string
  /** 展示标签(默认 v<序号>,可编辑语义由 label 承载) */
  readonly label: string
  /** 版本级改动备注(⑤,可编辑) */
  readonly note: string
  readonly content: string
  readonly createdAtUnix: number
}

export type ScenarioVersionStore = {
  /** 每场景独立历史:路径 → 版本列表(旧→新,append-only,不改写已存版本) */
  readonly versions: Readonly<Record<string, readonly ScenarioVersion[]>>
  /** 场景级改动备注(⑤) */
  readonly notes: Readonly<Record<string, string>>
  /** 当前基线指定:路径 → versionId;null = 项目文件原文(默认参照系) */
  readonly baseline: Readonly<Record<string, string | null>>
  /** 基线指定历史栈(回切用):路径 → 上一次指定(最新在前) */
  readonly baselineHistory: Readonly<Record<string, readonly (string | null)[]>>
}

export const EMPTY_VERSION_STORE: ScenarioVersionStore = {
  versions: {},
  notes: {},
  baseline: {},
  baselineHistory: {},
}

const MAX_HISTORY = 50

export function versionIdOf(content: string): string {
  return `ver_${stableHash(content)}`
}

export function versionOf(
  store: ScenarioVersionStore,
  path: string,
  versionId: string,
): ScenarioVersion | null {
  return (store.versions[path] ?? []).find((v) => v.versionId === versionId) ?? null
}

/** 保存版本:同内容去重(返回原 store 与既有版本);新版本追加到该场景末尾。 */
export function saveVersion(
  store: ScenarioVersionStore,
  path: string,
  content: string,
  opts: { label?: string; note?: string; now: number },
): { store: ScenarioVersionStore; version: ScenarioVersion; duplicated: boolean } {
  const versionId = versionIdOf(content)
  const existing = (store.versions[path] ?? []).find((v) => v.versionId === versionId)
  if (existing) return { store, version: existing, duplicated: true }
  const version: ScenarioVersion = {
    versionId,
    label: opts.label?.trim() || `v${(store.versions[path]?.length ?? 0) + 1}`,
    note: opts.note?.trim() ?? '',
    content,
    createdAtUnix: opts.now,
  }
  return {
    store: {
      ...store,
      versions: { ...store.versions, [path]: [...(store.versions[path] ?? []), version] },
    },
    version,
    duplicated: false,
  }
}

/** 版本级改动备注(⑤):只改备注字段,版本内容与 ID 不变。 */
export function updateVersionNote(
  store: ScenarioVersionStore,
  path: string,
  versionId: string,
  note: string,
): ScenarioVersionStore {
  const list = store.versions[path] ?? []
  if (!list.some((v) => v.versionId === versionId)) return store
  return {
    ...store,
    versions: {
      ...store.versions,
      [path]: list.map((v) => (v.versionId === versionId ? { ...v, note: note.trim() } : v)),
    },
  }
}

/** 场景级改动备注(⑤)。 */
export function setScenarioNote(store: ScenarioVersionStore, path: string, note: string): ScenarioVersionStore {
  const clean = note.trim()
  if ((store.notes[path] ?? '') === clean) return store
  return { ...store, notes: { ...store.notes, [path]: clean } }
}

/**
 * 指定当前基线(③):把该场景的只读参照系指到某个已存版本;versionId 传
 * null = 回到项目文件原文。上一次指定压栈(回切用);非法版本显式拒绝。
 */
export function setBaseline(
  store: ScenarioVersionStore,
  path: string,
  versionId: string | null,
): { ok: true; store: ScenarioVersionStore } | { ok: false; error: string } {
  if (versionId !== null && versionOf(store, path, versionId) === null) {
    return { ok: false, error: `版本 ${versionId} 不存在于 ${path} 的版本历史中` }
  }
  const current = store.baseline[path] ?? null
  if (current === versionId) return { ok: true, store }
  return {
    ok: true,
    store: {
      ...store,
      baseline: { ...store.baseline, [path]: versionId },
      baselineHistory: {
        ...store.baselineHistory,
        [path]: [current, ...(store.baselineHistory[path] ?? [])].slice(0, MAX_HISTORY),
      },
    },
  }
}

/** 回切基线(③):弹回上一次指定;栈空 = 回到项目文件原文(null)。 */
export function revertBaseline(store: ScenarioVersionStore, path: string): ScenarioVersionStore {
  const stack = store.baselineHistory[path] ?? []
  if (stack.length === 0) {
    if ((store.baseline[path] ?? null) === null) return store
    return { ...store, baseline: { ...store.baseline, [path]: null } }
  }
  const [previous, ...rest] = stack
  return {
    ...store,
    baseline: { ...store.baseline, [path]: previous },
    baselineHistory: { ...store.baselineHistory, [path]: rest },
  }
}

/** 生效基线(③):指定版本的原文,或项目文件原文;来源如实标注。 */
export function effectiveBaseline(
  store: ScenarioVersionStore,
  path: string,
  baseContent: string,
): { content: string; versionId: string | null; source: 'version' | 'file' } {
  const id = store.baseline[path] ?? null
  if (id === null) return { content: baseContent, versionId: null, source: 'file' }
  const v = versionOf(store, path, id)
  if (!v) return { content: baseContent, versionId: null, source: 'file' }
  return { content: v.content, versionId: id, source: 'version' }
}

/* —— 持久化(按项目隔离;载荷带 projectId 自检,防串数据) —— */

const STORE_VERSION = '1'

export const versionStorageKey = (projectId: string): string => `sandtable-wb2-scenario-versions-${projectId}`

type PersistedStore = {
  version: string
  projectId: string
  savedAt: number
  store: ScenarioVersionStore
}

export function persistScenarioVersions(storage: StorageLike | null, projectId: string, store: ScenarioVersionStore): boolean {
  try {
    const payload: PersistedStore = { version: STORE_VERSION, projectId, savedAt: Date.now(), store }
    storage?.setItem(versionStorageKey(projectId), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/** 恢复:projectId 不一致(跨项目)、异版或损坏一律得空表,不抛错不串数据。 */
export function restoreScenarioVersions(storage: StorageLike | null, projectId: string): ScenarioVersionStore {
  let raw: string | null
  try {
    raw = storage?.getItem(versionStorageKey(projectId)) ?? null
  } catch {
    return EMPTY_VERSION_STORE
  }
  if (!raw) return EMPTY_VERSION_STORE
  let parsed: PersistedStore
  try {
    parsed = JSON.parse(raw) as PersistedStore
  } catch {
    return EMPTY_VERSION_STORE
  }
  if (parsed.version !== STORE_VERSION || parsed.projectId !== projectId) return EMPTY_VERSION_STORE
  const s = parsed.store
  if (typeof s !== 'object' || s === null) return EMPTY_VERSION_STORE
  return {
    versions: s.versions ?? {},
    notes: s.notes ?? {},
    baseline: s.baseline ?? {},
    baselineHistory: s.baselineHistory ?? {},
  }
}

export function clearScenarioVersions(storage: StorageLike | null, projectId: string): void {
  try {
    storage?.removeItem(versionStorageKey(projectId))
  } catch {
    // 存储不可用:清不掉就留着,不影响当前会话
  }
}

/* —— 模块级会话状态(按当前项目加载;analysisStore 同款订阅) —— */

let currentProjectId: string | null = null
let store: ScenarioVersionStore = EMPTY_VERSION_STORE
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

/** 切换/打开项目时加载该项目的历史(内容不在本模块,只加载版本簿)。 */
export function loadScenarioVersions(projectId: string): void {
  currentProjectId = projectId
  store = restoreScenarioVersions(defaultStorage(), projectId)
  emit()
}

export function unloadScenarioVersions(): void {
  currentProjectId = null
  store = EMPTY_VERSION_STORE
  emit()
}

export const scenarioVersionsSnapshot = (): ScenarioVersionStore => store

export function subscribeScenarioVersions(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

type StoreMutation = { ok: true; store: ScenarioVersionStore } | { ok: false; error: string }

function mutate<A extends unknown[]>(fn: (s: ScenarioVersionStore, ...args: A) => StoreMutation | ScenarioVersionStore, ...args: A): { ok: boolean; error?: string } {
  if (currentProjectId === null) return { ok: false, error: '没有打开的项目' }
  const out = fn(store, ...args)
  if ('ok' in out && !out.ok) return { ok: false, error: out.error }
  store = 'ok' in out ? out.store : out
  persistScenarioVersions(defaultStorage(), currentProjectId, store)
  emit()
  return { ok: true }
}

export function versionsSaveVersion(path: string, content: string, opts: { label?: string; note?: string }): { ok: boolean; versionId?: string; duplicated?: boolean; error?: string } {
  if (currentProjectId === null) return { ok: false, error: '没有打开的项目' }
  const out = saveVersion(store, path, content, { ...opts, now: Math.floor(Date.now() / 1000) })
  store = out.store
  persistScenarioVersions(defaultStorage(), currentProjectId, store)
  emit()
  return { ok: true, versionId: out.version.versionId, duplicated: out.duplicated }
}

export function versionsUpdateNote(path: string, versionId: string, note: string): { ok: boolean; error?: string } {
  return mutate(updateVersionNote, path, versionId, note)
}

export function versionsSetScenarioNote(path: string, note: string): { ok: boolean; error?: string } {
  return mutate(setScenarioNote, path, note)
}

export function versionsSetBaseline(path: string, versionId: string | null): { ok: boolean; error?: string } {
  return mutate(setBaseline, path, versionId)
}

export function versionsRevertBaseline(path: string): { ok: boolean; error?: string } {
  return mutate(revertBaseline, path)
}
