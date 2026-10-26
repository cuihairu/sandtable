// WB-08.14 · 经济 / 掉落 / 抽卡分析(P2)。数值全部来自内核 daily_aggregate 的
// SampleStats,本层只搬运:不重算 CI、不 0 填缺席日、不跨口径相加。
// 产出 / 消耗是当日流量,存量是当日收盘 G(d),吸收比与通胀是比率,人均按当日
// 活跃人数 —— 不同口径量级不同,必须各自单独成图(单轴)。掉落切片与抽卡 E[T]
// 是运行级标量而非时间序列,按「非图表」呈现为数值行并带口径注。内核从未产出的
// 量(保底分布、逐日抽卡、逐日掉落)只能声明不可用及原因,不画不存在的数。
import type { TranslationKey } from './i18n/index.ts'
import type { AggregateDailyPoint } from './analysisView.ts'
import type { AggregateMetricStats, DailyAggregatedDay, DailyAggregation } from './types.ts'

/** 口径:流量 / 存量 / 比率 / 人均 / 期望值 —— 不同口径不可同轴相加 */
export type EconomyCaliber = 'flow' | 'stock' | 'ratio' | 'perActive' | 'expectation'

/** 口径 → 文案 key(界面口径标签的唯一来源) */
export const ECONOMY_CALIBER_LABEL: Record<EconomyCaliber, TranslationKey> = {
  flow: 'analysis.econ.caliberFlow',
  stock: 'analysis.econ.caliberStock',
  ratio: 'analysis.econ.caliberRatio',
  perActive: 'analysis.econ.caliberPerActive',
  expectation: 'analysis.econ.caliberExpectation',
}

/** 经济逐日键 = DailyAggregatedDay 的统计字段(day 本身除外) */
export type EconomyDailyKey = Exclude<keyof DailyAggregatedDay, 'day'>

export interface EconomyDailySpec {
  id: EconomyDailyKey
  labelKey: TranslationKey
  caliber: EconomyCaliber
  percent: boolean
}

/**
 * 逐日经济序列声明。顺序即成图顺序:流量 → 存量 → 比率 → 人均,
 * 每个口径一张图,不把不同量级的口径放进同一坐标轴。
 */
export const ECONOMY_DAILY = [
  { id: 'gold_earned', labelKey: 'analysis.econ.goldEarned', caliber: 'flow', percent: false },
  { id: 'gold_spent', labelKey: 'analysis.econ.goldSpent', caliber: 'flow', percent: false },
  { id: 'gold_supply', labelKey: 'analysis.econ.goldSupply', caliber: 'stock', percent: false },
  { id: 'sink_ratio', labelKey: 'analysis.econ.sinkRatio', caliber: 'ratio', percent: true },
  { id: 'inflation', labelKey: 'analysis.econ.inflation', caliber: 'ratio', percent: true },
  { id: 'income_per_active', labelKey: 'analysis.econ.incomePerActive', caliber: 'perActive', percent: false },
  { id: 'spending_per_active', labelKey: 'analysis.econ.spendingPerActive', caliber: 'perActive', percent: false },
] as const satisfies readonly EconomyDailySpec[]

export type EconomySeries = EconomyDailySpec & { points: readonly AggregateDailyPoint[] }

/**
 * 内核聚合 → 经济序列:与 aggregateDailySeries 同一搬运纪律 —— 某日整键
 * 缺席(如 day 1 的 inflation)不入点列,不补 0;CI 只搬运不重算。
 */
export function economyDailySeries(agg: DailyAggregation | null): readonly EconomySeries[] {
  if (agg === null) return []
  return ECONOMY_DAILY.map((spec) => ({
    ...spec,
    points: agg.day_stats.flatMap((day) => {
      const stat = day[spec.id]
      return stat === undefined
        ? []
        : [{ day: day.day, mean: stat.mean, ci95_lo: stat.ci95_lo, ci95_hi: stat.ci95_hi }]
    }),
  }))
}

export interface EconomyRowSpec {
  id: 'loot_gold_per_player' | 'gacha_pulls_to_hit'
  labelKey: TranslationKey
  caliber: EconomyCaliber
  percent: boolean
  /** 口径注:i18n key,随该行数值一并展示 */
  noteKey: TranslationKey
}

/** 运行级经济标量:掉落切片与抽卡期望,单次运行一值,不是时间序列 */
export const ECONOMY_ROWS = [
  {
    id: 'loot_gold_per_player',
    labelKey: 'analysis.econ.lootGoldPerPlayer',
    caliber: 'perActive',
    percent: false,
    noteKey: 'analysis.econ.lootNote',
  },
  {
    id: 'gacha_pulls_to_hit',
    labelKey: 'analysis.econ.gachaPullsToHit',
    caliber: 'expectation',
    percent: false,
    noteKey: 'analysis.econ.gachaNote',
  },
] as const satisfies readonly EconomyRowSpec[]

export type EconomyRow = EconomyRowSpec & { stat: AggregateMetricStats | null }

/**
 * 运行级行:stat 为 null = 该次运行未配置对应系统,内核整键缺席。
 * 调用方据此显示不可用而非 0,并把它计入不可用原因列表。
 */
export function economyRows(agg: DailyAggregation | null): readonly EconomyRow[] {
  return ECONOMY_ROWS.map((spec) => ({ ...spec, stat: agg?.[spec.id] ?? null }))
}

export interface EconomyUnavailableItem {
  id: string
  labelKey: TranslationKey
  reasonKey: TranslationKey
}

/**
 * 不可用指标与原因。结构性缺席(内核从未产出该量)恒列;未配置 gacha / loot
 * 的行级缺席按聚合结果追加。原因只述内核事实,不造替代数字。
 */
export function economyUnavailable(agg: DailyAggregation | null): readonly EconomyUnavailableItem[] {
  const items: EconomyUnavailableItem[] = [
    {
      id: 'pity_distribution',
      labelKey: 'analysis.econ.pityDistLabel',
      reasonKey: 'analysis.econ.pityDistReason',
    },
    {
      id: 'gacha_daily',
      labelKey: 'analysis.econ.gachaDailyLabel',
      reasonKey: 'analysis.econ.gachaDailyReason',
    },
    {
      id: 'loot_daily',
      labelKey: 'analysis.econ.lootDailyLabel',
      reasonKey: 'analysis.econ.lootDailyReason',
    },
    {
      id: 'day1_inflation',
      labelKey: 'analysis.econ.day1InflationLabel',
      reasonKey: 'analysis.econ.day1InflationReason',
    },
  ]
  if (agg !== null && agg.gacha_pulls_to_hit === undefined) {
    items.push({
      id: 'gacha_off',
      labelKey: 'analysis.econ.gachaOffLabel',
      reasonKey: 'analysis.econ.gachaOffReason',
    })
  }
  if (agg !== null && agg.loot_gold_per_player === undefined) {
    items.push({
      id: 'loot_off',
      labelKey: 'analysis.econ.lootOffLabel',
      reasonKey: 'analysis.econ.lootOffReason',
    })
  }
  return items
}
