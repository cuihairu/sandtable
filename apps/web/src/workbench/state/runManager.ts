// WB-02.08 · 应用级运行管理器:模块级单例。
// 关键要求"切页不卸载运行管理器"靠两层保证:
// 1) 状态不在任何页面组件里——本模块与页面挂载周期解耦,五个页面容器
//    都只是它的订阅者;
// 2) 定时器由管理器自启自停(有活动任务才 tick),不随 React 组件重建。
// WorkbenchApp 挂载/卸载只影响订阅,任务引用与进度不丢。
// 当前入队的是演示任务(不执行内核);WB-07 接真实执行时替换 execute 侧。
import { createId, ID_PREFIXES } from '../ids.ts'
import type { JobId } from '../ids.ts'
import * as logic from './jobLogic.ts'
import type { Job } from './jobLogic.ts'
import { notify } from './notifications.ts'

const TICK_MS = 700
const DEMO_RATIO = 18

let jobs: Job[] = []
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

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
        notify('info', `任务「${afterJob.name}」演示结束:未执行仿真,未生成新的结果产物`)
      }
      if (beforeJob.status !== 'cancelled' && afterJob.status === 'cancelled') {
        notify('info', `任务「${afterJob.name}」已在边界停止(保留 ${afterJob.done}/${afterJob.total} 演示进度)`)
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
    notify('warning', '已有演示任务运行中,请等待完成或取消后再添加')
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

/** 取消:请求落管理器,边界语义由 jobLogic 状态机表达。 */
export function cancelJob(id: JobId): void {
  const hit = logic.requestCancel(jobs, id)
  if (!hit.hit) return
  jobs = hit.jobs
  emit()
  startTimer()
}

/** 会话恢复(本批:演示队列不持久化——刷新即空,与原型口径一致)。 */
export function hasActiveJobs(): boolean {
  return logic.runningCount(jobs) > 0
}

/** 仅供测试:清空队列与定时器。 */
export function resetForTest(): void {
  jobs = []
  stopTimer()
}
