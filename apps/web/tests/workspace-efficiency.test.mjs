// Workspace efficiency contracts: persisted panel geometry, stable table
// column/sort behavior, and clipboard output compatible with spreadsheet apps.
import test from 'node:test'
import assert from 'node:assert/strict'

const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
}

const { normalizeWorkspaceLayout, readWorkspaceLayout, writeWorkspaceLayout, WORKSPACE_LAYOUT_STORAGE_KEY } = await import(
  '../src/workbench/state/workspaceLayout.ts'
)
const { DEFAULT_COLUMN_PREF, copyTable, nextSortDir, orderedColumns, sortRows, toggleColumn, togglePin } = await import(
  '../src/workbench/table/tableState.ts'
)
const { readColumnPreference, writeColumnPreference, COLUMN_PREFERENCE_STORAGE_KEY } = await import(
  '../src/workbench/table/tablePreference.ts'
)

test('panel layout restores within fixed bounds and survives corrupt storage', () => {
  const tiny = normalizeWorkspaceLayout({ explorerWidth: 40, inspectorWidth: 9999, drawerHeight: 0 })
  assert.equal(tiny.explorerWidth, 168)
  assert.equal(tiny.inspectorWidth, 520)
  assert.equal(tiny.drawerHeight, 120)
  assert.equal(readWorkspaceLayout({ getItem: () => '{bad json' }).explorerWidth, 220)

  const layout = { explorerWidth: 320, inspectorWidth: 380, drawerHeight: 300 }
  assert.equal(writeWorkspaceLayout(window.localStorage, layout), true)
  assert.deepEqual(readWorkspaceLayout(window.localStorage), layout)
  assert.equal(storage.get(WORKSPACE_LAYOUT_STORAGE_KEY), JSON.stringify(layout))
})

test('column visibility keeps source order, pinning is exclusive, and defaults show every column', () => {
  const columns = [{ key: 'a' }, { key: 'b' }, { key: 'c' }]
  assert.deepEqual(orderedColumns(columns, (column) => column.key, DEFAULT_COLUMN_PREF), columns)
  assert.deepEqual(
    orderedColumns(columns, (column) => column.key, { hidden: ['b'], pinnedLeft: ['c'], pinnedRight: [] }),
    [columns[2], columns[0]],
  )
  const hidden = toggleColumn(DEFAULT_COLUMN_PREF, 'a', false)
  assert.deepEqual(hidden.hidden, ['a'])
  assert.deepEqual(orderedColumns(columns, (column) => column.key, hidden), [columns[1], columns[2]])
  assert.deepEqual(toggleColumn(hidden, 'a', true).hidden, [])
  const pinned = togglePin(DEFAULT_COLUMN_PREF, 'b', 'left')
  assert.deepEqual(pinned.pinnedLeft, ['b'])
  assert.deepEqual(orderedColumns(columns, (column) => column.key, pinned)[0], columns[1])
  const moved = togglePin(pinned, 'b', 'right')
  assert.deepEqual(moved.pinnedLeft, [])
  assert.deepEqual(moved.pinnedRight, ['b'])
})

test('column preferences survive corrupt storage and invalid payloads', () => {
  assert.deepEqual(readColumnPreference({ getItem: () => '{bad json' }), DEFAULT_COLUMN_PREF)
  assert.deepEqual(readColumnPreference({ getItem: () => '{"hidden":"bad"}' }), DEFAULT_COLUMN_PREF)
  const pref = { hidden: ['baseline'], pinnedLeft: ['name'], pinnedRight: ['status'] }
  assert.equal(writeColumnPreference(window.localStorage, pref), true)
  assert.deepEqual(readColumnPreference(window.localStorage), pref)
  assert.equal(storage.get(COLUMN_PREFERENCE_STORAGE_KEY), JSON.stringify(pref))
})

test('sort handles numeric and text rows and follows standard click direction', () => {
  const rows = [{ id: 'z', n: 2 }, { id: '10', n: 10 }, { id: 'a', n: 1 }]
  assert.deepEqual(sortRows(rows, { key: 'n', dir: 1, value: (row) => row.n }).map((row) => row.id), ['a', 'z', '10'])
  assert.deepEqual(sortRows(rows, { key: 'id', dir: 1, value: (row) => row.id }).map((row) => row.id), ['10', 'a', 'z'])
  assert.equal(nextSortDir(null, 'n'), 1)
  assert.equal(nextSortDir('n', 'n', 1), -1)
  assert.equal(nextSortDir('n', 'n', -1), 1)
  assert.equal(nextSortDir('n', 'id', 1), 1)
})

test('multi-row copy emits quoted TSV with headers and escaping', () => {
  const rows = [{ id: 'a', note: 'keep "this"\there' }]
  const text = copyTable(rows, [
    { label: 'Candidate', value: (row) => row.id },
    { label: 'Note', value: (row) => row.note },
  ])
  assert.equal(text, 'Candidate\tNote\na\t"keep ""this""\there"\n')
})
