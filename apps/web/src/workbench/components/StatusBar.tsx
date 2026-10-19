// WB-02.02 · 状态栏:项目开关、草稿保存状态、任务入口(订阅运行管理器)、
// 数据来源标注与快捷键入口。与原型一致的信息密度,但状态来自订阅而非 DOM。
// WB-07.13 · 与任务页/抽屉共用 activeJob 判定:当前工作区切换后状态栏
// 显示的仍是同一个活动任务的名称与真实进度。
import { useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { WbIcon } from './icons.tsx'
import * as runManager from '../state/runManager.ts'
import * as jobLogic from '../state/jobLogic.ts'
import { activeJob } from '../state/execFsm.ts'
import { DATA_SOURCE } from '../demo/sampleProject.ts'

export type StatusBarProps = {
  onToggleExplorer: () => void
  onToggleTasks: () => void
  onShortcuts: () => void
  draftSavedLabel: string
  draftSaved: boolean
}

export function StatusBar({
  onToggleExplorer,
  onToggleTasks,
  onShortcuts,
  draftSavedLabel,
  draftSaved,
}: StatusBarProps): JSX.Element {
  const jobs = useSyncExternalStore(runManager.subscribe, runManager.listJobs)
  const active = jobLogic.runningCount(jobs)
  const act = activeJob(jobs) // WB-07.13 · 与任务页/抽屉同一当前任务判定
  return (
    <footer className="statusbar">
      <button onClick={onToggleExplorer}>
        <WbIcon name="panel-left" />
        项目
      </button>
      <span className="status-separator" />
      <span>
        <span className={draftSaved ? 'status-dot' : 'status-dot amber'} />
        {draftSavedLabel}
      </span>
      <span className="status-spacer" />
      {act !== null && (
        <span className="mono" title="当前活动任务(与任务页/抽屉同源)">
          {act.name}: {act.done}/{act.total}
        </span>
      )}
      <button onClick={onToggleTasks} aria-expanded="false">
        <WbIcon name="terminal" />
        {active > 0 ? '任务运行中' : '任务队列'}
        <span className="task-count">{active || jobs.length}</span>
      </button>
      <span className="status-separator" />
      <span>数据:{DATA_SOURCE === 'synthetic_demo' ? '内置演示结果' : '真实运行'}</span>
      <button onClick={onShortcuts} aria-label="查看键盘快捷键">
        <kbd>?</kbd>
      </button>
    </footer>
  )
}
