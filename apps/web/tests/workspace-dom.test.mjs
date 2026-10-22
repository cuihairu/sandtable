// Browser-level assertions for efficiency behaviors that only exist after
// React renders: drag handles, hidden column headers, keyboard focus, and
// clipboard payload delivery.
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

register(new URL('./workspace-dom-loader.mjs', import.meta.url), pathToFileURL('./'))
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
  url: 'https://sandtable.test/',
})
const storage = new Map()
Object.defineProperty(dom.window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  },
})
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true
globalThis.import_meta_env = { DEV: false }
if (!dom.window.HTMLElement.prototype.setPointerCapture) {
  Object.defineProperty(dom.window.HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value() {},
  })
}

const React = await import('react')
const { createElement, act } = React
const { createRoot } = await import('react-dom/client')
for (const key of ['Event', 'KeyboardEvent', 'MouseEvent', 'PointerEvent']) {
  globalThis[key] = dom.window[key]
}
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
})
Object.defineProperty(globalThis.navigator, 'clipboard', {
  configurable: true,
  value: { writeText: async (value) => { globalThis.copied = value } },
})

const { PanelResizer } = await import('../src/workbench/components/PanelResizer.tsx')
const { ColumnMenu } = await import('../src/workbench/table/ColumnMenu.tsx')
const { ParamTable } = await import('../src/workbench/params/ParamTable.tsx')
const { ParamDetail } = await import('../src/workbench/params/ParamDetail.tsx')
const { displayParamName } = await import('../src/workbench/params/paramRegistry.ts')
const { localeSession } = await import('../src/workbench/state/localeStore.ts')

function click(element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

function key(element, keyName) {
  element.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }))
}

function render(element) {
  const root = document.createElement('div')
  document.body.append(root)
  const reactRoot = createRoot(root)
  act(() => {
    reactRoot.render(element)
  })
  if (process.env.WORKSPACE_DOM_DEBUG === '1') console.log('rendered:', root.innerHTML)
  return { reactRoot, root }
}

function show(label, rendered) {
  if (process.env.WORKSPACE_DOM_DEBUG === '1') console.log(label, rendered.root.innerHTML)
}

function unmount({ reactRoot, root }) {
  act(() => {
    reactRoot.unmount()
  })
  root.remove()
}

test('panel resizer reports pointer movement after capture', async () => {
  let size = 220
  const rendered = render(createElement(PanelResizer, {
    orientation: 'vertical', label: 'Explorer',
    onStart: () => size,
    onUpdate: (value) => { size = value },
  }))
  show('initial', rendered)
  const handle = rendered.root.querySelector('button')
  if (process.env.WORKSPACE_DOM_DEBUG === '1') {
    handle.addEventListener('pointerdown', (event) => {
      console.log('native pointerdown', event.button, event.clientX, typeof handle.setPointerCapture)
    })
  }
  assert.equal(handle?.getAttribute('aria-orientation'), 'vertical')
  act(() => {
    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, pointerId: 7, button: 0 }))
    handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 140, pointerId: 7 }))
    handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 140, pointerId: 7 }))
  })
  assert.equal(size, 260)
  unmount(rendered)
})

test('column menu toggles visibility and pinning without reordering source columns', async () => {
  const columns = [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Type' }]
  let pref = { hidden: [], pinnedLeft: [], pinnedRight: [] }
  const rendered = render(createElement(ColumnMenu, {
    columns, locale: 'en', pref,
    onChange: (next) => { pref = next },
    onCopy: () => {},
  }))
  show('initial', rendered)
  click(rendered.root.querySelector('.table-action'))
  show('after click', rendered)
  const checkbox = rendered.root.querySelector('input[type="checkbox"]')
  if (process.env.WORKSPACE_DOM_DEBUG === '1') {
    checkbox.addEventListener('change', () => {
      console.log('native change', checkbox.checked, typeof checkbox.checked)
    })
  }
  act(() => {
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
  if (process.env.WORKSPACE_DOM_DEBUG === '1') console.log('after change', rendered.root.querySelector('.column-menu')?.outerHTML)
  assert.deepEqual(pref.hidden, ['name'])
  click(rendered.root.querySelectorAll('.pin-button')[0])
  assert.deepEqual(pref.pinnedLeft, ['name'])
  unmount(rendered)
})

test('kernel error card jumps to its located parameter row', async () => {
  const row = {
    def: { path: 'model.combat.p_hit', desc: 'hit probability', default: 0.5, kind: 'f64', group: 'combat' },
    baseline: { present: true, text: '0.5', num: 0.5 },
    candidate: { present: true, text: '1.5', num: 1.5 },
    modified: true,
    editable: true,
    group: 'combat',
  }
  const focused = { path: null }
  const table = render(createElement(ParamTable, {
    id: 'parameter-table', rows: [row], columns: [{ key: 'name', label: 'Name' }],
    columnPref: { hidden: [], pinnedLeft: [], pinnedRight: [] },
    sortKey: null, sortDir: 1, selected: new Set(), focusId: null, kernelErrorPath: row.def.path,
    onCommit: () => '', onSelect: () => {}, onSelectAll: () => {}, onSort: () => {},
    onFocusRow: (path) => { focused.path = path }, onAdvancedEdit: () => {}, locale: 'en-US',
  }))
  const inspector = render(createElement(ParamDetail, {
    row, changedCount: 1, savedLabel: 'saved',
    kernelError: { path: row.def.path, message: 'probability must be in [0, 1]' },
    onResetOne: () => {}, onAdvancedEdit: () => {},
    onJumpToError: () => {
      focused.path = row.def.path
      table.root.querySelector(`[data-param-row="${row.def.path}"]`)?.focus()
    },
    locale: 'en-US',
  }))
  const jump = [...inspector.root.querySelectorAll('button')].find((button) => button.textContent?.includes('Go to located parameter'))
  assert.ok(jump)
  click(jump)
  assert.equal(focused.path, row.def.path)
  assert.equal(document.activeElement?.getAttribute('data-param-row'), row.def.path)
  unmount(table)
  unmount(inspector)
})
