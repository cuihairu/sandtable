// WB-02.02 · 应用栏:项目标识、命令搜索入口、数据来源标注。
// 纯展示 + 回调 props,便于独立接数据。
// WB-04.01 · YAML 与 .sandtable 文件选择迁入应用栏项目入口(打开/保存);
// 取消选择不产生错误(选择器关闭即无事发生,见 projectDoc.readPickedFile)。
import type { JSX, MouseEventHandler } from 'react'
import { WbIcon } from './icons.tsx'
import { LanguageSwitcher } from './LanguageSwitcher.tsx'

export type AppBarProps = {
  projectName: string
  projectId: string
  onCommandSearch: () => void
  onAbout: () => void
  onProjectInfo: MouseEventHandler<HTMLButtonElement>
  demoMode: boolean
  /** WB-04.01 · 打开项目文件(.sandtable / YAML);缺省不渲染入口 */
  onOpenProject?: () => void
  /** WB-04.10 · 保存项目(仅真实项目提供;null 时不渲染按钮) */
  onSaveProject?: (() => void) | null
  /** 保存按钮提示(状态可见:未保存修改 / 与项目文件一致) */
  saveLabel?: string
  /** 项目标识副标签(内置样例 / 项目文件) */
  sourceLabel?: string
}

export function AppBar({
  projectName,
  projectId,
  onCommandSearch,
  onAbout,
  onProjectInfo,
  demoMode,
  onOpenProject,
  onSaveProject,
  saveLabel,
  sourceLabel,
}: AppBarProps): JSX.Element {
  return (
    <header className="application-bar">
      <a className="wordmark" href="#/workbench/analysis" aria-label="Sandtable 结果分析">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="m3 7 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 17l9 5 9-5" stroke="currentColor" strokeWidth={1.6} />
        </svg>
        <strong>SANDTABLE</strong>
        <span>数值实验工作台</span>
      </a>
      <button className="project-switch" onClick={onProjectInfo} title={`项目 ${projectId}`}>
        <span className="project-dot" />
        {projectName}
        <span className="key-label">{sourceLabel ?? (demoMode ? '内置样例' : '项目文件')}</span>
      </button>
      {onOpenProject && (
        <button className="command-trigger" onClick={onOpenProject} title="打开 .sandtable 项目文件或 YAML 配置">
          <WbIcon name="folder-open" />
          <span>打开项目…</span>
        </button>
      )}
      {onOpenProject && onSaveProject && (
        <button className="command-trigger" onClick={onSaveProject} title={saveLabel ?? '保存项目(.sandtable)'}>
          <WbIcon name="save" />
          <span>保存项目</span>
        </button>
      )}
      <button className="command-trigger" onClick={onCommandSearch} aria-keyshortcuts="Control+k">
        <WbIcon name="search" />
        <span>查找参数、命令…</span>
        <kbd>Ctrl K</kbd>
      </button>
      {/* WB-11.05 · 语言切换入口(自包含:直连 locale 会话,不经 props) */}
      <LanguageSwitcher />
      {demoMode && (
        <button className="prototype-label" onClick={onAbout}>
          <span className="status-dot amber" />
          演示数据 · 未接内核
          <WbIcon name="info" />
        </button>
      )}
    </header>
  )
}

