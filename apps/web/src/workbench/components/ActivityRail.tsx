// WB-02.02 · 功能轨(活动栏):五个工作区的导航,当前项高亮 + aria-current。
// WB-11.11 · 工作区名称/短标签走词典(nav.*),不再读 routing.ts 的中文常量。
import type { JSX, KeyboardEvent } from 'react'
import { WbIcon } from './icons.tsx'
import { PAGES } from '../routing.ts'
import type { PageId } from '../routing.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

/** 页面 ID → 词典 key(字面量键面,保住 t() 的 key 类型检查)。 */
const NAV_LABEL: Record<PageId, 'nav.analysis' | 'nav.parameters' | 'nav.designer' | 'nav.runs' | 'nav.exchange'> = {
  analysis: 'nav.analysis',
  parameters: 'nav.parameters',
  designer: 'nav.designer',
  runs: 'nav.runs',
  exchange: 'nav.exchange',
}
const NAV_SHORT: Record<PageId, 'nav.short.analysis' | 'nav.short.parameters' | 'nav.short.designer' | 'nav.short.runs' | 'nav.short.exchange'> = {
  analysis: 'nav.short.analysis',
  parameters: 'nav.short.parameters',
  designer: 'nav.short.designer',
  runs: 'nav.short.runs',
  exchange: 'nav.short.exchange',
}

export type ActivityRailProps = {
  page: PageId
  onNavigate: (page: PageId) => void
  onShortcuts: () => void
  /** 忙文档不允许丢草稿切换;壳层把目标页压入待确认。 */
  isBlocked?: (page: PageId) => boolean
}

export function ActivityRail({ page, onNavigate, onShortcuts, isBlocked }: ActivityRailProps): JSX.Element {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // 纵向 roving focus:↑/↓ 移动,Enter 原生激活
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.rail-button[data-page]'))
    const index = buttons.findIndex((b) => b.getAttribute('data-page') === page)
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (delta !== 0 && buttons.length > 0) {
      event.preventDefault()
      buttons[(index + delta + buttons.length) % buttons.length]?.focus()
    }
  }
  const locale = useLocale()
  return (
    <nav className="activity-rail" aria-label={t(locale, 'nav.workspaces')} onKeyDown={onKeyDown}>
      {PAGES.map((p) => (
        <button
          key={p.id}
          className={`rail-button${p.id === page ? ' active' : ''}`}
          data-page={p.id}
          title={t(locale, NAV_LABEL[p.id])}
          aria-label={t(locale, NAV_LABEL[p.id])}
          aria-current={p.id === page ? 'page' : undefined}
          onClick={() => {
            if (isBlocked?.(p.id) !== true) onNavigate(p.id)
          }}
          aria-disabled={isBlocked?.(p.id) === true}
        >
          <WbIcon name={p.icon} />
          <span>{t(locale, NAV_SHORT[p.id])}</span>
        </button>
      ))}
      <button
        className="rail-button rail-bottom"
        onClick={onShortcuts}
        title={t(locale, 'nav.shortcuts')}
        aria-label={t(locale, 'nav.shortcuts')}
      >
        <WbIcon name="settings" />
      </button>
    </nav>
  )
}
