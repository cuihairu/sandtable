// 实时预览的纯显示层:等宽分箱 + 逐点配对差。逐 replicate 值与统计结论
// 全部出自内核(kpi_eval 的 per_replicate/SampleStats 与 abCompare 的
// Comparison);这里绝不重算均值/CI/显著性,只把内核给出的值画出来。

import type { MetricKey } from '../../lib/types.ts'

export type PreviewMetricMeta = { key: MetricKey; percent: boolean; label: string }

/** 预览可选指标 = 内核 MetricKey 全集(声明序,与 kpi_eval 表达式白名单同口径)。 */
export const PREVIEW_METRICS: readonly PreviewMetricMeta[] = [
  { key: 'retention_d7', percent: true, label: 'retention_d7' },
  { key: 'retention_d3', percent: true, label: 'retention_d3' },
  { key: 'win_rate', percent: true, label: 'win_rate' },
  { key: 'gold_per_player', percent: false, label: 'gold_per_player' },
  { key: 'power_p50', percent: false, label: 'power_p50' },
  { key: 'churn_rate', percent: true, label: 'churn_rate' },
  { key: 'gacha_pulls_to_hit', percent: false, label: 'gacha_pulls_to_hit' },
  { key: 'loot_gold_per_player', percent: false, label: 'loot_gold_per_player' },
]

/** 等宽分箱(显示层 binning):空 → 无箱;全等值(或单点)→ 单箱;其余 bins 份等宽。 */
export function histogramBins(values: readonly number[], bins: number): Array<{ lo: number; hi: number; count: number }> {
  if (values.length === 0) return []
  const width = Number.isSafeInteger(bins) && bins >= 1 ? bins : 1
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (values.length === 1 || min === max) return [{ lo: min, hi: max, count: values.length }]
  const span = max - min
  const edges: Array<{ lo: number; hi: number; count: number }> = []
  for (let i = 0; i < width; i++) {
    edges.push({ lo: min + (span * i) / width, hi: min + (span * (i + 1)) / width, count: 0 })
  }
  for (const value of values) {
    // 最大值归最后一箱(右闭),其余左闭右开
    const index = Math.min(Math.floor(((value - min) / span) * width), width - 1)
    edges[index].count++
  }
  return edges
}

/** 逐点配对差 cand[i]−base[i](CRN 成对显示;任一臂 null 的 replicate 跳过,
 * 与内核「缺席不填 0」同口径;长度不齐截到公共前缀)。 */
export function pairedDiff(base: readonly (number | null)[], cand: readonly (number | null)[]): number[] {
  const n = Math.min(base.length, cand.length)
  const diffs: number[] = []
  for (let i = 0; i < n; i++) {
    const a = base[i]
    const b = cand[i]
    if (a !== null && b !== null) diffs.push(b - a)
  }
  return diffs
}
