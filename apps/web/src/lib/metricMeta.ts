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

// WB-11.14:显示名与单位走词典(analysis.kpi.*/analysis.kpiUnit.*),
// 上表 zh 值是同源回退(缺词时兜底;键集由 i18n 守卫测试锁死)。
// locale 缺省 zh-CN:纯逻辑/节点测试的既有断言按中文锁,站点默认
// locale 是 en-US,缺省不取它,防显示层契约漂移(WB-11.13 同一纪律)。
import { t } from './i18n/index.ts'
import type { Locale } from './i18n/index.ts'

const LABEL_KEY: Record<MetricKey, 'analysis.kpi.win_rate' | 'analysis.kpi.retention_d7' | 'analysis.kpi.retention_d3' | 'analysis.kpi.churn_rate' | 'analysis.kpi.gold_per_player' | 'analysis.kpi.loot_gold_per_player' | 'analysis.kpi.power_p50' | 'analysis.kpi.gacha_pulls_to_hit'> = {
  win_rate: 'analysis.kpi.win_rate',
  retention_d7: 'analysis.kpi.retention_d7',
  retention_d3: 'analysis.kpi.retention_d3',
  churn_rate: 'analysis.kpi.churn_rate',
  gold_per_player: 'analysis.kpi.gold_per_player',
  loot_gold_per_player: 'analysis.kpi.loot_gold_per_player',
  power_p50: 'analysis.kpi.power_p50',
  gacha_pulls_to_hit: 'analysis.kpi.gacha_pulls_to_hit',
}

const UNIT_KEY: Record<MetricKey, 'analysis.kpiUnit.percent' | 'analysis.kpiUnit.gold' | 'analysis.kpiUnit.power' | 'analysis.kpiUnit.count'> = {
  win_rate: 'analysis.kpiUnit.percent',
  retention_d7: 'analysis.kpiUnit.percent',
  retention_d3: 'analysis.kpiUnit.percent',
  churn_rate: 'analysis.kpiUnit.percent',
  gold_per_player: 'analysis.kpiUnit.gold',
  loot_gold_per_player: 'analysis.kpiUnit.gold',
  power_p50: 'analysis.kpiUnit.power',
  gacha_pulls_to_hit: 'analysis.kpiUnit.count',
}

/** 指标显示名(locale 可选,缺省 zh-CN) */
export function metricLabel(metric: MetricKey, locale?: Locale): string {
  const value = t(locale ?? 'zh-CN', LABEL_KEY[metric])
  return value !== '' ? value : METRIC_META[metric].label
}

/** 指标单位后缀(locale 可选,缺省 zh-CN) */
export function metricUnit(metric: MetricKey, locale?: Locale): string {
  const value = t(locale ?? 'zh-CN', UNIT_KEY[metric])
  return value !== '' ? value : METRIC_META[metric].unit
}
