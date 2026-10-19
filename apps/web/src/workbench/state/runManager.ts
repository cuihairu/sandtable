// WB-02.08 · 应用级运行管理器:模块级单例。
// 关键要求"切页不卸载运行管理器"靠两层保证:
// 1) 状态不在任何页面组件里——本模块与页面挂载周期解耦,五个页面容器
//    都只是它的订阅者;
// 2) 演示定时器由管理器自启自停(有活动任务才 tick),不随 React 组件重建。
// WorkbenchApp 挂载/卸载只影响订阅,任务引用与进度不丢。
// WB-07 · 真实执行接入:enqueueRun 绑定 job/experiment/run ID,执行引擎
// (executor.ts)按内核事件驱动进度——真实任务无定时器;取消/清理/竞争
// 条件由本模块与 executor 共同约束(单活动任务、终态先到先得、终态后
// 清理活动控制引用,支持再次提交)。
import { createId, ID_PREFIXES } from '../ids.ts'
import type { JobId } from '../ids.ts'
import * as logic from './jobLogic.ts'
import type { ExecSpec, Job } from './jobLogic.ts'
import { startExec, resolveBackends } from './executor.ts'
import type { ExecBackends, ExecJobPatch, ExecOutcome } from './executor.ts'
import { canTransition, terminalOutcome } from './execFsm.ts'
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

function emit(): void {
  for (const listener of listeners) listener()
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

/** 执行规格 → 任务总量口径:扫描 = 内核计划 sims;A/B = 双臂 × reps;单次 = reps。 */
function totalOf(spec: ExecSpec): number {
  if (spec.kind === 'sweep') return spec.plan.sims
  if (spec.kind === 'ab') return 2 * spec.replicates
  return spec.replicates
}

function replicatesOf(spec: ExecSpec): number {
  return spec.kind === 'sweep' ? spec.plan.replicates : spec.replicates
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

/** 终局落地(WB-07.14/15):终态、错误分类与保留产物;清理活动引用,可再次提交。 */
function applyOutcome(id: JobId, out: ExecOutcome): void {
  const job = jobs.find((j) => j.id === id)
  if (!job || !job.exec) return
  if (logic.isTerminal(job.status)) return // 竞争:终态已先落
  const status = out.status === 'succeeded'
    ? ('succeeded' as const)
    : out.status === 'cancelled' ? ('cancelled' as const) : ('failed' as const)
  patchJob(id, {
    status,
    exec: {
      results: out.results,
      recommendation: out.recommendation,
      recommendationError: out.recommendationError,
      comparison: out.comparison,
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
 * 是提交时冻结的快照(spec 自足,切页/切项目不读 store)。受单活动任务约束
 * (WB-07.12);进度由执行引擎按内核事件推进(无定时器)。
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
  if (logic.runningCount(jobs) > 0) {
    notify('warning', { key: 'tasks.toast.busyReal' })
    return null
  }
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
    },
  }
  jobs = [...jobs, job]
  emit()
  const controls = startExec(input.spec, input.backends ?? resolveBackends(), { update: patchJob }, job.id)
  activeControls.set(job.id, controls)
  void controls.promise.then((out) => {
    // WB-07.15 · 终局清理:busy/控制引用/监听随终态解除,支持再次提交
    activeControls.delete(job.id)
    applyOutcome(job.id, out)
  })
  emit()
  return job
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
  const controls = activeControls.get(id)
  if (!controls) {
    // 已入队未启动:本地取消,不经内核令牌(WB-07.12 令牌只对应活动任务)
    patchJob(id, { status: 'cancelled' })
    return
  }
  // WB-07.10/16 · 再次取消(cancelling 中)= 浏览器端升级为终止 Worker;
  // 首次取消 = 边界停止请求(桌面 replicate 边界 / 扫描候选边界)。
  const escalate = job.status === 'cancelling'
  await controls.cancel(escalate)
}

/** WB-07.16 · 失败后重试:同一执行快照重新入队(同输入 ⇒ 同 run 引用)。 */
export function retryJob(id: JobId): Job | null {
  const job = jobs.find((j) => j.id === id)
  if (!job || !job.exec) return null
  return enqueueRun({
    experimentId: job.experimentId,
    runId: job.exec.runId,
    name: job.name,
    method: job.method,
    spec: job.exec.spec,
  })
}

/** 会话恢复(本批:任务队列不持久化——刷新即空,与原型口径一致)。 */
export function hasActiveJobs(): boolean {
  return logic.runningCount(jobs) > 0
}

/** 仅供测试:清空队列、定时器与活动引用。 */
export function resetForTest(): void {
  jobs = []
  activeControls.clear()
  stopTimer()
}
