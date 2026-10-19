// WB-02.08 · 任务领域逻辑(纯函数,runManager 与节点测试共用)。
// 状态机:queued → running → (cancelling → cancelled | succeeded | failed)。
// 演示任务的"成功/取消"只推进进度沙漏,不执行内核、不产生新结果产物——
// 真实执行与进度(WB-07)接入同一状态机。
import type { JobId } from '../ids.ts'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'succeeded'
  | 'failed'

export type Job = {
  id: JobId
  /** 提交时绑定的实验引用(演示任务为演示实验 ID) */
  experimentId: string
  name: string
  method: string
  total: number
  done: number
  status: JobStatus
  /** demo 任务只演示进度/取消流程 */
  demo: boolean
  createdAt: number
}

export function isTerminal(status: JobStatus): boolean {
  return status === 'cancelled' || status === 'succeeded' || status === 'failed'
}

/** 一个 tick:每个运行中任务推进一段;取消请求在边界落地。返回新数组。 */
export function tickJobs(jobs: readonly Job[], ratio = 18): Job[] {
  return jobs.map((job) => {
    if (job.status === 'running') {
      const done = Math.min(job.total, job.done + Math.max(1, Math.ceil(job.total / ratio)))
      return { ...job, done }
    }
    if (job.status === 'cancelling') {
      // 边界到达:保留已完成进度,状态落"已取消"
      return { ...job, status: 'cancelled' as const }
    }
    if (job.status === 'queued') {
      return { ...job, status: 'running' as const }
    }
    return job
  })
}

/** 已运行的运行中任务自然跑完 → 成功(边界后不再变更)。 */
export function settleJobs(jobs: readonly Job[]): Job[] {
  return jobs.map((job) => {
    if (job.status === 'running' && job.done >= job.total) {
      return { ...job, status: 'succeeded' as const }
    }
    return job
  })
}

/** 取消请求:仅对未终态任务生效;返回是否命中。 */
export function requestCancel(jobs: readonly Job[], id: JobId): { jobs: Job[]; hit: boolean } {
  let hit = false
  const next = jobs.map((job) => {
    if (job.id !== id || isTerminal(job.status)) return job
    hit = true
    // 已排队未运行:直接终态;运行中:进入取消中(边界落地)
    return { ...job, status: job.status === 'queued' ? ('cancelled' as const) : ('cancelling' as const) }
  })
  return { jobs: next, hit }
}

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: '排队中',
  running: '运行中',
  cancelling: '取消中',
  cancelled: '已取消',
  succeeded: '已完成',
  failed: '已失败',
}

export function runningCount(jobs: readonly Job[]): number {
  return jobs.filter((j) => j.status === 'running' || j.status === 'cancelling' || j.status === 'queued').length
}
