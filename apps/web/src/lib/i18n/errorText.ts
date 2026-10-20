// WB-11.21:错误的本地化展示面。分类复用 lib/errors.ts 的稳定前缀契约,
// 在此换成稳定错误码 + 词典参数化模板;原始内核消息逐字保留在 detail
// 供定位,展示文本只是模板套壳,不吞详情。未知错误走 errors.unknown
// 本地化兜底(WB-11.25 的缺词纪律对错误词条同样生效)。
import { classifyWasmError, type WasmErrorKind } from '../errors.ts'
import { t, type TranslationKey } from './index.ts'
import type { Locale } from './locales.ts'

/** 稳定错误码:不随界面语言、不随展示措辞变化;新错误类别在此追加 */
export type ErrorCode =
  | 'parse_error'
  | 'config_error'
  | 'param_error'
  | 'serialize_error'
  | 'unknown_error'

const CODE_BY_KIND: Record<WasmErrorKind, ErrorCode> = {
  parse: 'parse_error',
  config: 'config_error',
  param: 'param_error',
  serialize: 'serialize_error',
  other: 'unknown_error',
}

const KEY_BY_CODE: Record<ErrorCode, TranslationKey> = {
  parse_error: 'errors.parse',
  config_error: 'errors.config',
  param_error: 'errors.param',
  serialize_error: 'errors.serialize',
  unknown_error: 'errors.unknown',
}

export interface LocalizedError {
  /** 稳定错误码(日志/埋点/测试断言用) */
  code: ErrorCode
  /** 本地化展示文本(词典模板,含 {detail}) */
  text: string
  /** 原始内核错误消息,逐字保留 */
  detail: string
}

/** 任意绑定层抛出物(string / Error / unknown)→ 可展示错误 */
export function localizeWasmError(locale: Locale | string, err: unknown): LocalizedError {
  const detail =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : String(err)
  const code = CODE_BY_KIND[classifyWasmError(detail).kind]
  return { code, text: t(locale, KEY_BY_CODE[code], { detail }), detail }
}

/** WB-03.15 · 界面正文用:模板 {detail} 换成剥掉通道前缀的正文,避免
 *  「配置错误：配置错误: …」重复前缀;.text 不再含原始全文(定位用
 *  detail 字段)。 */
export function localizeWasmErrorText(locale: Locale | string, err: unknown): LocalizedError {
  const localized = localizeWasmError(locale, err)
  const body = classifyWasmError(localized.detail).detail
  return { code: localized.code, text: t(locale, KEY_BY_CODE[localized.code], { detail: body }), detail: localized.detail }
}
