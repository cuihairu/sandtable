// WB-11.05/.06/.07 的库侧内核:应用入口与组件之间唯一的 locale 状态面。
// 组合 detect(引导优先级)+ index 的订阅式存储 + 文档头应用,全部依赖注入
// (storage / 系统语言 / 文档头目标),节点测试与 SSR 都可直接装配。
// WB-11.29:持久化写失败(隐私模式/配额满)不中断切换——语言照常生效,
// 正式形态静默,开发形态每会话只 console.warn 一次。
import { DEFAULT_LOCALE, isLocale, type Locale } from './locales.ts'
import { resolveInitialLocale, persistLocale, type LocaleStorage } from './detect.ts'
import { createLocaleStore, t } from './index.ts'

/** 文档头写入目标:DOM 侧适配 document.documentElement.lang 与 document.title。
 * setLang 可选:html lang 决定读屏器的语言,正文语言与 locale 一致时才该同步
 * (WB-11.10 的收尾项;正文翻译未完成前接上会让读屏器按英文发音念中文正文)。 */
export interface LocaleDocument {
  setTitle(title: string): void
  setLang?(lang: string): void
}

/** 文档标题词条:唯一来源是词典(与 index.html 的 zh 初值一致),不在此拼接 */
function documentTitle(locale: Locale): string {
  return t(locale, 'common.appTitle')
}

/** WB-11.10(部分):文档标题跟随 locale(可选同步 html lang);未知 locale 按 en-US 应用 */
export function applyDocumentLocale(locale: string, doc: LocaleDocument): void {
  const resolved: Locale = isLocale(locale) ? locale : DEFAULT_LOCALE
  doc.setLang?.(resolved)
  doc.setTitle(documentTitle(resolved))
}

export interface LocaleSession {
  get(): Locale
  set(next: Locale): void
  subscribe(fn: () => void): () => void
  /** 重新按当前 locale 应用文档头(引导阶段外部想幂等重放时用) */
  apply(): void
}

export function openLocaleSession(opts: {
  storage: LocaleStorage | null
  languages: readonly string[]
  doc?: LocaleDocument | null
  /** 持久化写失败的告警开关(仅开发形态告警);缺省 = 正式形态静默 */
  dev?: boolean
}): LocaleSession {
  const store = createLocaleStore(resolveInitialLocale(opts.storage, opts.languages))
  let warnedPersist = false
  const apply = (): void => {
    if (opts.doc) applyDocumentLocale(store.get(), opts.doc)
  }
  apply() // 创建即应用:引导阶段同步设好 lang/title,不等首帧渲染
  return {
    get: store.get,
    subscribe: store.subscribe,
    apply,
    set(next: Locale): void {
      if (next === store.get()) return
      store.set(next)
      // 持久化是副产物:写失败不影响切换结果(WB-11.29)
      if (opts.storage) {
        try {
          persistLocale(opts.storage, next)
        } catch (e) {
          if (opts.dev && !warnedPersist) {
            warnedPersist = true
            console.warn(`[i18n] locale persistence failed, switching without saving: ${String(e)}`)
          }
        }
      }
      apply()
    },
  }
}
