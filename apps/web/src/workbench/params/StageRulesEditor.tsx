import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { parseBulkPaste } from './bulkPaste.ts'
import { parseConfig } from './configYaml.ts'
import { kernelCheck } from './paramsLogic.ts'
import {
  applyStageRuleRows, readStageRuleRows, reviewStageRules, stageRuleDiff, stageRuleImpact,
  stageRuleSummaries, STAGE_RULES_PATH,
} from './stageRules.ts'
import type { StageRuleRow } from './stageRules.ts'
import { useLocale } from '../state/localeStore.ts'

type Draft = {
  rows: readonly StageRuleRow[]
  paste: string
  reports: readonly import('./bulkPaste.ts').BulkPasteRow[]
  error: string | null
  checking: boolean
  approved: boolean
  kernelError: string | null
}

const emptyDraft: Draft = {
  rows: [], paste: '', reports: [], error: null, checking: false, approved: false, kernelError: null,
}

const stageMapper = {
  headers: ['from', 'to', 'effect', 'chance'],
  fields: ['from', 'to', 'effect', 'chance'],
  validate: (row: Record<string, string | undefined>): string | null => {
    const from = Number(row.from)
    const chance = Number(row.chance)
    if (!Number.isSafeInteger(from) || from < 0) return 'from 必须为非负安全整数'
    if (row.to === undefined || row.to === '') return 'to 必须为文本'
    if (row.effect === undefined || row.effect === '') return 'effect 必须为文本'
    if (!Number.isFinite(chance)) return 'chance 必须为有限数值'
    return null
  },
  build: (row: Record<string, string | undefined>): StageRuleRow => ({
    from: Number(row.from),
    to: String(row.to ?? ''),
    effect: String(row.effect ?? ''),
    chance: Number(row.chance),
  }),
}

export function StageRulesEditor({ open, onClose, baseYaml, candidateYaml, onApply, onSaveVersion }: {
  open: boolean
  onClose: () => void
  baseYaml: string
  candidateYaml: string
  onApply: (yaml: string) => void
  onSaveVersion: (yaml: string) => void
}): JSX.Element | null {
  const locale = useLocale()
  const english = locale.startsWith('en')
  const [draft, setDraft] = useState<Draft>(() => ({ ...emptyDraft, rows: [...(readStageRuleRows(candidateYaml) ?? [])] }))
  const baseRows = useMemo(() => readStageRuleRows(baseYaml), [baseYaml])
  const report = useMemo(() => reviewStageRules(draft.rows), [draft.rows])
  const diff = useMemo(() => stageRuleDiff(baseRows, draft.rows), [baseRows, draft.rows])
  const impact = useMemo(() => stageRuleImpact(baseRows, draft.rows), [baseRows, draft.rows])
  const parsed = parseConfig(candidateYaml)
  const canApply = report.valid && parsed.errors.length === 0 && !draft.checking && draft.approved && draft.kernelError === null

  const pasteNow = (): void => {
    const result = parseBulkPaste(draft.paste, stageMapper)
    const nextReport = reviewStageRules(result.rows)
    setDraft((current) => ({
      ...current,
      rows: result.rows,
      reports: result.reports,
      error: result.rows.length === 0 ? english ? 'No importable good rows' : '没有可导入的好行' : null,
      approved: false,
      kernelError: null,
      checking: nextReport.valid && result.rows.length > 0,
    }))
  }

  useEffect(() => {
    if (!draft.checking) return
    let active = true
    const scratch = applyStageRuleRows(candidateYaml, draft.rows)
    if (!scratch.ok) {
      queueMicrotask(() => {
        if (active) setDraft((current) => ({ ...current, checking: false, approved: false, error: scratch.error }))
      })
      return
    }
    void kernelCheck(scratch.yaml).then((result) => {
      if (!active) return
      setDraft((current) => ({
        ...current,
        checking: false,
        approved: result.ok,
        kernelError: result.ok ? null : `${result.path ? `${result.path}: ` : ''}${result.message}`,
      }))
    })
    return () => { active = false }
  }, [candidateYaml, draft.checking, draft.rows])

  if (!open) return null

  const update = (index: number, field: keyof StageRuleRow, value: string): void => {
    setDraft((current) => ({
      ...current,
      approved: false,
      kernelError: null,
      checking: false,
      rows: current.rows.map((row, rowIndex) => rowIndex === index
        ? { ...row, [field]: field === 'from' || field === 'chance' ? Number(value) : value }
        : row),
    }))
  }

  const apply = (): void => {
    const outcome = applyStageRuleRows(candidateYaml, draft.rows)
    if (!outcome.ok) {
      setDraft((current) => ({ ...current, error: outcome.error }))
      return
    }
    onApply(outcome.yaml)
    onSaveVersion(outcome.yaml)
  }

  return (
    <section className="form-section growth-editor" aria-label={english ? 'Stage rules structured editor' : '阶段规则结构化编辑器'}>
      <div className="form-section-heading">
        <h2>{english ? 'Stage rules' : '阶段规则'}</h2>
        <span className="badge amber">{english ? 'Baseline read-only · candidate write' : '基线只读 · 候选写入'}</span>
        <button className="btn subtle" onClick={() => { onClose(); setDraft(emptyDraft) }}>{english ? 'Close' : '关闭'}</button>
      </div>
      <p className="muted">{english ? `YAML path: ${STAGE_RULES_PATH}; the kernel is the final authority.` : `YAML 路径:${STAGE_RULES_PATH};内核是最终权威。`}</p>
      <div className="growth-grid">
        <table className="growth-table" aria-label={english ? 'Stage rules table' : '阶段规则表'}>
          <thead><tr>{['from', 'to', 'effect', 'chance', ''].map((field) => <th key={field}>{field}</th>)}</tr></thead>
          <tbody>
            {draft.rows.map((row, index) => (
              <tr key={index}>
                {(['from', 'to', 'effect', 'chance'] as const).map((field) => (
                  <td key={field}>
                    <input
                      value={row[field]}
                      inputMode={field === 'from' || field === 'chance' ? 'numeric' : 'text'}
                      aria-invalid={report.issues.some((issue) => issue.row === index + 1 && issue.message.includes(field))}
                      onChange={(event) => update(index, field, event.target.value)}
                      aria-label={`${STAGE_RULES_PATH}.${field} #${index}`}
                    />
                  </td>
                ))}
                <td>
                  <button className="btn subtle" onClick={() => setDraft((current) => ({ ...current, rows: current.rows.filter((_, rowIndex) => rowIndex !== index), approved: false }))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="growth-side">
          <label className="form-field">
            {english ? 'Bulk paste (TSV/CSV, header optional)' : '批量粘贴(TSV/CSV,可含表头)'}
            <textarea
              rows={8}
              value={draft.paste}
              aria-label={english ? 'Stage rules bulk paste text' : '阶段规则批量粘贴文本'}
              onChange={(event) => setDraft((current) => ({ ...current, paste: event.target.value }))}
            />
          </label>
          <div className="growth-actions">
            <button className="btn" onClick={pasteNow}>{english ? 'Parse and replace' : '解析并替换'}</button>
            <button
              className="btn"
              onClick={() => setDraft((current) => ({ ...current, paste: stageRuleSummaries(current.rows).map((row) => [row.from, row.to, 'effect', row.chance].join('\t')).join('\n') }))}
            >
              {english ? 'Copy summaries' : '导出摘要'}
            </button>
          </div>
          <div className="loot-totals" role="status">
            {stageRuleSummaries(draft.rows).map((row) => (
              <div key={`${row.from}-${row.to}`}>{row.from} → {row.to}: {row.chance}%</div>
            ))}
          </div>
        </div>
      </div>

      {(draft.reports.some((row) => row.message !== null) || report.issues.length > 0 || draft.error || draft.kernelError) && (
        <div className="error-wall" role="alert" aria-label={english ? 'Stage rules errors' : '阶段规则错误列表'}>
          {draft.reports.some((row) => row.message !== null) && <strong>{english ? 'Per-row paste report' : '批量粘贴逐行报告'}</strong>}
          <ul>
            {draft.reports.filter((row) => row.message !== null).map((row) => (
              <li key={`${row.line}-${row.message}`}>{row.line === null ? '' : `#${row.line} `}{row.message}</li>
            ))}
            {report.issues.map((issue) => <li key={`${issue.row}-${issue.message}`}>{issue.row === null ? '' : `#${issue.row} `}{issue.message}</li>)}
            {draft.error && <li>{draft.error}</li>}
            {draft.kernelError && <li>{draft.kernelError}</li>}
          </ul>
        </div>
      )}

      <div className="growth-review">
        <div>
          <h3>{english ? 'Pre-save diff' : '保存前 diff'}</h3>
          {parsed.errors.length > 0 && <p role="alert">{`#${parsed.errors[0].line} ${parsed.errors[0].message}`}</p>}
          {diff.length === 0 ? <p className="muted">{english ? 'No difference from baseline.' : '相对基线无差异。'}</p> : (
            <ul className="growth-diff">
              {diff.slice(0, 24).map((row) => (
                <li key={`${row.index}-${row.field}`}><span className="mono">#{row.index}.{row.field}</span> {row.from} → {row.to}</li>
              ))}
              {diff.length > 24 && <li>{english ? `${diff.length - 24} more differences` : `另有 ${diff.length - 24} 个差异`}</li>}
            </ul>
          )}
        </div>
        <div>
          <h3>{english ? 'Impact scope' : '影响范围'}</h3>
          <ul className="growth-impact">
            {impact.length === 0 ? <li>{english ? 'No write impact.' : '无写入影响。'}</li> : impact.map((item) => <li key={item} className="mono">{item}</li>)}
          </ul>
          <p className="muted">{english ? 'The baseline remains read-only; apply writes only the current candidate.' : '基线只读;应用只改当前候选。'}</p>
        </div>
      </div>

      <div className="growth-actions">
        <button className="btn" disabled={!report.valid || draft.rows.length === 0} onClick={() => setDraft((current) => ({ ...current, checking: true, approved: false, kernelError: null }))}>
          {draft.checking ? english ? 'Checking' : '校验中' : english ? 'Check and validate' : '预检并校验'}
        </button>
        <button className="btn primary" disabled={!canApply} onClick={apply}>{english ? 'Write candidate and save version' : '写入候选并存版本'}</button>
        <button className="btn" onClick={() => setDraft((current) => ({ ...current, rows: [...(baseRows ?? [])], approved: false, kernelError: null }))}>
          {english ? 'Load baseline' : '载入基线'}
        </button>
      </div>
    </section>
  )
}
