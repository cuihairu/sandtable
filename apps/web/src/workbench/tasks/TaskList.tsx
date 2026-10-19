// WB-02.08 · 任务进度条 + 任务列表 + 取消操作。
// 取消语义:按钮文案区分"取消中"(请求已发出)与可再次取消;
// 任务身份 = Job 稳定 ID,列表顺序不代表身份。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import type { Job } from '../state/jobLogic.ts'
import { STATUS_LABEL, isTerminal } from '../state/jobLogic.ts'

export function TaskProgress({ job, compact = false }: { job: Job; compact?: boolean }): JSX.Element {
  const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0
  return (
    <>
      <div
        className="task-progress"
        role="progressbar"
        aria-label={`${job.name}进度`}
        aria-valuenow={job.done}
        aria-valuemin={0}
        aria-valuemax={job.total}
        style={compact ? undefined : { flex: 1, maxWidth: 360 }}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="mono">
        {job.done} / {job.total}
      </span>
    </>
  )
}

export type TaskCancelProps = {
  job: Job
  onCancel: (id: Job['id']) => void
  compact?: boolean
}

export function TaskCancelButton({ job, onCancel, compact = false }: TaskCancelProps): JSX.Element | null {
  if (isTerminal(job.status)) return null
  return (
    <button
      className="btn"
      style={compact ? { minHeight: 26, fontSize: 10 } : undefined}
      onClick={() => onCancel(job.id)}
      disabled={job.status === 'cancelling'}
      title={job.status === 'cancelling' ? '取消请求已发出,等待边界落地' : `取消${STATUS_LABEL[job.status]}任务`}
    >
      <WbIcon name="cross" />
      {job.status === 'cancelling' ? '取消中…' : '取消'}
    </button>
  )
}

export type TaskListProps = {
  jobs: readonly Job[]
  onCancel: (id: Job['id']) => void
  emptyAction?: JSX.Element
}

export function TaskList({ jobs, onCancel, emptyAction }: TaskListProps): JSX.Element {
  if (jobs.length === 0) {
    return (
      <div className="empty-state">
        <WbIcon name="terminal" />
        当前没有任务
        <br />
        {emptyAction}
      </div>
    )
  }
  return (
    <>
      {jobs
        .slice()
        .reverse()
        .map((job) => (
          <article className="job" key={job.id}>
            <div className="job-title">
              <WbIcon name={job.status === 'running' ? 'clock' : 'terminal'} />
              <strong>{job.name}</strong>
              <span className={`badge ${job.status === 'running' || job.status === 'queued' ? 'teal' : 'amber'}`}>
                {STATUS_LABEL[job.status]}
                {job.demo ? ' · 演示' : ''}
              </span>
              <div className="actions">
                <TaskCancelButton job={job} onCancel={onCancel} />
              </div>
            </div>
            <div className="job-body">
              <TaskProgress job={job} />
              <span className="muted" style={{ fontSize: 11 }}>
                {`${job.method} · 演示任务 · 不执行内核`}
              </span>
            </div>
            <div className="job-footer">
              {job.status === 'succeeded'
                ? '进度演示结束;未执行仿真,未生成新的结果产物。'
                : job.status === 'cancelled'
                  ? `已在边界停止(保留 ${job.done}/${job.total} 演示进度)。可返回实验设计器调整后重新加入队列。`
                  : job.status === 'cancelling'
                    ? '取消请求已发出,正在等待边界落地。'
                    : '演示任务正在模拟任务进度,可切页或取消;切页不打断本队列。'}
            </div>
          </article>
        ))}
    </>
  )
}
