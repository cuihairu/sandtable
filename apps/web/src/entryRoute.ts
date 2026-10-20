export type EntryRoute = 'workbench' | 'legacy'

export const LEGACY_HASH_BASE = '#/legacy'

/** 默认进 V2 工作台；旧 Phase 6 单页保留在 #/legacy 深链后。 */
export function entryRoute(hash: string): EntryRoute {
  return hash.startsWith(LEGACY_HASH_BASE) ? 'legacy' : 'workbench'
}

/** 旧应用自身不使用路由；#/legacy 后缀仅为稳定历史入口，进入后内部链接保持默认行为。 */
export function legacyHash(hash: string): string {
  return hash.startsWith(LEGACY_HASH_BASE) ? hash : LEGACY_HASH_BASE
}
