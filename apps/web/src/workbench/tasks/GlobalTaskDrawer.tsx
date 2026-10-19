// WB-02.08 · 全局任务抽屉:常驻主区底部,任意页面可见最近任务。
// 抽屉状态在共享 store;任务数据订阅运行管理器(模块级单例)——
// 这就是"切页不卸载运行管理器"的界面面:抽屉/状态栏/任务页三处
// 读同一份数据源。
// WB-07.13 · 当前任务优先:抽屉与状态栏/任务页用同一个 activeJob 判定,
// 切换工作区后三处显示同一个任务;徽标按任务来源如实标注(真实执行/演示)。
// WB-11.15 · 抽屉文案走词典(tasks.*)。
import { useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import * as runManager from '../state/runManager.ts'
import type { Job } from '../state/jobLogic.ts'
import { statusLabel } from './taskText.ts'
import { activeJob } from '../state/execFsm.ts'
import { TaskProgress, TaskCancelButton } from './TaskList.tsx'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type GlobalTaskDrawerProps = {
  open: boolean
  onToggle: () => void
  onAllJobs: () => void
  onCancel: (id: Job['id']) => void
}

export function GlobalTaskDrawer({ open, onToggle, onAllJobs, onCancel }: GlobalTaskDrawerProps): JSX.Element {
  const locale = useLocale()
  const jobs = useSyncExternalStore(runManager.subscribe, runManager.listJobs)
  // WB-07.13 · 当前任务置顶,其余按最近排序——切页/切工作区后仍显示同一个任务
  const act = activeJob(jobs)
  const rest = jobs.slice().reverse().filter((j) => j.id !== act?.id)
  const recent = act !== null ? [act, ...rest].slice(0, 2) : rest.slice(0, 2)
  const hasReal = jobs.some((j) => !j.demo)
  return (
    <section className="task-drawer" hidden={!open} aria-label={t(locale, 'tasks.drawerAria')}>
      <div className="drawer-heading">
        <strong>
          <WbIcon name="terminal" />
          {t(locale, 'tasks.queueTitle')}
          <span className="badge amber">{hasReal ? t(locale, 'tasks.drawerReal') : t(locale, 'tasks.drawerDemo')}</span>
        </strong>
        <div className="actions">
          <button className="btn subtle" onClick={onAllJobs}>
            {t(locale, 'tasks.allJobs')}
          </button>
          <button className="icon-button" onClick={onToggle} aria-label={t(locale, 'tasks.drawerCollapse')}>
            <WbIcon name="cross" />
          </button>
        </div>
      </div>
      {recent.length > 0 ? (
        recent.map((job) => (
          <div className="task-item" key={job.id}>
            <div>
              <strong>{job.name}</strong>
              <small>
                {statusLabel(job.status, locale)} · {job.demo ? t(locale, 'tasks.drawerDemoLine') : t(locale, 'tasks.drawerRealLine')}
              </small>
            </div>
            <TaskProgress job={job} compact />
            <TaskCancelButton job={job} onCancel={onCancel} compact />
          </div>
        ))
      ) : (
        <div className="empty-state" style={{ padding: 22 }}>
          {t(locale, 'tasks.drawerEmpty')}
        </div>
      )}
    </section>
  )
}
