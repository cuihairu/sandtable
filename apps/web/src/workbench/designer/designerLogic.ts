// WB-02.07 · 实验设计的纯逻辑:候选数/任务数预算、运行前基础校验。
// 注意红线:这里的预算上限是当前 Web 执行端的演示预算;真实预算门
// (Web 64/200/400k,桌面无门)在 WB-06.13 接执行端差异时接入,不提前编造。
import { METRICS } from '../demo/sampleProject.ts'
import type { MetricValues } from '../demo/sampleProject.ts'

export type ExperimentMethod = 'ab' | 'grid' | 'random'

export type DesignDraft = {
  name: string
  method: ExperimentMethod
  /** Grid 因子域 */
  min: number
  max: number
  step: number
  /** Random / LHS 固定预算 */
  samples: number
  /** 场景与统计 */
  reps: number
  players: number
  days: number
  paired: boolean
  sampling: 'lhc' | 'uniform'
  /** KPI 约束阈值(UI 口径 0–100,接内核时按 WB-03.03 转口径) */
  thresholds: MetricValues
}

export type DesignCounts = {
  candidates: number
  tasks: number
  playerDays: number
}

export function designCounts(d: DesignDraft): DesignCounts {
  const candidates =
    d.method === 'ab' ? 2 : d.method === 'grid'
      ? (d.step > 0 && d.max >= d.min ? Math.floor((d.max - d.min) / d.step + 1e-9) + 1 : 0)
      : Math.max(0, d.samples)
  return {
    candidates,
    tasks: candidates * d.reps,
    playerDays: candidates * d.reps * d.players * d.days,
  }
}

/**
 * 单因子 Grid 计划预览:等距取值序列(供因子表展示)。
 * 真实 planSweep(sweep_plan)桥接是 WB-06.10;这里只做表单侧预演。
 */
export function gridFactorValues(d: DesignDraft): number[] {
  if (d.method !== 'grid' || d.step <= 0 || d.max < d.min) return []
  const out: number[] = []
  for (let v = d.min; v <= d.max + 1e-9; v += d.step) out.push(Math.round(v))
  return out
}

export const DEMO_TASK_BUDGET = 100_000

export function designErrors(d: DesignDraft): string[] {
  const errors: string[] = []
  if (!d.name.trim()) errors.push('请填写实验名称')
  for (const [key, label] of [['reps', 'replicates'], ['players', '玩家数'], ['days', '仿真天数']] as const) {
    if (!Number.isSafeInteger(d[key]) || d[key] <= 0) errors.push(`${label}需为正整数`)
  }
  if (d.days < 7) errors.push('D7 留存要求仿真周期至少 7 天')
  if (d.method !== 'ab') {
    if (!Number.isSafeInteger(d.min) || !Number.isSafeInteger(d.max) || d.min <= 0 || d.max < d.min) {
      errors.push('因子范围需要正整数,且最大值不小于最小值')
    }
    if (d.method === 'grid' && (!Number.isSafeInteger(d.step) || d.step <= 0)) errors.push('Grid 步长需要正整数')
    if (d.method === 'random' && (!Number.isSafeInteger(d.samples) || d.samples <= 0)) errors.push('采样数需要正整数')
  }
  for (const key of ['win', 'retention'] as const) {
    if (!Number.isFinite(d.thresholds[key]) || d.thresholds[key] < 0 || d.thresholds[key] > 100) {
      errors.push(`${METRICS[key].label}阈值需在 0–100 之间`)
    }
  }
  if (!Number.isFinite(d.thresholds.gold) || d.thresholds.gold < 0) errors.push('金币阈值需为非负数')
  if (designCounts(d).tasks > DEMO_TASK_BUDGET) {
    errors.push(`当前演示预算上限为 ${DEMO_TASK_BUDGET.toLocaleString()} 次,请缩小实验规模`)
  }
  return errors
}

export const METHOD_INFO: ReadonlyArray<{ id: ExperimentMethod; label: string; desc: string }> = [
  { id: 'ab', label: 'A/B 配对比较', desc: '基线 vs 候选方案' },
  { id: 'grid', label: 'Grid 参数扫描', desc: '等距枚举 · 精确比较' },
  { id: 'random', label: 'Random / LHS', desc: '固定预算 · 空间采样' },
]

export const METHOD_LABEL: Record<ExperimentMethod | 'run', string> = {
  ab: 'A/B',
  grid: 'Grid',
  random: 'Random / LHS',
  run: '运行',
}
