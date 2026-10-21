// P1-01 · 项目库(项目与场景管理 ①⑤):多项目注册表——创建/复制/归档/恢复/
// 重命名/备注。纪律:
// - 注册表只存项目元数据(id/名字/备注/归档软态/时间戳);项目内容(场景、
//   实验配置、结果)始终以 ProjectDoc → buildProjectSave → packProject 写回
//   .sandtable 归档(state/projectDoc.ts 已验路径),这里不另建一份内容状态,
//   不出现第二个事实源;
// - 归档是可恢复软态:只翻 archived 标记,不删条目、不碰任何项目字节;
//   恢复即翻回,数据无损;
// - 项目 ID 是创建型身份(ids.ts 纪律):创建/复制时生成一次,此后改名、
//   归档、恢复都不漂移;
// - 持久化走 StorageLike(与 WB-04.11 草稿持久化同一抽象),载荷带版本号与
//   自检字段,损坏/异版丢弃不抛错(存储不可用不阻塞编辑)。
import { createId, ID_PREFIXES } from '../ids.ts'
import type { ProjectId } from '../ids.ts'

export type ProjectRegistryEntry = {
  readonly projectId: ProjectId
  readonly name: string
  /** 项目级改动备注(可编辑,⑤) */
  readonly note: string
  /** 归档软态:可恢复;true 时项目仍完整保留,只是从活动清单退场 */
  readonly archived: boolean
  readonly archivedAtUnix: number | null
  readonly createdAtUnix: number
  readonly updatedAtUnix: number
}

export const REGISTRY_STORAGE_KEY = 'sandtable-wb2-project-registry'
const REGISTRY_VERSION = '1'

type RegistryPayload = {
  version: string
  entries: ProjectRegistryEntry[]
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** 读取注册表:无记录 = 空表;损坏/异版载荷整表丢弃(不抛错、不部分恢复)。 */
export function readRegistry(storage: StorageLike | null): ProjectRegistryEntry[] {
  let raw: string | null
  try {
    raw = storage?.getItem(REGISTRY_STORAGE_KEY) ?? null
  } catch {
    return []
  }
  if (!raw) return []
  let parsed: RegistryPayload
  try {
    parsed = JSON.parse(raw) as RegistryPayload
  } catch {
    return []
  }
  if (parsed.version !== REGISTRY_VERSION || !Array.isArray(parsed.entries)) return []
  const entries: ProjectRegistryEntry[] = []
  for (const e of parsed.entries) {
    if (typeof e?.projectId !== 'string' || typeof e?.name !== 'string' || e.name === '') continue
    entries.push({
      projectId: e.projectId as ProjectId,
      name: e.name,
      note: typeof e.note === 'string' ? e.note : '',
      archived: e.archived === true,
      archivedAtUnix: typeof e.archivedAtUnix === 'number' ? e.archivedAtUnix : null,
      createdAtUnix: typeof e.createdAtUnix === 'number' ? e.createdAtUnix : 0,
      updatedAtUnix: typeof e.updatedAtUnix === 'number' ? e.updatedAtUnix : 0,
    })
  }
  return entries
}

/** 写注册表;失败返回 false(存储不可用不阻塞当前会话)。 */
export function writeRegistry(storage: StorageLike | null, entries: readonly ProjectRegistryEntry[]): boolean {
  try {
    const payload: RegistryPayload = { version: REGISTRY_VERSION, entries: [...entries] }
    storage?.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function entryFor(entries: readonly ProjectRegistryEntry[], projectId: string): ProjectRegistryEntry | null {
  return entries.find((e) => e.projectId === projectId) ?? null
}

/** 非空名字守卫(与 packProject「项目名不能为空」同口径);非法返回 null。 */
function cleanName(name: string): string | null {
  const trimmed = name.trim()
  return trimmed === '' ? null : trimmed
}

export function createEntry(
  name: string,
  note: string,
  now: number,
): { ok: true; entry: ProjectRegistryEntry } | { ok: false; error: string } {
  const clean = cleanName(name)
  if (clean === null) return { ok: false, error: '项目名不能为空' }
  return {
    ok: true,
    entry: {
      projectId: createId(ID_PREFIXES.project) as ProjectId,
      name: clean,
      note: note.trim(),
      archived: false,
      archivedAtUnix: null,
      createdAtUnix: now,
      updatedAtUnix: now,
    },
  }
}

/**
 * 复制注册表条目:新项目 ID(创建型身份,生成一次)、名字加副本后缀、
 * 备注继承;原条目原样。归档软态不继承(副本是活动项目)。
 */
export function duplicateEntry(
  entries: readonly ProjectRegistryEntry[],
  projectId: string,
  now: number,
): { ok: true; entries: ProjectRegistryEntry[]; entry: ProjectRegistryEntry } | { ok: false; error: string } {
  const src = entryFor(entries, projectId)
  if (!src) return { ok: false, error: `注册表中没有项目 ${projectId}` }
  const copy: ProjectRegistryEntry = {
    projectId: createId(ID_PREFIXES.project) as ProjectId,
    name: `${src.name} copy`,
    note: src.note,
    archived: false,
    archivedAtUnix: null,
    createdAtUnix: now,
    updatedAtUnix: now,
  }
  return { ok: true, entries: [...entries, copy], entry: copy }
}

/** 归档(软态):幂等;已归档原样返回;不删数据、不清理内容。 */
export function archiveEntry(
  entries: readonly ProjectRegistryEntry[],
  projectId: string,
  now: number,
): readonly ProjectRegistryEntry[] {
  return entries.map((e) =>
    e.projectId === projectId && !e.archived
      ? { ...e, archived: true, archivedAtUnix: now, updatedAtUnix: now }
      : e,
  )
}

/** 恢复(归档的逆操作):幂等;清归档时间戳,数据面本就未动。 */
export function restoreEntry(
  entries: readonly ProjectRegistryEntry[],
  projectId: string,
  now: number,
): readonly ProjectRegistryEntry[] {
  return entries.map((e) =>
    e.projectId === projectId && e.archived
      ? { ...e, archived: false, archivedAtUnix: null, updatedAtUnix: now }
      : e,
  )
}

/** 重命名:空名拒绝(返回原表);改名不改项目 ID。 */
export function renameEntry(
  entries: readonly ProjectRegistryEntry[],
  projectId: string,
  name: string,
  now: number,
): readonly ProjectRegistryEntry[] {
  const clean = cleanName(name)
  if (clean === null) return entries
  return entries.map((e) =>
    e.projectId === projectId && e.name !== clean
      ? { ...e, name: clean, updatedAtUnix: now }
      : e,
  )
}

/** 项目级改动备注(⑤):可整段覆写。 */
export function setEntryNote(
  entries: readonly ProjectRegistryEntry[],
  projectId: string,
  note: string,
  now: number,
): readonly ProjectRegistryEntry[] {
  const clean = note.trim()
  return entries.map((e) =>
    e.projectId === projectId && e.note !== clean
      ? { ...e, note: clean, updatedAtUnix: now }
      : e,
  )
}

/** 打开/创建项目时登记(幂等 upsert):按 ID 对齐,不覆盖用户的备注与归档态。 */
export function upsertEntry(
  entries: readonly ProjectRegistryEntry[],
  projectId: string,
  name: string,
  now: number,
): readonly ProjectRegistryEntry[] {
  const existing = entryFor(entries, projectId)
  if (existing) return entries
  const clean = cleanName(name) ?? 'untitled'
  return [
    ...entries,
    {
      projectId: projectId as ProjectId,
      name: clean,
      note: '',
      archived: false,
      archivedAtUnix: null,
      createdAtUnix: now,
      updatedAtUnix: now,
    },
  ]
}

/* —— 模块级会话状态(analysisStore 同款订阅模式;React 用 useSyncExternalStore) —— */

type RegistrySession = {
  entries: readonly ProjectRegistryEntry[]
  persisted: boolean
}

let session: RegistrySession = { entries: readRegistry(defaultStorage()), persisted: true }
const listeners = new Set<() => void>()

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

function commit(next: RegistrySession): void {
  session = next
  for (const l of listeners) l()
}

export const registrySnapshot = (): RegistrySession => session
export const registrySubscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function registryCreate(name: string, note: string): { ok: true; entry: ProjectRegistryEntry } | { ok: false; error: string } {
  const created = createEntry(name, note, Math.floor(Date.now() / 1000))
  if (!created.ok) return created
  const entries = [...session.entries, created.entry]
  commit({ entries, persisted: writeRegistry(defaultStorage(), entries) })
  return created
}

export function registryDuplicate(projectId: string): { ok: true; entry: ProjectRegistryEntry } | { ok: false; error: string } {
  const out = duplicateEntry(session.entries, projectId, Math.floor(Date.now() / 1000))
  if (!out.ok) return out
  commit({ entries: out.entries, persisted: writeRegistry(defaultStorage(), out.entries) })
  return { ok: true, entry: out.entry }
}

export function registryArchive(projectId: string): void {
  const entries = archiveEntry(session.entries, projectId, Math.floor(Date.now() / 1000))
  commit({ entries, persisted: writeRegistry(defaultStorage(), entries) })
}

export function registryRestore(projectId: string): void {
  const entries = restoreEntry(session.entries, projectId, Math.floor(Date.now() / 1000))
  commit({ entries, persisted: writeRegistry(defaultStorage(), entries) })
}

export function registryRename(projectId: string, name: string): void {
  const entries = renameEntry(session.entries, projectId, name, Math.floor(Date.now() / 1000))
  commit({ entries, persisted: writeRegistry(defaultStorage(), entries) })
}

export function registrySetNote(projectId: string, note: string): void {
  const entries = setEntryNote(session.entries, projectId, note, Math.floor(Date.now() / 1000))
  commit({ entries, persisted: writeRegistry(defaultStorage(), entries) })
}

export function registryRegister(projectId: string, name: string): void {
  const entries = upsertEntry(session.entries, projectId, name, Math.floor(Date.now() / 1000))
  commit({ entries, persisted: writeRegistry(defaultStorage(), entries) })
}
