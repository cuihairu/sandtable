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
import { t } from '../../lib/i18n/index.ts'
import type { Locale, TranslationKey, InterpolationParams } from '../../lib/i18n/index.ts'

/** WB-11.13:逻辑层错误串的回退语言 = 中文真值源(不取站点默认 en-US)。
 *  校验串语义由节点侧测试锁中文子串(experiment-form/workbench-logic),
 *  且中文词典是真值源;界面调用一律显式传 locale,缺省只影响纯逻辑消费方。 */
const LOGIC_FALLBACK: Locale = 'zh-CN'

/** WB-11.13:逻辑层错误串可选带 locale;缺省按 LOGIC_FALLBACK(zh-CN)出。 */
function msg(locale: Locale | undefined, key: TranslationKey, params?: InterpolationParams): string {
  return t(locale ?? LOGIC_FALLBACK, key, params)
}

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

/** 指标 id → 词典键(显示名走词典;id 本身稳定,参与内核契约与序列化) */
const KPI_LABEL_KEY: Record<string, 'analysis.kpi.retention_d7' | 'analysis.kpi.retention_d3' | 'analysis.kpi.win_rate' | 'analysis.kpi.gold_per_player' | 'analysis.kpi.power_p50' | 'analysis.kpi.churn_rate' | 'analysis.kpi.gacha_pulls_to_hit' | 'analysis.kpi.loot_gold_per_player'> = {
  retention_d7: 'analysis.kpi.retention_d7',
  retention_d3: 'analysis.kpi.retention_d3',
  win_rate: 'analysis.kpi.win_rate',
  gold_per_player: 'analysis.kpi.gold_per_player',
  power_p50: 'analysis.kpi.power_p50',
  churn_rate: 'analysis.kpi.churn_rate',
  gacha_pulls_to_hit: 'analysis.kpi.gacha_pulls_to_hit',
  loot_gold_per_player: 'analysis.kpi.loot_gold_per_player',
}

/** WB-11.14:指标显示名(KPI_TABLE.label 是 zh 回退源;未登记指标原样返回 id) */
export function kpiDisplayName(metric: string, locale?: Locale): string {
  const key = KPI_LABEL_KEY[metric]
  if (key !== undefined) return msg(locale, key)
  return KPI_TABLE[metric]?.label ?? metric
}

/** 单位后缀词典键(约束表/坐标轴共用;percent 两种语言同为 %) */
const KPI_UNIT_KEY: Record<string, 'analysis.kpiUnit.percent' | 'analysis.kpiUnit.gold' | 'analysis.kpiUnit.power' | 'analysis.kpiUnit.count'> = {
  retention_d7: 'analysis.kpiUnit.percent',
  retention_d3: 'analysis.kpiUnit.percent',
  win_rate: 'analysis.kpiUnit.percent',
  gold_per_player: 'analysis.kpiUnit.gold',
  power_p50: 'analysis.kpiUnit.power',
  churn_rate: 'analysis.kpiUnit.percent',
  gacha_pulls_to_hit: 'analysis.kpiUnit.count',
  loot_gold_per_player: 'analysis.kpiUnit.gold',
}

/** WB-11.14:单位后缀(KPI_TABLE.unitText 是 zh 回退源) */
export function kpiUnitText(metric: string, locale?: Locale): string {
  const key = KPI_UNIT_KEY[metric]
  if (key !== undefined) return msg(locale, key)
  return KPI_TABLE[metric]?.unitText ?? ''
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
  /** 错误文案语言(WB-11.13;缺省 zh-CN) */
  locale?: Locale
}

export function factorRowError(f: FactorDraft, ctx: FactorCheckContext): string | null {
  const def = registryParam(f.path)
  if (!def) return msg(ctx.locale, 'experiment.errFactorNotRegistered')
  if (!SWEEPABLE_KINDS.includes(def.kind)) {
    return msg(ctx.locale, 'experiment.errKindNotSweepable', { kind: def.kind })
  }
  if (!Number.isFinite(f.min) || !Number.isFinite(f.max)) return msg(ctx.locale, 'experiment.errRangeFinite')
  if (f.max < f.min) return msg(ctx.locale, 'experiment.errMaxLtMin')
  if (INTEGER_KINDS.includes(def.kind)) {
    if (!Number.isSafeInteger(f.min) || !Number.isSafeInteger(f.max) || f.min < 0) {
      return msg(ctx.locale, 'experiment.errIntegerRange', { kind: def.kind })
    }
    if (ctx.method === 'grid' && (!Number.isSafeInteger(f.step) || f.step <= 0)) {
      return msg(ctx.locale, 'experiment.errGridStepInt', { kind: def.kind })
    }
  } else if (ctx.method === 'grid' && (!Number.isFinite(f.step) || f.step <= 0)) {
    return msg(ctx.locale, 'experiment.errGridStepPositive')
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
 *  缺值如实 null(不回退注册默认,WB-05.03 纪律)。
 *  错误串语言可选(WB-11.13),缺省 zh-CN。 */
export function scenarioStats(yaml: string, locale?: Locale): ScenarioStats {
  const parsed = parseConfig(yaml)
  const errors: string[] = [
    ...(parsed.errors.length > 0
      ? parsed.errors.map((e) => msg(locale, 'params.yamlErrorLine', { line: e.line, message: e.message }))
      : []),
  ]
  const num = (path: string): number | null => {
    const v = readNumeric(parsed, path)
    if (v === undefined) return null
    return v
  }
  const players = num('scenario.population')
  const durationText = readText(parsed, 'scenario.duration')
  let days: number | null = null
  if (durationText === null) errors.push(msg(locale, 'experiment.errScenarioNoDuration'))
  else {
    const m = /^(\d+)\s*d$/i.exec(durationText.trim())
    if (m) days = Number(m[1])
    else errors.push(msg(locale, 'experiment.errScenarioDurationBad', { text: durationText }))
  }
  const seed = readNumeric(parsed, 'scenario.seed') ?? null
  if (seed === null) errors.push(msg(locale, 'experiment.errScenarioNoSeed'))
  if (players === null) errors.push(msg(locale, 'experiment.errScenarioNoPopulation'))
  const mix = {
    casual: num('scenario.population_mix.casual'),
    core: num('scenario.population_mix.core'),
    whale: num('scenario.population_mix.whale'),
  }
  if (mix.casual === null && mix.core === null && mix.whale === null) {
    errors.push(msg(locale, 'experiment.errScenarioNoMix'))
  }
  return { players, days, durationText, seed, mix, errors }
}

/* ————— KPI 可用性(WB-06.07,语义镜像 experiment.rs unavailable_reason) ————— */

export type KpiAvailability = {
  ok: boolean
  /** 内核口径的不可用原因(≥7 天 / 配置节存在等);可用时为 null */
  reason: string | null
}

export function kpiAvailability(yaml: string, locale?: Locale): Record<string, KpiAvailability> {
  const parsed = parseConfig(yaml)
  const stats = scenarioStats(yaml, locale)
  const days = stats.days
  const hasGacha = parsed.leaves.some((l) => l.path.startsWith('model.gacha.'))
  const hasLoot = parsed.leaves.some((l) => l.path.startsWith('model.loot.'))
  const out: Record<string, KpiAvailability> = {}
  for (const metric of KPI_POOL) {
    let reason: string | null = null
    if (metric === 'retention_d7' && (days === null || days < 7)) {
      reason = days === null ? msg(locale, 'experiment.errD7NoDays') : msg(locale, 'experiment.errD7Short')
    } else if (metric === 'retention_d3' && (days === null || days < 3)) {
      reason = days === null ? msg(locale, 'experiment.errD3NoDays') : msg(locale, 'experiment.errD3Short')
    } else if (metric === 'gacha_pulls_to_hit' && !hasGacha) {
      reason = msg(locale, 'experiment.errKpiNeedGacha')
    } else if (metric === 'loot_gold_per_player' && !hasLoot) {
      reason = msg(locale, 'experiment.errKpiNeedLoot')
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
  /** 错误文案语言(WB-11.13;缺省 zh-CN) */
  locale?: Locale
}

export function designErrors(design: DesignDraft, ctx: DesignContext): DesignError[] {
  const locale = ctx.locale
  const errors: DesignError[] = []
  if (!design.name.trim()) errors.push({ scope: 'name', locator: null, message: msg(locale, 'experiment.errNameRequired') })
  if (!Number.isSafeInteger(design.reps) || design.reps < 1) {
    errors.push({ scope: 'reps', locator: null, message: msg(locale, 'experiment.errRepsPositive') })
  }
  if (design.method === 'ab') {
    // A/B:约束目标不参与内核 sweep;结果显示另有 WB-03.10 桥接。
    return errors
  }
  if (design.factors.length === 0) {
    errors.push({ scope: 'factors', locator: null, message: msg(locale, 'experiment.errFactorMin') })
  }
  const seen = new Set<string>()
  for (const f of design.factors) {
    const message = factorRowError(f, { method: design.method, locale })
    if (message) errors.push({ scope: 'factors', locator: f.path, message })
    if (seen.has(f.path)) {
      errors.push({ scope: 'factors', locator: f.path, message: msg(locale, 'experiment.errFactorDup') })
    }
    seen.add(f.path)
  }
  if (design.method === 'random') {
    if (!Number.isSafeInteger(design.samples) || design.samples < 1) {
      errors.push({ scope: 'sampling', locator: null, message: msg(locale, 'experiment.errSamplesPositive') })
    } else if (design.samples > 10000) {
      errors.push({ scope: 'sampling', locator: null, message: msg(locale, 'experiment.errSamplesCap') })
    }
  }
  for (const target of design.targets) {
    const av = ctx.availability[target.metric]
    if (!av || !av.ok) {
      errors.push({ scope: 'kpi', locator: target.metric, message: av?.reason ?? msg(locale, 'experiment.errKpiUnknown') })
      continue
    }
    const label = kpiDisplayName(target.metric, locale)
    if (target.min === null && target.max === null) {
      errors.push({ scope: 'kpi', locator: target.metric, message: msg(locale, 'experiment.errKpiNeedBound', { label }) })
    } else if (target.min !== null && target.max !== null && target.min > target.max) {
      errors.push({ scope: 'kpi', locator: target.metric, message: msg(locale, 'experiment.errKpiMinGtMax', { label }) })
    } else if (isRatioMetric(target.metric) && [target.min, target.max].some((v) => v !== null && (v < 0 || v > 1))) {
      errors.push({ scope: 'kpi', locator: target.metric, message: msg(locale, 'experiment.errKpiRatioRange', { label }) })
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
 *  配比是 UI 百分数入参 → 自动 ÷100 写比例(WB-06.08 同一转换纪律)。
 *  失败原因语言可选(WB-11.13),缺省 zh-CN。 */
export function applyScenarioLeaf(yaml: string, leaf: ScenarioLeaf, text: string, locale?: Locale): ScenarioEditOutcome {
  const value = text.trim()
  if (value === '') return { ok: false, why: msg(locale, 'experiment.errLeafEmpty') }
  const parsed = parseConfig(yaml)
  const edit = (path: string, newText: string): ScenarioEditOutcome => {
    const outcome = applyParamEdit(yaml, parsed, path, newText)
    return outcome.ok
      ? { ok: true, yaml: outcome.yaml, path }
      : { ok: false, why: msg(locale, 'experiment.errLeafWrite', { path, error: outcome.error }) }
  }
  switch (leaf) {
    case 'population': {
      const n = Number(value)
      if (!Number.isSafeInteger(n) || n < 1) return { ok: false, why: msg(locale, 'experiment.errPopulationInt') }
      return edit('scenario.population', String(n))
    }
    case 'duration_days': {
      if (!/^\d+$/.test(value)) return { ok: false, why: msg(locale, 'experiment.errDaysInt') }
      return edit('scenario.duration', `${Number(value)}d`)
    }
    case 'seed': {
      if (!/^\d+$/.test(value)) return { ok: false, why: msg(locale, 'experiment.errSeedInt') }
      return edit('scenario.seed', value)
    }
    case 'mix_casual':
    case 'mix_core':
    case 'mix_whale': {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return { ok: false, why: msg(locale, 'experiment.errMixPercent') }
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

/** UI 文本 → 内核口径:比例类指标 ÷100;绝对值类原样;空串 = 清除(null)。
 *  失败原因语言可选(WB-11.13),缺省 zh-CN。 */
export function thresholdFromUi(metric: string, field: 'min' | 'max', text: string, locale?: Locale): ThresholdOutcome {
  const trimmed = text.trim()
  void field
  if (trimmed === '') return { ok: true, value: null, kernelText: null }
  const n = Number(trimmed)
  if (!Number.isFinite(n)) return { ok: false, why: msg(locale, 'experiment.errThresholdNumber', { metric, field }) }
  const value = uiPercentToKernel(metric, n)
  if (isRatioMetric(metric) && value !== null && (value < 0 || value > 1)) {
    return { ok: false, why: msg(locale, 'experiment.errThresholdRatio', { metric }) }
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

/** 提示文案语言可选(WB-11.13),缺省 zh-CN;触发词匹配保持中文「预算」
 *  (内核错误消息当前为中文原文,匹配不随 UI 语言漂移)。 */
export function budgetActions(message: string, locale?: Locale): string | null {
  return /预算/.test(message) ? msg(locale, 'experiment.budgetHint') : null
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
