// todo L381 批六 · 图表与报告模板的版本与构成契约:
// - 报告模板是前端资产(离线单文件 HTML 组版),有自己的模板 id 与版本——
//   报告可追溯、跨版本可比,模板演进有可引用的契约号(HTML <meta> 落盘);
// - 口径版本分两层:模板版本来自前端常量;报告 schema / 模型版本由内核随
//   产物回传;指标字典版本来自内核 kpi_dict 桥(本模块不做内核调用,
//   dictVersion 由调用方传入,null = 未知,显示「不可用」不造默认);
// - 模板构成(SECTIONS)把固定小节写成机器可读结构,每项对应 HTML 里实际
//   存在的 data-testid——增删小节须递增模板版本,构成与产物的对账由测试锁。
export const REPORT_TEMPLATE_ID = 'sandtable-design-report'

/** 模板契约版本:HTML 组版结构变化(增删小节 / 换表列语义)时递增 */
export const REPORT_TEMPLATE_VERSION = '1'

export type CaliberRow = {
  /** 条目类型(渲染时映射词典) */
  key: 'template' | 'schema' | 'model' | 'dict'
  /** 值;null = 未知(缺席 ≠ 默认) */
  value: string | null
  /** 值的来源(runId / 模板 / 内核桥) */
  origin: string
}

export type TemplateSection = {
  id: string
  /** 小节标题词典键(恒定在场,是构成对账的稳定锚) */
  heading: string
  /** HTML 内的 data-testid;条件小节数据缺失时改出 role=alert 原因,此时为 null */
  testid: string | null
}

/** 模板固定构成(顺序即组版顺序);增删小节须递增模板版本 */
export const REPORT_TEMPLATE_SECTIONS: readonly TemplateSection[] = [
  { id: 'summary', heading: 'report.sectionSummary', testid: 'report-summary' },
  { id: 'run-status', heading: 'report.sectionRunStatus', testid: null },
  { id: 'conditions', heading: 'report.sectionConditions', testid: 'report-conditions' },
  { id: 'parameter-diff', heading: 'report.sectionDiff', testid: 'report-parameter-diff' },
  { id: 'metrics', heading: 'report.sectionStats', testid: 'report-metrics' },
  { id: 'charts', heading: 'report.sectionCharts', testid: 'report-chart' },
  { id: 'unavailable', heading: 'report.sectionUnavailable', testid: 'report-unavailable' },
  { id: 'assumptions', heading: 'report.sectionAssumptions', testid: null },
  { id: 'caliber', heading: 'report.templateSection', testid: 'report-caliber' },
  { id: 'sources', heading: 'report.sectionSources', testid: 'report-sources' },
]

/**
 * 口径/版本行:模板行恒在;内核版本按来源逐条列出(多来源多行,
 * 缺失记 null);指标字典只有拿到内核版本才出行——未知不造行、不写默认。
 */
export function buildCaliberRows(
  sources: readonly { runId: string; schemaVersion: string | null; modelVersion: string | null }[],
  dictVersion: string | null,
): CaliberRow[] {
  const rows: CaliberRow[] = [
    { key: 'template', value: `${REPORT_TEMPLATE_ID} v${REPORT_TEMPLATE_VERSION}`, origin: 'template' },
  ]
  for (const source of sources) {
    rows.push({ key: 'schema', value: source.schemaVersion, origin: source.runId })
    rows.push({ key: 'model', value: source.modelVersion, origin: source.runId })
  }
  if (dictVersion !== null) {
    rows.push({ key: 'dict', value: dictVersion, origin: 'metric_dictionary' })
  }
  return rows
}
