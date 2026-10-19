// WB-02.14 · 全局快捷键裁决(纯函数):Ctrl/Cmd 修饰键才接管,
// 输入框/文本区内撤销与重做交还浏览器原生行为;Ctrl+S / Ctrl+K 无原生文本
// 编辑语义,任何焦点位置都由应用接管。
import test from 'node:test'
import assert from 'node:assert/strict'

const { globalShortcutFor, isEditableTarget } = await import('../src/workbench/keyboard.ts')

const plain = { ctrlKey: true, shiftKey: false, key: 'z', target: null }
const inInput = { ctrlKey: true, shiftKey: false, key: 'z', target: { tagName: 'INPUT' } }
const inContentEditable = {
  ctrlKey: true,
  shiftKey: false,
  key: 'z',
  target: { tagName: 'DIV', isContentEditable: true },
}

test('WB-02.14 无修饰键不接管全局快捷键', () => {
  assert.equal(globalShortcutFor({ ...plain, ctrlKey: false, key: 's' }), null)
  assert.equal(globalShortcutFor({ ...plain, ctrlKey: false, key: 'k' }), null)
  assert.equal(globalShortcutFor({ ...plain, ctrlKey: false, key: 'z' }), null)
})

test('WB-02.14 Ctrl 与 Cmd 都算修饰键', () => {
  assert.equal(globalShortcutFor({ ...plain, ctrlKey: true, key: 's' }), 'save')
  assert.equal(globalShortcutFor({ ctrlKey: false, metaKey: true, shiftKey: false, key: 'z', target: null }), 'undo')
})

test('WB-02.14 非输入焦点:K/S/Z/Shift+Z/Y 全部接管', () => {
  const body = { target: { tagName: 'BODY' } }
  assert.equal(globalShortcutFor({ ctrlKey: true, shiftKey: false, key: 'k', ...body }), 'command-search')
  assert.equal(globalShortcutFor({ ctrlKey: true, shiftKey: false, key: 's', ...body }), 'save')
  assert.equal(globalShortcutFor({ ctrlKey: true, shiftKey: false, key: 'z', ...body }), 'undo')
  assert.equal(globalShortcutFor({ ctrlKey: true, shiftKey: true, key: 'Z', ...body }), 'redo')
  assert.equal(globalShortcutFor({ ctrlKey: true, shiftKey: false, key: 'y', ...body }), 'redo')
  // 未登记的组合不接管(交给浏览器/其他处理器)
  assert.equal(globalShortcutFor({ ctrlKey: true, shiftKey: false, key: 'a', ...body }), null)
  assert.equal(globalShortcutFor({ ctrlKey: true, shiftKey: false, key: 'x', ...body }), null)
})

test('WB-02.14 输入框内不抢占原生撤销与重做', () => {
  assert.equal(globalShortcutFor(inInput), null)
  assert.equal(globalShortcutFor({ ...inInput, shiftKey: true, key: 'Z' }), null)
  assert.equal(globalShortcutFor({ ...inInput, key: 'y' }), null)
  assert.equal(globalShortcutFor(inContentEditable), null)
  assert.equal(isEditableTarget(inInput.target), true)
  assert.equal(isEditableTarget(inContentEditable.target), true)
})

test('WB-02.14 输入框内 Ctrl+S 与 Ctrl+K 仍由应用接管', () => {
  assert.equal(globalShortcutFor({ ...inInput, key: 's' }), 'save')
  assert.equal(globalShortcutFor({ ...inInput, key: 'k' }), 'command-search')
})

test('WB-02.14 目标大小写不敏感,异常目标视为非输入', () => {
  assert.equal(isEditableTarget({ tagName: 'textarea' }), true)
  assert.equal(isEditableTarget({ tagName: 'select' }), true)
  assert.equal(isEditableTarget({ tagName: 'BUTTON' }), false)
  assert.equal(isEditableTarget(null), false)
  assert.equal(isEditableTarget(undefined), false)
  // 非输入焦点(如 document/BODY)撤销仍归应用
  assert.equal(globalShortcutFor({ ...plain, target: { tagName: 'BODY' } }), 'undo')
})
