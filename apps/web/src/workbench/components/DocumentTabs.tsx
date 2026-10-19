// WB-02.03 · 文档标签:标签记录对象 ID、标题、未保存状态与当前激活项。
// - 身份:OpenDocument.id 是稳定对象 ID(候选草稿=内容寻址 ID,结果=run ID),
//   绝不用数组下标;active 由 page 推导;
// - 未保存:unsaved 的文档出琥珀点(与项目浏览器 dirty 标记同源);
// - 键盘:←/→/Home/End roving focus,Enter 激活(基础键盘路径,WB-02.14
//   再做完整快捷键迁移)。
import { useEffect } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { WbIcon } from './icons.tsx'
import type { OpenDocument } from '../state/workbenchStore.ts'

export type DocumentTabsProps = {
  documents: readonly OpenDocument[]
  activePage: string
  onActivate: (page: OpenDocument['page']) => void
}

export function DocumentTabs({ documents, activePage, onActivate }: DocumentTabsProps): JSX.Element {
  const activeDoc = documents.find((d) => d.page === activePage) ?? documents[0]

  // roving tabindex:激活标签接收 Tab 序列,方向键在标签间移动
  useEffect(() => {
    const tablist = document.querySelector('[role="tablist"][aria-label="打开的文档"]')
    tablist?.querySelector<HTMLElement>(`[data-doc-page="${activePage}"]`)?.focus({ preventScroll: true })
  }, [activePage])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'] as const
    if (!keys.includes(event.key as (typeof keys)[number])) return
    event.preventDefault()
    const index = documents.findIndex((d) => d.page === activePage)
    const last = documents.length - 1
    const next = event.key === 'ArrowLeft'
      ? (index - 1 + documents.length) % documents.length
      : event.key === 'ArrowRight'
        ? (index + 1) % documents.length
        : event.key === 'Home' ? 0 : last
    const target = documents[next]
    if (target) onActivate(target.page)
  }

  return (
    <div className="document-tabs" role="tablist" aria-label="打开的文档" onKeyDown={onKeyDown}>
      {documents.map((doc) => {
        const active = doc.id === activeDoc?.id
        return (
          <button
            key={doc.id}
            role="tab"
            id={`tab-${doc.page}`}
            className={`document-tab${active ? ' active' : ''}`}
            data-doc-page={doc.page}
            aria-selected={active}
            aria-controls="workspace"
            tabIndex={active ? 0 : -1}
            title={`${doc.title}${doc.unsaved ? ' · 未保存' : ''}`}
            onClick={() => onActivate(doc.page)}
          >
            <WbIcon name={doc.icon} />
            {doc.title}
            {doc.unsaved && <span className="document-dot" aria-label="未保存" />}
          </button>
        )
      })}
    </div>
  )
}
