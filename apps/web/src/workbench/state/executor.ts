// WB-07 · 真实执行引擎(纯逻辑 + 可注入后端,节点可测)。
// 职责边界:
// - 进度只来自内核事件:桌面 run_simulation 的 Channel 逐 replicate(WB-07.04)、
//   扫描的候选边界(WB-07.05)——绝不推算内核未提供的候选内进度,绝不用定时器;
// - 取消语义(WB-07.06/07/10):桌面单次/双臂仿真走内核 cancelRun(replicate
//   边界);扫描取消 = 主线程在候选边界停止派发;浏览器可升级为终止 Worker;
// - 部分结果(WB-07.07/14):取消/失败保留已完成候选;单候选 config_error 是
//   结果不是任务失败;完整候选集才调用 recommendSweep 生成推荐;
// - 单活动任务与内存预算(WB-07.12):并发门在 runManager(入队拒绝),本模块
//   兜底候选结果内存上限;桌面内核取消令牌只属于活动 run_simulation 任务,
//   扫描取消绝不调用内核 cancelRun;
// - 竞争条件(WB-07.16):终态先到先得(settled 单向闸),重复取消幂等,
//   取消晚于完成 = 完成生效。
// 桥接说明:内核 Comparison 桥接已发布(WB-03.10/11/12):ExecBackends.compare
// 是唯一调用点——双臂 YAML + metric + 已跑 SimOutput 进内核 compare_arms,
// 成对前提与指标可用性由内核显式判定,前端不另算统计;compare = null 仍作
// 假后端/防御分支保留(null → A/B 任务如实报 bridge,不冒充统计判定)。
import type {
  CandidateResult,
  Comparison,
  ComparisonFailure,
  SimOutput,
  SimProgress,
  SweepRecOutput,
} from '../../lib/types.ts'
import { METRIC_KEYS } from '../../lib/types.ts'
import type { JobId } from '../ids.ts'
import type { ExecErrorClass, ExecSpec, JobExec, JobStatus, RetryResume } from './jobLogic.ts'
import { isWorkerResponse } from './workerProtocol.ts'
import type { WorkerRequest, WorkerRequestInput, WorkerResultValue } from './workerProtocol.ts'

/** WB-07.12 · 内存预算:单个任务保留在内存中的候选结果上限(超出即预算错误,
 *  不静默丢弃也不 OOM)。Web 端内核 planSweep 另有 200 sims 预算门。 */
export const MAX_CANDIDATE_RESULTS_IN_MEMORY = 1000

/** 执行后端:桌面 = native 命令面(lib/wasm invoke);浏览器 = Worker 协议。
 *  compare = 内核 A/B 统计桥接(WB-03.10/11):双臂 YAML + metric + 已跑
 *  SimOutput 进内核 compare_arms,CRN 成对结论内核直出;null 仅为测试
 *  注入/防御分支保留。terminate = 浏览器端"终止 Worker"的升级取消(桌面无此面)。 */
export type ExecBackends = {
  mode: 'desktop' | 'worker'
  sim: (yaml: string, replicates: number, onProgress?: (p: SimProgress) => void) => Promise<SimOutput>
  candidate: (yaml: string, replicates: number, values: Record<string, number>) => Promise<CandidateResult>
  recommend: (yaml: string, results: CandidateResult[]) => Promise<SweepRecOutput>
  /** 内核取消令牌(仅桌面 run_simulation;浏览器恒 false) */
  kernelCancel: () => Promise<boolean>
  /** A/B 统计比较(WB-03.10/11):双臂 YAML(内核校验同 base_seed 的 CRN
   *  前提)+ metric + 双臂已跑 SimOutput(results 数组回读内核),配对结论
   *  与可用性/成对校验全部由内核 compare_arms 判定,前端不另算。 */
  compare:
    | ((baseYaml: string, candYaml: string, metric: string, base: SimOutput, cand: SimOutput) => Promise<Comparison>)
    | null
  terminate?: () => void
}

/** Worker 最小端口面(真实 DOM Worker 结构兼容)。 */
export type WorkerLike = {
  postMessage: (data: unknown) => void
  terminate: () => void
  onmessage: ((ev: { data: unknown }) => void) | null
}

/** 真实任务对 job 的增量补丁(status 迁移合法性由 runManager 守卫)。 */
export type ExecJobPatch = {
  status?: JobStatus
  done?: number
  exec?: Partial<JobExec>
}

export type ExecHooks = {
  update: (jobId: JobId, patch: ExecJobPatch) => void
}

/** 终局:status + 分类错误 + 保留产物 + 真实停止边界(取消时)。 */
export type ExecOutcome = {
  status: 'succeeded' | 'cancelled' | 'failed'
  errorClass: ExecErrorClass | null
  message: string | null
  results: readonly CandidateResult[]
  recommendation: SweepRecOutput | null
  recommendationError: string | null
  comparison: Comparison | null
  /** A/B 分析视图:逐 KPI 内核配对比较(主指标 + 其余可用 KPI) */
  comparisons: Comparison[] | null
  /** A/B 分析视图:内核显式拒绝的 KPI(原文错误,不 0 填) */
  comparisonErrors: ComparisonFailure[] | null
  arms: { base: SimOutput | null; cand: SimOutput | null } | null
  sim: SimOutput | null
  /** WB-07.06/07 · 真正停止的边界(null = 没有发生取消) */
  boundary: { kind: 'replicate' | 'candidate' | 'arm'; done: number; total: number } | null
}

export type ExecControls = {
  jobId: JobId
  promise: Promise<ExecOutcome>
  /** 请求取消:幂等;escalate = 浏览器端升级为终止 Worker(WB-07.10)。 */
  cancel: (escalate?: boolean) => Promise<void>
}

/** 桌面内核取消错误(桌面 lib.rs 契约):「已取消: 完成 X/Y replicate」。 */
export function classifyKernelCancel(message: string): { done: number; total: number } | null {
  const m = /已取消: 完成 (\d+)\/(\d+) replicate/.exec(message)
  return m ? { done: Number(m[1]), total: Number(m[2]) } : null
}

const okCount = (results: readonly CandidateResult[]): number =>
  results.filter((r) => r.status === 'ok').length

const outcome = (
  status: ExecOutcome['status'],
  errorClass: ExecErrorClass | null,
  message: string | null,
  extra: Partial<ExecOutcome>,
): ExecOutcome => ({
  results: [],
  recommendation: null,
  recommendationError: null,
  comparison: null,
  comparisons: null,
  comparisonErrors: null,
  arms: null,
  sim: null,
  boundary: null,
  ...extra,
  status,
  errorClass,
  message,
})

/** 启动一次真实执行:状态推进经 hooks,终局经 promise 恰好一次。 */
export function startExec(
  spec: ExecSpec,
  backends: Promise<ExecBackends> | ExecBackends,
  hooks: ExecHooks,
  jobId: JobId,
  resume: RetryResume | null = null,
): ExecControls {
  // 单向闸:终局写出后任何 update/取消都不再生效(WB-07.16 终态先到先得)
  let settled = false
  let cancelRequested = false

  const update = (patch: ExecJobPatch): void => {
    if (settled) return
    hooks.update(jobId, patch)
  }

  const baseExec = (): Partial<JobExec> => ({
    results: [],
    recommendation: null,
    recommendationError: null,
    comparison: null,
    comparisons: null,
    comparisonErrors: null,
    arms: null,
    sim: null,
    errorClass: null,
    errorMessage: null,
  })

  /* —— 扫描(WB-07.03/05/07):按已校验计划逐候选调用 runSweepCandidate —— */
  const runSweep = async (
    be: ExecBackends,
    sweepSpec: Extract<ExecSpec, { kind: 'sweep' }>,
  ): Promise<ExecOutcome> => {
    const candidates = sweepSpec.plan.candidates
    const reps = sweepSpec.plan.replicates
    const total = candidates.length
    if (total > MAX_CANDIDATE_RESULTS_IN_MEMORY) {
      // WB-07.12 内存预算:开跑前拒绝,不半途丢弃
      return outcome('failed', 'budget', `候选数 ${total} 超出内存预算(${MAX_CANDIDATE_RESULTS_IN_MEMORY}),请缩小实验规模`, {})
    }
    const startIndex = resume?.kind === 'sweep'
      ? Math.min(Math.max(resume.nextCandidateIndex, 0), total, resume.results.length)
      : 0
    const results: CandidateResult[] = resume?.kind === 'sweep'
      ? resume.results.slice(0, startIndex)
      : []
    update({
      status: 'running',
      exec: {
        ...baseExec(),
        progressKind: 'candidates',
        replicates: reps,
        candidatesDone: results.length,
        candidatesTotal: total,
        results: [...results],
      },
    })
    for (let i = startIndex; i < total; i++) {
      if (cancelRequested) {
        // WB-07.07 · 候选边界检查:保留已完成候选,不碰内核令牌
        return outcome('cancelled', null, null, { results: [...results], boundary: { kind: 'candidate', done: results.length, total } })
      }
      let r: CandidateResult
      try {
        r = await be.candidate(sweepSpec.yaml, reps, candidates[i])
      } catch (e) {
        // 扫描的取消不经内核令牌(主线程停止派发);这里只有真实运行错误
        return outcome('failed', 'run', String(e), { results: [...results] })
      }
      // 单候选 config_error 是结果不是失败(WB-07.14):留在结果集继续
      results.push(r)
      update({
        done: okCount(results) * reps,
        exec: { candidatesDone: results.length, results: [...results] },
      })
    }
    if (results.length === total) {
      // WB-07.16 · 取消与完成同时发生:全部候选完成 = 完成生效(先到先得)
      let recommendation: SweepRecOutput | null = null
      let recommendationError: string | null = null
      try {
        recommendation = await be.recommend(sweepSpec.yaml, results)
      } catch (e) {
        // 候选结果真实保留;推荐失败如实记录,不降格冒充
        recommendationError = String(e)
      }
      update({
        status: 'succeeded',
        done: okCount(results) * reps,
        exec: { results: [...results], recommendation, recommendationError },
      })
      return outcome('succeeded', null, null, { results: [...results], recommendation, recommendationError })
    }
    // 循环因取消退出且未完成全部候选(WB-07.07:不对不完整数据生成完整推荐)
    return outcome('cancelled', null, null, { results: [...results], boundary: { kind: 'candidate', done: results.length, total } })
  }

  /* —— 单次/双臂仿真(WB-07.04/06):桌面走 Channel 进度与内核 cancelRun —— */
  const runSims = async (
    be: ExecBackends,
    arms: Array<{ label: 'base' | 'cand' | 'single'; yaml: string }>,
    reps: number,
  ): Promise<ExecOutcome> => {
    // 浏览器 Worker 内单次仿真无逐 replicate 进度面(同步 wasm),如实标 none
    const progressKind = be.mode === 'desktop' ? 'replicates' : 'none'
    const completedArms = resume?.kind === 'ab' ? resume.completedArms : null
    const startIndex = completedArms === null
      ? 0
      : (() => {
        const firstIncomplete = arms.findIndex((arm) => completedArms[arm.label as 'base' | 'cand'] === null)
        return firstIncomplete === -1 ? arms.length : firstIncomplete
      })()
    const skipArms = startIndex > 0 ? arms.slice(0, startIndex) : []
    const restoredDone = skipArms.length * reps
    update({
      status: 'running',
      exec: {
        ...baseExec(),
        progressKind,
        replicates: reps,
        candidatesDone: 0,
        candidatesTotal: 0,
        ...(spec.kind === 'ab' && completedArms !== null ? { arms: completedArms } : {}),
      },
    })

    const outputs: { base: SimOutput | null; cand: SimOutput | null } = completedArms ?? { base: null, cand: null }
    const armsOut = (): { base: SimOutput | null; cand: SimOutput | null } | null =>
      spec.kind === 'ab' ? { base: outputs.base, cand: outputs.cand } : null

    let doneBase = restoredDone
    for (const arm of arms.slice(startIndex)) {
      if (cancelRequested) {
        // WB-07.16 · 臂间边界取消:已完成臂保留(双臂);单次已完成则保留输出
        if (spec.kind === 'single' && outputs.base !== null) {
          return outcome('cancelled', null, null, { sim: outputs.base, boundary: { kind: 'arm', done: 0, total: 1 } })
        }
        return outcome('cancelled', null, null, { arms: armsOut(), boundary: { kind: 'arm', done: arms.indexOf(arm), total: arms.length } })
      }
      const offset = doneBase
      const onProgress = be.mode === 'desktop'
        ? (p: SimProgress): void => update({ done: offset + p.done })
        : undefined
      let out: SimOutput
      try {
        out = await be.sim(arm.yaml, reps, onProgress)
      } catch (e) {
        const b = classifyKernelCancel(String(e))
        if (b !== null) {
          // WB-07.06 · 已在 replicate 边界真正停止(内核契约错误串携带真实计数)
          return outcome('cancelled', null, null, {
            ...(spec.kind === 'single' ? { sim: null } : { arms: armsOut() }),
            boundary: { kind: 'replicate', done: offset + b.done, total: offset + b.total },
          })
        }
        return outcome('failed', 'run', String(e), spec.kind === 'single' ? {} : { arms: armsOut() })
      }
      doneBase += reps
      if (spec.kind === 'single') {
        // 浏览器同步执行不可中断:取消晚于完成 = 完成生效(WB-07.16)
        update({ done: reps, exec: { sim: out } })
        return outcome('succeeded', null, null, { sim: out })
      }
      outputs[arm.label as 'base' | 'cand'] = out
      update({ done: doneBase, exec: { arms: armsOut() } })
    }

    if (cancelRequested) {
      // 双臂都完成但取消先落:不继续比较,双臂输出保留为部分结果
      return outcome('cancelled', null, null, { arms: armsOut(), boundary: { kind: 'arm', done: arms.length, total: arms.length } })
    }
    // WB-07.03 · A/B 调用真实比较桥接(WB-03.10/11):双臂 YAML + metric +
    // 已跑输出进内核;compare = null 仅防御/测试注入分支 → 如实报 bridge
    if (be.compare === null) {
      return outcome('failed', 'bridge', 'A/B 统计比较需内核 Comparison 桥接(WB-03.10/11);双臂仿真已真跑并保留,统计判定不由前端另算', { arms: armsOut() })
    }
    // 单次仿真在臂内已返回;能走到这里的都是双臂(A/B)。ExecSpec 是 kind 判别
    // 联合,baseYaml/candYaml/metric 只在 ab 变体上,先收窄再取字段。
    const ab = spec.kind === 'ab' ? spec : null
    if (ab === null) {
      return outcome('failed', 'run', 'A/B 比较只适用于双臂规格;当前规格无第二臂', { arms: armsOut() })
    }
    let comparison: Comparison
    try {
      comparison = await be.compare(ab.baseYaml, ab.candYaml, ab.metric, outputs.base!, outputs.cand!)
    } catch (e) {
      // 内核显式拒绝(种子错位/指标不可用/replicate 不等长/未知指标):
      // 双臂输出保留,错误原样进错误通道(配置错误/参数错误前缀)
      return outcome('failed', 'run', String(e), { arms: armsOut() })
    }
    // A/B 分析视图(WB-08.12):主指标之外逐 KPI 再进内核 compare_arms,
    // 每个可用 KPI 各得一份真实配对 Comparison;内核显式拒绝(如 gacha/loot
    // 未配置、天数不足以算 D7)逐条原文记录为不可用,不 0 填、不前端重算。
    // 统计判定仍全部出自内核同一桥接,本循环只是同一调用点的逐指标重复。
    const comparisons: Comparison[] = [comparison]
    const comparisonErrors: ComparisonFailure[] = []
    for (const metric of METRIC_KEYS) {
      if (metric === ab.metric) continue
      try {
        comparisons.push(await be.compare(ab.baseYaml, ab.candYaml, metric, outputs.base!, outputs.cand!))
      } catch (e) {
        comparisonErrors.push({ metric, message: String(e) })
      }
    }
    const errorsOut = comparisonErrors.length > 0 ? comparisonErrors : null
    update({ status: 'succeeded', done: doneBase, exec: { comparison, comparisons, comparisonErrors: errorsOut, arms: armsOut() } })
    return outcome('succeeded', null, null, { comparison, comparisons, comparisonErrors: errorsOut, arms: armsOut() })
  }

  const promise = (async (): Promise<ExecOutcome> => {
    try {
      const be = await backends
      if (cancelRequested) {
        // 入队即取消(queued → cancelled 已落):不再触碰内核
        const boundary = spec.kind === 'sweep'
          ? { kind: 'candidate' as const, done: 0, total: spec.plan.candidates.length }
          : { kind: 'arm' as const, done: 0, total: 1 }
        return outcome('cancelled', null, null, { boundary })
      }
      if (spec.kind === 'sweep') return await runSweep(be, spec)
      if (spec.kind === 'ab') {
        return await runSims(be, [
          { label: 'base', yaml: spec.baseYaml },
          { label: 'cand', yaml: spec.candYaml },
        ], spec.replicates)
      }
      return await runSims(be, [{ label: 'single', yaml: spec.yaml }], spec.replicates)
    } finally {
      settled = true
    }
  })()

  const cancel = async (escalate = false): Promise<void> => {
    if (settled) return // WB-07.16 · 终态后取消 = 无操作
    if (cancelRequested && !escalate) return // WB-07.16 · 重复取消幂等
    cancelRequested = true
    update({ status: 'cancelling' })
    const be = await backends
    if (settled) return
    if (spec.kind === 'sweep') {
      // WB-07.12 · 桌面取消令牌只对应活动 run_simulation:扫描取消绝不调用内核
      return
    }
    if (be.mode === 'desktop') {
      // WB-07.06 · 取消请求已发出;内核在 replicate 边界落地
      await be.kernelCancel()
      return
    }
    if (escalate) {
      // WB-07.10 · 浏览器升级取消 = 终止 Worker(在途候选结果丢弃,已收到的保留)
      be.terminate?.()
    }
  }

  return { jobId, promise, cancel }
}

/** WB-07.08/11 · Worker 连接:按 taskId 路由响应;终态/换代任务的旧消息丢弃。 */
export class WorkerConnection {
  private worker: WorkerLike | null = null
  private readonly pending = new Map<string, { resolve: (v: WorkerResultValue) => void; reject: (e: Error) => void }>()
  private seq = 0
  /** 诊断:Worker 实例创建次数(终止后重建 = 重新初始化,WB-07.11) */
  creations = 0

  private readonly spawn: () => WorkerLike

  constructor(spawn: () => WorkerLike) {
    this.spawn = spawn
  }

  private ensure(): WorkerLike {
    if (this.worker !== null) return this.worker
    this.creations++
    const w = this.spawn()
    w.onmessage = (ev: { data: unknown }): void => {
      const data: unknown = ev.data
      if (!isWorkerResponse(data)) return
      if (data.kind === 'progress') return // 内核未提供候选内/仿真内真实进度,Worker 不发(WB-07.05)
      if (data.kind === 'result' || data.kind === 'error') {
        const p = this.pending.get(data.taskId)
        if (!p) return // WB-07.11 · 旧消息/无主消息不写入新任务
        this.pending.delete(data.taskId)
        if (data.kind === 'result') {
          p.resolve(data.value)
        } else {
          const err = new Error(data.message) as Error & { wClass: string; retryable: boolean }
          err.wClass = data.errorClass
          err.retryable = data.retryable
          p.reject(err)
        }
      }
    }
    this.worker = w
    return w
  }

  request(partial: WorkerRequestInput): Promise<WorkerResultValue> {
    const w = this.ensure()
    const taskId = `wreq_${++this.seq}` // WB-07.08 · 请求/任务 ID
    const req = { protocol: 1, taskId, ...partial } as WorkerRequest
    return new Promise<WorkerResultValue>((resolve, reject) => {
      this.pending.set(taskId, { resolve, reject })
      w.postMessage(req)
    })
  }

  /** WB-07.11 · 终止:清空执行上下文,拒绝全部在途请求;下一次 request 重新
   *  初始化(新 Worker 实例)。旧 Worker 的迟到消息因 pending 已清而被丢弃。 */
  terminate(): void {
    const w = this.worker
    if (w === null) return
    this.worker = null
    for (const p of this.pending.values()) p.reject(new Error('worker-terminated'))
    this.pending.clear()
    w.terminate()
  }
}

/** 浏览器后端:Worker 连接 + 协议请求(WB-07.08/09/11)。 */
export function workerBackends(spawn: () => WorkerLike): ExecBackends {
  const connection = new WorkerConnection(spawn)
  const expect = (reqKind: WorkerResultValue['reqKind'], v: WorkerResultValue): WorkerResultValue => {
    if (v.reqKind !== reqKind) throw new Error(`Worker 响应类型不匹配:期望 ${reqKind},得到 ${v.reqKind}`)
    return v
  }
  return {
    mode: 'worker',
    sim: async (yaml, replicates) => {
      const v = expect('sim', await connection.request({ kind: 'sim', yaml, replicates }))
      if (v.reqKind !== 'sim') throw new Error('unreachable')
      return v.output
    },
    candidate: async (yaml, replicates, values) => {
      const v = expect('candidate', await connection.request({ kind: 'candidate', yaml, replicates, values }))
      if (v.reqKind !== 'candidate') throw new Error('unreachable')
      return v.result
    },
    recommend: async (yaml, results) => {
      const v = expect('recommend', await connection.request({ kind: 'recommend', yaml, results }))
      if (v.reqKind !== 'recommend') throw new Error('unreachable')
      return v.rec
    },
    kernelCancel: async () => false,
    compare: async (baseYaml, candYaml, metric, base, cand) => {
      const v = expect(
        'ab_compare',
        await connection.request({ kind: 'ab_compare', baseYaml, candYaml, metric, resultsA: base.results, resultsB: cand.results }),
      )
      if (v.reqKind !== 'ab_compare') throw new Error('unreachable')
      return v.comparison
    },
    terminate: () => connection.terminate(),
  }
}

/** 真实后端解析:桌面走 native 命令面;浏览器走 Worker(动态 import,节点
 *  测试注入假后端时绝不触发)。compare = 内核 A/B 统计桥接(WB-03.12 双端同构)。 */
export async function resolveBackends(): Promise<ExecBackends> {
  const wasm = await import('../../lib/wasm.ts')
  if (wasm.isDesktop) {
    return {
      mode: 'desktop',
      sim: wasm.runSimulation,
      candidate: wasm.runSweepCandidate,
      recommend: wasm.recommendSweep,
      kernelCancel: wasm.cancelRun,
      compare: (baseYaml, candYaml, metric, base, cand) =>
        wasm.abCompare(baseYaml, candYaml, metric, base.results, cand.results),
    }
  }
  return workerBackends(
    () => new Worker(new URL('./sweepWorker.entry.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike,
  )
}
