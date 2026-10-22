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
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type StatusBarProps = {
  onToggleExplorer: () => void
  onToggleTasks: () => void
  onShortcuts: () => void
  onResetLayout: () => void
  draftSavedLabel: string
  draftSaved: boolean
}

export function StatusBar({
  onToggleExplorer,
  onToggleTasks,
  onShortcuts,
  onResetLayout,
  draftSavedLabel,
  draftSaved,
}: StatusBarProps): JSX.Element {
  const locale = useLocale()
  const jobs = useSyncExternalStore(runManager.subscribe, runManager.listJobs)
  const active = jobLogic.runningCount(jobs)
  const act = activeJob(jobs) // WB-07.13 · 与任务页/抽屉同一当前任务判定
  return (
    <footer className="statusbar">
      <button onClick={onToggleExplorer}>
        <WbIcon name="panel-left" />
        {t(locale, 'common.project')}
      </button>
      <span className="status-separator" />
      <span>
        <span className={draftSaved ? 'status-dot' : 'status-dot amber'} />
        {draftSavedLabel}
      </span>
      <span className="status-spacer" />
      {act !== null && (
        <span className="mono" title={t(locale, 'common.activeTaskTitle')}>
          {act.name}: {act.done}/{act.total}
        </span>
      )}
      <button onClick={onToggleTasks} aria-expanded="false">
        <WbIcon name="terminal" />
        {active > 0 ? t(locale, 'common.tasksRunning') : t(locale, 'common.taskQueue')}
        <span className="task-count">{active || jobs.length}</span>
      </button>
      <span className="status-separator" />
      <span>{DATA_SOURCE === 'synthetic_demo' ? t(locale, 'common.dataSourceDemo') : t(locale, 'common.dataSourceReal')}</span>
      <button onClick={onShortcuts} aria-label={t(locale, 'common.viewShortcuts')}>
        <kbd>?</kbd>
      </button>
      <button onClick={onResetLayout} title={t(locale, 'common.collapseExplorer')}>
        <kbd>⤢</kbd>
      </button>
    </footer>
  )
}
