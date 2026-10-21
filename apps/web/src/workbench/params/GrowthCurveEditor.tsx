// P1 · 成长曲线结构化编辑:表编辑 + 批量粘贴 + 示例求值 + 基础校验;
// 保存前整表过内核,diff/影响范围可见;基线只读。公式/掉落表/阶段规则后续批。
import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import {
  applyTierTable, parseConfig, readText,
} from './configYaml.ts'
import {
  GROWTH_PATH, growthDiff, growthImpact, parseGrowthPaste, previewGrowth, readGrowthRows, reviewGrowthRows,
} from './growthCurve.ts'
import { kernelCheck } from './paramsLogic.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

type Draft = {
  rows: readonly import('./growthCurve.ts').TierTableRow[]
  paste: string
  reports: readonly import('./growthCurve.ts').GrowthPasteRow[]
  error: string | null
  checking: boolean
  approved: boolean
  kernelError: string | null
}

const emptyDraft: Draft = {
  rows: [],
  paste: '',
  reports: [],
  error: null,
  checking: false,
  approved: false,
  kernelError: null,
}

export function GrowthCurveEditor({ open, onClose, baseYaml, candidateYaml, initialRows, onApply, onSaveVersion }: {
  open: boolean
  onClose: () => void
  baseYaml: string
  candidateYaml: string
  onApply: (yaml: string) => void
  onSaveVersion: (yaml: string) => void
  initialRows: readonly import('./growthCurve.ts').TierTableRow[]
}): JSX.Element | null {
  const locale = useLocale()
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft, rows: [...initialRows] })
  const baseTable = useMemo(() => readGrowthRows(baseYaml), [baseYaml])
  const candidateTable = useMemo(() => readGrowthRows(candidateYaml), [candidateYaml])
  const baseParsed = useMemo(() => parseConfig(baseYaml), [baseYaml])
  const nextReport = useMemo(() => reviewGrowthRows(draft.rows), [draft.rows])
  const impact = useMemo(() => growthImpact(baseTable, draft.rows), [baseTable, draft.rows])
  const diff = useMemo(() => growthDiff(baseTable, draft.rows), [baseTable, draft.rows])
  const [previewTier, setPreviewTier] = useState('0')
  const tierText = readText(baseParsed, 'model.dungeon.tiers')
  const tierCount = Number(tierText ?? '8')
  const previewTierValue = Number(previewTier)
  const currentPreview = useMemo(() => previewGrowth(
    previewTierValue,
    { mHp: 300, mAttack: 45, mDefense: 20, rewardGold: 40, rewardXp: 45 },
    { tier: 1.5, gold: 1.4, xp: 1.4 },
    draft.rows,
  ), [draft.rows, previewTierValue])

  const parsed = parseConfig(candidateYaml)
  const tierMismatch = candidateTable !== null && Number.isSafeInteger(tierCount) && candidateTable.length !== tierCount
  const canApply = nextReport.valid && draft.rows.length === tierCount && !tierMismatch && !draft.checking && draft.kernelError === null

  const pasteNow = (): void => {
    const result = parseGrowthPaste(draft.paste)
    const report = reviewGrowthRows(result.rows)
    setDraft((s) => ({
      ...s,
      rows: result.rows,
      reports: result.reports,
      approved: false,
      kernelError: null,
      error: result.rows.length === 0 ? '没有可导入的好行' : null,
      checking: report.valid && result.rows.length > 0,
    }))
  }

  useEffect(() => {
    if (!draft.checking) return
    let active = true
    const scratch = applyTierTable(candidateYaml, draft.rows)
    if (!scratch.ok) {
      queueMicrotask(() => {
        setDraft((s) => ({ ...s, checking: false, approved: false, error: scratch.error }))
      })
      return
    }
    void kernelCheck(scratch.yaml).then((result) => {
      if (!active) return
      setDraft((s) => ({
        ...s,
        checking: false,
        approved: result.ok,
        kernelError: result.ok ? null : `${result.path ? `${result.path}: ` : ''}${result.message}`,
      }))
    })
    return () => { active = false }
  }, [candidateYaml, draft.checking, draft.rows])

  if (!open) {
    return null
  }

  const apply = (): void => {
    const outcome = applyTierTable(candidateYaml, draft.rows)
    if (!outcome.ok) {
      setDraft((s) => ({ ...s, error: outcome.error }))
      return
    }
    onApply(outcome.yaml)
    onSaveVersion(outcome.yaml)
  }

  return (
    <section className="form-section growth-editor" aria-label={t(locale, 'params.growth.aria')}>
      <div className="form-section-heading">
        <h2>{t(locale, 'params.growth.title')}</h2>
        <span className="badge amber" role="status">{t(locale, 'params.growth.path')}</span>
        <button className="btn subtle" onClick={() => { onClose(); setDraft(emptyDraft) }}>{t(locale, 'common.closeDialog')}</button>
      </div>
      <p className="muted">{t(locale, 'params.growth.note', { path: GROWTH_PATH, n: tierCount })}</p>
      <div className="growth-grid">
        <table className="growth-table" aria-label={t(locale, 'params.growth.tableAria')}>
          <thead><tr>{(['tier', 'hp', 'attack', 'defense', 'gold', 'xp', 'actions'] as const).map((field) => (
            <th key={field}>{t(locale, `params.growth.${field}`)}</th>
          ))}</tr></thead>
          <tbody>
            {draft.rows.map((row, index) => (
              <tr key={index}>
                <td className="mono">{index + 1}</td>
                {(['hp', 'attack', 'defense', 'gold', 'xp'] as const).map((field) => (
                  <td key={field}>
                    <input
                      inputMode="numeric"
                      value={row[field] ?? ''}
                      aria-label={`${t(locale, `params.growth.${field}`)} ${index + 1}`}
                      onChange={(event) => {
                        const raw = event.target.value
                        const value = raw === '' ? (field === 'gold' || field === 'xp' ? null : Number.NaN) : Number(raw)
                        setDraft((s) => {
                          const rows = [...s.rows]
                          rows[index] = { ...row, [field]: value }
                          return { ...s, rows, approved: false, kernelError: null, checking: false }
                        })
                      }}
                    />
                  </td>
                ))}
                <td><button className="btn subtle" onClick={() => setDraft((s) => ({ ...s, rows: s.rows.filter((_, i) => i !== index), approved: false }))}>×</button></td>
              </tr>
            ))}
            <tr>
              <td colSpan={7}>
                <button
                  className="btn"
                  onClick={() => setDraft((s) => ({ ...s, rows: [...s.rows, { hp: Number.NaN, attack: Number.NaN, defense: Number.NaN, gold: null, xp: null }], approved: false }))}
                >
                  {t(locale, 'params.growth.addRow')}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <div className="growth-side">
          <label>
            {t(locale, 'params.growth.pasteLabel')}
            <textarea
              value={draft.paste}
              rows={5}
              spellCheck={false}
              aria-label={t(locale, 'params.growth.pasteAria')}
              onChange={(event) => setDraft((s) => ({ ...s, paste: event.target.value }))}
            />
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn" onClick={pasteNow}>{t(locale, 'params.growth.pasteParse')}</button>
            <button className="btn" onClick={() => setDraft((s) => ({ ...s, paste: (candidateTable ?? []).map((r) => [r.hp, r.attack, r.defense, r.gold ?? '', r.xp ?? ''].join('\t')).join('\n') }))}>
              {t(locale, 'params.growth.copyCurrent')}
            </button>
          </div>
          <label className="growth-preview">
            {t(locale, 'params.growth.previewLabel')}
            <input
              value={previewTier}
              inputMode="numeric"
              onChange={(event) => setPreviewTier(event.target.value)}
              aria-label={t(locale, 'params.growth.previewLabel')}
            />
          </label>
          <dl className="growth-preview-result">
            {currentPreview === null ? <dt>{t(locale, 'params.growth.previewInvalid')}</dt> : (
              <>
                <dt>hp</dt><dd>{currentPreview.hp}</dd>
                <dt>attack</dt><dd>{currentPreview.attack}</dd>
                <dt>defense</dt><dd>{currentPreview.defense}</dd>
                <dt>gold</dt><dd>{currentPreview.gold}</dd>
                <dt>xp</dt><dd>{currentPreview.xp}</dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {draft.reports.length > 0 && (
        <div className="error-wall" role="alert" aria-label={t(locale, 'params.growth.errorsAria')}>
          <strong>{t(locale, 'params.growth.errorTitle')}</strong>
          <ul>
            {draft.reports.filter((r) => r.message !== null).map((r) => (
              <li key={`${r.line}-${r.message}`}>{r.line === null ? '' : `#${r.line} `}{r.message}</li>
            ))}
            {nextReport.issues.map((issue) => <li key={`row-${issue.row}-${issue.message}`}>#{issue.row} {issue.message}</li>)}
            {tierMismatch && <li>{t(locale, 'params.growth.lengthMismatch', { actual: candidateTable?.length ?? 0, expected: tierCount })}</li>}
            {draft.kernelError && <li>{draft.kernelError}</li>}
          </ul>
        </div>
      )}
      {(nextReport.issues.length > 0 || tierMismatch || draft.kernelError) && draft.reports.length === 0 && (
        <div className="error-wall" role="alert" aria-label={t(locale, 'params.growth.errorsAria')}>
          <ul>
            {nextReport.issues.map((issue) => <li key={`row-${issue.row}-${issue.message}`}>#{issue.row} {issue.message}</li>)}
            {tierMismatch && <li>{t(locale, 'params.growth.lengthMismatch', { actual: candidateTable?.length ?? 0, expected: tierCount })}</li>}
            {draft.kernelError && <li>{draft.kernelError}</li>}
          </ul>
        </div>
      )}

      <div className="growth-review">
        <div>
          <h3>{t(locale, 'params.growth.diffTitle')}</h3>
          {parsed.errors.length > 0 && <p role="alert">{t(locale, 'params.yamlErrorLine', { line: parsed.errors[0].line, message: parsed.errors[0].message })}</p>}
          {diff.length === 0 ? <p className="muted">{t(locale, 'params.growth.noDiff')}</p> : (
            <ul className="growth-diff">
              {diff.slice(0, 24).map((row) => (
                <li key={`${row.tier}-${row.field}`}><span className="mono">#{row.tier}.{row.field}</span> {row.from} → {row.to}</li>
              ))}
              {diff.length > 24 && <li>{t(locale, 'params.growth.more', { n: diff.length - 24 })}</li>}
            </ul>
          )}
        </div>
        <div>
          <h3>{t(locale, 'params.growth.impactTitle')}</h3>
          <ul className="growth-impact">
            {impact.length === 0 ? <li>{t(locale, 'params.growth.noImpact')}</li> : impact.map((item) => <li key={item} className="mono">{item}</li>)}
          </ul>
          <p className="muted">{t(locale, 'params.growth.baselineNote')}</p>
        </div>
      </div>

      <div className="growth-actions">
        <button className="btn" disabled={!nextReport.valid || draft.rows.length === 0} onClick={() => setDraft((s) => ({ ...s, checking: true, approved: false, kernelError: null }))}>
          {draft.checking ? t(locale, 'params.checking') : t(locale, 'params.growth.check')}
        </button>
        <button className="btn primary" disabled={!canApply} onClick={apply}>{t(locale, 'params.growth.apply')}</button>
        <button className="btn" onClick={() => setDraft((s) => ({ ...s, rows: baseTable ?? [] }))}>{t(locale, 'params.growth.reset')}</button>
      </div>
    </section>
  )
}
