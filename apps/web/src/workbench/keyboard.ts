// WB-02.14 · 全局快捷键裁决(纯函数,WorkbenchApp 的 window keydown 只负责触发)。
// 红线:输入框/文本区内不抢占原生编辑快捷键——撤销/重做交还浏览器原生行为;
// Ctrl+S / Ctrl+K 没有原生文本编辑语义,任何焦点位置都由应用接管。
export type GlobalShortcut = 'command-search' | 'save' | 'undo' | 'redo'

/** 只依赖事件的关键字段(target 是 EventTarget,放宽为 unknown 便于节点侧测试)。 */
export type ShortcutKeyEvent = {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  key: string
  target: unknown
}

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** 焦点是否在可编辑区域(原生撤销/重做归属浏览器,不由工作台接管)。 */
export function isEditableTarget(target: unknown): boolean {
  if (target === null || target === undefined || typeof target !== 'object') return false
  const tag = String((target as { tagName?: unknown }).tagName ?? '').toUpperCase()
  if (EDITABLE_TAGS.has(tag)) return true
  return (target as { isContentEditable?: unknown }).isContentEditable === true
}

/** 全局快捷键裁决:无 Ctrl/Cmd 修饰一律不接管;输入区内的撤销/重做交还原生。 */
export function globalShortcutFor(e: ShortcutKeyEvent): GlobalShortcut | null {
  if (!e.ctrlKey && !e.metaKey) return null
  const key = e.key.toLowerCase()
  if (key === 'k') return 'command-search'
  if (key === 's') return 'save'
  if (key === 'z' || key === 'y') {
    if (isEditableTarget(e.target)) return null
    return e.shiftKey || key === 'y' ? 'redo' : 'undo'
  }
  return null
}
