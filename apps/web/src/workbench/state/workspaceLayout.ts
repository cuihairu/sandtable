// Persisted workbench panel geometry. Values are clamped at both the store and
// render boundaries so corrupted or intentionally oversized storage cannot
// push chrome or document content off screen.

export const WORKSPACE_LAYOUT_STORAGE_KEY = 'sandtable-workspace-layout-v1'

export type WorkspaceLayout = {
  explorerWidth: number
  inspectorWidth: number
  drawerHeight: number
}

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  explorerWidth: 220,
  inspectorWidth: 267,
  drawerHeight: 220,
}

export const WORKSPACE_LAYOUT_LIMITS = {
  explorerWidth: [168, 420] as const,
  inspectorWidth: [200, 520] as const,
  drawerHeight: [120, 480] as const,
}

export function clampLayoutValue(value: number, [min, max]: readonly [number, number]): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min
}

export function normalizeWorkspaceLayout(value: unknown): WorkspaceLayout {
  const raw = (value ?? {}) as Partial<Record<keyof WorkspaceLayout, unknown>>
  return {
    explorerWidth: clampLayoutValue(Number(raw.explorerWidth), WORKSPACE_LAYOUT_LIMITS.explorerWidth),
    inspectorWidth: clampLayoutValue(Number(raw.inspectorWidth), WORKSPACE_LAYOUT_LIMITS.inspectorWidth),
    drawerHeight: clampLayoutValue(Number(raw.drawerHeight), WORKSPACE_LAYOUT_LIMITS.drawerHeight),
  }
}

export function readWorkspaceLayout(storage: Pick<Storage, 'getItem'> | undefined): WorkspaceLayout {
  if (!storage) return DEFAULT_WORKSPACE_LAYOUT
  try {
    const raw = storage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY)
    return raw === null ? DEFAULT_WORKSPACE_LAYOUT : normalizeWorkspaceLayout(JSON.parse(raw))
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT
  }
}

export function writeWorkspaceLayout(storage: Pick<Storage, 'setItem'> | undefined, layout: WorkspaceLayout): boolean {
  if (!storage) return false
  try {
    storage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
    return true
  } catch {
    return false
  }
}
