// WB-08.12 · A/B 分析视图语义层(纯函数,节点可测):逐 KPI 配对效应分面。
// 数据源 = 内核 compare_arms 逐指标直出的 Comparison(lib/types.ts 同构);
// 本层只做显示派生(相对变化、显著性读数、分面轴设置),绝不重算任何统计、
// 绝不覆写内核判定、绝不把不可用指标画成 0(纪律同 analysisView.ts)。
// 铁则:不同单位的 KPI 各占一个分面、各用一根轴——分面轴域由 effectDomain
// 逐分面独立计算,聚合图层面不存在跨指标共用轴的可能。
import { METRIC_KEYS } from './types.ts'
import type { Comparison, ComparisonFailure, MetricKey, SampleStats } from './types.ts'
import { METRIC_META } from './metricMeta.ts'
import type { MetricDimension } from './metricMeta.ts'

export type AbFacet = {
  metric: MetricKey
  /** 量纲分组(percent = 内核 0–1 比例;amount = 绝对量),显示层据此分面排序 */
  dimension: MetricDimension
  armA: SampleStats
  armB: SampleStats
  /** 配对差均值与 95% CI(CRN 同种子配对;内核直出,不前端重算) */
  diffMean: number
  diffCi95Lo: number
  diffCi95Hi: number
  /** 效应量 d = Δ / 合并 sd(内核直出) */
  effectSizeD: number
  /** 内核判定原样(BHigher/AHigher/NoDifference) */
  verdict: Comparison['verdict']
  /** 配对差 95% CI 是否不含 0——内核 CI 的直接读数,不是新做的检验 */
  significant: boolean
  /** 相对变化 = diff_mean / arm_a.mean × 100;基线均值为 0/非有限 → null(不编造) */
  relativeChangePct: number | null
}

/**
 * 逐 KPI 分面:输入 = 内核逐指标 Comparison(METRIC_KEYS 序);
 * 未知指标原样丢弃(内核只会回 METRIC_KEYS 内的指标,防御不编造)。
 */
export function abFacets(comparisons: readonly Comparison[]): AbFacet[] {
  const known = new Map(comparisons.map((c) => [c.metric, c] as const))
  return METRIC_KEYS.flatMap((metric) => {
    const c = known.get(metric)
    if (c === undefined) return []
    const relative = Number.isFinite(c.arm_a.mean) && c.arm_a.mean !== 0
      ? (c.diff_mean / c.arm_a.mean) * 100
      : null
    return [{
      metric,
      dimension: METRIC_META[metric].dimension,
      armA: c.arm_a,
      armB: c.arm_b,
      diffMean: c.diff_mean,
      diffCi95Lo: c.diff_ci95_lo,
      diffCi95Hi: c.diff_ci95_hi,
      effectSizeD: c.effect_size_d,
      verdict: c.verdict,
      significant: c.diff_ci95_lo > 0 || c.diff_ci95_hi < 0,
      relativeChangePct: relative,
    }]
  })
}

/** 内核显式拒绝的 KPI(METRIC_KEYS 序);输入错误原文原样透传。 */
export function abUnavailable(comparisons: readonly Comparison[], errors: readonly ComparisonFailure[]): ComparisonFailure[] {
  const done = new Set(comparisons.map((c) => c.metric))
  return METRIC_KEYS.flatMap((metric) =>
    errors.filter((e) => e.metric === metric && !done.has(metric)))
}

/**
 * 分面轴域 = 0 与配对差 CI 的包络 ± 10% 余量;退化(全同)给最小可见跨度
 * ±1 档位扩大——轴设置不落在数据上,不为画图伪造差值(口径同 yAutoDomain)。
 * 每个分面独立调用 → 不同单位绝不共用一根轴。
 */
export function effectDomain(facet: Pick<AbFacet, 'diffCi95Lo' | 'diffCi95Hi'>): { min: number; max: number } {
  const min = Math.min(0, facet.diffCi95Lo)
  const max = Math.max(0, facet.diffCi95Hi)
  const pad = (max - min) * 0.1
  if (max - min <= Number.EPSILON) return { min: min - 1, max: max + 1 }
  return { min: min - pad, max: max + pad }
}

/** 分面显示序:percent 量纲在前、amount 在后(组内保持 METRIC_KEYS 序);不混合成一根轴。 */
export function facetsByDimension(facets: readonly AbFacet[]): { percent: AbFacet[]; amount: AbFacet[] } {
  return {
    percent: facets.filter((f) => f.dimension === 'percent'),
    amount: facets.filter((f) => f.dimension === 'amount'),
  }
}
