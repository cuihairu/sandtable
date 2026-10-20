// WB-02.09 · 演示数据导出(CSV / JSON / SVG)。
// 红线:导出内容必须标明 synthetic_demo 来源;JSON 把"当前编辑草稿"与
// "样例结果快照"分开,未运行的修改绝不冒充样例结果的输入。
// WB-09 接真实 run 时替换为真实产物导出(列契约在 WB-09.02 展开)。
import { DATA_SOURCE, METRICS, METRIC_KEYS } from './sampleProject.ts'
import { PARAM_REGISTRY, displayParamName, paramGroups } from '../params/paramRegistry.ts'
import type { DemoCandidate, MetricKey, ParamValues } from './sampleProject.ts'
import { verdictOf } from './sampleProject.ts'
import type { DesignDraft } from '../designer/designerLogic.ts'
import { METHOD_LABEL } from '../designer/designerLogic.ts'
// WB-11.22/.23 · 机器导出口径共用点:规范十进制(不再四舍五入到 4 位)、
// RFC4180 引号、非有限数值明确报错;可读 SVG 记录导出时 locale
import { csvCell, machineJson, svgLanguageMeta } from '../../lib/machineExport.ts'
import { t } from '../../lib/i18n/index.ts'

export function demoCsv(rows: readonly DemoCandidate[]): string {
  const cols = [
    'data_source', 'candidate_id', 'model.warrior.attack', 'replicates',
    'win_rate_pct', 'win_rate_ci_low_pct', 'win_rate_ci_high_pct',
    'retention_d7_pct', 'retention_d7_ci_low_pct', 'retention_d7_ci_high_pct',
    'gold_per_player', 'gold_ci_low', 'gold_ci_high', 'constraint_verdict',
  ]
  const lines = rows.map((c) =>
    [
      DATA_SOURCE, c.id, c.paramValue, c.replicates,
      c.win, c.win - METRICS.win.ci, c.win + METRICS.win.ci,
      c.retention, c.retention - METRICS.retention.ci, c.retention + METRICS.retention.ci,
      c.gold, c.gold - METRICS.gold.ci, c.gold + METRICS.gold.ci,
      verdictOf(c),
    ].map(csvCell).join(','),
  )
  return '\uFEFF' + [cols.join(','), ...lines].join('\r\n')
}

export function demoSnapshot(
  rows: readonly DemoCandidate[],
  draft: { values: ParamValues; design: DesignDraft },
): string {
  // machineJson:非有限数值明确报错,不静默变 null;输出 locale 无关(WB-11.22)
  return machineJson(
    {
      prototype: 'sandtable-workbench-v2-react',
      data_source: DATA_SOURCE,
      notice: 'Synthetic demonstration results, not produced by the Sandtable core. Current draft is not the input of these results.',
      draft: {
        parameters: draft.values,
        // WB-06 · targets 为内核比例口径(0–1);导出保持原口径并保留 units 标注
        experiment: { ...draft.design },
      },
      sample_result_snapshot: {
        parameter: 'model.warrior.attack',
        method: 'grid',
        range: [80, 130, 5],
        replicates: 20,
        players: 10000,
        days: 30,
        crn: true,
        units: {
          win_rate: 'percent_0_100',
          retention_d7: 'percent_0_100',
          gold_per_player: 'unscaled',
        },
        constraints: Object.fromEntries(
          METRIC_KEYS.map((k) => [
            METRICS[k].id,
            {
              operator: METRICS[k].op,
              threshold: METRICS[k].target,
              ci_method: 'illustrative_symmetric_interval',
            },
          ]),
        ),
        candidates: rows.map((c) => ({
          ...c,
          verdict: verdictOf(c),
          ci: Object.fromEntries(
            METRIC_KEYS.map((k) => [METRICS[k].id, [c[k] - METRICS[k].ci, c[k] + METRICS[k].ci]]),
          ),
        })),
      },
    },
  )
}

/** WB-11.23:SVG 可读标注(标题/来源说明)——随导出 locale 走词典,
 * 纯函数节点可测;调用方与 svgFromElement 用同一个 locale,产物不混语言。 */
export function svgAnnotation(locale: string, metricLabel: string): { title: string; desc: string } {
  return {
    title: `${metricLabel} · ${t(locale, 'data.export.svgTitleNote')}`,
    desc: t(locale, 'data.export.svgDescNote'),
  }
}

/** SVG 序列化共用封装(WB-09.05 起真实 run 复用):xmlns + locale 元数据
 * (xml:lang + data-locale)+ 可读标注 + 内嵌图表样式 + 白底;来源与数据
 * 属性由调用方给定(演示 = synthetic_demo,真实 = kernel + data-run)。 */
export function svgSerialize(
  svg: SVGSVGElement,
  locale: string,
  annotation: { title: string; desc: string },
  dataSource: string,
  dataMetric: string,
  dataRun: string | null,
): string {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  for (const [name, value] of Object.entries(svgLanguageMeta(locale))) {
    clone.setAttribute(name, value)
  }
  const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
  title.textContent = annotation.title
  const desc = document.createElementNS('http://www.w3.org/2000/svg', 'desc')
  desc.textContent = annotation.desc
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = `.chart-grid{stroke:#e7edef;stroke-width:1}.chart-text{fill:#6c7e86;font:11px monospace}.chart-label{fill:#62777e;font:11px sans-serif}.chart-ci{stroke:#55a3a6;stroke-width:1.5}.chart-point{fill:white;stroke:#087f86;stroke-width:2}.selected .chart-point{fill:#ba7e20;stroke:white;stroke-width:2.5}.selected .chart-ci{stroke:#aa7216;stroke-width:2}`
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('width', '100%')
  bg.setAttribute('height', '100%')
  bg.setAttribute('fill', 'white')
  clone.replaceChildren(title, desc, style, bg, ...Array.from(clone.children))
  clone.setAttribute('data-source', dataSource)
  clone.setAttribute('data-metric', dataMetric)
  if (dataRun !== null) clone.setAttribute('data-run', dataRun)
  return new XMLSerializer().serializeToString(clone)
}

/** 从 React 渲染出的主图 SVG 元素序列化为独立 SVG 文件(带来源标注)。
 * WB-11.23:导出语言必传——记录进产物根节点(xml:lang + data-locale),
 * 可读标注(title/desc)经 svgAnnotation 用同一 locale 出词,不混语言。 */
export function svgFromElement(
  svg: SVGSVGElement,
  metricLabel: string,
  metricId: string,
  locale: string,
): string {
  return svgSerialize(svg, locale, svgAnnotation(locale, metricLabel), DATA_SOURCE, metricId, null)
}

export function download(name: string, data: string | Uint8Array, mime: string): void {
  // cast:Uint8Array<ArrayBufferLike> → BlobPart 收窄与 App.tsx 同口径(TS 5.7)
  const blob = new Blob([data as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 命令搜索用的参数条目(WB-05:全量注册表,不再用 18 项原型)。 */
export function paramCommandEntries(): Array<{ id: string; label: string; hint: string }> {
  return PARAM_REGISTRY.map((p) => ({
    id: p.path,
    label: displayParamName(p.path, 'zh-CN'),
    hint: p.path,
  }))
}

export const EXPORT_GROUP_LABEL = (g: string): string => (paramGroups().includes(g) ? g : 'all')

export function metricById(id: string): MetricKey | undefined {
  return METRIC_KEYS.find((k) => METRICS[k].id === id)
}

export { METHOD_LABEL }
