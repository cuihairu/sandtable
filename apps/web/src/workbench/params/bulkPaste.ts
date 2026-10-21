export type BulkPasteRow = {
  readonly line: number | null
  readonly row: unknown
  readonly message: string | null
}
export type BulkPasteResult<T> = {
  readonly rows: readonly T[]
  readonly reports: readonly BulkPasteRow[]
  readonly valid: boolean
}

export type BulkPasteMapper<T> = {
  readonly headers: readonly string[]
  readonly fields: readonly string[]
  readonly validate: (row: Record<string, string | undefined>) => string | null
  readonly build: (row: Record<string, string | undefined>) => T
}

/** TSV 优先、单字符 CSV 逐行判定;空行跳过,坏行保留报告,绝不静默丢弃。 */
export function parseBulkPaste<T>(text: string, mapper: BulkPasteMapper<T>): BulkPasteResult<T> {
  const reports: BulkPasteRow[] = []
  const rows: T[] = []
  let header: readonly string[] | null = null
  const lowerHeaders = new Set(mapper.headers.map((header) => header.toLowerCase()))
  for (const [rawIndex, rawLine] of text.replace(/\r\n?/g, '\n').split('\n').entries()) {
    const line = rawIndex + 1
    const trimmed = rawLine.trim()
    if (trimmed === '') continue
    const cells = (trimmed.includes('\t')
      ? trimmed.split('\t')
      : trimmed.includes(',') ? trimmed.split(',') : trimmed.split(/\s+/))
      .map((cell) => cell.trim())
      .filter((cell) => cell !== '')
    if (!header) {
      const lowered = cells.map((cell) => cell.toLowerCase())
      if (lowered.length >= mapper.fields.length && lowered.every((cell) => lowerHeaders.has(cell))) {
        header = lowered
        continue
      }
    }
    const mapped = header && cells.length === header.length
      ? header.map((field, index) => ({ field, value: cells[index] }))
      : cells.map((value, index) => ({ field: mapper.fields[index] ?? `extra:${index}`, value }))
    const raw: Record<string, string | undefined> = {}
    let issue: string | null = null
    for (const { field, value } of mapped) {
      if (!field || !lowerHeaders.has(field)) {
        issue = `未知字段:${field ?? '空'}`
        break
      }
      const canonical = mapper.headers.find((candidate) => candidate.toLowerCase() === field) ?? field
      raw[canonical] = value
    }
    if (issue === null) issue = mapper.validate(raw)
    if (issue !== null) {
      reports.push({ line, row: null, message: issue })
      continue
    }
    const row = mapper.build(raw)
    rows.push(row)
    reports.push({ line, row, message: null })
  }
  if (rows.length === 0 && reports.length === 0) {
    reports.push({ line: null, row: null, message: '粘贴内容为空' })
  }
  return { rows, reports, valid: reports.every((report) => report.message === null) && rows.length > 0 }
}
