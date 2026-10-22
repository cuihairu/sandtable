import { DEFAULT_COLUMN_PREF, normalizeColumnPreference } from './tableState.ts'
import type { TableColumnPref } from './tableState.ts'

export const COLUMN_PREFERENCE_STORAGE_KEY = 'sandtable-param-columns-v1'

export function readColumnPreference(storage: Pick<Storage, 'getItem'> | undefined): TableColumnPref {
  if (!storage) return DEFAULT_COLUMN_PREF
  try {
    const raw = storage.getItem(COLUMN_PREFERENCE_STORAGE_KEY)
    return raw === null ? DEFAULT_COLUMN_PREF : normalizeColumnPreference(JSON.parse(raw))
  } catch {
    return DEFAULT_COLUMN_PREF
  }
}

export function writeColumnPreference(storage: Pick<Storage, 'setItem'> | undefined, pref: TableColumnPref): boolean {
  if (!storage) return false
  try {
    storage.setItem(COLUMN_PREFERENCE_STORAGE_KEY, JSON.stringify(pref))
    return true
  } catch {
    return false
  }
}
