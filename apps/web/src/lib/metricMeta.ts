// WB-08.11(量纲基础)/ WB-08.06(量纲分组)· 内核指标的显示元数据。
// 纪律:
// - 键 = 内核 METRIC_KEYS(lib/types.ts 声明序),数值语义与口径一致:
//   ratio 类 = 内核 0–1 比例口径,×100 只发生在 i18n fmtPercent(显示层),
//   本表只标注 percent 分组,不换算;
// - label 是唯一简短中文显示名(图表标题/列头兜底);调用方可传入
//   localize 显示层译词覆盖(项目 label 不写死到数据层);
// - decimals 是显示收口的小数位(普通数值用;percent 走 fmtPercent 的
//   fractionDigits 口径),此处不改变底层数值。
import type { MetricKey } from './types.ts'

export type MetricDimension = 'percent' | 'amount'

export type MetricMeta = {
  /** 内核指标 ID(= 显示兜底名,导出/机器列名以此为准) */
  readonly id: MetricKey
  /** 简短中文显示名(图表标题/表列头);不造 harmonic 之外的别名 */
  readonly label: string
  /** 量纲分组:percent = 内核 0–1 比例;amount = 绝对量(计数/额度) */
  readonly dimension: MetricDimension
  /** 显示收口小数位(percent 用 fmtPercent 的 fractionDigits) */
  readonly decimals: number
  readonly unit: string
}

export const METRIC_META: Readonly<Record<MetricKey, MetricMeta>> = {
  win_rate: { id: 'win_rate', label: '战斗胜率', dimension: 'percent', decimals: 1, unit: '%' },
  retention_d7: { id: 'retention_d7', label: 'D7 留存率', dimension: 'percent', decimals: 1, unit: '%' },
  retention_d3: { id: 'retention_d3', label: 'D3 留存率', dimension: 'percent', decimals: 1, unit: '%' },
  churn_rate: { id: 'churn_rate', label: '总流失率', dimension: 'percent', decimals: 1, unit: '%' },
  gold_per_player: { id: 'gold_per_player', label: '人均金币产出', dimension: 'amount', decimals: 1, unit: '金币/玩家' },
  loot_gold_per_player: { id: 'loot_gold_per_player', label: '人均战利品金币', dimension: 'amount', decimals: 1, unit: '金币/玩家' },
  power_p50: { id: 'power_p50', label: 'P50 功率', dimension: 'amount', decimals: 1, unit: '功率' },
  gacha_pulls_to_hit: { id: 'gacha_pulls_to_hit', label: '抽卡至命中次数', dimension: 'amount', decimals: 1, unit: '抽' },
} as const

/** 指标显示名(数据层兜底;显示层可传 localize 覆盖) */
export function metricLabel(metric: MetricKey): string {
  return METRIC_META[metric].label
}
