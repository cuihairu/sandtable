// WB-02.08 · 任务进度条 + 任务列表 + 取消操作。
// 取消语义:按钮文案区分"取消中"(请求已发出)与可再次取消;
// 任务身份 = Job 稳定 ID,列表顺序不代表身份。
// WB-07.14 · 真实任务的来源与错误分类展示:进度口径(progressKind)、
// 部分结果徽标、取消/运行/初始化/预算/桥接错误的差异化文案与恢复动作;
// 演示任务维持原样并明确标注(不把演示画成执行能力)。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import type { Job } from '../state/jobLogic.ts'
import { STATUS_LABEL, isTerminal } from '../state/jobLogic.ts'
import { ERROR_CLASS_LABEL, recoveryFor, terminalOutcome } from '../state/execFsm.ts'

/** 进度口径说明(WB-07.04/05:来源如实,不冒充真实进度)。 */
function progressKindLabel(job: Job): string {
  const ex = job.exec
  if (!ex) return ''
  if (ex.progressKind === 'replicates') return '桌面执行 · 逐 replicate 内核进度'
  if (ex.progressKind === 'candidates') return `扫描 · 候选边界进度(${ex.candidatesDone}/${ex.candidatesTotal} 候选 × ${ex.replicates} replicates)`
  return '执行中 · 此执行端无逐 replicate 进度面(如实显示,不推算)'
}

/** WB-07.14 · 终态/错误文案:取消(边界语义)、运行错误、初始化错误、预算、桥接分类展示。 */
function execFooter(job: Job): JSX.Element {
  const ex = job.exec!
  const outcome = terminalOutcome(job)
  const kept = ex.results.length
  const errorCount = ex.results.filter((r) => r.status !== 'ok').length
  if (job.status === 'succeeded') {
    return (
      <>
        真实执行完成:保留 {kept} 候选结果{errorCount > 0 ? `(含 ${errorCount} 个单候选配置错误,留在结果集)` : ''}。
        {ex.recommendationError !== null
          ? ` 推荐未生成:${ex.recommendationError}`
          : ex.recommendation !== null ? ' 已生成完整推荐(基于全部候选)。' : ''}
      </>
    )
  }
  if (job.status === 'cancelled') {
    const where = ex.progressKind === 'candidates'
      ? `候选边界(已完成 ${ex.candidatesDone}/${ex.candidatesTotal} 候选)`
      : `执行边界(完成 ${job.done}/${job.total})`
    return (
      <>
        已在{where}真正停止(取消请求 → 边界落地);保留已完成产物
        {outcome === 'partial' ? ',不对不完整数据生成完整推荐。' : '。'} 调整后可重新提交。
      </>
    )
  }
  // failed:按错误类分类展示 + 恢复动作
  const cls = ex.errorClass ?? 'run'
  return (
    <>
      <span style={{ color: 'var(--danger, #b42318)' }}>{ERROR_CLASS_LABEL[cls]}</span>:{ex.errorMessage ?? '未知错误'}
      <br />
      恢复:{recoveryFor(ex.errorClass, ex.kind)}
    </>
  )
}

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
      title={
        job.status === 'cancelling'
          ? '取消请求已发出;再次点击将升级为终止执行端(浏览器 Worker;桌面 replicate 边界已生效)'
          : '请求取消:在执行边界(replicate / 候选)停止'
      }
      onClick={() => onCancel(job.id)}
    >
      <WbIcon name="cross" />
      {job.status === 'cancelling' ? '取消中…(再点 = 终止)' : '取消'}
    </button>
  )
}

export type TaskListProps = {
  jobs: readonly Job[]
  onCancel: (id: Job['id']) => void
  onRetry?: (id: Job['id']) => void
  emptyAction?: JSX.Element
}

export function TaskList({ jobs, onCancel, onRetry, emptyAction }: TaskListProps): JSX.Element {
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
        .map((job) => {
          const ex = job.exec
          const outcome = terminalOutcome(job)
          return (
            <article className="job" key={job.id}>
              <div className="job-title">
                <WbIcon name={job.status === 'running' ? 'clock' : 'terminal'} />
                <strong>{job.name}</strong>
                <span className={`badge ${job.status === 'running' || job.status === 'queued' ? 'teal' : 'amber'}`}>
                  {STATUS_LABEL[job.status]}
                  {job.demo ? ' · 演示' : ' · 真实执行'}
                </span>
                {outcome === 'partial' && <span className="badge amber">含部分结果</span>}
                <div className="actions">
                  <TaskCancelButton job={job} onCancel={onCancel} />
                  {onRetry && job.status === 'failed' && ex !== undefined && (
                    <button className="btn" style={{ minHeight: 26, fontSize: 10 }} onClick={() => onRetry(job.id)}>
                      <WbIcon name="reset" />
                      重试
                    </button>
                  )}
                </div>
              </div>
              <div className="job-body">
                <TaskProgress job={job} />
                <span className="muted" style={{ fontSize: 11 }}>
                  {job.demo
                    ? `${job.method} · 演示任务 · 不执行内核`
                    : `${job.method} · ${progressKindLabel(job)}`}
                </span>
              </div>
              <div className="job-footer">
                {job.demo
                  ? job.status === 'succeeded'
                    ? '进度演示结束;未执行仿真,未生成新的结果产物。'
                    : job.status === 'cancelled'
                      ? `已在边界停止(保留 ${job.done}/${job.total} 演示进度)。可返回实验设计器调整后重新加入队列。`
                      : job.status === 'cancelling'
                        ? '取消请求已发出,正在等待边界落地。'
                        : '演示任务正在模拟任务进度,可切页或取消;切页不打断本队列。'
                  : execFooter(job)}
              </div>
            </article>
          )
        })}
    </>
  )
}
