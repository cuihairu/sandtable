// WB-13 · 离线单文件报告 HTML(纯序列化):
// 结构化报告模型 → 确定性 HTML;无脚本、无外链、无运行时状态。
// 正文词条沿用现有 i18n 词典,精确值直接文本化,比例不做显示换算。
import type { DesignReportModel, ReportChart, ReportTableRow } from './designReport.ts'
import { t } from './i18n/index.ts'

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function table(columns: readonly string[], rows: readonly ReportTableRow[]): string {
  return `<table data-testid="report-table"><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

function chartSection(chart: ReportChart): string {
  const drawRows = chart.rows.filter((row) =>
    [row.mean, row.ci95_lo, row.ci95_hi].every((value) => Number.isFinite(Number(value))))
  const domain = drawRows.length === 0 ? { lo: -1, hi: 1 } : {
    lo: Math.min(...drawRows.map((row) => Math.min(Number(row.ci95_lo), Number(row.ci95_hi)))),
    hi: Math.max(...drawRows.map((row) => Math.max(Number(row.ci95_lo), Number(row.ci95_hi)))),
  }
  const span = domain.hi - domain.lo || Math.abs(domain.hi) || 1
  const points = drawRows.map((row, index) => {
    const mean = Number(row.mean)
    const lo = Number(row.ci95_lo)
    const hi = Number(row.ci95_hi)
    const indexText = `${index} · ${row.candidate} · ${row.metric}`
    const y = 18 + index * 22
    const left = 180 + ((lo - domain.lo) / span) * 700
    const right = 180 + ((hi - domain.lo) / span) * 700
    const middle = 180 + ((mean - domain.lo) / span) * 700
    return `<g data-testid="report-chart-point" data-candidate="${escapeHtml(row.candidate)}" data-metric="${escapeHtml(row.metric)}" data-mean="${mean}" data-ci95-lo="${lo}" data-ci95-hi="${hi}"><title>${escapeHtml(indexText)}: CI [${lo}, ${hi}], mean ${mean}</title><line x1="${left}" y1="${y}" x2="${right}" y2="${y}" class="report-ci"/><line x1="${left}" y1="${y - 4}" x2="${left}" y2="${y + 4}" class="report-ci"/><line x1="${right}" y1="${y - 4}" x2="${right}" y2="${y + 4}" class="report-ci"/><circle cx="${middle}" cy="${y}" r="3"/></g>`
  }).join('')
  const height = Math.max(180, 36 + drawRows.length * 22)
  return `<section><h3>${escapeHtml(chart.title)}</h3><p class="note">${escapeHtml(chart.note)}</p><p class="mono">${escapeHtml(chart.sourcePath)}</p><svg data-testid="report-chart" viewBox="0 0 1080 ${height}" role="img" aria-label="${escapeHtml(chart.title)}">${points}</svg>${table(chart.columns, chart.rows)}</section>`
}

export function designReportHtml(model: DesignReportModel): string {
  const locale = model.language
  const summary = model.summary.map((line) => `<li>${escapeHtml(line)}</li>`).join('')
  const conditions = model.conditions
    ? `<table data-testid="report-conditions"><thead><tr><th>${escapeHtml(t(locale, 'report.colPopulation'))}</th><th>${escapeHtml(t(locale, 'report.colDays'))}</th><th>${escapeHtml(t(locale, 'report.colSeed'))}</th><th>${escapeHtml(t(locale, 'report.colCandidateRun'))}</th></tr></thead><tbody><tr><td>${model.conditions.population}</td><td>${model.conditions.days}</td><td>${escapeHtml(model.conditions.seed ?? '')}</td><td class="mono">${escapeHtml(model.conditions.candidateSourceRunId)}</td></tr></tbody></table>`
    : `<p role="alert">${escapeHtml(model.conditionReason ?? '')}</p>`
  const diff = model.parameterDiff.length > 0
    ? `<table data-testid="report-parameter-diff"><thead><tr><th>${escapeHtml(t(locale, 'report.colPath'))}</th><th>${escapeHtml(t(locale, 'report.colBaseline'))}</th><th>${escapeHtml(t(locale, 'report.colCandidate'))}</th></tr></thead><tbody>${model.parameterDiff.map((row) => `<tr><td class="mono">${escapeHtml(row.path)}</td><td>${row.baseline}</td><td>${row.candidate}</td></tr>`).join('')}</tbody></table>`
    : `<p role="alert">${escapeHtml(model.parameterDiffReason ?? '')}</p>`
  const stats = model.metrics.length > 0
    ? `<table data-testid="report-metrics"><thead><tr><th>${escapeHtml(t(locale, 'report.colMetric'))}</th><th>${escapeHtml(t(locale, 'report.colN'))}</th><th>${escapeHtml(t(locale, 'report.colMean'))}</th><th>${escapeHtml(t(locale, 'report.colCiLo'))}</th><th>${escapeHtml(t(locale, 'report.colCiHi'))}</th><th>${escapeHtml(t(locale, 'report.colSd'))}</th><th>${escapeHtml(t(locale, 'report.colSource'))}</th></tr></thead><tbody>${model.metrics.map((row) => `<tr><td class="mono">${escapeHtml(row.metric)}</td><td>${row.n ?? ''}</td><td>${row.mean ?? ''}</td><td>${row.ci95Lo ?? ''}</td><td>${row.ci95Hi ?? ''}</td><td>${row.sd ?? ''}</td><td class="mono">${escapeHtml(row.sourcePath)}</td></tr>`).join('')}</tbody></table>`
    : ''
  const unavailableSource = (source: string): string => source === 'configuration'
    ? t(locale, 'report.sourceConfiguration')
    : t(locale, 'report.sourceKernelResult')
  const unavailable = `<table data-testid="report-unavailable"><thead><tr><th>${escapeHtml(t(locale, 'report.colMetric'))}</th><th>${escapeHtml(t(locale, 'report.colUnavailableSource'))}</th><th>${escapeHtml(t(locale, 'report.colSource'))}</th></tr></thead><tbody>${model.unavailableMetrics.map((row) => `<tr><td class="mono">${escapeHtml(row.metric)}</td><td>${escapeHtml(unavailableSource(row.source))}</td><td>${escapeHtml(row.reason)}</td></tr>`).join('')}</tbody></table>`
  const assumptions = `<ul>${model.assumptions.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`
  const sources = `<table data-testid="report-sources"><thead><tr><th>runId</th><th>artifact path</th><th>${escapeHtml(t(locale, 'report.colSchema'))}</th><th>${escapeHtml(t(locale, 'report.colModel'))}</th></tr></thead><tbody>${model.sources.map((row) => `<tr><td class="mono">${escapeHtml(row.runId)}</td><td class="mono">${escapeHtml(row.path)}</td><td>${escapeHtml(row.schemaVersion ?? '')}</td><td>${escapeHtml(row.modelVersion ?? '')}</td></tr>`).join('')}</tbody></table>`
  return `<!doctype html>
<html lang="${escapeHtml(model.language)}">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t(locale, 'report.title'))}</title>
<style>
:root{color-scheme:light;font:14px/1.45 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17202a;background:#fff}body{margin:0}main{max-width:1180px;margin:auto;padding:32px 24px 64px}h1{font-size:28px;margin:0}h2{font-size:20px;margin:28px 0 8px;padding-bottom:5px;border-bottom:1px solid #cbd5e0}h3{margin:18px 0 6px}.note{color:#4a5560;margin:6px 0}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;margin:10px 0 16px;font-size:12px}th,td{border:1px solid #cbd5e0;padding:6px;text-align:left;vertical-align:top}th{background:#edf2f7}svg{width:100%;height:auto;border:1px solid #cbd5e0;background:#fff}.report-ci{stroke:#2b6cb0;stroke-width:2}circle{fill:#2b6cb0}ul{margin:6px 0 16px;padding-left:22px}@media print{main{max-width:none;padding:12mm}}
</style>
<main data-testid="design-report">
<h1>${escapeHtml(t(locale, 'report.title'))}</h1><p>${escapeHtml(t(locale, 'report.subtitle'))}</p>
<h2>${escapeHtml(t(locale, 'report.sectionSummary'))}</h2><ul data-testid="report-summary">${summary}</ul>
<h2>${escapeHtml(t(locale, 'report.sectionRunStatus'))}</h2><p><strong>${escapeHtml(t(locale, 'report.jobStatus'))}</strong> ${escapeHtml(model.runStatus)} · <strong>${escapeHtml(t(locale, 'report.artifactStatus'))}</strong> ${escapeHtml(model.artifactStatus ?? t(locale, 'common.unavailable'))}</p>
<h2>${escapeHtml(t(locale, 'report.sectionConditions'))}</h2>${conditions}
<h2>${escapeHtml(t(locale, 'report.sectionDiff'))}</h2>${diff}
<h2>${escapeHtml(t(locale, 'report.sectionStats'))}</h2>${stats || `<p role="alert">${escapeHtml(t(locale, 'analysis.unavailable'))}</p>`}
<h2>${escapeHtml(t(locale, 'report.sectionCharts'))}</h2>${model.charts.map(chartSection).join('')}
<h2>${escapeHtml(t(locale, 'report.sectionUnavailable'))}</h2>${unavailable}
<h2>${escapeHtml(t(locale, 'report.sectionAssumptions'))}</h2>${assumptions}
<p class="note" role="status">${escapeHtml(t(locale, 'report.pdfUnavailable'))}</p>
<h2>${escapeHtml(t(locale, 'report.sectionSources'))}</h2>${sources}
</main>`
}
