// WB-02.08 · 全局任务抽屉:常驻主区底部,任意页面可见最近任务。
// 抽屉状态在共享 store;任务数据订阅运行管理器(模块级单例)——
// 这就是"切页不卸载运行管理器"的界面面:抽屉/状态栏/任务页三处
// 读同一份数据源。
// WB-07.13 · 当前任务优先:抽屉与状态栏/任务页用同一个 activeJob 判定,
// 切换工作区后三处显示同一个任务;徽标按任务来源如实标注(真实执行/演示)。
import { useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import * as runManager from '../state/runManager.ts'
import type { Job } from '../state/jobLogic.ts'
import { STATUS_LABEL } from '../state/jobLogic.ts'
import { activeJob } from '../state/execFsm.ts'
import { TaskProgress, TaskCancelButton } from './TaskList.tsx'

export type GlobalTaskDrawerProps = {
  open: boolean
  onToggle: () => void
  onAllJobs: () => void
  onCancel: (id: Job['id']) => void
}

export function GlobalTaskDrawer({ open, onToggle, onAllJobs, onCancel }: GlobalTaskDrawerProps): JSX.Element {
  const jobs = useSyncExternalStore(runManager.subscribe, runManager.listJobs)
  // WB-07.13 · 当前任务置顶,其余按最近排序——切页/切工作区后仍显示同一个任务
  const act = activeJob(jobs)
  const rest = jobs.slice().reverse().filter((j) => j.id !== act?.id)
  const recent = act !== null ? [act, ...rest].slice(0, 2) : rest.slice(0, 2)
  const hasReal = jobs.some((j) => !j.demo)
  return (
    <section className="task-drawer" hidden={!open} aria-label="后台任务">
      <div className="drawer-heading">
        <strong>
          <WbIcon name="terminal" />
          任务队列
          <span className="badge amber">{hasReal ? '真实执行' : '演示模式'}</span>
        </strong>
        <div className="actions">
          <button className="btn subtle" onClick={onAllJobs}>
            全部任务
          </button>
          <button className="icon-button" onClick={onToggle} aria-label="收起任务队列">
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
                {STATUS_LABEL[job.status]} · {job.demo ? '演示任务 · 不执行内核' : '真实执行'}
              </small>
            </div>
            <TaskProgress job={job} compact />
            <TaskCancelButton job={job} onCancel={onCancel} compact />
          </div>
        ))
      ) : (
        <div className="empty-state" style={{ padding: 22 }}>
          暂无任务。在实验设计器配置后提交。
        </div>
      )}
    </section>
  )
}
