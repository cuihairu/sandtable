// Parameter import: machine CSV shape, mapping, conversion, and preview.
// Definitions come only from the registry; writes stay one atomic candidate edit.
import { PARAM_REGISTRY, type RegistryParam } from './paramRegistry.ts'
import { toCsv } from '../../lib/machineExport.ts'
import { unzipSync, strFromU8 } from 'fflate'
import { parseCellInput, validateParam, type ParamRowModel } from './paramsLogic.ts'

export const IMPORT_TEMPLATE_HEADERS = ['path', 'value', 'type', 'unit', 'source'] as const
const TEMPLATE_PATH_HEADER = IMPORT_TEMPLATE_HEADERS[0]
const TEMPLATE_VALUE_HEADER = IMPORT_TEMPLATE_HEADERS[1]

export function importTemplateCsv(): string {
  return toCsv(IMPORT_TEMPLATE_HEADERS, PARAM_REGISTRY.map((param) => [
    param.path,
    param.default === '—' ? null : param.default,
    param.kind,
    unitOf(param),
    'registry',
  ]))
}

export function unitOf(param: RegistryParam): string {
  if (param.path === 'scenario.duration') return 'days'
  return param.kind === 'mix' || /\.p_|base_rate/.test(param.path) ? 'ratio_0_1' : ''
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

export function templateRole(header: string): 'path' | 'value' | null {
  switch (normalizeHeader(header)) {
    case TEMPLATE_PATH_HEADER: return TEMPLATE_PATH_HEADER
    case TEMPLATE_VALUE_HEADER: return TEMPLATE_VALUE_HEADER
    default: return null
  }
}

export type ColumnMapping = ReadonlyArray<string | null>

export function autoMapColumns(headers: readonly string[]): ColumnMapping {
  const byPath = new Map(PARAM_REGISTRY.map((param) => [normalizeHeader(param.path), param.path]))
  const templateByHeader = new Map([
    [normalizeHeader(TEMPLATE_PATH_HEADER), TEMPLATE_PATH_HEADER],
    [normalizeHeader(TEMPLATE_VALUE_HEADER), TEMPLATE_VALUE_HEADER],
  ])
  return headers.map((header) => {
    const normalizedHeader = normalizeHeader(header)
    return byPath.get(normalizedHeader) ?? templateByHeader.get(normalizedHeader) ?? null
  })
}

function parseCsvRecords(text: string): Array<{ line: number; cells: string[] }> {
  const records: Array<{ line: number; cells: string[] }> = []
  let recordLine = 1
  let line = 1
  let cells: string[] = []
  let cell = ''
  let quoted = false

  const finishCell = () => {
    cells.push(cell)
    cell = ''
  }
  const finishRecord = () => {
    finishCell()
    if (cells.some((value) => value.trim() !== '')) {
      records.push({ line: recordLine, cells })
    }
    cells = []
    recordLine = line
  }

  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '\r') {
      const next = text[index + 1]
      if (next === '\n') index++
      line++
      if (quoted) cell += '\n'
      else finishRecord()
      continue
    }
    if (char === '\n') {
      line++
      if (quoted) cell += char
      else finishRecord()
      continue
    }
    if (char === '"' && quoted) {
      if (text[index + 1] === '"') {
        cell += '"'
        index++
      } else quoted = false
    } else if (char === '"' && cell === '') {
      quoted = true
    } else if (char === ',' && !quoted) {
      finishCell()
    } else cell += char
  }
  if (cell !== '' || cells.length > 0 || quoted) finishRecord()
  return records
}

export type ImportTable = {
  headers: string[]
  rows: string[][]
  errors: Array<{ line: number; reason: string }>
}

export function parseCsv(text: string): ImportTable {
  const records = parseCsvRecords(text.replace(/^\uFEFF/, ''))
  const first = records[0]
  if (!first) return { headers: [], rows: [], errors: [{ line: 1, reason: 'CSV is empty' }] }
  const headers = first.cells.map((cell) => cell.trim())
  const normalized = headers.map((header) => normalizeHeader(header))
  const missingRequired = ([TEMPLATE_PATH_HEADER, TEMPLATE_VALUE_HEADER] as const)
    .filter((required) => !normalized.includes(required))
  const rows: string[][] = []
  const errors: Array<{ line: number; reason: string }> = []
  for (const required of missingRequired) {
    errors.push({ line: 1, reason: `missing required header: ${required}` })
  }
  for (const record of records.slice(1)) {
    const row = record.cells.map((cell) => cell.trim())
    if (row.length !== headers.length) {
      errors.push({
        line: record.line,
        reason: `expected ${headers.length} columns, found ${row.length}`,
      })
      rows.push(row)
    } else rows.push(row)
  }
  if (rows.length === 0 && errors.length === 0) errors.push({ line: 1, reason: 'CSV has no data rows' })
  return { headers, rows, errors }
}

function templateMapping(headers: readonly string[]): { path: number; value: number } | null {
  const normalized = headers.map((header) => normalizeHeader(header))
  const path = normalized.indexOf(TEMPLATE_PATH_HEADER)
  const value = normalized.indexOf(TEMPLATE_VALUE_HEADER)
  return path >= 0 && value >= 0 ? { path, value } : null
}

/** Read XLSX as its first visible sheet. Keep the dependency boundary here so
 * callers continue to consume the same table shape and CSV semantics. */
export async function parseParameterImportFile(file: File): Promise<ImportTable> {
  if (!/\.(csv|txt)$/i.test(file.name)) {
    try {
      const workbook = unzipSync(new Uint8Array(await file.arrayBuffer()))
      const workbookXml = strFromU8(workbook['xl/workbook.xml'])
      const sheetElements = Array.from(workbookXml.matchAll(/<sheet\b[^>]*>/g), (match) => match[0])
      const firstVisibleSheet = sheetElements.find((element) => !/\bstate="hidden"/.test(element))
      const sheetPath = firstVisibleSheet?.match(/\br:id="(rId\d+)"/)?.[1]
      const relXml = strFromU8(workbook['xl/_rels/workbook.xml.rels'])
      const target = relXml
        .match(new RegExp(`<Relationship[^>]*Id="${sheetPath}"[^>]*Target="([^"]+)"`))?.[1]
        ?? relXml.match(/<Relationship[^>]*Type="[^"]*worksheet"[^>]*Target="([^"]+)"/)?.[1]
      if (!sheetPath || !target) return emptyTable('workbook has no worksheets')
      const normalizedTarget = target.replace(/^\/?xl\//, '')
      const sheetXml = strFromU8(workbook[`xl/${normalizedTarget}`])
      if (!sheetXml) return emptyTable('workbook has no visible sheets')
      return xlsxTable(sheetXml, workbook)
    } catch {
      return emptyTable('file is not a valid XLSX workbook')
    }
  }
  return parseCsv(await file.text())
}

function emptyTable(reason: string): ImportTable {
  return { headers: [], rows: [], errors: [{ line: 1, reason }] }
}

function xlsxTable(sheetXml: string, workbook: Record<string, Uint8Array>): ImportTable {
  const sharedXml = workbook['xl/sharedStrings.xml'] ? strFromU8(workbook['xl/sharedStrings.xml']) : ''
  const sharedStrings = Array.from(sharedXml.matchAll(/<si(?: [^>]*)?>([\s\S]*?)<\/si>/g), (match) =>
    Array.from(match[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g), (item) => xmlText(item[1])).join(''),
  )
  const rows = Array.from(sheetXml.matchAll(/<row(?: [^>]*)?>([\s\S]*?)<\/row>/g))
  const firstRow = rows[0]?.[1] ?? ''
  const headers = cells(firstRow, sharedStrings).map((cell) => cell.trim())
  if (headers.length === 0) return emptyTable('first worksheet is empty')
  const result: ImportTable = { headers, rows: [], errors: [] }
  rows.slice(1).forEach((row, rowIndex) => {
    const values = cells(row[1], sharedStrings)
    if (values.length === 0) return
    while (values.length < headers.length) values.push('')
    if (values.length !== headers.length) {
      result.errors.push({
        line: rowIndex + 2,
        reason: `expected ${headers.length} columns, found ${values.length}`,
      })
    }
    result.rows.push(values.slice(0, headers.length))
  })
  if (result.rows.length === 0 && result.errors.length === 0) {
    result.errors.push({ line: 1, reason: 'first worksheet has no data rows' })
  }
  return result
}

function cells(rowXml: string, sharedStrings: readonly string[]): string[] {
  return Array.from(rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g), (match) => {
    const reference = match[1].match(/r="([A-Z]+)\d+"/)?.[1]
    let text = match[2].match(/<v(?: [^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? ''
    if (match[1].includes('t="s"') && text !== '') {
      text = sharedStrings[Number(text)] ?? ''
    } else if (match[1].includes('t="inlineStr"')) {
      text = Array.from(match[2].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g), (item) => xmlText(item[1])).join('')
    } else text = xmlText(text)
    return { reference, text }
  }).reduce<string[]>((result, cell) => {
    const index = referenceIndex(cell.reference ?? '')
    if (index >= result.length) while (result.length < index) result.push('')
    result[index] = cell.text
    return result
  }, [])
}

function referenceIndex(reference: string): number {
  let index = 0
  for (const char of reference) index = index * 26 + char.charCodeAt(0) - 64
  return Math.max(0, index - 1)
}

function xmlText(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_text, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_text, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

export type ImportRowReport = {
  line: number
  path: string | null
  reason: string | null
}

export type ImportPreviewRow = {
  line: number
  path: string
  currentValue: string
  importValue: string
  changed: boolean
}

export type ImportPreview = {
  ok: boolean
  reports: ImportRowReport[]
  rows: ImportPreviewRow[]
  edits: Array<{ path: string; text: string }>
}

export type ImportUnit = '' | 'percent' | 'days'

export function transformParamImportValue(param: RegistryParam, raw: string, unit: ImportUnit): string | null {
  if (unit === 'percent') {
    if (unitOf(param) !== 'ratio_0_1') return null
    const numeric = Number(raw.replace('%', '').trim())
    if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) return null
    return String(numeric / 100)
  }
  if (unit === 'days') {
    if (param.path !== 'scenario.duration') return null
    const numeric = Number(raw.replace(/d$/i, '').trim())
    return Number.isFinite(numeric) && numeric > 0 ? `${Math.round(numeric)}d` : null
  }
  if (param.path === 'scenario.duration') {
    const numeric = Number(raw.replace(/d$/i, '').trim())
    return Number.isFinite(numeric) && numeric > 0 ? `${Math.round(numeric)}d` : null
  }
  return raw
}

export function previewParamImport(
  rows: readonly ParamRowModel[],
  table: { headers: readonly string[]; rows: readonly string[][] },
  mapping: ColumnMapping,
  units?: Readonly<Record<string, ImportUnit>>,
): ImportPreview {
  const template = templateMapping(table.headers)
  const pathIndexes = mapping
    .map((path, index) => path === null ? null : { path, index })
    .filter((item): item is { path: string; index: number } => item !== null)
  const reports: ImportRowReport[] = []
  const duplicatePaths = new Set<string>()
  let ok = true
  for (const path of new Set(pathIndexes.map((item) => item.path))) {
    if (pathIndexes.filter((item) => item.path === path).length > 1) {
      reports.push({ line: 1, path, reason: `${path}: duplicate path` })
      ok = false
    }
  }
  const previewRows: ImportPreviewRow[] = []
  const edits: Array<{ path: string; text: string }> = []
  const parseFailures = table.rows.length === 0
    ? [{ line: 1, path: null as string | null, reason: 'CSV has no data rows' }]
    : []
  for (const error of parseFailures) reports.push(error)
  if (parseFailures.length > 0) ok = false
  if (pathIndexes.length === 0) {
    reports.push({ line: 1, path: null, reason: 'map at least one parameter column' })
    return { ok: false, reports, rows: [], edits: [] }
  }
  table.rows.forEach((cells, rowIndex) => {
    const line = rowIndex + 2
    if (template) {
      const path = cells[template.path] ?? ''
      const raw = cells[template.value] ?? ''
      const def = PARAM_REGISTRY.find((param) => param.path === path)
      const row = rows.find((item) => item.def.path === path)
      if (path === '') {
        reports.push({ line, path: null, reason: 'path is empty' })
        ok = false
        return
      }
      if (!def || !row || !row.editable) {
        reports.push({ line, path, reason: `${path} is not an editable numeric parameter` })
        ok = false
        return
      }
      const input = transformParamImportValue(def, raw, units?.[path] ?? '')
      if (input === null) {
        reports.push({ line, path, reason: `${path}: unsupported unit conversion ${raw}` })
        ok = false
        return
      }
      if (input === '') {
        reports.push({ line, path, reason: `${path}: value is empty` })
        ok = false
        return
      }
      const parsed = parseCellInput(input, def)
      if (parsed.state !== 'ok') {
        reports.push({ line, path, reason: `${path}: ${parsed.error}` })
        ok = false
        return
      }
      const validationError = validateParam(def, parsed.value)
      if (validationError !== '') {
        reports.push({ line, path, reason: `${path}: ${validationError}` })
        ok = false
        return
      }
      if (duplicatePaths.has(path)) {
        reports.push({ line, path, reason: `${path}: duplicate path` })
        ok = false
        return
      }
      duplicatePaths.add(path)
      appendPreviewRow(reports, previewRows, edits, row, line, parsed.text)
      return
    }

    for (const { path, index } of pathIndexes) {
      const reportPath = path
      const def = PARAM_REGISTRY.find((param) => param.path === path)
      const row = rows.find((item) => item.def.path === path)
      if (!def || !row || !row.editable) {
        reports.push({ line, path: reportPath, reason: `${path} is not an editable numeric parameter` })
        ok = false
        continue
      }
      const input = transformParamImportValue(def, cells[index] ?? '', units?.[path] ?? '')
      if (input === null) {
        reports.push({ line, path, reason: `${path}: unsupported unit conversion ${cells[index] ?? ''}` })
        ok = false
        continue
      }
      if (input === '') {
        reports.push({ line, path, reason: `${path}: value is empty` })
        ok = false
        continue
      }
      const parsed = parseCellInput(input, def)
      if (parsed.state !== 'ok') {
        reports.push({ line, path, reason: `${path}: ${parsed.error}` })
        ok = false
        continue
      }
      const validationError = validateParam(def, parsed.value)
      if (validationError !== '') {
        reports.push({ line, path, reason: `${path}: ${validationError}` })
        ok = false
        continue
      }
      appendPreviewRow(reports, previewRows, edits, row, line, parsed.text)
    }
  })
  return { ok, reports, rows: previewRows, edits: ok ? edits : [] }
}

function appendPreviewRow(
  reports: ImportRowReport[],
  previewRows: ImportPreviewRow[],
  edits: Array<{ path: string; text: string }>,
  row: ParamRowModel,
  line: number,
  importText: string,
): void {
  const changed = row.candidate.text !== importText || row.candidate.present !== true
  previewRows.push({
    line,
    path: row.def.path,
    currentValue: row.candidate.present ? row.candidate.text : '(missing)',
    importValue: importText,
    changed,
  })
  if (changed) edits.push({ path: row.def.path, text: importText })
  reports.push({ line, path: row.def.path, reason: null })
}
