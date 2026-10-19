// WB-11.05/.06/.07 · locale 会话单例(React 壳侧薄层)。
// 引导在模块初始化时同步完成:持久化 > 系统语言 > en-US,并即刻应用文档标题,
// 首帧前就位(WB-11.06/.07 与 WB-11.10 的标题部分项)。
// 组件经 useLocale() 订阅、经 setLocale() 切换;持久化写失败静默降级
// (WB-11.29,库侧 session 内处理)。纯逻辑与注入点都在 lib/i18n/session.ts。
import { useSyncExternalStore } from 'react'
import { openLocaleSession } from '../../lib/i18n/index.ts'
import type { Locale, LocaleDocument, LocaleStorage } from '../../lib/i18n/index.ts'

function browserStorage(): LocaleStorage | null {
  // 隐私模式下访问 localStorage 本身也可能抛(旧实现),一并降级为无存储
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  const langs = navigator.languages
  if (langs && langs.length > 0) return langs
  return navigator.language ? [navigator.language] : []
}

// WB-11.10 · 正文翻译(WB-11.11~16)落地后接上 setLang:<html lang> 决定读屏器
// 发音,正文语言与 locale 一致时同步才不是可访问性回退(标题此前已接)。
const domDoc: LocaleDocument | null =
  typeof document === 'undefined'
    ? null
    : {
        setTitle: (title) => (document.title = title),
        setLang: (lang) => {
          document.documentElement.lang = lang
        },
      }

export const localeSession = openLocaleSession({
  storage: browserStorage(),
  languages: browserLanguages(),
  doc: domDoc,
  dev: !!(import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV,
})

/** 组件订阅当前 locale(与 workbenchStore 同一套 useSyncExternalStore 习惯) */
export function useLocale(): Locale {
  return useSyncExternalStore(localeSession.subscribe, localeSession.get)
}

export function setLocale(next: Locale): void {
  localeSession.set(next)
}
