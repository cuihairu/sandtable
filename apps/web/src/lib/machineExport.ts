// 机器可读导出的口径契约(WB-11.22/.23 的库侧内核,WB-11.19 的原始字段登记)。
// 纪律:
// - 机器输出(machineNumber/machineJson/toCsv)一律不接收 locale 参数——
//   字段名、枚举值、小数点不随界面语言漂移,漂移在编译期即不可能;
//   本地化只发生在显示层(i18n t/tPlural/displayName 与 fmtPercent 的 ×100)。
// - 数值用规范十进制:String(value),小数点恒为 '.',无千分位、无本地化分组;
//   -0 归一为 0,避免导出同一数值两种写法。
// - 非有限数值(NaN/±Infinity)明确报错:CSV 里写 'NaN' 或 JSON 里被
//   JSON.stringify 静默变成 null,都是静默造假;不可用字段必须显式写 null。
// - CSV 按 RFC4180:含逗号/引号/换行的单元格加引号、引号翻倍,行用 CRLF;
//   表头字段名原样(机器 schema),行宽不齐 = 调用方错误,明确报错。
// - 可读产物(SVG/报告)用导出时选定语言,并把 locale 记录进产物本身
//   (xml:lang + data-locale);本地化显示文本绝不写回实验配置。
import { DEFAULT_LOCALE, isLocale, type Locale } from './i18n/locales.ts'

/** WB-11.19:六类保持原始内容的字段。这些字段永不作为翻译 key,
 * 机器导出与实验配置里只放原始值;系统显示名的本地化走 displayName。 */
export const RAW_FIELD_KINDS = ['paramPath', 'kpiId', 'filePath', 'hash', 'seed', 'userName'] as const
export type RawFieldKind = (typeof RAW_FIELD_KINDS)[number]

export function isRawFieldKind(kind: string): kind is RawFieldKind {
  return (RAW_FIELD_KINDS as readonly string[]).includes(kind)
}

function failNotFinite(value: number, at: string): never {
  throw new Error(
    `机器导出收到非有限数值 ${String(value)}(${at});不可用字段请写 null,不静默序列化`,
  )
}

/** 规范十进制:小数点恒 '.',无千分位;-0 归一为 '0' */
export function machineNumber(value: number): string {
  if (!Number.isFinite(value)) failNotFinite(value, 'machineNumber')
  if (Object.is(value, -0)) return '0'
  return String(value)
}

/** 递归检查深层非有限数值,报错带取值路径便于定位 */
function assertFiniteDeep(value: unknown, at: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) failNotFinite(value, at)
    return
  }
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertFiniteDeep(item, `${at}[${i}]`))
    return
  }
  for (const [key, item] of Object.entries(value)) assertFiniteDeep(item, `${at}.${key}`)
}

/** 机器快照序列化:合法且 locale 无关(JSON.stringify 本身不带本地化),
 * 额外守住非有限数值不被静默变 null */
export function machineJson(value: unknown): string {
  assertFiniteDeep(value, '$')
  return JSON.stringify(value, null, 2)
}

/** CSV 单元格:数字走规范十进制;null = 空单元格(不可用,绝不写 0) */
export function csvCell(value: string | number | null): string {
  if (value === null) return ''
  if (typeof value === 'number') return machineNumber(value)
  return /["\n,\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

/** 行列导出:表头与行宽必须一致,CRLF 换行 */
export function toCsv(
  header: readonly string[],
  rows: ReadonlyArray<ReadonlyArray<string | number | null>>,
): string {
  const width = header.length
  const lines = [header.map(csvCell).join(',')]
  rows.forEach((row, i) => {
    if (row.length !== width) {
      throw new Error(`CSV 第 ${i + 1} 行 ${row.length} 列,与表头 ${width} 列不一致`)
    }
    lines.push(row.map(csvCell).join(','))
  })
  return lines.join('\r\n')
}

/** WB-11.23:导出时选定语言;未知 locale 退 en-US(与翻译层同一兜底口径) */
export function exportLocale(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE
}

/** SVG/可读报告根节点应记录的 locale 属性:记录值即渲染可读文本所用语言 */
export function svgLanguageMeta(locale: string): Record<string, string> {
  const resolved = exportLocale(locale)
  return { 'xml:lang': resolved, 'data-locale': resolved }
}
