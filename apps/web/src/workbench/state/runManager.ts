// WB-02.08 · 应用级运行管理器:模块级单例。
// 关键要求"切页不卸载运行管理器"靠两层保证:
// 1) 状态不在任何页面组件里——本模块与页面挂载周期解耦,五个页面容器
//    都只是它的订阅者;
// 2) 演示定时器由管理器自启自停(有活动任务才 tick),不随 React 组件重建。
// WorkbenchApp 挂载/卸载只影响订阅,任务引用与进度不丢。
// WB-07 · 真实执行接入:enqueueRun 绑定 job/experiment/run ID,执行引擎
// (executor.ts)按内核事件驱动进度——真实任务无定时器;取消/清理/竞争
// 条件由本模块与 executor 共同约束(多任务 FIFO 排队、同一时刻仅一项真实
// 执行、终态先到先得、终态后清理活动控制引用并自动续跑下一项)。
import { createId, ID_PREFIXES } from '../ids.ts'
import type { JobId } from '../ids.ts'
import * as logic from './jobLogic.ts'
import type { ExecSpec, Job, RetryResume } from './jobLogic.ts'
import { startExec, resolveBackends, MAX_CANDIDATE_RESULTS_IN_MEMORY } from './executor.ts'
import type { ExecBackends, ExecJobPatch, ExecOutcome } from './executor.ts'
import { canTransition, terminalOutcome } from './execFsm.ts'
import {
  persistQueueState,
  persistSchedulingState,
  restoreQueueState,
  restoreSchedulingState,
} from './projectDoc.ts'
import type { StorageLike } from './projectDoc.ts'
import { notify } from './notifications.ts'
// WB-11.15:本文件在 WB-07.17 守卫清单内,不得 import i18n——toast 发结构化
// 词条 { key, params },由 notifications 在入队时按当前 locale 解析。

const TICK_MS = 700
const DEMO_RATIO = 18

/** 终局取消 toast 的整句词条表:边界种类 × 部分结果(WB-11.15)。
 *  字面量常量,词条按当前 locale 在 notifications.notify 入队时解析。 */
const STOPPED_TOAST_KEYS = {
  candidate: { full: 'tasks.toast.stoppedCandidate', partial: 'tasks.toast.stoppedCandidatePartial' },
  replicate: { full: 'tasks.toast.stoppedReplicate', partial: 'tasks.toast.stoppedReplicatePartial' },
  arm: { full: 'tasks.toast.stoppedArm', partial: 'tasks.toast.stoppedArmPartial' },
} as const

let jobs: Job[] = []
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

/** WB-07.12 · 活动任务的控制引用(取消句柄);终态即清理。 */
const activeControls = new Map<JobId, { cancel: (escalate?: boolean) => Promise<void> }>()

/** WB-07.12 · 排队中的注入后端引用;启动时消费,取消/终态后清理。 */
const queuedBackends = new Map<JobId, Promise<ExecBackends> | ExecBackends>()
/** 真实任务的执行端点引用:重试沿用提交/恢复时的端点,不静默换执行面。 */
const jobBackends = new Map<JobId, Promise<ExecBackends> | ExecBackends>()

/** 队列状态存储(应用启动时挂上;测试直接走 projectDoc 的纯函数)。 */
let queueStorage: StorageLike | null = null
let queueRestored = false
export type SchedulingConfig = {
  concurrency: number
  memoryBudget: number
}

const scheduling: SchedulingConfig = {
  concurrency: 1,
  memoryBudget: MAX_CANDIDATE_RESULTS_IN_MEMORY,
}

function emit(): void {
  for (const listener of listeners) listener()
  if (queueStorage !== null) {
    persistQueueState({ storage: queueStorage, jobs })
  }
}

function startTimer(): void {
  if (timer !== null) return
  timer = setInterval(() => {
    const before = jobs
    jobs = logic.settleJobs(logic.tickJobs(before, DEMO_RATIO))
    for (const [beforeJob, afterJob] of zip(before, jobs)) {
      if (beforeJob.status !== 'succeeded' && afterJob.status === 'succeeded') {
        notify('info', { key: 'tasks.toast.demoDone', params: { name: afterJob.name } })
      }
      if (beforeJob.status !== 'cancelled' && afterJob.status === 'cancelled') {
        notify('info', { key: 'tasks.toast.demoCancelled', params: { name: afterJob.name, done: afterJob.done, total: afterJob.total } })
      }
    }
    emit()
    if (logic.runningCount(jobs) === 0) stopTimer()
  }, TICK_MS)
}

function stopTimer(): void {
  if (timer === null) return
  clearInterval(timer)
  timer = null
}

function zip(before: readonly Job[], after: readonly Job[]): Array<[Job, Job]> {
  return before.flatMap((job, i) => (after[i] ? [[job, after[i]] as [Job, Job]] : []))
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function listJobs(): readonly Job[] {
  return jobs
}

/** 当前执行策略快照;调用方不得直接改写内部调度状态。 */
export function getSchedulingConfig(): SchedulingConfig {
  return { ...scheduling }
}

/** 调整并发与内存预算后立即按新策略重排,不要求人工重试排队项。 */
export function setSchedulingConfig(partial: Partial<SchedulingConfig>): SchedulingConfig {
  const concurrency = Math.max(1, Math.floor(partial.concurrency ?? scheduling.concurrency))
  const memoryBudget = Math.max(1, Math.floor(partial.memoryBudget ?? scheduling.memoryBudget))
  scheduling.concurrency = concurrency
  scheduling.memoryBudget = memoryBudget
  if (queueStorage !== null) {
    persistSchedulingState({ storage: queueStorage, config: scheduling })
  }
  startNextQueued()
  emit()
  return { ...scheduling }
}

/** 执行规格 → 任务总量口径:扫描 = 内核计划 sims;A/B = 双臂 × reps;单次 = reps。 */
function totalOf(spec: ExecSpec): number {
  if (spec.kind === 'sweep') return spec.plan.sims
  if (spec.kind === 'ab') return 2 * spec.replicates
  return spec.replicates
}

function replicatesOf(spec: ExecSpec): number {
  return spec.kind === 'sweep' ? spec.plan.replicates : spec.replicates
}

/** 排队预算口径与 executor 完全一致:sweep 按候选数,其余视为单份输出。 */
function candidateMemoryCount(spec: ExecSpec): number {
  return spec.kind === 'sweep' ? spec.plan.candidates.length : 1
}

/** 状态推进(真实任务):迁移守卫 + 终态单向闸(WB-07.01/16)。 */
function patchJob(id: JobId, patch: ExecJobPatch): void {
  jobs = jobs.map((j) => {
    if (j.id !== id) return j
    if (patch.status !== undefined) {
      if (logic.isTerminal(j.status)) return j // 终态先到先得
      if (!canTransition(j.status, patch.status)) return j // 非法迁移拒绝
    }
    const next: Job = { ...j }
    if (patch.status !== undefined) next.status = patch.status
    if (patch.done !== undefined) next.done = patch.done
    if (patch.exec !== undefined && j.exec !== undefined) {
      next.exec = { ...j.exec, ...patch.exec }
    }
    return next
  })
  emit()
}

function patchWaitReason(id: JobId, waitReason: Job['waitReason']): void {
  jobs = jobs.map((job) => (job.id === id ? { ...job, waitReason } : job))
  emit()
}

/** 真实任务是否已启动执行:queued 仅排队,尚不占用活动执行槽。 */
function isExecuting(status: Job['status']): boolean {
  return status === 'running' || status === 'cancelling'
}

/** 终局落地(WB-07.14/15):终态、错误分类与保留产物;清理活动引用,可再次提交。 */
function applyOutcome(id: JobId, out: ExecOutcome): void {
  const job = jobs.find((j) => j.id === id)
  if (!job || !job.exec) {
    startNextQueued()
    return
  }
  if (logic.isTerminal(job.status)) {
    startNextQueued()
    return
  }
  const status = out.status === 'succeeded'
    ? ('succeeded' as const)
    : out.status === 'cancelled' ? ('cancelled' as const) : ('failed' as const)
  patchJob(id, {
    status,
    exec: {
      resume: null,
      results: out.results,
      recommendation: out.recommendation,
      recommendationError: out.recommendationError,
      comparison: out.comparison,
      comparisons: out.comparisons,
      comparisonErrors: out.comparisonErrors,
      arms: out.arms,
      sim: out.sim,
      errorClass: out.errorClass,
      errorMessage: out.message,
    },
  })
  if (status === 'cancelled' && out.boundary !== null) {
    patchJob(id, { done: boundaryDone(job, out) })
  }
  // 终局 toast:取消/成功/失败各一个口径(与演示队列同风格)
  const kept = terminalOutcome(jobs.find((j) => j.id === id) ?? job)
  // 终局 toast 词条整句成形(边界种类 × 部分结果 × A/B 各为独立词条,
  // 不在状态层拼字符串);词条解析见 notifications.notify
  if (status === 'succeeded') {
    notify('success', {
      key: out.comparison !== null ? 'tasks.toast.realDoneComparison' : 'tasks.toast.realDone',
      params: { name: job.name, n: out.results.length },
    })
  } else if (status === 'cancelled') {
    const b = out.boundary
    const key = b === null
      ? (kept === 'partial' ? 'tasks.toast.stoppedPartial' : 'tasks.toast.stopped')
      : kept === 'partial' ? STOPPED_TOAST_KEYS[b.kind].partial : STOPPED_TOAST_KEYS[b.kind].full
    notify('info', {
      key,
      params: b === null ? { name: job.name } : { name: job.name, done: b.done, total: b.total },
    })
  } else if (out.message === null) {
    notify('error', { key: 'tasks.toast.failedUnknown', params: { name: job.name, class: out.errorClass ?? 'run' } })
  } else {
    notify('error', { key: 'tasks.toast.failed', params: { name: job.name, class: out.errorClass ?? 'run', detail: out.message } })
  }
  startNextQueued()
}

/** 取消边界的真实计数:候选边界 = 已完成候选 × replicates;replicate 边界用内核计数。 */
function boundaryDone(job: Job, out: ExecOutcome): number {
  const b = out.boundary
  if (b === null) return job.done
  if (b.kind === 'replicate') return b.done
  const reps = job.exec?.replicates ?? 0
  const ok = out.results.filter((r) => r.status === 'ok').length
  return b.kind === 'candidate' ? ok * reps : job.done
}

/**
 * WB-07.02/03 · 入队一个真实执行任务:绑定 job/experiment/run ID,执行输入
 * 是提交时冻结的快照(spec 自足,切页/切项目不读 store)。多个真实任务可按
 * FIFO 排队;WB-07.12 的单并发约束保留为执行预算——同一时刻只有队首一项
 * 真正调用 startExec,其余保持 queued。进度由执行引擎按内核事件推进(无
 * 定时器)。当前执行终态后自动启动队列下一项。
 * backends 参数默认走真实端点解析(桌面 native / 浏览器 Worker),测试可注入。
 */
export function enqueueRun(input: {
  experimentId: string
  runId: string
  name: string
  method: string
  spec: ExecSpec
  backends?: Promise<ExecBackends> | ExecBackends
}): Job | null {
  const job: Job = {
    id: createId(ID_PREFIXES.job) as JobId,
    experimentId: input.experimentId,
    name: input.name,
    method: input.method,
    total: totalOf(input.spec),
    done: 0,
    status: 'queued',
    demo: false,
    createdAt: Date.now(),
    exec: {
      runId: input.runId,
      kind: input.spec.kind,
      spec: input.spec,
      progressKind: 'none',
      replicates: replicatesOf(input.spec),
      candidatesDone: 0,
      candidatesTotal: input.spec.kind === 'sweep' ? input.spec.plan.candidates.length : 0,
      results: [],
      recommendation: null,
      recommendationError: null,
      comparison: null,
      arms: null,
      sim: null,
      errorClass: null,
      errorMessage: null,
      resume: null,
    },
  }
  queuedBackends.set(job.id, input.backends ?? resolveBackends())
  jobBackends.set(job.id, input.backends ?? resolveBackends())
  jobs = [...jobs, job]
  startNextQueued()
  return job
}

/**
 * 队列调度:单趟 FIFO 扫描填满并发槽;超内存预算的队首项显式等待且不算失败。
 *
 * 单趟扫描而非 while+jobs.find():startExec 的 queued→running 补丁经 await
 * backends 在微任务后落地,find 会重复命中同一队首项 → 无限 startExec 调用
 * (activeControls.set 同 key 不增 size)→ OOM。单趟 for + activeControls.has
 * 幂等跳过已启动项,状态更新幂等。
 */
function startNextQueued(): void {
  for (const job of jobs) {
    // 槽满即停(活动控制引用是同步占用信号,先于 jobs.status 落地)
    if (activeControls.size >= scheduling.concurrency) return
    if (job.exec === undefined || job.status !== 'queued') continue
    if (activeControls.has(job.id)) continue // 幂等:本轮已启动,跳过
    // 队头超预算即停:不跳过队头去启动后续项(FIFO 语义)
    if (candidateMemoryCount(job.exec.spec) > scheduling.memoryBudget) {
      if (job.waitReason !== 'memory-budget') patchWaitReason(job.id, 'memory-budget')
      return
    }
    if (job.waitReason !== undefined) patchWaitReason(job.id, undefined)

    const backends = queuedBackends.get(job.id) ?? resolveBackends()
    queuedBackends.delete(job.id)
    jobBackends.set(job.id, backends)
    const controls = startExec(job.exec.spec, backends, { update: patchJob }, job.id, job.exec.resume ?? resumeOf(job))
    activeControls.set(job.id, controls)
    void controls.promise.then((out) => {
      // WB-07.15 · 终局清理:busy/控制引用/监听随终态解除;applyOutcome 内续跑下一项
      activeControls.delete(job.id)
      queuedBackends.delete(job.id)
      applyOutcome(job.id, out)
    })
    emit()
  }
}

/**
 * 入队一个演示任务(不执行内核)。受规则约束:同一时刻只允许一个活动
 * 演示任务,避免把进度演示误读为并发执行能力。
 */
export function enqueueDemo(input: {
  experimentId: string
  name: string
  method: string
  total: number
}): Job | null {
  if (logic.runningCount(jobs) > 0) {
    notify('warning', { key: 'tasks.toast.busyDemo' })
    return null
  }
  const job: Job = {
    id: createId(ID_PREFIXES.job) as JobId,
    experimentId: input.experimentId,
    name: input.name,
    method: input.method,
    total: input.total,
    done: 0,
    status: 'queued',
    demo: true,
    createdAt: Date.now(),
  }
  jobs = [...jobs, job]
  startTimer()
  emit()
  return job
}

/** 从失败/部分完成执行提取真实续点；null = 缺少可复用进度,保持整跑语义。 */
function resumeOf(job: Job): RetryResume | null {
  const exec = job.exec
  if (!exec) return null
  if (exec.kind === 'sweep') {
    return { kind: 'sweep', nextCandidateIndex: exec.results.length, results: exec.results }
  }
  if (exec.kind === 'ab' && exec.arms && (exec.arms.base !== null || exec.arms.cand !== null)) {
    return { kind: 'ab', completedArms: { base: exec.arms.base, cand: exec.arms.cand } }
  }
  return null
}

/**
 * WB-07.14/16 · 失败/取消后重试:原位恢复同一 Job 与执行快照,已完成候选
 * /臂不重跑,失败点从断点继续;缺少可复用进度时保持同输入整跑语义。
 */
export function retryJob(id: JobId): Job | null {
  const job = jobs.find((j) => j.id === id)
  if (!job || !job.exec || !logic.isTerminal(job.status)) return null
  if (job.status === 'succeeded') return null
  const resume = resumeOf(job)
  const retried: Job = {
    ...job,
    status: 'queued',
    waitReason: undefined,
    done: 0,
    exec: {
      ...job.exec,
      progressKind: 'none',
      candidatesDone: 0,
      results: [],
      recommendation: null,
      recommendationError: null,
      comparison: null,
      arms: null,
      sim: null,
      errorClass: null,
      errorMessage: null,
      resume,
    },
  }
  jobs = [...jobs.filter((item) => item.id !== id), retried]
  queuedBackends.set(id, jobBackends.get(id) ?? resolveBackends())
  startNextQueued()
  emit()
  return jobs.find((item) => item.id === id) ?? null
}

/** 挂载队列存档面;后续每次状态变化按当前顺序写同一载荷。 */
export function attachQueueStorage(storage: StorageLike): void {
  queueStorage = storage
  setSchedulingConfig(restoreSchedulingState(storage) ?? scheduling)
  persistQueueState({ storage, jobs })
  persistSchedulingState({ storage, config: scheduling })
}

/** 重载恢复:运行中项因执行句柄不可持久化而回到队首执行,其余顺序不变。 */
export function restorePersistedQueue(
  storage: StorageLike,
  backends: ReadonlyMap<JobId, Promise<ExecBackends> | ExecBackends> = new Map(),
): Job[] | null {
  if (queueRestored) return null
  queueRestored = true
  queueStorage = storage
  const restored = restoreQueueState(storage)
  const restoredScheduling = restoreSchedulingState(storage)
  if (restoredScheduling !== null) {
    scheduling.concurrency = restoredScheduling.concurrency
    scheduling.memoryBudget = restoredScheduling.memoryBudget
  }
  if (restored === null) {
    persistQueueState({ storage, jobs })
    persistSchedulingState({ storage, config: scheduling })
    return null
  }
  jobs = restored.map((job) => ({
    ...job,
    // running/cancelling 统一回 queued:执行句柄不可持久化,由槽重新启动
    status: isExecuting(job.status) ? 'queued' as const : job.status,
    // 恢复时清运行时字段:waitReason 由调度重新判定,resume 由 resumeOf 重建
    waitReason: undefined,
    exec: job.exec === undefined ? undefined : { ...job.exec, resume: job.exec.resume ?? resumeOf(job) },
  }))
  for (const [id, backend] of backends) queuedBackends.set(id, backend)
  for (const [id, backend] of backends) jobBackends.set(id, backend)
  startNextQueued()
  startTimer()
  emit()
  persistSchedulingState({ storage, config: scheduling })
  return jobs
}

/** 取消:请求落管理器;演示任务走演示状态机,真实任务走执行引擎取消语义。 */
export async function cancelJob(id: JobId): Promise<void> {
  const job = jobs.find((j) => j.id === id)
  if (!job || logic.isTerminal(job.status)) return // WB-07.16 · 重复取消/终态后取消 = 无操作
  if (job.demo) {
    const hit = logic.requestCancel(jobs, id)
    if (!hit.hit) return
    jobs = hit.jobs
    emit()
    startTimer()
    return
  }
  if (job.status === 'queued') {
    // 排队项取消即终态,不触碰内核令牌(WB-07.12 令牌只对应活动任务)。
    // backends 已被 startNextQueued 消费但状态尚未迁 running 时,活动控制
    // 引用已代表槽被本项占用;该项已判为 queued 取消终态,故同步释放槽。
    queuedBackends.delete(id)
    patchJob(id, { status: 'cancelled' })
    activeControls.delete(id)
    startNextQueued()
    return
  }
  const controls = activeControls.get(id)
  if (!controls) {
    // queued→cancelled 的竞争兜底:无活动控制引用且非终态时不启动内核
    return
  }
  // WB-07.10/16 · 再次取消(cancelling 中)= 浏览器端升级为终止 Worker;
  // 首次取消 = 边界停止请求(桌面 replicate 边界 / 扫描候选边界)。
  const escalate = job.status === 'cancelling'
  await controls.cancel(escalate)
}

export function hasActiveJobs(): boolean {
  return logic.runningCount(jobs) > 0
}

/** 仅供测试:清空队列、定时器与活动引用。 */
export function resetForTest(): void {
  jobs = []
  activeControls.clear()
  queuedBackends.clear()
  jobBackends.clear()
  queueStorage = null
  queueRestored = false
  scheduling.concurrency = 1
  scheduling.memoryBudget = MAX_CANDIDATE_RESULTS_IN_MEMORY
  stopTimer()
}
