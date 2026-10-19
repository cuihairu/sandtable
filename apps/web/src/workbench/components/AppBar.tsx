// WB-02.02 · 应用栏:项目标识、命令搜索入口、数据来源标注。
// 纯展示 + 回调 props,便于独立接数据(项目浏览器尚未接真实项目文件,
// 当前固定挂演示项目,标注"内置样例")。
import type { JSX, MouseEventHandler } from 'react'
import { WbIcon } from './icons.tsx'
import { DEMO_PROJECT_ID } from '../demo/sampleProject.ts'

export type AppBarProps = {
  projectName: string
  projectId: string
  onCommandSearch: () => void
  onAbout: () => void
  onProjectInfo: MouseEventHandler<HTMLButtonElement>
  demoMode: boolean
}

export function AppBar({
  projectName,
  projectId,
  onCommandSearch,
  onAbout,
  onProjectInfo,
  demoMode,
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
        <span className="key-label">内置样例</span>
      </button>
      <button className="command-trigger" onClick={onCommandSearch} aria-keyshortcuts="Control+k">
        <WbIcon name="search" />
        <span>查找参数、命令…</span>
        <kbd>Ctrl K</kbd>
      </button>
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

export { DEMO_PROJECT_ID }
