// WB-07.08 · 浏览器 Worker 消息协议(版本化信封,纯类型 + 守卫,节点可测)。
// 纪律:
// - 每条消息带 `protocol` 版本与 `taskId`(请求/任务 ID)——主线程 sink 按
//   taskId 路由,终态/换代任务的旧消息一律丢弃(WB-07.11);
// - 结果与错误都是"响应";progress 是协议内**可用**的进度事件形态——
//   Worker 内核执行是同步 wasm,候选内/仿真内没有真实进度,serve 端
//   不得伪造 progress(WB-07.05 红线:未提供的进度不得推算成真进度);
// - 输入 = 请求载荷原文(输入快照自足,不引用主线程可变状态)。
import type { CandidateResult, SimOutput, SweepPlan, SweepRecOutput } from '../../lib/types.ts'

export const WORKER_PROTOCOL_VERSION = 1

/** 分布式 Omit:联合的每个成员各自去 envelope 键(plain Omit 只留公共键)。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** 请求载荷(无信封):Worker 连接补 protocol + taskId。 */
export type WorkerRequestInput = DistributiveOmit<WorkerRequest, 'protocol' | 'taskId'>

/** 请求:kind 决定内核调用面;taskId 唯一(任务 ID,创建型稳定 ID 体系)。 */
export type WorkerRequest =
  | { protocol: 1; kind: 'plan'; taskId: string; yaml: string; replicatesOverride: number }
  | { protocol: 1; kind: 'sim'; taskId: string; yaml: string; replicates: number }
  | { protocol: 1; kind: 'candidate'; taskId: string; yaml: string; replicates: number; values: Record<string, number> }
  | { protocol: 1; kind: 'recommend'; taskId: string; yaml: string; results: readonly CandidateResult[] }

/** Worker 侧错误类:init = WASM 初始化失败(可重试,retryable: true);run = 内核运行错误。 */
export type WorkerErrorClass = 'init' | 'run'

/** 响应:result / error / progress。错误不抛异常过边界,走结构化 error。 */
export type WorkerResponse =
  | { protocol: 1; kind: 'result'; taskId: string; reqKind: WorkerRequest['kind']; value: WorkerResultValue }
  | { protocol: 1; kind: 'error'; taskId: string; reqKind: WorkerRequest['kind'] | null; errorClass: WorkerErrorClass; retryable: boolean; message: string }
  | {
      protocol: 1
      kind: 'progress'
      taskId: string
      done: number
      total: number
      /** 进度口径:replicates = 逐 replicate;candidate = 候选边界 */
      scope: 'replicates' | 'candidate'
    }

export type WorkerResultValue =
  | { reqKind: 'plan'; plan: SweepPlan }
  | { reqKind: 'sim'; output: SimOutput }
  | { reqKind: 'candidate'; result: CandidateResult }
  | { reqKind: 'recommend'; rec: SweepRecOutput }

/** 守卫:入站消息必须过协议检查,非协议消息被丢弃(不进入执行)。 */
export function isWorkerRequest(v: unknown): v is WorkerRequest {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.protocol !== WORKER_PROTOCOL_VERSION || typeof r.taskId !== 'string' || r.taskId === '') return false
  switch (r.kind) {
    case 'plan':
      return typeof r.yaml === 'string' && typeof r.replicatesOverride === 'number'
    case 'sim':
      return typeof r.yaml === 'string' && typeof r.replicates === 'number'
    case 'candidate':
      return (
        typeof r.yaml === 'string' &&
        typeof r.replicates === 'number' &&
        typeof r.values === 'object' && r.values !== null
      )
    case 'recommend':
      return typeof r.yaml === 'string' && Array.isArray(r.results)
    default:
      return false
  }
}

export function isWorkerResponse(v: unknown): v is WorkerResponse {
  if (typeof v !== 'object' || v === null) return false
  const r = v as Record<string, unknown>
  if (r.protocol !== WORKER_PROTOCOL_VERSION || typeof r.taskId !== 'string' || r.taskId === '') return false
  switch (r.kind) {
    case 'result':
      return r.reqKind === 'plan' || r.reqKind === 'sim' || r.reqKind === 'candidate' || r.reqKind === 'recommend'
    case 'error':
      return (
        (r.reqKind === null || r.reqKind === 'plan' || r.reqKind === 'sim' || r.reqKind === 'candidate' || r.reqKind === 'recommend') &&
        (r.errorClass === 'init' || r.errorClass === 'run') &&
        typeof r.retryable === 'boolean' &&
        typeof r.message === 'string'
      )
    case 'progress':
      return (
        typeof r.done === 'number' &&
        typeof r.total === 'number' &&
        (r.scope === 'replicates' || r.scope === 'candidate')
      )
    default:
      return false
  }
}
