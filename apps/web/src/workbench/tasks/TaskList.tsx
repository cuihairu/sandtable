// WB-02.08 · 任务进度条 + 任务列表 + 取消操作。
// 取消语义:按钮文案区分"取消中"(请求已发出)与可再次取消;
// 任务身份 = Job 稳定 ID,列表顺序不代表身份。
// WB-07.14 · 真实任务的来源与错误分类展示:进度口径(progressKind)、
// 部分结果徽标、取消/运行/初始化/预算/桥接错误的差异化文案与恢复动作;
// 演示任务维持原样并明确标注(不把演示画成执行能力)。
// WB-11.15 · 队列文案走词典:replicate/候选等内核契约名保持原样。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import type { Job } from '../state/jobLogic.ts'
import { isTerminal } from '../state/jobLogic.ts'
import { terminalOutcome } from '../state/execFsm.ts'
import { statusLabel, errorClassLabel, recoveryText } from './taskText.ts'
import { t } from '../../lib/i18n/index.ts'
import type { Locale, TranslationKey } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

const LOGIC_FALLBACK: Locale = 'zh-CN'

function msg(locale: Locale | undefined, key: TranslationKey, params?: Record<string, string | number>): string {
  return t(locale ?? LOGIC_FALLBACK, key, params)
}

/** 进度口径说明(WB-07.04/05:来源如实,不冒充真实进度)。 */
function progressKindLabel(job: Job, locale?: Locale): string {
  const ex = job.exec
  if (!ex) return ''
  if (ex.progressKind === 'replicates') return msg(locale, 'tasks.progress.replicates')
  if (ex.progressKind === 'candidates') {
    return msg(locale, 'tasks.progress.candidates', { done: ex.candidatesDone, total: ex.candidatesTotal, replicates: ex.replicates })
  }
  return msg(locale, 'tasks.progress.none')
}

/** WB-07.14 · 终态/错误文案:取消(边界语义)、运行错误、初始化错误、预算、桥接分类展示。 */
function execFooter(job: Job, locale: Locale): JSX.Element {
  const ex = job.exec!
  const outcome = terminalOutcome(job)
  const kept = ex.results.length
  const errorCount = ex.results.filter((r) => r.status !== 'ok').length
  if (job.status === 'succeeded') {
    return (
      <>
        {t(locale, 'tasks.footer.succeeded', { kept })}
        {errorCount > 0 ? t(locale, 'tasks.footer.succeededErrors', { n: errorCount }) : ''}
        {t(locale, 'tasks.footer.succeededEnd')}
        {ex.recommendationError !== null
          ? t(locale, 'tasks.footer.recError', { detail: ex.recommendationError })
          : ex.recommendation !== null ? t(locale, 'tasks.footer.recDone') : ''}
      </>
    )
  }
  if (job.status === 'cancelled') {
    const where = ex.progressKind === 'candidates'
      ? t(locale, 'tasks.footer.cancelAtCandidates', { done: ex.candidatesDone, total: ex.candidatesTotal })
      : t(locale, 'tasks.footer.cancelAtExec', { done: job.done, total: job.total })
    return (
      <>
        {t(locale, 'tasks.footer.cancelBody', { where })}
        {outcome === 'partial' ? t(locale, 'tasks.footer.partialTail') : t(locale, 'tasks.footer.cancelEnd')}
        {t(locale, 'tasks.footer.resubmit')}
      </>
    )
  }
  // failed:按错误类分类展示 + 恢复动作
  const cls = ex.errorClass ?? 'run'
  return (
    <>
      <span style={{ color: 'var(--danger, #b42318)' }}>{errorClassLabel(cls, locale)}</span>:{ex.errorMessage ?? t(locale, 'tasks.error.unknown')}
      <br />
      {t(locale, 'tasks.footer.recovery', { detail: recoveryText(ex.errorClass, ex.kind, locale) })}
    </>
  )
}

export function TaskProgress({ job, compact = false }: { job: Job; compact?: boolean }): JSX.Element {
  const locale = useLocale()
  const pct = job.total > 0 ? Math.round((job.done / job.total) * 100) : 0
  return (
    <>
      <div
        className="task-progress"
        role="progressbar"
        aria-label={t(locale, 'tasks.progressAria', { name: job.name })}
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
  const locale = useLocale()
  if (isTerminal(job.status)) return null
  return (
    <button
      className="btn"
      style={compact ? { minHeight: 26, fontSize: 10 } : undefined}
      title={
        job.status === 'cancelling'
          ? t(locale, 'tasks.cancel.titleCancelling')
          : t(locale, 'tasks.cancel.title')
      }
      onClick={() => onCancel(job.id)}
    >
      <WbIcon name="cross" />
      {job.status === 'cancelling' ? t(locale, 'tasks.cancel.cancelling') : t(locale, 'common.cancel')}
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
  const locale = useLocale()
  if (jobs.length === 0) {
    return (
      <div className="empty-state">
        <WbIcon name="terminal" />
        {t(locale, 'tasks.empty')}
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
                  {statusLabel(job.status, locale)}
                  {job.demo ? t(locale, 'tasks.badgeDemo') : t(locale, 'tasks.badgeReal')}
                </span>
                {outcome === 'partial' && <span className="badge amber">{t(locale, 'tasks.partialBadge')}</span>}
                <div className="actions">
                  <TaskCancelButton job={job} onCancel={onCancel} />
                  {onRetry && job.status === 'failed' && ex !== undefined && (
                    <button className="btn" style={{ minHeight: 26, fontSize: 10 }} onClick={() => onRetry(job.id)}>
                      <WbIcon name="reset" />
                      {t(locale, 'tasks.retry')}
                    </button>
                  )}
                </div>
              </div>
              <div className="job-body">
                <TaskProgress job={job} />
                <span className="muted" style={{ fontSize: 11 }}>
                  {job.demo
                    ? t(locale, 'tasks.demoLine', { method: job.method })
                    : `${job.method} · ${progressKindLabel(job, locale)}`}
                </span>
              </div>
              <div className="job-footer">
                {job.demo
                  ? job.status === 'succeeded'
                    ? t(locale, 'tasks.demo.done')
                    : job.status === 'cancelled'
                      ? t(locale, 'tasks.demo.cancelled', { done: job.done, total: job.total })
                      : job.status === 'cancelling'
                        ? t(locale, 'tasks.demo.cancelling')
                        : t(locale, 'tasks.demo.running')
                  : execFooter(job, locale)}
              </div>
            </article>
          )
        })}
    </>
  )
}
