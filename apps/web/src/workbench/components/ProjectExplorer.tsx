// WB-02.02 · 项目浏览器:项目根、资源树(模型与配置/实验/结果集/数据交换)、
// 底部口径说明。资源项以稳定 ID 作为身份,当前项由 activeId 决定(非下标)。
// WB-11.11 · 自身文案走词典;资源标题/分组名是数据侧文案,由调用方翻译。
import type { JSX } from 'react'
import type { ReactNode } from 'react'
import { WbIcon } from './icons.tsx'
import type { PageId } from '../routing.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import { PanelResizer } from './PanelResizer.tsx'

export type ExplorerResource = {
  id: string
  page: PageId
  icon: string
  title: string
  meta?: string
  /** 结果集数据来源标注(内置样例 = 演示数据点) */
  demoSource?: boolean
  /** 有未保存草稿的小标记 */
  dirty?: boolean
}

export type ExplorerGroup = {
  id: string
  title: string
  resources: readonly ExplorerResource[]
  open?: boolean
}

export type ProjectExplorerProps = {
  projectName: string
  groups: readonly ExplorerGroup[]
  collapsed: boolean
  activeId: string | null
  onToggle: () => void
  onOpen: (resource: ExplorerResource) => void
  /** 拖拽浏览器面板宽度;几何状态由壳层持有 */
  onResize?: (width: number) => void
  width?: number
  /** 忙文档不允许丢草稿切换;壳层把目标页压入待确认。 */
  isBlocked?: (page: PageId) => boolean
  footerNote: ReactNode
}

export function ProjectExplorer({
  projectName,
  groups,
  collapsed,
  activeId,
  onToggle,
  onOpen,
  isBlocked,
  onResize,
  width,
  footerNote,
}: ProjectExplorerProps): JSX.Element | null {
  const locale = useLocale()
  if (collapsed) return null
  return (
    <aside className="explorer" aria-label={t(locale, 'common.explorer')} style={width === undefined ? undefined : { width }}>
      <div className="explorer-header">
        <strong>{t(locale, 'common.explorer')}</strong>
        <button className="icon-button" onClick={onToggle} title={t(locale, 'common.collapseExplorer')} aria-label={t(locale, 'common.collapseExplorer')}>
          <WbIcon name="panel-left" />
        </button>
      </div>
      <div className="project-root">
        <WbIcon name="folder-open" />
        <div>
          <strong>{projectName}</strong>
          <small>DEFAULT SCENARIO</small>
        </div>
      </div>
      <div className="explorer-scroll">
        {groups.map((group) => (
          <details key={group.id} open={group.open}>
            <summary>
              {group.title}
              <span className="count">{group.resources.length}</span>
            </summary>
            {group.resources.map((r) => (
              <button
                key={r.id}
                className={`resource${activeId === r.id ? ' selected' : ''}`}
                onClick={() => {
                  if (isBlocked?.(r.page) !== true) onOpen(r)
                }}
                aria-disabled={isBlocked?.(r.page) === true}
              >
                <WbIcon name={r.icon} />
                <span>
                  {r.title}
                  {r.meta !== undefined && <small>{r.meta}</small>}
                </span>
                {r.demoSource === true && <i className="resource-status" title={t(locale, 'common.demoData')} />}
                {r.dirty === true && <i className="resource-mark" title={t(locale, 'common.unsavedChanges')} />}
              </button>
            ))}
          </details>
        ))}
      </div>
      <div className="explorer-bottom">
        <div>
          <span className="status-dot" />
          {t(locale, 'common.baselineReadonly')}
          <span className="mono">DEFAULT</span>
        </div>
        <p>{footerNote}</p>
      </div>
      {onResize && (
        <PanelResizer
          orientation="vertical"
          label={t(locale, 'common.collapseExplorer')}
          onStart={() => width ?? 220}
          onUpdate={onResize}
        />
      )}
    </aside>
  )
}
