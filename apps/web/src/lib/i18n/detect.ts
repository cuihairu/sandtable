// WB-11.06/.07:初始 locale 解析。优先级固定为
// 用户手动选择(持久化)> 浏览器/系统语言 > en-US 兜底,
// 与 docs 站首页探测同一套口径(见 docs/index.md 语言探测段)。
// storage 与系统语言列表都作参数注入:模块不碰 window/localStorage,
// 因此 SSR 与节点测试都可直接调用;接线在应用入口(WB-11.05/.06 落位后)。
import { DEFAULT_LOCALE, isLocale, type Locale } from './locales.ts'

/** 持久化键。手动选择写入此键后,之后的系统语言变化不再覆盖它(WB-11.07) */
export const LOCALE_STORAGE_KEY = 'sandtable-workbench-locale'

/** 最小存储面;localStorage 直接满足,测试可注入内存实现 */
export interface LocaleStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** 从偏好列表按序探测:zh* → zh-CN,en* → en-US,首个命中即返回 */
export function detectFromLanguages(languages: readonly string[]): Locale {
  for (const raw of languages) {
    const tag = raw.toLowerCase()
    if (tag.startsWith('zh')) return 'zh-CN'
    if (tag.startsWith('en')) return 'en-US'
  }
  return DEFAULT_LOCALE
}

/** 首次进入的 locale:持久化里的手动选择优先,否则按系统语言探测 */
export function resolveInitialLocale(
  storage: LocaleStorage | null,
  systemLanguages: readonly string[],
): Locale {
  const saved = storage?.getItem(LOCALE_STORAGE_KEY)
  // 存了非法值(外部改动/旧版本残留)视同未选择,不把它当 locale 使用
  if (saved && isLocale(saved)) return saved
  return detectFromLanguages(systemLanguages)
}

export function persistLocale(storage: LocaleStorage, locale: Locale): void {
  storage.setItem(LOCALE_STORAGE_KEY, locale)
}
