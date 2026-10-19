// WB-06 · 实验表单纯逻辑:方法→内核 sweep 模式、因子域校验、KPI 可用性、
// 约束口径换算、计划摘要。与内核契约的对应关系:
// - 模式名与内核 SweepMode 序列化一致(grid/random/latin_hypercube),
//   常量取自 lib/types.ts 的 SWEEP_MODES(WB-03.01 锁形状,此处只读引用);
// - 指标可用语义镜像 experiment.rs MetricKey::unavailable_reason(D3/D7
//   需要 days ≥ 3/7,gacha/loot 指标需要对应 model 节);
// - 比例类指标(retention/win_rate/churn_rate)内核口径 0–1,UI 百分数
//   ×100 展示,写 YAML 时 ÷100(WB-03.03 转换纪律,不静默折算成假口径)。
// 执行/预算不在这里猜:候选与预算只能来自 planSweep(WB-06.10)。
import { SWEEP_MODES } from '../../lib/types.ts'
import type { SweepMode } from '../../lib/types.ts'
import { applyParamEdit, parseConfig, readNumeric, readText } from '../params/configYaml.ts'
import { formatScalar } from '../params/paramsLogic.ts'
import { hashId, ID_PREFIXES } from '../ids.ts'
import { PARAM_REGISTRY, registryParam } from '../params/paramRegistry.ts'
import type { ParamKind } from '../../lib/types.ts'

/** 设计表单方法:ab = A/B 配对比较;sweep = 内核参数扫描。 */
export type DesignerMethod = 'ab' | 'grid' | 'random'

/** 内核 sweep 模式名(必须 ∈ SWEEP_MODES;tests/experiment-form.test.mjs 锁) */
export type SweepModeName = Extract<
  SweepMode,
  'grid' | 'random' | 'latin_hypercube'
>

/** 单个扫描因子(内核 sweep.parameters[<path>] = {min, max, step}) */
export type FactorDraft = {
  /** 参数注册表路径(内核按注册表逐条校验,不在注册表 = 计划失败) */
  path: string
  min: number
  max: number
  /** Grid 步长;random/latin_hypercube 忽略(只用 min/max) */
  step: number
}

/** KPI 约束(内核 sweep.targets = {metric, kind, min?, max?};比例口径 0–1) */
export type ConstraintDraft = {
  metric: string
  kind: 'hard' | 'soft'
  min: number | null
  max: number | null
}

export type DesignDraft = {
  name: string
  method: DesignerMethod
  /** method === 'random' 时:'lhc' → latin_hypercube;'uniform' → random */
  sampling: 'lhc' | 'uniform'
  factors: FactorDraft[]
  /** Random / LHS 候选采样数(内核 sweep.samples;随机/LHS 模式必填) */
  samples: number
  /** replicates = 每候选独立重复运行次数(统计样本量,内核 sweep.replicates) */
  reps: number
  /** KPI 约束目标(内核 sweep.targets;YAML 写比例/绝对值口径) */
  targets: ConstraintDraft[]
}

/** 指标显示与口径(WB-03.09 本地化属性接入前的 zh 简表,仅表单组织) */
export type KpiInfo = {
  label: string
  /** 'ratio' = 比例(0–1,UI 百分数 ×100);'value' = 绝对值(不换算) */
  unit: 'ratio' | 'value'
  unitText: string
}

const KPI_TABLE: Record<string, KpiInfo> = {
  retention_d7: { label: 'D7 留存率', unit: 'ratio', unitText: '%' },
  retention_d3: { label: 'D3 留存率', unit: 'ratio', unitText: '%' },
  win_rate: { label: '战斗胜率', unit: 'ratio', unitText: '%' },
  gold_per_player: { label: '人均金币产出', unit: 'value', unitText: '金币' },
  power_p50: { label: '功率 P50(期末)', unit: 'value', unitText: '功率' },
  churn_rate: { label: '总流失率', unit: 'ratio', unitText: '%' },
  gacha_pulls_to_hit: { label: '到保底抽卡次数', unit: 'value', unitText: '次' },
  loot_gold_per_player: { label: 'Loot 人均金币', unit: 'value', unitText: '金币' },
}

export function kpiInfo(metric: string): KpiInfo | undefined {
  return KPI_TABLE[metric]
}

export const KPI_POOL: readonly string[] = Object.keys(KPI_TABLE)

/** False = 不做换算的指标被误给了换算调用(红线:口径不能混)。 */
export function isRatioMetric(metric: string): boolean {
  const info = KPI_TABLE[metric]
  if (!info) return false
  // 比例语义来自内核字段本身(retention/win_rate/churn_rate ∈ [0,1]);
  // tests/experiment-form.test.mjs 锁该四项与换算,防口径漂移。
  return info.unit === 'ratio'
}

/** UI 百分数 → 内核比例(仅比例类指标;非比例类原样返回并跳过)。 */
export function uiPercentToKernel(metric: string, uiValue: number): number | null {
  if (!Number.isFinite(uiValue)) return null
  return isRatioMetric(metric) ? uiValue / 100 : uiValue
}

/** 内核值 → UI 百分数(仅比例类指标 ×100;显示用,四舍五入防浮点串尾)。 */
export function kernelToUiPercent(metric: string, kernelValue: number): number | null {
  if (!Number.isFinite(kernelValue)) return null
  return isRatioMetric(metric) ? Math.round(kernelValue * 100 * 10000) / 10000 : kernelValue
}

/** method + sampling → 内核 sweep 模式名。 */
export function sweepModeOf(method: DesignerMethod, sampling: 'lhc' | 'uniform'): SweepModeName | null {
  if (method === 'ab') return null
  if (method === 'grid') {
    // grid 模式与 sampling 无关:等距枚举不是随机采样(WB-06.14 隐藏该字段)
    return 'grid'
  }
  const mode: SweepModeName = sampling === 'lhc' ? 'latin_hypercube' : 'random'
  return mode
}

/** 模式名是内核契约的一员(WB-06.04/06.05 序列化名称一致的红线)。 */
export function assertModeInKernelContract(mode: SweepModeName): boolean {
  return (SWEEP_MODES as readonly string[]).includes(mode)
}

/* ————— 因子域校验(WB-06.03) ————— */

/** 可扫描的参数类型:数值通道注册项(u32/u64/i64/f64)。mix 是 cohort 配比
 *  占比、expr/formula/table/dur 不进 sweep 数值域。 */
export const SWEEPABLE_KINDS: readonly ParamKind[] = ['u32', 'u64', 'i64', 'f64']
const INTEGER_KINDS: readonly string[] = ['u32', 'u64', 'i64']

export type FactorCheckContext = {
  method: DesignerMethod
}

export function factorRowError(f: FactorDraft, ctx: FactorCheckContext): string | null {
  const def = registryParam(f.path)
  if (!def) return '路径不在参数注册表'
  if (!SWEEPABLE_KINDS.includes(def.kind)) {
    return `参数类型 ${def.kind} 不支持扫描数值域(可选 u32/u64/i64/f64)`
  }
  if (!Number.isFinite(f.min) || !Number.isFinite(f.max)) return '范围需要有限数'
  if (f.max < f.min) return '最大值不小于最小值'
  if (INTEGER_KINDS.includes(def.kind)) {
    if (!Number.isSafeInteger(f.min) || !Number.isSafeInteger(f.max) || f.min < 0) {
      return `${def.kind} 参数范围需要非负整数`
    }
    if (ctx.method === 'grid' && (!Number.isSafeInteger(f.step) || f.step <= 0)) {
      return `${def.kind} 参数的 Grid 步长需要正整数`
    }
  } else if (ctx.method === 'grid' && (!Number.isFinite(f.step) || f.step <= 0)) {
    return 'Grid 步长需要正数'
  }
  return null
}

/* ————— 场景字段读取(WB-06.06:直接读场景 YAML,不存草稿副本) ————— */

export type ScenarioStats = {
  players: number | null
  days: number | null
  /** '30d' 源文本 */
  durationText: string | null
  seed: number | null
  mix: { casual: number | null; core: number | null; whale: number | null }
  errors: string[]
}

/** 从候选(或实验)YAML 读场景面:population/duration/seed/population_mix。
 *  缺值如实 null(不回退注册默认,WB-05.03 纪律)。 */
export function scenarioStats(yaml: string): ScenarioStats {
  const parsed = parseConfig(yaml)
  const errors: string[] = [...(parsed.errors.length > 0 ? parsed.errors.map((e) => `第 ${e.line} 行:${e.message}`) : [])]
  const num = (path: string): number | null => {
    const v = readNumeric(parsed, path)
    if (v === undefined) return null
    return v
  }
  const players = num('scenario.population')
  const durationText = readText(parsed, 'scenario.duration')
  let days: number | null = null
  if (durationText === null) errors.push('缺少 scenario.duration;KPI 可用性与规模指标未定')
  else {
    const m = /^(\d+)\s*d$/i.exec(durationText.trim())
    if (m) days = Number(m[1])
    else errors.push(`scenario.duration「${durationText}」不是 Nd 形式`)
  }
  const seed = readNumeric(parsed, 'scenario.seed') ?? null
  if (seed === null) errors.push('缺少 scenario.seed(CRN 配对依赖两侧共用该种子)')
  if (players === null) errors.push('缺少 scenario.population')
  const mix = {
    casual: num('scenario.population_mix.casual'),
    core: num('scenario.population_mix.core'),
    whale: num('scenario.population_mix.whale'),
  }
  if (mix.casual === null && mix.core === null && mix.whale === null) {
    errors.push('缺少 scenario.population_mix 配比')
  }
  return { players, days, durationText, seed, mix, errors }
}

/* ————— KPI 可用性(WB-06.07,语义镜像 experiment.rs unavailable_reason) ————— */

export type KpiAvailability = {
  ok: boolean
  /** 内核口径的不可用原因(≥7 天 / 配置节存在等);可用时为 null */
  reason: string | null
}

export function kpiAvailability(yaml: string): Record<string, KpiAvailability> {
  const parsed = parseConfig(yaml)
  const stats = scenarioStats(yaml)
  const days = stats.days
  const hasGacha = parsed.leaves.some((l) => l.path.startsWith('model.gacha.'))
  const hasLoot = parsed.leaves.some((l) => l.path.startsWith('model.loot.'))
  const out: Record<string, KpiAvailability> = {}
  for (const metric of KPI_POOL) {
    let reason: string | null = null
    if (metric === 'retention_d7' && (days === null || days < 7)) {
      reason = days === null ? 'retention_d7 需要 scenario.duration ≥ 7d,当前未读到天数' : 'retention_d7 需要 days ≥ 7,当前配置不足'
    } else if (metric === 'retention_d3' && (days === null || days < 3)) {
      reason = days === null ? 'retention_d3 需要 scenario.duration ≥ 3d,当前未读到天数' : 'retention_d3 需要 days ≥ 3,当前配置不足'
    } else if (metric === 'gacha_pulls_to_hit' && !hasGacha) {
      reason = 'gacha_pulls_to_hit 需要 model.gacha 配置,当前未配置'
    } else if (metric === 'loot_gold_per_player' && !hasLoot) {
      reason = 'loot_gold_per_player 需要 model.loot 配置,当前未配置'
    }
    out[metric] = { ok: reason === null, reason }
  }
  return out
}

/* ————— 表单级校验(WB-06.03/04/05/06/07 入口;预算不在这里算) ————— */

export type DesignError = {
  scope: 'name' | 'factors' | 'sampling' | 'reps' | 'kpi' | 'scenario'
  /** 定位栏(因子路径 / 指标) */
  locator: string | null
  message: string
}

export type DesignContext = {
  /** 每个 KPI 的可用性(来自 kpiAvailability(WB-06.07)) */
  availability: Record<string, KpiAvailability>
}

export function designErrors(design: DesignDraft, ctx: DesignContext): DesignError[] {
  const errors: DesignError[] = []
  if (!design.name.trim()) errors.push({ scope: 'name', locator: null, message: '请填写实验名称' })
  if (!Number.isSafeInteger(design.reps) || design.reps < 1) {
    errors.push({ scope: 'reps', locator: null, message: 'replicates 需要正整数' })
  }
  if (design.method === 'ab') {
    // A/B:约束目标不参与内核 sweep;结果显示另有 WB-03.10 桥接。
    return errors
  }
  if (design.factors.length === 0) {
    errors.push({ scope: 'factors', locator: null, message: '至少需要一个扫描因子' })
  }
  const seen = new Set<string>()
  for (const f of design.factors) {
    const message = factorRowError(f, { method: design.method })
    if (message) errors.push({ scope: 'factors', locator: f.path, message })
    if (seen.has(f.path)) {
      errors.push({ scope: 'factors', locator: f.path, message: '因子路径重复' })
    }
    seen.add(f.path)
  }
  if (design.method === 'random') {
    if (!Number.isSafeInteger(design.samples) || design.samples < 1) {
      errors.push({ scope: 'sampling', locator: null, message: '采样数需要正整数' })
    } else if (design.samples > 10000) {
      errors.push({ scope: 'sampling', locator: null, message: '采样数超过内核上限 10000' })
    }
  }
  for (const t of design.targets) {
    const av = ctx.availability[t.metric]
    if (!av || !av.ok) {
      errors.push({ scope: 'kpi', locator: t.metric, message: av?.reason ?? '指标不在内核可选清单' })
      continue
    }
    if (t.min === null && t.max === null) {
      errors.push({ scope: 'kpi', locator: t.metric, message: `${KPI_TABLE[t.metric]?.label ?? t.metric} 的约束需要至少给出 min 或 max` })
    } else if (t.min !== null && t.max !== null && t.min > t.max) {
      errors.push({ scope: 'kpi', locator: t.metric, message: `${KPI_TABLE[t.metric]?.label ?? t.metric} 的 min 大于 max` })
    } else if (isRatioMetric(t.metric) && [t.min, t.max].some((v) => v !== null && (v < 0 || v > 1))) {
      errors.push({ scope: 'kpi', locator: t.metric, message: `${KPI_TABLE[t.metric]?.label ?? t.metric} 是比例口径(0–1),越界即 UI 百分数口径未换算` })
    }
  }
  return errors
}

/* ————— 计划摘要(WB-06.12:数字全部来自内核 planSweep 返回) ————— */

export type PlanShape = {
  config_hash: string
  players: number
  days: number
  base_seed: number
  replicates: number
  mode: string
  axes: ReadonlyArray<{ path: string; min: number; max: number; step: number }>
  candidates: ReadonlyArray<Record<string, number>>
  targets: ReadonlyArray<unknown>
  sims: number
}

export type PlanSummary = {
  candidates: number
  replicates: number
  sims: number
  playerDays: number
  mode: string
  baseSeed: number
  configHash: string
}

export function planSummary(plan: PlanShape): PlanSummary {
  return {
    candidates: plan.candidates.length,
    replicates: plan.replicates,
    sims: plan.sims,
    playerDays: plan.sims * plan.players * plan.days,
    mode: String(plan.mode),
    baseSeed: plan.base_seed,
    configHash: plan.config_hash,
  }
}

/** A/B 没有内核 sweep 计划:数量 = 2 方案 × replicates(仅演示队列计数字段)。 */
export function abTaskCount(reps: number): number {
  return 2 * reps
}

/* ————— 方法切换的输入保留(WB-06.14) ————— */

/** 切换方法:sweep 方法之间保留因子 min/max(共享域)、samples、reps、
 *  targets;A/B ↔ sweep 之间保留 reps/samples/targets。返回新草稿。 */
export function preserveOnMethodSwitch(
  prev: DesignDraft,
  method: DesignerMethod,
): DesignDraft {
  if (prev.method === method) return prev
  // sampling 只在 random 方法有意义;离开 random 时字段隐藏、值保留,
  // 避免来回切换丢失用户已选的 LHS/均匀语义。
  return { ...prev, method }
}

/* ————— 提交单飞守卫(WB-06.15:双击只创建一个任务) ————— */

export function createSubmitGuard(): () => boolean {
  let inFlight = false
  return () => {
    if (inFlight) return false
    inFlight = true
    return true
  }
}

/* ————— 计划预览版本门(WB-06.11):晚返回的旧计划不得落位 ————— */

export function createPlanGate() {
  let latest = 0
  return {
    /** 每次新请求发放版本号 */
    next(): number {
      return ++latest
    },
    /** 响应返回时判断其请求版本是否仍是最新(旧响应直接丢弃) */
    accept(seq: number): boolean {
      return seq === latest
    },
  }
}

/* ————— 场景节编辑(WB-06.06:population/duration/seed/配比) ————— */

/** 场景叶值编辑的定位(与 ScenarioForm 的字段一一对应) */
export type ScenarioLeaf =
  | 'population'
  | 'duration_days'
  | 'seed'
  | 'mix_casual'
  | 'mix_core'
  | 'mix_whale'

export type ScenarioEditOutcome =
  | { ok: true; yaml: string; path: string }
  | { ok: false; why: string }

/** 场景(YAML)叶值编辑:行级外科手术写回;失败返回原 YAML + 原因。
 *  配比是 UI 百分数入参 → 自动 ÷100 写比例(WB-06.08 同一转换纪律)。 */
export function applyScenarioLeaf(yaml: string, leaf: ScenarioLeaf, text: string): ScenarioEditOutcome {
  const t = text.trim()
  if (t === '') return { ok: false, why: '内容为空,未写入' }
  const parsed = parseConfig(yaml)
  const edit = (path: string, newText: string): ScenarioEditOutcome => {
    const outcome = applyParamEdit(yaml, parsed, path, newText)
    return outcome.ok ? { ok: true, yaml: outcome.yaml, path } : { ok: false, why: `${path} 写入失败:${outcome.error}` }
  }
  switch (leaf) {
    case 'population': {
      const n = Number(t)
      if (!Number.isSafeInteger(n) || n < 1) return { ok: false, why: '玩家数需为正整数(scenario.population)' }
      return edit('scenario.population', String(n))
    }
    case 'duration_days': {
      if (!/^\d+$/.test(t)) return { ok: false, why: '仿真天数需为非负整数,写入 Nd 形式' }
      return edit('scenario.duration', `${Number(t)}d`)
    }
    case 'seed': {
      if (!/^\d+$/.test(t)) return { ok: false, why: 'seed 为 u64 非负整数(文本提交防大整数精度丢失)' }
      return edit('scenario.seed', t)
    }
    case 'mix_casual':
    case 'mix_core':
    case 'mix_whale': {
      const n = Number(t)
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return { ok: false, why: '配比为 UI 百分数(0–100);YAML 自动 ÷100 写比例' }
      }
      const path = `scenario.population_mix.${leaf.slice(4)}`
      return edit(path, formatScalar(n / 100))
    }
  }
}

/* ————— KPI 阈值输入(WB-06.08:UI 百分数 ⇄ 比例;空串 = 清除) ————— */

export type ThresholdOutcome =
  | { ok: true; value: number | null; kernelText: string | null }
  | { ok: false; why: string }

/** UI 文本 → 内核口径:比例类指标 ÷100;绝对值类原样;空串 = 清除(null)。 */
export function thresholdFromUi(metric: string, field: 'min' | 'max', text: string): ThresholdOutcome {
  const t = text.trim()
  void field
  if (t === '') return { ok: true, value: null, kernelText: null }
  const n = Number(t)
  if (!Number.isFinite(n)) return { ok: false, why: `${metric} ${field} 需为数值` }
  const value = uiPercentToKernel(metric, n)
  if (isRatioMetric(metric) && value !== null && (value < 0 || value > 1)) {
    return { ok: false, why: `${metric} 是比例口径:UI 百分数应为 0–100` }
  }
  return { ok: true, value, kernelText: value === null ? null : formatScalar(value) }
}

/* ————— 实验 ID(WB-06.01:方法+名称+项目派生,非固定样例对象) ————— */

/** 实验身份 = 项目键(项目 ID 或 'yaml-draft') + 方法 + 名称 的内容派生 ID。 */
export function experimentScopedId(projectKey: string, design: Pick<DesignDraft, 'method' | 'name'>): string {
  return String(hashId(ID_PREFIXES.experiment, projectKey, `${design.method}:${design.name.trim() || '未命名'}`))
}


/* ————— 展示与文案 ————— */

/** 内核预算 / 校验错误的可读整理 + 可行操作(不编造数字,引用内核原文)。 */
export function planErrorLines(message: string): string[] {
  return message.split(/\n+/).filter((line) => line.trim() !== '')
}

/* ————— WB-06.13 · 预算类内核错误的可行操作提示(不编造数字) ————— */

export function budgetActions(message: string): string | null {
  return /预算/.test(message)
    ? '可行操作:缩小因子范围或加大步长(降低候选数)、减少 replicates,或改用桌面端(更大预算)再提交'
    : null
}

export const METHOD_INFO: ReadonlyArray<{ id: DesignerMethod; label: string; desc: string }> = [
  { id: 'ab', label: 'A/B 配对比较', desc: '基线 vs 候选 · 两侧共用 seed' },
  { id: 'grid', label: 'Grid 参数扫描', desc: '等距枚举 · 精确比较' },
  { id: 'random', label: 'Random / LHS', desc: '固定采样预算 · 空间采样' },
]

export const METHOD_LABEL: Record<DesignerMethod | 'run', string> = {
  ab: 'A/B',
  grid: 'Grid',
  random: 'Random / LHS',
  run: '运行',
}

/** 默认草稿:默认值取注册表逐字默认(pokemon 口径),网格域按 examples
 *  pokemon-sweep(attack 20–220 步 40),replicates 4(文档 11 章 R 5–10 内取小)。 */
export function defaultDesign(): DesignDraft {
  return {
    name: '初始攻击力扫描',
    method: 'grid',
    sampling: 'lhc',
    factors: [{ path: 'model.warrior.attack', min: 20, max: 220, step: 40 }],
    samples: 12,
    reps: 4,
    targets: [
      { metric: 'churn_rate', kind: 'hard', min: 0.0, max: 0.2 },
      { metric: 'retention_d7', kind: 'hard', min: 0.9, max: 1.0 },
    ],
  }
}

/** 注册表中可扫描参数(u32/u64/i64/f64)— 因子下拉数据源。 */
export function sweepableParams(): ReadonlyArray<{ path: string; kind: ParamKind; desc: string }> {
  return PARAM_REGISTRY
    .filter((p) => SWEEPABLE_KINDS.includes(p.kind))
    .map((p) => ({ path: p.path, kind: p.kind, desc: p.desc }))
}
