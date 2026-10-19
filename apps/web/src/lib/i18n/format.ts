// WB-11.18:显示格式统一走 Intl。规则:
// - 这些函数只格式化,不改底层数值(语言切换不改变 seed、指标值与哈希);
// - fmtPercent 是唯一做「比例→百分数」×100 的点,绝对差(百分点)走 fmtNumber;
// - 数字默认保留原始精度,百分比默认 1 位小数(胜率类值收口);
// - 日期按 UTC 取日历日,不随本机时区漂移;
// - 非法 locale 由 Intl 自行回退,不抛错(WB-11.26 回退面)。
// 格式化器按 locale+选项缓存:候选表是「候选行数 × KPI 列数」的格式化调用,
// 每次 new Intl.NumberFormat 都是可省的开销。
import type { Locale } from './locales.ts'

export interface FractionOptions {
  /** 固定小数位;不传则数字按原始精度、百分比按 1 位 */
  fractionDigits?: number
}

const DEFAULT_PERCENT_FRACTION = 1

const numberCache = new Map<string, Intl.NumberFormat>()

function numberFormat(
  locale: Locale | string,
  style: 'decimal' | 'percent',
  fractionDigits?: number,
): Intl.NumberFormat {
  const key = `${locale}|${style}|${fractionDigits ?? -1}`
  let fmt = numberCache.get(key)
  if (!fmt) {
    // 显式小数位 = 固定(min=max);百分比默认 0–1 位,既收口胜率精度又不把 0 打成 0.0%
    const fraction =
      style === 'percent'
        ? { min: fractionDigits ?? 0, max: fractionDigits ?? DEFAULT_PERCENT_FRACTION }
        : fractionDigits !== undefined
          ? { min: fractionDigits, max: fractionDigits }
          : undefined
    fmt = new Intl.NumberFormat(locale, {
      style,
      ...(fraction ? { minimumFractionDigits: fraction.min, maximumFractionDigits: fraction.max } : {}),
    })
    numberCache.set(key, fmt)
  }
  return fmt
}

/** 普通数字:按 locale 分组与小数符号,不做任何换算 */
export function fmtNumber(locale: Locale | string, value: number, opts?: FractionOptions): string {
  return numberFormat(locale, 'decimal', opts?.fractionDigits).format(value)
}

/** 比例(0–1)显示为百分数:此函数内做 ×100,别处不得再乘一次 */
export function fmtPercent(
  locale: Locale | string,
  ratio: number,
  opts?: FractionOptions,
): string {
  return numberFormat(locale, 'percent', opts?.fractionDigits).format(ratio)
}

const dateCache = new Map<string, Intl.DateTimeFormat>()

/** ISO 日期(YYYY-MM-DD 或完整 ISO)按 UTC 日历日格式化 */
export function fmtDate(locale: Locale | string, isoDate: string): string {
  let fmt = dateCache.get(locale)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    })
    dateCache.set(locale, fmt)
  }
  return fmt.format(new Date(isoDate))
}
