// WB-02.02 · 功能轨(活动栏):五个工作区的导航,当前项高亮 + aria-current。
import type { JSX, KeyboardEvent } from 'react'
import { WbIcon } from './icons.tsx'
import { PAGES } from '../routing.ts'
import type { PageId } from '../routing.ts'

export type ActivityRailProps = {
  page: PageId
  onNavigate: (page: PageId) => void
  onShortcuts: () => void
}

export function ActivityRail({ page, onNavigate, onShortcuts }: ActivityRailProps): JSX.Element {
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
  return (
    <nav className="activity-rail" aria-label="功能工作区" onKeyDown={onKeyDown}>
      {PAGES.map((p) => (
        <button
          key={p.id}
          className={`rail-button${p.id === page ? ' active' : ''}`}
          data-page={p.id}
          title={p.label}
          aria-label={p.label}
          aria-current={p.id === page ? 'page' : undefined}
          onClick={() => onNavigate(p.id)}
        >
          <WbIcon name={p.icon} />
          <span>{p.short}</span>
        </button>
      ))}
      <button
        className="rail-button rail-bottom"
        onClick={onShortcuts}
        title="快捷键"
        aria-label="快捷键"
      >
        <WbIcon name="settings" />
      </button>
    </nav>
  )
}
