// WB-11.17:复数规则引擎 = Intl.PluralRules(与 WB-11.18 的 Intl 纪律同源,
// 不在词典层硬编码语言规则)。词典复数形键 = `<key>.<category>`;
// zh-CN 无复数变化恒 other,词典里的 .one 形仅为与 en 键集对齐,运行时不命中。
import type { Locale } from './locales.ts'

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/** 该 locale、该数字的复数类别(CLDR 规则,经 Intl.PluralRules) */
export function pluralCategory(locale: Locale | string, n: number): PluralCategory {
  return new Intl.PluralRules(locale).select(n) as PluralCategory
}
