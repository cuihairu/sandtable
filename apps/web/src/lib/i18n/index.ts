// WB-11.02:统一翻译入口 + 语言状态。组件只经此模块取词、读写当前 locale,
// 不在组件内散落语言判断。词典解析规则:
// - 未知 locale → 退 en-US 词典(WB-11.06 的兜底语义,不抛错);
// - 未知 key → 原样返回 key(缺词在界面上可见,便于发现;缺失报告是 WB-11.25);
// - 插值用 {name} 命名占位,未提供的参数原样保留。
import { zh, type ZhDict } from './dict/zh.ts'
import { en } from './dict/en.ts'
import { DEFAULT_LOCALE, type Locale } from './locales.ts'

export { LOCALES, DEFAULT_LOCALE, isLocale } from './locales.ts'
export type { Locale } from './locales.ts'
export { zh } from './dict/zh.ts'
export { en } from './dict/en.ts'

/** 翻译 key 类型 = 中文词典 key 集合(真值源),en 侧编译期已锁同集合 */
export type TranslationKey = keyof ZhDict

// 两部词典在此放宽到 string 值:zh 的 as const 字面量可向下兼容,
// en 的 satisfies 只保证 key 集合,值已是 string。
const DICTS: Record<Locale, Record<string, string>> = { 'zh-CN': zh, 'en-US': en }

export type InterpolationParams = Record<string, string | number>

export function t(
  locale: string,
  key: TranslationKey,
  params?: InterpolationParams,
): string {
  const dict = DICTS[locale as Locale] ?? DICTS[DEFAULT_LOCALE]
  const template = dict[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (raw, name: string) =>
    name in params ? String(params[name]) : raw,
  )
}

// 语言状态:最小订阅式存储,无框架依赖(WB-11.05 接到 AppBar、
// WB-11.06 在应用入口按系统语言初始化、WB-11.07 做持久化)。
export function createLocaleStore(initial: Locale = DEFAULT_LOCALE) {
  let current: Locale = initial
  const listeners = new Set<() => void>()
  return {
    get: (): Locale => current,
    set(next: Locale): void {
      if (next === current) return
      current = next
      for (const fn of listeners) fn()
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}
