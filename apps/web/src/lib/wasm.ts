// wasm 绑定单例:首次调用时 init(浏览器 fetch bg.wasm),之后复用。
// 绑定层返回 JSON 字符串(ABI 稳通道),这里统一 parse 成类型。
// 桌面壳(Tauri)下不走 wasm:invoke 走 native 命令面,JSON 形状逐字段同构
// (桌面 lib.rs 命令与本绑定同源 core 纯函数,core 直连不经 wasm 边界)。
import init, {
  run_simulation as runSim,
  validate_config as validateCfg,
  sweep_plan as sweepPlanBinding,
  sweep_candidate as sweepCandidateBinding,
  sweep_recommend as sweepRecommendBinding,
} from 'sandtable-wasm'
import { Channel, invoke } from '@tauri-apps/api/core'
import type {
  CandidateResult,
  LocalQueryResult,
  SimOutput,
  SimProgress,
  SweepPlan,
  SweepRecOutput,
  ValidateInfo,
} from './types'

// 桌面壳(Tauri)运行中:前端按此决定走 native 命令面还是浏览器 wasm。
// 导出供面板级判断用(本地文件查询只有桌面能用)。
export const isDesktop =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let ready: Promise<unknown> | null = null

function ensureInit(): Promise<unknown> {
  ready ??= init()
  return ready
}

export async function validateConfig(yaml: string): Promise<ValidateInfo> {
  if (isDesktop) return invoke('validate_config', { yaml })
  await ensureInit()
  return JSON.parse(validateCfg(yaml) as unknown as string) as ValidateInfo
}

// 长任务(桌面异步命令):onProgress 经 Channel 逐 replicate 收 {done,total};
// 浏览器 wasm 是同步调用,主线程被占满,回调不会被触发,传了也忽略。
export async function runSimulation(
  yaml: string,
  replicates: number,
  onProgress?: (p: SimProgress) => void,
): Promise<SimOutput> {
  if (isDesktop) {
    const channel = new Channel<SimProgress>()
    if (onProgress) channel.onmessage = onProgress
    return invoke('run_simulation', { yaml, replicates, onProgress: channel })
  }
  await ensureInit()
  return JSON.parse(runSim(yaml, replicates) as unknown as string) as SimOutput
}

// 取消活动长任务(仅桌面,run_simulation 在 replicate 边界生效)。
// 返回是否命中活动任务;无任务/已结束为 false,不报错。
export async function cancelRun(): Promise<boolean> {
  if (!isDesktop) throw new Error('取消仅桌面端可用')
  return invoke('cancel_run')
}

// —— 参数扫描:JS 逐候选驱动,候选间让出主线程(绑定层单线程纯转发)——

export async function planSweep(
  yaml: string,
  replicatesOverride: number,
): Promise<SweepPlan> {
  if (isDesktop) {
    return invoke('sweep_plan', { yaml, replicatesOverride })
  }
  await ensureInit()
  return JSON.parse(
    sweepPlanBinding(yaml, replicatesOverride) as unknown as string,
  ) as SweepPlan
}

export async function runSweepCandidate(
  yaml: string,
  replicates: number,
  values: Record<string, number>,
): Promise<CandidateResult> {
  if (isDesktop) {
    return invoke('sweep_candidate', { yaml, replicates, valuesJson: JSON.stringify(values) })
  }
  await ensureInit()
  return JSON.parse(
    sweepCandidateBinding(yaml, replicates, JSON.stringify(values)) as unknown as string,
  ) as CandidateResult
}

export async function recommendSweep(
  yaml: string,
  results: CandidateResult[],
): Promise<SweepRecOutput> {
  if (isDesktop) {
    return invoke('sweep_recommend', { yaml, resultsJson: JSON.stringify(results) })
  }
  await ensureInit()
  return JSON.parse(
    sweepRecommendBinding(yaml, JSON.stringify(results)) as unknown as string,
  ) as SweepRecOutput
}

// —— 本地文件查询(仅桌面)——
// 会话内按天数据走 duckdb-wasm 内存表;CLI / 桌面产物在磁盘上,浏览器拿不到
// 本机路径,只有桌面壳的 query 命令(duckdb-rs,与 CLI query 同源)能只读打开。
export async function queryLocal(
  inputs: string[],
  sql: string,
): Promise<LocalQueryResult> {
  if (!isDesktop) throw new Error('本地文件查询仅在桌面端可用')
  return invoke('query', { inputs, sql })
}
