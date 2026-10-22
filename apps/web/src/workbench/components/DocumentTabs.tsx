// WB-02.03 · 文档标签:标签记录对象 ID、标题、未保存状态与当前激活项。
// - 身份:OpenDocument.id 是稳定对象 ID(候选草稿=内容寻址 ID,结果=run ID),
//   绝不用数组下标;active 由 page 推导;
// - 未保存:unsaved 的文档出琥珀点(与项目浏览器 dirty 标记同源);
// - 键盘:←/→/Home/End roving focus,Enter 激活(基础键盘路径,WB-02.14
//   再做完整快捷键迁移)。
// WB-11.11 · 标签标题走词典 nav.tab.<page>(文档身份/未保存点不变);
// tablist 定位钩子从中文 aria-label 解耦为 data-doc-tabs 属性(aria 随语言变,
// 选择器不能跟着变)。
import { useEffect } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { WbIcon } from './icons.tsx'
import type { OpenDocument } from '../state/workbenchStore.ts'
import type { PageId } from '../routing.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

const NAV_TAB: Record<PageId, 'nav.tab.analysis' | 'nav.tab.parameters' | 'nav.tab.designer' | 'nav.tab.runs' | 'nav.tab.exchange'> = {
  analysis: 'nav.tab.analysis',
  parameters: 'nav.tab.parameters',
  designer: 'nav.tab.designer',
  runs: 'nav.tab.runs',
  exchange: 'nav.tab.exchange',
}

export type DocumentTabsProps = {
  documents: readonly OpenDocument[]
  activePage: string
  onActivate: (page: OpenDocument['page']) => void
  /** 忙文档不允许丢草稿切换;壳层把目标页压入待确认。 */
  isBlocked?: (page: OpenDocument['page']) => boolean
}

export function DocumentTabs({ documents, activePage, onActivate, isBlocked }: DocumentTabsProps): JSX.Element {
  const locale = useLocale()
  const activeDoc = documents.find((d) => d.page === activePage) ?? documents[0]

  // roving tabindex:激活标签接收 Tab 序列,方向键在标签间移动
  useEffect(() => {
    const tablist = document.querySelector('[role="tablist"][data-doc-tabs]')
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
    if (target && isBlocked?.(target.page) !== true) onActivate(target.page)
  }

  return (
    <div className="document-tabs" role="tablist" data-doc-tabs aria-label={t(locale, 'common.openDocuments')} onKeyDown={onKeyDown}>
      {documents.map((doc) => {
        const active = doc.id === activeDoc?.id
        const title = t(locale, NAV_TAB[doc.page])
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
            title={`${title}${doc.unsaved ? ` · ${t(locale, 'common.unsaved')}` : ''}`}
            onClick={() => {
              if (isBlocked?.(doc.page) !== true) onActivate(doc.page)
            }}
            aria-disabled={isBlocked?.(doc.page) === true}
          >
            <WbIcon name={doc.icon} />
            {title}
            {doc.unsaved && <span className="document-dot" aria-label={t(locale, 'common.unsaved')} />}
          </button>
        )
      })}
    </div>
  )
}
