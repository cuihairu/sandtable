// Shared data-grid behavior used by parameter and candidate tables.
// Controls follow spreadsheet/workbench conventions: sorting stays stable,
// selection is copied with Tab-separated cells, and column preferences are
// explicit state rather than DOM-derived values.

export type TableColumnPref = {
  hidden: readonly string[]
  pinnedLeft: readonly string[]
  pinnedRight: readonly string[]
}

export type SortRule<T> = {
  key: string
  dir: 1 | -1
  value: (row: T) => string | number
}

export type CopyCell<T> = {
  label: string
  value: (row: T) => string | number
}

export const DEFAULT_COLUMN_PREF: TableColumnPref = {
  hidden: [],
  pinnedLeft: [],
  pinnedRight: [],
}

function moveUnique(keys: readonly string[], key: string, add: boolean): string[] {
  const without = keys.filter((item) => item !== key)
  return add ? [...without, key] : without
}

export function toggleColumn(pref: TableColumnPref, key: string, visible: boolean): TableColumnPref {
  return {
    ...pref,
    hidden: moveUnique(pref.hidden, key, !visible),
    pinnedLeft: moveUnique(pref.pinnedLeft, key, !visible && pref.pinnedLeft.includes(key)),
    pinnedRight: moveUnique(pref.pinnedRight, key, !visible && pref.pinnedRight.includes(key)),
  }
}

export function normalizeColumnPreference(pref: unknown): TableColumnPref {
  const raw = (pref ?? {}) as Partial<Record<keyof TableColumnPref, unknown>>
  const strings = (value: unknown): readonly string[] => Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
  return {
    hidden: strings(raw.hidden),
    pinnedLeft: strings(raw.pinnedLeft),
    pinnedRight: strings(raw.pinnedRight),
  }
}

export function togglePin(pref: TableColumnPref, key: string, side: 'left' | 'right'): TableColumnPref {
  const other = side === 'left' ? 'pinnedRight' as const : 'pinnedLeft' as const
  const isPinned = pref[side === 'left' ? 'pinnedLeft' : 'pinnedRight'].includes(key)
  return {
    ...pref,
    [side === 'left' ? 'pinnedLeft' : 'pinnedRight']: isPinned
      ? moveUnique(pref[side === 'left' ? 'pinnedLeft' : 'pinnedRight'], key, false)
      : moveUnique(pref[side === 'left' ? 'pinnedLeft' : 'pinnedRight'], key, true),
    [other]: moveUnique(pref[other], key, false),
  }
}

/** Hidden or unknown preferences never break a table; source order is preserved. */
export function orderedColumns<T>(columns: readonly T[], getKey: (column: T) => string, pref: TableColumnPref): T[] {
  const hidden = new Set(pref.hidden)
  const byKey = new Map(columns.map((column) => [getKey(column), column] as const))
  const left = pref.pinnedLeft.flatMap((key) => byKey.has(key) ? [byKey.get(key) as T] : [])
  const right = pref.pinnedRight.flatMap((key) => byKey.has(key) ? [byKey.get(key) as T] : [])
  const pinned = new Set([...pref.pinnedLeft, ...pref.pinnedRight])
  const center = columns.filter((column) => {
    const key = getKey(column)
    return !hidden.has(key) && !pinned.has(key)
  })
  return [...left, ...center, ...right]
}

export function sortRows<T>(rows: readonly T[], rule: SortRule<T> | null): T[] {
  if (rule === null) return [...rows]
  return [...rows].sort((left, right) => {
    const a = rule.value(left)
    const b = rule.value(right)
    const compared = typeof a === 'number' && typeof b === 'number'
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true })
    return compared * rule.dir
  })
}

export function nextSortDir(currentKey: string | null, requestedKey: string, currentDir: 1 | -1 = 1): 1 | -1 {
  return currentKey === requestedKey && currentDir === 1 ? -1 : 1
}

/** Excel/Sheets-compatible clipboard shape: header row, quoted TSV cells. */
export function copyTable(rows: readonly unknown[], columns: readonly CopyCell<never>[]): string {
  const quote = (value: string | number): string => {
    const text = String(value)
    return /["\t\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const lines = [columns.map((column) => quote(column.label)).join('\t')]
  for (const row of rows) {
    lines.push(columns.map((column) => quote((column.value as (source: unknown) => string | number)(row))).join('\t'))
  }
  return `${lines.join('\n')}\n`
}
