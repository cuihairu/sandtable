// WB-12 · 多维扫描设计(L364)· 纯逻辑,节点可测,无 React/i18n 依赖。
// 复用现有扫描与推荐能力:本层只在与内核 core::sweep 相同的口径上做
// **设计期预演**与**结果期整理**,不另起一套扫描语义:
// - 离散水平:grid_levels 与内核 ParamRange::grid_points 同口径
//   (min + k·step,k = 0..=floor((max−min)/step+1e-9),不补尾点);
// - 组合预算:与内核 SweepSpec::plan 的「先算账后物化」同账本
//   (逐维水平数饱和乘积,超过 MAX_CANDIDATES 即拒;上限数值与内核一致);
// - Random/LHS 预算:samples ∈ [1, MAX_CANDIDATES](内核同限);
// - 重复候选处理:参数域完全相同的计划槽归组(应用侧候选 ID 内容寻址,
//   同域恒同 ID,天然聚合;本层给出组与计数供展示);
// - 失败点追踪:计划槽位 × 实际返回整理为 ok / config_error / 未返回,
//   config_error 消息逐字保留(内核输出,不转写)。
// 内核计划仍是唯一真值源:本层预算预演不替代内核 planSweep 校验。

/** 单个候选规模上限(与内核 core::sweep::MAX_CANDIDATES 一致的兜底口径) */
export const MAX_CANDIDATES = 10_000

/** 单个扫描因子的取值域(lib/types.ts SweepAxis 同形) */
export type AxisDomain = { readonly path: string; readonly min: number; readonly max: number; readonly step: number }

export type DomainError =
  | 'not_finite'
  | 'max_lt_min'
  | 'step_not_positive'

export type DomainCheck =
  | { ok: true }
  | { ok: false; error: DomainError; path: string }

/** 范围合法性(与内核 ParamRange::check 同则:有限、step>0、min≤max) */
export function checkDomain(axis: AxisDomain): DomainCheck {
  const bad = (error: DomainError): DomainCheck => ({ ok: false, error, path: axis.path })
  if (!Number.isFinite(axis.min) || !Number.isFinite(axis.max) || !Number.isFinite(axis.step)) return bad('not_finite')
  if (axis.max < axis.min) return bad('max_lt_min')
  if (axis.step <= 0) return bad('step_not_positive')
  return { ok: true }
}

/** 单轴离散水平(内核 grid_points 同口径;不补尾点)。非法域返回 null。 */
export function gridLevels(axis: AxisDomain): number[] | null {
  if (!checkDomain(axis).ok) return null
  const steps = Math.floor((axis.max - axis.min) / axis.step + 1e-9)
  return Array.from({ length: steps + 1 }, (_, k) => axis.min + k * axis.step)
}

/** 每因子离散水平(Random/LHS 连续采样无水平表 → null,不编造) */
export function factorLevels(axes: readonly AxisDomain[]): Array<{ path: string; levels: number[] } | null> {
  return axes.map((a) => {
    const levels = gridLevels(a)
    return levels === null ? null : { path: a.path, levels }
  })
}

export type CombinationBudget =
  | { ok: true; total: number; perAxis: Array<{ path: string; levels: number }> }
  | { ok: false; total: number; reason: 'invalid_domain' | 'over_budget'; detail: string }

/**
 * Grid 组合预算:逐维水平数的饱和乘积(先算账后物化,内核同账本)。
 * total 是最后一次安全计算的累计值(溢出时为饱和值),供「超上限」展示。
 */
export function combinationBudget(axes: readonly AxisDomain[]): CombinationBudget {
  let total = 1
  const perAxis: Array<{ path: string; levels: number }> = []
  for (const axis of axes) {
    const levels = gridLevels(axis)
    if (levels === null) {
      return { ok: false, total, reason: 'invalid_domain', detail: axis.path }
    }
    perAxis.push({ path: axis.path, levels: levels.length })
    total = Math.min(MAX_CANDIDATES + 1, total * levels.length)
    if (total > MAX_CANDIDATES) {
      return { ok: false, total, reason: 'over_budget', detail: axis.path }
    }
  }
  return { ok: true, total, perAxis }
}

/** Random/LHS 采样预算(sweep.samples;内核 validate 同则) */
export type SamplingBudget = { ok: true } | { ok: false; reason: 'not_positive' | 'over_budget' }

export function samplingBudget(samples: number): SamplingBudget {
  if (!Number.isSafeInteger(samples) || samples < 1) return { ok: false, reason: 'not_positive' }
  if (samples > MAX_CANDIDATES) return { ok: false, reason: 'over_budget' }
  return { ok: true }
}

/* ————— 重复候选处理 ————— */

export type DuplicateGroup = { key: string; indices: number[] }

export type DuplicateReport = {
  /** 唯一参数域个数 */
  uniqueCount: number
  /** 与既有域重复的计划槽个数(= candidates.length − uniqueCount) */
  duplicateSlots: number
  /** 仅含有 ≥2 槽的组;indices 按计划序 */
  groups: DuplicateGroup[]
}

/** 候选参数域的规范键:按路径排序后逐项 `path=value` 连接(浮点原样)。 */
export function candidateDomainKey(values: Readonly<Record<string, number>>): string {
  return Object.keys(values)
    .sort()
    .map((p) => `${p}=${values[p]}`)
    .join('|')
}

/**
 * 重复候选归组(重复候选处理):参数域完全相同的计划槽共享同一条内容寻址
 * 候选 ID;运行侧逐槽照跑(内核不合并),展示/聚合侧按组收敛。
 */
export function duplicateGroups(candidates: readonly Readonly<Record<string, number>>[]): DuplicateReport {
  const byKey = new Map<string, DuplicateGroup>()
  candidates.forEach((values, index) => {
    const key = candidateDomainKey(values)
    const group = byKey.get(key)
    if (group) group.indices.push(index)
    else byKey.set(key, { key, indices: [index] })
  })
  const groups: DuplicateGroup[] = []
  for (const g of byKey.values()) if (g.indices.length > 1) groups.push(g)
  return {
    uniqueCount: byKey.size,
    duplicateSlots: candidates.length - byKey.size,
    groups,
  }
}

/* ————— 失败点追踪 ————— */

/** 内核候选返回的最小形状(lib/types.ts CandidateResult 的只读投影) */
export type CandidateSlotResult = {
  readonly status: 'ok' | { readonly config_error: string }
}

export type FailedPoint = {
  /** 计划槽位(与 plan.candidates 下标一致) */
  index: number
  values: Readonly<Record<string, number>>
  /** config_error 消息(内核原文,逐字保留) */
  message: string
}

export type FailureTracking = {
  ok: number
  /** 配置错误候选:保留在结果集,不静默丢弃(内核约定) */
  configErrors: FailedPoint[]
  /** 已计划但尚无返回的槽位(运行中/取消/失败):留空,不补 0 */
  missing: FailedPoint[]
}

export function trackFailedPoints(
  candidates: readonly Readonly<Record<string, number>>[],
  results: ReadonlyArray<CandidateSlotResult | null>,
): FailureTracking {
  const out: FailureTracking = { ok: 0, configErrors: [], missing: [] }
  const limit = Math.min(candidates.length, results.length)
  candidates.forEach((values, index) => {
    const r = index < limit ? results[index] : null
    if (r === null || r === undefined) out.missing.push({ index, values, message: '' })
    else if (r.status === 'ok') out.ok += 1
    else out.configErrors.push({ index, values, message: r.status.config_error })
  })
  return out
}
