// WB-02.02 · 工作区容器:承载五个页面容器的公共骨架
// (标题区 + 可选工具栏 + 页面主体),以 tablist/tabpanel 关联文档标签。
// 页面切换即替换子组件;运行管理器等跨页状态不在这里(在模块级 store/管理器)。
import { useEffect, useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type WorkspaceHeadingProps = {
  title: string
  crumb: string
  badge?: { text: string; tone?: 'teal' | 'amber' | 'red' | 'default' }
  actions?: JSX.Element
}

export function WorkspaceHeading({ title, crumb, badge, actions }: WorkspaceHeadingProps): JSX.Element {
  return (
    <header className="workspace-heading">
      <div>
        <div className="breadcrumb">
          RPG 平衡实验室<span>/</span>
          {crumb}
        </div>
        <h1>
          {title}
          {badge && <span className={`badge${badge.tone && badge.tone !== 'default' ? ` ${badge.tone}` : ''}`}>{badge.text}</span>}
        </h1>
      </div>
      <div className="actions">{actions}</div>
    </header>
  )
}

export type WorkspaceContainerProps = {
  /** 文档标签 id(aria-controls 关联),如 `tab-analysis` */
  labelledBy: string
  /** 切页时聚焦工作区容器,读屏/键盘路径清晰 */
  focusKey: string
  children: ReactNode
}

export function WorkspaceContainer({ labelledBy, focusKey, children }: WorkspaceContainerProps): JSX.Element {
  const locale = useLocale()
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [focusKey])
  return (
    <section
      ref={ref}
      className="workspace"
      role="tabpanel"
      id="workspace"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      aria-label={t(locale, 'nav.workspace')}
    >
      {children}
    </section>
  )
}
