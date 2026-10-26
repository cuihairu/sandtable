// wasm 绑定单例:首次调用时 init(浏览器 fetch bg.wasm),之后复用。
// 绑定层返回 JSON 字符串(ABI 稳通道),这里统一 parse 成类型。
// 桌面壳(Tauri)下不走 wasm:invoke 走 native 命令面,JSON 形状逐字段同构
// (桌面 lib.rs 命令与本绑定同源 core 纯函数,core 直连不经 wasm 边界)。
import init, {
  run_simulation as runSim,
  validate_config as validateCfg,
  param_registry as paramRegistryBinding,
  param_values as paramValuesBinding,
  param_apply as paramApplyBinding,
  kpi_availability as kpiAvailabilityBinding,
  ab_compare as abCompareBinding,
  daily_aggregate as dailyAggregateBinding,
  optimize as optimizeBinding,
  surrogate_train as surrogateTrainBinding,
  surrogate_predict as surrogatePredictBinding,
  sweep_plan as sweepPlanBinding,
  sweep_candidate as sweepCandidateBinding,
  sweep_recommend as sweepRecommendBinding,
} from 'sandtable-wasm'
import { Channel, invoke } from '@tauri-apps/api/core'
import type {
  CandidateResult,
  Comparison,
  DailyAggregation,
  LocalQueryResult,
  OptimResult,
  ParamDefinition,
  RunMetrics,
  SimOutput,
  SimProgress,
  SweepPlan,
  SweepRecOutput,
  SurrogateModel,
  SurrogatePrediction,
  SurrogateTrainOutput,
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

// 参数定义注册表(WB-03.04):静态全量 {path, kind, default, desc},
// 浏览器 wasm 与桌面 native 命令同源 core::registry::all,返回形状逐字段一致。
// 内核没有的可选元信息不出场(缺失保持缺席,不造默认值);desc 是注册表
// zh 原文,译名在前端显示层(displayParamName)。
export async function paramDefinitions(): Promise<ParamDefinition[]> {
  if (isDesktop) return invoke('param_registry')
  await ensureInit()
  return JSON.parse(paramRegistryBinding() as unknown as string) as ParamDefinition[]
}

// 当前配置数值读取(WB-03.05):core read_numeric 的真实生效值,
// 不把注册表 default 当当前值;非数值槽(时长/公式/结构表)缺键 ≠ 0;
// loot/gacha 未配置时返回内核真实生效缺省。u64 槽位(seed/pity_*)走
// 无损通道(WB-03.08):超出 JS 安全整数(2^53−1)的值以十进制字符串
// 表达(string 分支),绝不静默舍入。
export async function paramValues(yaml: string): Promise<Record<string, number | string>> {
  if (isDesktop) return invoke('param_values', { yaml })
  await ensureInit()
  return JSON.parse(paramValuesBinding(yaml) as unknown as string) as Record<string, number | string>
}

// 数值参数应用(WB-03.06):内核寻址 apply_numeric 单条编辑,应用后重验
// (显式性契约在编辑期报错),返回应用后 config_hash 与回读值;未知路径/
// 非数值槽/非法类型抛 配置错误: 前缀字符串(经 classifyWasmError 分类)。
// u64 槽位越界值(> 2^53−1)内核明确拒绝,同样不静默舍入(WB-03.08)。
export type ParamApplyResult = { config_hash: string; path: string; value: number | string }

export async function paramApply(
  yaml: string,
  path: string,
  value: number,
): Promise<ParamApplyResult> {
  if (isDesktop) return invoke('param_apply', { yaml, path, value })
  await ensureInit()
  return JSON.parse(paramApplyBinding(yaml, path, value) as unknown as string) as ParamApplyResult
}

// KPI 可用性(WB-03.09):内核 MetricKey::ALL 逐项 unavailable_reason,
// 返回 [{metric, reason}](空 = 全部可用)。metric 是内核 ID(snake_case),
// reason 是内核中文原文(错误通道原样透传);名称/显示名/可展示格式在
// metricMeta 显示层(内核 ID 与本地化显示名分面)。
export type KpiUnavailable = { metric: string; reason: string }

export async function kpiAvailabilityForTest(yaml: string): Promise<KpiUnavailable[]> {
  const override = (globalThis as {
    __testKpiAvailabilityForReport?: (yaml: string) => Promise<KpiUnavailable[]>
  }).__testKpiAvailabilityForReport
  if (override) return override(yaml)
  return kpiAvailability(yaml)
}

export async function kpiAvailability(yaml: string): Promise<KpiUnavailable[]> {
  if (isDesktop) return invoke('kpi_availability', { yaml })
  await ensureInit()
  return JSON.parse(kpiAvailabilityBinding(yaml) as unknown as string) as KpiUnavailable[]
}

// A/B 统计比较(WB-03.10):双臂 YAML + metric + 双臂**已跑** results 数组
// 进内核 compare_arms——同 base_seed(CRN 成对前提)、指标可用性、逐
// replicate extract(None 不 0 填)与配对统计全部由内核显式判定,前端不另算
// (WB-03.11)。结论 Comparison 与 core::experiment::Comparison 序列化同构
// (types.ts);未知指标/结果解析失败抛 参数错误,成对前提破坏/指标不可用
// 抛 配置错误(内核原文)。
export async function abCompare(
  baseYaml: string,
  candYaml: string,
  metric: string,
  baseResults: RunMetrics[],
  candResults: RunMetrics[],
): Promise<Comparison> {
  if (isDesktop) {
    return invoke('ab_compare', {
      baseYaml,
      candYaml,
      metric,
      resultsAJson: JSON.stringify(baseResults),
      resultsBJson: JSON.stringify(candResults),
    })
  }
  await ensureInit()
  return JSON.parse(
    abCompareBinding(baseYaml, candYaml, metric, JSON.stringify(baseResults), JSON.stringify(candResults)) as unknown as string,
  ) as Comparison
}

// 逐日跨 replicate 聚合(P2 第一步):**已跑** results 数组进内核。
// replicates <2 明确拒绝;天数不一致由内核取公共日并回传裁剪天数/警告;
// 可选指标缺席保持缺席。CI 由内核 SampleStats 口径(t 或 df>30 normal)
// 直出,禁止前端拿单次 days.csv 套置信带。
export async function dailyAggregate(results: RunMetrics[]): Promise<DailyAggregation> {
  // 测试注入点(同 __testKpiAvailabilityForReport 先例):节点 DOM 测试无法
  // fetch 浏览器 wasm,注入同源内核聚合(pkg-node binding)保持真数据源。
  const override = (globalThis as {
    __testDailyAggregate?: (results: RunMetrics[]) => Promise<DailyAggregation>
  }).__testDailyAggregate
  if (override) return override(results)
  if (isDesktop) {
    return invoke('daily_aggregate', { resultsJson: JSON.stringify(results) })
  }
  await ensureInit()
  return JSON.parse(dailyAggregateBinding(JSON.stringify(results)) as unknown as string) as DailyAggregation
}

// 进化寻优(优化与代理视图):**寻优实验 YAML**(scenario + model + optimize
// 三节)进内核,单次调用跑完整个 种群 × (代数+1) × replicates 寻优
// (evolutionary = 字典序适应度;pareto = 约束感知非支配排序)。Web 预算红线
// 与扫描同账(≤200 次仿真),超限内核直接拒绝;内核单次调用无候选级中断
// 边界,不提供取消。
export async function optimizeRun(yaml: string): Promise<OptimResult> {
  // 测试注入点(同 __testDailyAggregate 先例):节点 DOM 测试无法 fetch 浏览器
  // wasm,注入同源内核寻优(pkg-node binding)保持真数据源。
  const override = (globalThis as {
    __testOptimizeRun?: (yaml: string) => Promise<OptimResult>
  }).__testOptimizeRun
  if (override) return override(yaml)
  if (isDesktop) return invoke('optimize', { yaml })
  await ensureInit()
  return JSON.parse(optimizeBinding(yaml) as unknown as string) as OptimResult
}

// 代理训练(P2 自动寻优增量):**已跑**候选结果 → 随机森林。零额外仿真;
// 代理只读 sweep 产物、不进仿真路径(文档 09 红线)。训练账(trained/excluded,
// 内核过滤口径)与特征重要性由内核给出,模型全量 JSON 原样回传预测用。
export interface SurrogateTrainParams {
  trees: number
  max_depth: number
  min_samples_leaf: number
  seed: number
}

export async function surrogateTrain(
  results: readonly CandidateResult[],
  metric: string,
  params: SurrogateTrainParams,
): Promise<SurrogateTrainOutput> {
  const { trees, max_depth, min_samples_leaf, seed } = params
  // 测试注入点:同 __testDailyAggregate(节点 DOM 测试用 pkg-node 同源内核)。
  const override = (globalThis as {
    __testSurrogateTrain?: (
      results: readonly CandidateResult[],
      metric: string,
      params: SurrogateTrainParams,
    ) => Promise<SurrogateTrainOutput>
  }).__testSurrogateTrain
  if (override) return override(results, metric, params)
  if (isDesktop) {
    return invoke('surrogate_train', {
      resultsJson: JSON.stringify(results),
      metric,
      trees,
      maxDepth: max_depth,
      minSamplesLeaf: min_samples_leaf,
      seed,
    })
  }
  await ensureInit()
  return JSON.parse(
    // wasm u64 → JS bigint(wasm-bindgen ABI),超参上限由内核 SurrogateSpec::validate 拦
    surrogateTrainBinding(JSON.stringify(results), metric, trees, max_depth, min_samples_leaf, BigInt(seed)) as unknown as string,
  ) as SurrogateTrainOutput
}

// 代理预测:模型 + 参数点 → 森林均值 + 树间分歧包络(spread_min/spread_max
// 是全部树各自预测的 min/max,描述性散布,**不是统计置信区间**——UI 不得
// 画成置信带;置信带只在内核逐日聚合输出上呈现)。
export async function surrogatePredict(
  model: SurrogateModel,
  params: Record<string, number>,
): Promise<SurrogatePrediction> {
  const modelJson = JSON.stringify(model)
  const paramsJson = JSON.stringify(params)
  // 测试注入点:同 __testDailyAggregate(节点 DOM 测试用 pkg-node 同源内核)。
  const override = (globalThis as {
    __testSurrogatePredict?: (
      model: SurrogateModel,
      params: Record<string, number>,
    ) => Promise<SurrogatePrediction>
  }).__testSurrogatePredict
  if (override) return override(model, params)
  if (isDesktop) {
    return invoke('surrogate_predict', { modelJson, paramsJson })
  }
  await ensureInit()
  return JSON.parse(surrogatePredictBinding(modelJson, paramsJson) as unknown as string) as SurrogatePrediction
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
