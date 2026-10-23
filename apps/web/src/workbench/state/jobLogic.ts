// WB-02.08 · 任务领域逻辑(纯函数,runManager 与节点测试共用)。
// 状态机:queued → running → (cancelling → cancelled | succeeded | failed)。
// 演示任务的"成功/取消"只推进进度沙漏,不执行内核、不产生新结果产物。
// WB-07 · 真实执行接入同一状态机:进度只来自内核事件(无原型定时器),
// 取消/错误分类与部分结果语义见 execFsm.ts,执行引擎见 executor.ts。
import type { CandidateResult, Comparison, SimOutput, SweepRecOutput } from '../../lib/types.ts'
import type { JobId } from '../ids.ts'
import type { AnalysisContext } from '../analysis/resultModel.ts'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'succeeded'
  | 'failed'

/** WB-07.01 · 状态机六态不变;真实任务的状态推进由 executor 按内核事件驱动。 */
export type ExecKind = 'sweep' | 'ab' | 'single'

/** 进度来源口径:replicates=桌面 Channel 逐 replicate;candidates=扫描候选边界;none=该执行端无进度面 */
export type ExecProgressKind = 'replicates' | 'candidates' | 'none'

/** WB-07.14 · 错误分类:init=Worker 初始化失败 / run=内核运行错误 / budget=内存预算 / bridge=内核桥接未接入。取消不是错误(状态机 cancelled)。 */
export type ExecErrorClass = 'init' | 'run' | 'budget' | 'bridge'

/** WB-07.03 · 执行输入快照(数据自足:切项目/切页不读 store,任务重试同 spec)。 */
export type ExecSpec = (
  | { kind: 'sweep'; yaml: string; plan: { candidates: ReadonlyArray<Record<string, number>>; replicates: number; sims: number } }
  | { kind: 'ab'; baseYaml: string; candYaml: string; replicates: number; metric: string }
  | { kind: 'single'; yaml: string; replicates: number }
) & { readonly analysis?: AnalysisContext }

/** WB-07.02 · 真实执行任务的扩展视图(演示任务无此字段)。绑定 run ID + 保留执行输入。 */
export type JobExec = {
  runId: string
  kind: ExecKind
  spec: ExecSpec
  progressKind: ExecProgressKind
  replicates: number
  /** 扫描:已完成(已出结果)候选数,含 config_error 候选 */
  candidatesDone: number
  candidatesTotal: number
  /** WB-07.07/14 · 保留的候选结果(取消/失败不清空;config_error 留在结果集) */
  results: readonly CandidateResult[]
  recommendation: SweepRecOutput | null
  /** WB-07.14 · 推荐调用失败时如实记录(不重算、不伪装成 null 区间) */
  recommendationError: string | null
  comparison: Comparison | null
  /** A/B 双臂输出(桥接未接入时保留为部分结果,不冒充统计判定);单臂完成也如实保留 */
  arms: { base: SimOutput | null; cand: SimOutput | null } | null
  sim: SimOutput | null
  errorClass: ExecErrorClass | null
  errorMessage: string | null
  /** 重试/恢复时的可复用续点;启动执行时消费并清空 */
  resume?: RetryResume | null
}

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
  /** WB-07 · 真实执行视图;undefined = 演示任务 */
  exec?: JobExec
}

/** 重跑的真实续点：失败/部分完成后仍保留且可复用的进度。 */
export type RetryResume =
  | { kind: 'sweep'; nextCandidateIndex: number; results: readonly CandidateResult[] }
  | { kind: 'ab'; completedArms: { base: SimOutput | null; cand: SimOutput | null } }

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
