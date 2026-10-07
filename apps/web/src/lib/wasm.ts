// wasm 绑定单例:首次调用时 init(浏览器 fetch bg.wasm),之后复用。
// 绑定层返回 JSON 字符串(ABI 稳通道),这里统一 parse 成类型。
import init, {
  run_simulation as runSim,
  validate_config as validateCfg,
  sweep_plan as sweepPlanBinding,
  sweep_candidate as sweepCandidateBinding,
  sweep_recommend as sweepRecommendBinding,
} from 'sandtable-wasm'
import type {
  CandidateResult,
  SimOutput,
  SweepPlan,
  SweepRecOutput,
  ValidateInfo,
} from './types'

let ready: Promise<unknown> | null = null

function ensureInit(): Promise<unknown> {
  ready ??= init()
  return ready
}

export async function validateConfig(yaml: string): Promise<ValidateInfo> {
  await ensureInit()
  return JSON.parse(validateCfg(yaml) as unknown as string) as ValidateInfo
}

export async function runSimulation(
  yaml: string,
  replicates: number,
): Promise<SimOutput> {
  await ensureInit()
  return JSON.parse(runSim(yaml, replicates) as unknown as string) as SimOutput
}

// —— 参数扫描:JS 逐候选驱动,候选间让出主线程(绑定层单线程纯转发)——

export async function planSweep(
  yaml: string,
  replicatesOverride: number,
): Promise<SweepPlan> {
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
  await ensureInit()
  return JSON.parse(
    sweepCandidateBinding(yaml, replicates, JSON.stringify(values)) as unknown as string,
  ) as CandidateResult
}

export async function recommendSweep(
  yaml: string,
  results: CandidateResult[],
): Promise<SweepRecOutput> {
  await ensureInit()
  return JSON.parse(
    sweepRecommendBinding(yaml, JSON.stringify(results)) as unknown as string,
  ) as SweepRecOutput
}
