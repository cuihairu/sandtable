// WB-07.09/10/11 · Worker 内核服务端(纯逻辑,绑定经 env 注入,节点可测)。
// - WB-07.09:init 在 Worker 内完成并缓存复用(initPromise 单例);失败清空
//   缓存 → 下一个请求重新初始化(可重试);
// - WB-07.10:取消语义 = 主线程停止派发下一候选(边界停止);Worker 内单个
//   同步 wasm 调用不可中断,无法返回中间状态——如实报 run 错误或由主线程
//   终止 Worker(终止后未完成候选的结果不产出,已收到的保留在主线程);
// - WB-07.11:serve 实例与 Worker 生命周期一致,终止即整体销毁;每次请求
//   独立 taskId,响应原样带回,主线程 sink 丢弃换代旧消息。
// 真正的 Worker 入口见 sweepWorker.entry.ts(绑定真实 sandtable-wasm)。
import type { WorkerRequest, WorkerResponse, WorkerResultValue } from './workerProtocol.ts'

export type ServeEnv = {
  /** 回发响应(postMessage 的包装) */
  post: (msg: WorkerResponse) => void
  /** 初始化 WASM(幂等化由本模块负责;env.init 只需真正执行一次加载) */
  init: () => Promise<unknown>
  plan: (yaml: string, replicatesOverride: number) => Promise<unknown>
  sim: (yaml: string, replicates: number) => Promise<unknown>
  candidate: (yaml: string, replicates: number, values: Record<string, number>) => Promise<unknown>
  recommend: (yaml: string, results: readonly unknown[]) => Promise<unknown>
  /** A/B 统计比较(双臂 YAML + metric + 已跑 results 数组 → 内核 Comparison) */
  abCompare: (baseYaml: string, candYaml: string, metric: string, resultsA: readonly unknown[], resultsB: readonly unknown[]) => Promise<unknown>
}

export type SweepWorkerServer = {
  onMessage: (req: WorkerRequest) => Promise<void>
  /** 仅供测试:重置初始化缓存(模拟新的 Worker 实例) */
  resetForTest: () => void
}

export function serveSweepWorker(env: ServeEnv): SweepWorkerServer {
  // initPromise 缓存 = 复用:同一 Worker 实例只初始化一次(WB-07.09)
  let initPromise: Promise<unknown> | null = null

  const ensureInit = async (): Promise<boolean> => {
    try {
      initPromise ??= env.init()
      await initPromise
      return true
    } catch {
      // 初始化失败:清缓存,下一个请求重新初始化(可重试,WB-07.09)
      initPromise = null
      return false
    }
  }

  const error = (taskId: string, reqKind: WorkerRequest['kind'] | null, errorClass: 'init' | 'run', message: string): WorkerResponse => ({
    protocol: 1,
    kind: 'error',
    taskId,
    reqKind,
    errorClass,
    retryable: errorClass === 'init',
    message,
  })

  const ok = (taskId: string, reqKind: WorkerRequest['kind'], value: WorkerResultValue): WorkerResponse => ({
    protocol: 1,
    kind: 'result',
    taskId,
    reqKind,
    value,
  })

  async function dispatch(req: WorkerRequest): Promise<WorkerResponse> {
    if (!(await ensureInit())) {
      return error(req.taskId, req.kind, 'init', 'WASM 初始化失败(在 Worker 内);可重试')
    }
    try {
      switch (req.kind) {
        case 'plan': {
          const plan = await env.plan(req.yaml, req.replicatesOverride)
          return ok(req.taskId, 'plan', { reqKind: 'plan', plan } as WorkerResultValue)
        }
        case 'sim': {
          const output = await env.sim(req.yaml, req.replicates)
          return ok(req.taskId, 'sim', { reqKind: 'sim', output } as WorkerResultValue)
        }
        case 'candidate': {
          const result = await env.candidate(req.yaml, req.replicates, req.values)
          return ok(req.taskId, 'candidate', { reqKind: 'candidate', result } as WorkerResultValue)
        }
        case 'recommend': {
          const rec = await env.recommend(req.yaml, req.results)
          return ok(req.taskId, 'recommend', { reqKind: 'recommend', rec } as WorkerResultValue)
        }
        case 'ab_compare': {
          const comparison = await env.abCompare(req.baseYaml, req.candYaml, req.metric, req.resultsA, req.resultsB)
          return ok(req.taskId, 'ab_compare', { reqKind: 'ab_compare', comparison } as WorkerResultValue)
        }
      }
    } catch (e) {
      // 内核运行错误:结构化 error 过边界(不把异常抛丢);init 已就绪后
      // 的失败都是 run 类(不可重试同一请求,主线程走"重新提交"恢复)
      return error(req.taskId, req.kind, 'run', String(e))
    }
  }

  return {
    async onMessage(req: WorkerRequest): Promise<void> {
      env.post(await dispatch(req))
    },
    resetForTest(): void {
      initPromise = null
    },
  }
}
