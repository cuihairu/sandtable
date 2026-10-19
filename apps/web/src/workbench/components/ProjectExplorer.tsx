// WB-02.02 · 项目浏览器:项目根、资源树(模型与配置/实验/结果集/数据交换)、
// 底部口径说明。资源项以稳定 ID 作为身份,当前项由 activeId 决定(非下标)。
import type { JSX } from 'react'
import type { ReactNode } from 'react'
import { WbIcon } from './icons.tsx'
import type { PageId } from '../routing.ts'

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
  footerNote: ReactNode
}

export function ProjectExplorer({
  projectName,
  groups,
  collapsed,
  activeId,
  onToggle,
  onOpen,
  footerNote,
}: ProjectExplorerProps): JSX.Element | null {
  if (collapsed) return null
  return (
    <aside className="explorer" aria-label="项目浏览器">
      <div className="explorer-header">
        <strong>项目浏览器</strong>
        <button className="icon-button" onClick={onToggle} title="收起项目浏览器" aria-label="收起项目浏览器">
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
                onClick={() => onOpen(r)}
              >
                <WbIcon name={r.icon} />
                <span>
                  {r.title}
                  {r.meta !== undefined && <small>{r.meta}</small>}
                </span>
                {r.demoSource === true && <i className="resource-status" title="内置样例数据" />}
                {r.dirty === true && <i className="resource-mark" title="有未保存修改" />}
              </button>
            ))}
          </details>
        ))}
      </div>
      <div className="explorer-bottom">
        <div>
          <span className="status-dot" />
          基线只读
          <span className="mono">DEFAULT</span>
        </div>
        <p>{footerNote}</p>
      </div>
    </aside>
  )
}
