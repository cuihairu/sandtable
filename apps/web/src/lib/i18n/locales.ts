// WB-11.01:首版支持的 locale 与固定显示名。
// 显示名是给「语言切换入口」(WB-11.05)用的标签,不参与翻译;两个名称各自
// 固定,切换时不做本机本地化(「简体中文」在英文界面下仍显示「简体中文」)。
export const LOCALES = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'en-US', label: 'English' },
] as const

export type Locale = (typeof LOCALES)[number]['code']

/** 无匹配系统语言时的兜底(WB-11.06);不是默认展示语言,而是唯一安全退路 */
export const DEFAULT_LOCALE: Locale = 'en-US'

export function isLocale(s: string): s is Locale {
  return LOCALES.some((l) => l.code === s)
}
