// WB-09.05 · 真实 run 的 SVG 导出:与演示同一套序列化封装(内嵌图表样式/
// 白底/xml:lang + data-locale),但来源标注、data-source 与 data-run 换成
// kernel 侧——真实产物绝不带 synthetic_demo 字样。标注纯函数节点可测,
// 与演示侧 svgAnnotation(WB-11.23)同范式:调用方用同一个 locale 出词。
import { KERNEL_SOURCE } from '../../lib/dataSource.ts'
import type { Locale } from '../../lib/i18n/locales.ts'
import { t } from '../../lib/i18n/index.ts'
import { svgSerialize } from '../demo/export.ts'

/** 真实 run SVG 标注:标题 = 指标显示名 · kernel · run · 状态;说明声明
 * 数据与判定来自内核、统计不经前端改写,并带上 run 与状态可追溯。 */
export function svgRunAnnotation(locale: Locale, metricLabel: string, runId: string, status: string): { title: string; desc: string } {
  return {
    title: t(locale, 'analysis.svgRunTitle', { label: metricLabel, run: runId, status }),
    desc: t(locale, 'analysis.svgRunDesc', { run: runId, status }),
  }
}

/** 从分析页真实主图序列化 kernel 来源的独立 SVG:
 * data-source=kernel + data-run=<run id> + data-metric=<指标 ID>。 */
export function svgRunFromElement(
  svg: SVGSVGElement,
  locale: Locale,
  metricLabel: string,
  metricId: string,
  runId: string,
  status: string,
): string {
  return svgSerialize(svg, locale, svgRunAnnotation(locale, metricLabel, runId, status), KERNEL_SOURCE, metricId, runId)
}
