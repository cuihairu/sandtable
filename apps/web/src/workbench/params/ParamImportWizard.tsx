import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { OverlayDialog } from '../overlays/OverlayDialog.tsx'
import { PARAM_REGISTRY, displayParamName } from './paramRegistry.ts'
import type { ParamRowModel } from './paramsLogic.ts'
import {
  autoMapColumns, importTemplateCsv, parseCsv, parseParameterImportFile,
  previewParamImport, templateRole, unitOf,
  type ImportUnit,
} from './paramImport.ts'
import { toCsv } from '../../lib/machineExport.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type ParamImportWizardProps = {
  open: boolean
  rows: readonly ParamRowModel[]
  onClose: () => void
  onApply: (edits: Array<{ path: string; text: string }>) => Promise<void>
}

export function ParamImportWizard({
  open, rows, onClose, onApply,
}: ParamImportWizardProps): JSX.Element | null {
  const locale = useLocale()
  const [text, setText] = useState('')
  const [unitByPath, setUnitByPath] = useState<Record<string, ImportUnit>>({})
  const [headerToPath, setHeaderToPath] = useState<Record<string, string>>({})
  const [applying, setApplying] = useState(false)
  const parsed = useMemo(() => parseCsv(text), [text])
  const autoMapping = useMemo(() => autoMapColumns(parsed.headers), [parsed.headers])
  const selected = parsed.headers.map((header, index) => headerToPath[header] ?? autoMapping[index] ?? null)
  const editablePaths = rows.filter((row) => row.editable).map((row) => row.def.path)
  const preview = useMemo(
    () => previewParamImport(rows, parsed, selected, unitByPath),
    [rows, parsed, selected, unitByPath],
  )

  const apply = async (edits: Array<{ path: string; text: string }>): Promise<void> => {
    setApplying(true)
    try {
      await onApply(edits)
    } finally {
      setApplying(false)
    }
  }

  if (!open) return null

  const downloadTemplate = (): void => {
    const url = URL.createObjectURL(new Blob([importTemplateCsv()], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'sandtable-parameter-import.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const assignPath = (header: string, path: string): void => {
    const headerIndex = parsed.headers.indexOf(header)
    const previousHeader = parsed.headers.find((_candidate, index) =>
      index !== headerIndex && selected[index] === path && path !== '')
    const next = { ...headerToPath, [header]: path }
    if (previousHeader !== undefined) delete next[previousHeader]
    setHeaderToPath(next)
  }

  const load = async (file: File): Promise<void> => {
    const table = await parseParameterImportFile(file)
    setText(table.headers.length === 0 ? '' : toCsv(table.headers, table.rows))
    setHeaderToPath({})
    setUnitByPath({})
  }

  return (
    <OverlayDialog open={open} onClose={onClose} title={t(locale, 'params.import.title')}>
      <div className="param-import">
        <div className="param-import-actions">
          <button className="btn" onClick={downloadTemplate}>{t(locale, 'params.import.template')}</button>
          <label className="btn">
            {t(locale, 'params.import.file')}
            <input
              type="file"
              accept=".csv,.txt,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void load(file)
              }}
            />
          </label>
        </div>
        <textarea
          rows={7}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label={t(locale, 'params.import.paste')}
        />
        {parsed.errors.length > 0 && (
          <div className="parameter-error" role="alert">
            {parsed.errors.map((error) => `${error.line}: ${error.reason}`).join('; ')}
          </div>
        )}
        <section>
          <h3>{t(locale, 'params.import.mapping')}</h3>
          <table>
            <thead>
              <tr>
                <th>{t(locale, 'params.import.header')}</th>
                <th>{t(locale, 'params.import.path')}</th>
                <th>{t(locale, 'params.import.unitChoice')}</th>
              </tr>
            </thead>
            <tbody>
              {parsed.headers.map((header, index) => {
                const path = selected[index] ?? ''
                const role = templateRole(header)
                return (
                  <tr key={`${index}:${header}`}>
                    <td>{header}</td>
                    <td>
                      {role ? (
                        <span
                          className="muted"
                          data-testid="param-import-template-role"
                        >{t(locale, 'params.import.templateRole')}</span>
                      ) : (
                        <select
                          value={path}
                          onChange={(event) => assignPath(header, event.target.value)}
                          aria-label={`${t(locale, 'params.import.mapping')}: ${header}`}
                        >
                          <option value="">{t(locale, 'params.import.unmapped')}</option>
                          {editablePaths.map((candidate) => (
                            <option key={candidate} value={candidate}>{candidate}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      {path ? (
                        <select
                          value={unitByPath[path] ?? ''}
                          onChange={(event) => setUnitByPath((value) => ({
                            ...value,
                            [path]: event.target.value as ImportUnit,
                          }))}
                          aria-label={`${t(locale, 'params.import.unitChoice')}: ${path}`}
                        >
                          <option value="">{t(locale, 'params.import.native')}</option>
                          <option value="percent">percent</option>
                          <option value="days">days</option>
                        </select>
                      ) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
        <section>
          <h3>{t(locale, 'params.import.dictionary')}</h3>
          <table>
            <thead>
              <tr>
                <th>{t(locale, 'params.import.path')}</th>
                <th>{t(locale, 'params.import.type')}</th>
                <th>{t(locale, 'params.import.unit')}</th>
                <th>{t(locale, 'params.import.current')}</th>
                <th>{t(locale, 'params.import.value')}</th>
              </tr>
            </thead>
            <tbody>
              {PARAM_REGISTRY.map((param) => (
                <tr key={param.path} data-testid={`param-import-row-${param.path}`}>
                  <td>
                    <code>{param.path}</code>
                    <div className="muted">{displayParamName(param.path, locale)}</div>
                  </td>
                  <td>{param.kind}</td>
                  <td>{unitOf(param) || '—'}</td>
                  <td>
                    {rows.find((row) => row.def.path === param.path)?.candidate.text
                      || t(locale, 'params.import.missing')}
                  </td>
                  <td>{param.default === '—' ? '—' : param.default}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section>
          <h3>{t(locale, 'params.import.diff')}</h3>
          <table>
            <thead>
              <tr>
                <th>{t(locale, 'params.import.line')}</th>
                <th>{t(locale, 'params.import.path')}</th>
                <th>{t(locale, 'params.import.current')}</th>
                <th>{t(locale, 'params.import.imported')}</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.map((row) => (
                <tr key={`${row.line}:${row.path}`} data-line={row.line}>
                  <td>{row.line}</td>
                  <td><code>{row.path}</code></td>
                  <td>{row.currentValue}</td>
                  <td>{row.importValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview.reports.some((report) => report.reason !== null) && (
            <div className="parameter-error" role="alert">
              {preview.reports.filter((report) => report.reason !== null)
                .map((report) => `${report.line}: ${report.path ?? ''} ${report.reason}`).join('; ')}
            </div>
          )}
        </section>
        <footer className="dialog-actions">
          <button className="btn subtle" onClick={onClose}>{t(locale, 'params.import.cancel')}</button>
          <button
            className="btn primary"
            disabled={preview.rows.length === 0 || !preview.ok || parsed.errors.length > 0 || applying}
            onClick={() => void apply(preview.edits)}
          >
            {applying ? t(locale, 'params.import.check') : t(locale, 'params.import.confirm')}
          </button>
        </footer>
      </div>
    </OverlayDialog>
  )
}
