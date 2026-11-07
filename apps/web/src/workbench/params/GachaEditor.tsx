import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { applyGachaConfig, parseConfig } from './configYaml.ts'
import type { GachaConfig } from '../../lib/types.ts'
import { draftGacha, gachaDiff, gachaDraft, gachaToYaml, reviewGacha } from './gachaYaml.ts'
import { kernelCheck } from './paramsLogic.ts'
import { yamlToValue } from './yamlValue.ts'
import { useLocale } from '../state/localeStore.ts'

type DraftState = { text: string; checking: boolean; approved: boolean; kernelError: string | null }
type Parsed = { ok: true; value: GachaConfig } | { ok: false; error: string }
type EditorGacha = {
  -readonly [K in keyof ReturnType<typeof gachaDraft>]: ReturnType<typeof gachaDraft>[K]
}

const initialDraft: DraftState = { text: '', checking: false, approved: false, kernelError: null }

const FIELDS = [
  ['baseRate', 'base_rate', 'decimal'],
  ['pityHard', 'pity_hard', 'numeric'],
  ['pitySoftStart', 'pity_soft_start', 'numeric'],
  ['pitySoftStep', 'pity_soft_step', 'decimal'],
  ['featuredRate', 'featured_rate', 'decimal'],
  ['featuredGuarantee', 'featured_guarantee', 'numeric'],
] as const

/** 抽签/保底结构化编辑器:表单改数值 + 批量 YAML,写回走 applyGachaConfig 手术。
 * 基线只读,候选写入;从不改 candidateYaml 本身。骨架与 LootTableEditor 同构。 */
export function GachaEditor({ open, onClose, baseYaml, candidateYaml, onApply, onSaveVersion }: {
  open: boolean
  onClose: () => void
  baseYaml: string
  candidateYaml: string
  onApply: (yaml: string) => void
  onSaveVersion: (yaml: string) => void
}): JSX.Element | null {
  const locale = useLocale()
  const en = locale.startsWith('en')
  const [draft, setDraft] = useState<DraftState>({ ...initialDraft, text: candidateYaml })
  const base = useMemo(() => parseConfigured(baseYaml), [baseYaml])
  const parsed = useMemo(() => parseGacha(draft.text), [draft.text])
  const value = parsed.ok ? gachaDraft(parsed.value) : null
  const report = useMemo(() => value === null
    ? { issues: [{ row: null, message: parsed.ok ? '' : parsed.error }], valid: false }
    : reviewGacha(value), [parsed, value])
  const diff = useMemo(() => value === null ? [] : gachaDiff(base, value), [base, value])
  const canApply = Boolean(value && report.valid && draft.approved && !draft.checking && draft.kernelError === null)

  const update = (mutate: (draft: EditorGacha) => void): void => {
    if (value === null) return
    const next = structuredClone(value)
    mutate(next)
    setDraft((s) => ({ ...s, text: gachaToYaml(next), approved: false, kernelError: null, checking: false }))
  }

  useEffect(() => {
    if (!draft.checking || value === null) return
    let active = true
    const outcome = applyGachaConfig(candidateYaml, draftGacha(value))
    if (!outcome.ok) {
      void Promise.resolve().then(() => {
        if (active) setDraft((s) => ({ ...s, checking: false, kernelError: outcome.error }))
      })
      return
    }
    void kernelCheck(outcome.yaml).then((result) => {
      if (!active) return
      setDraft((s) => ({ ...s, checking: false, approved: result.ok, kernelError: result.ok ? null : `${result.path ? `${result.path}: ` : ''}${result.message}` }))
    })
    return () => { active = false }
  }, [candidateYaml, draft.checking, value])

  if (!open) return null

  const apply = (): void => {
    if (value === null || !report.valid) return
    const outcome = applyGachaConfig(candidateYaml, draftGacha(value))
    if (!outcome.ok) { setDraft((s) => ({ ...s, kernelError: outcome.error })); return }
    onApply(outcome.yaml)
    onSaveVersion(outcome.yaml)
  }

  const fieldLabels: Record<keyof EditorGacha, string> = {
    baseRate: en ? 'Base 5★ rate' : '基础 5★ 概率',
    pityHard: en ? 'Hard pity (pulls)' : '硬保底(抽)',
    pitySoftStart: en ? 'Soft pity start (pull)' : '软保底起点(第 N 抽)',
    pitySoftStep: en ? 'Soft pity step' : '软保底递增',
    featuredRate: en ? 'Featured rate (0 = none)' : 'UP 概率(0 = 无 UP)',
    featuredGuarantee: en ? 'Featured guarantee (0 = none)' : '定轨阈值(0 = 无定轨)',
  }

  return (
    <section className="form-section growth-editor gacha-editor" aria-label={en ? 'Gacha structured editor' : '抽签结构化编辑器'}>
      <div className="form-section-heading">
        <h2>{en ? 'Gacha / pity' : '抽签/保底'}</h2>
        <span className="badge amber">{en ? 'Baseline read-only · candidate write' : '基线只读 · 候选写入'}</span>
        <button className="btn subtle" onClick={() => { onClose(); setDraft(initialDraft) }}>{en ? 'Close' : '关闭'}</button>
      </div>
      <div className="growth-grid">
        <div className="growth-fields">
          {FIELDS.map(([draftKey, yamlKey, inputMode]) => (
            <label key={draftKey}>
              {fieldLabels[draftKey]}
              <input inputMode={inputMode} value={value?.[draftKey] ?? ''} onChange={(e) => update((d) => { d[draftKey] = Number(e.target.value) })} data-field={yamlKey} />
            </label>
          ))}
        </div>
        <div className="growth-side">
          <label>{en ? 'Bulk YAML (TSV-safe structure)' : '批量编辑 YAML'}<textarea rows={9} value={draft.text} onChange={(e) => setDraft((s) => ({ ...s, text: e.target.value, approved: false, kernelError: null, checking: false }))} /></label>
          <div className="loot-totals" role="status">
            {value === null ? null : (
              <>
                <div>{en ? `Guaranteed 5★ by pull ${value.pityHard > 0 ? value.pityHard : '—'}` : `第 ${value.pityHard > 0 ? value.pityHard : '—'} 抽必出 5★`}</div>
                <div>{en ? `Soft pity: rate grows +${value.pitySoftStep}/pull from pull ${value.pitySoftStart > 0 ? value.pitySoftStart : '—'}` : `软保底:第 ${value.pitySoftStart > 0 ? value.pitySoftStart : '—'} 抽起每抽 +${value.pitySoftStep}`}</div>
                <div>{value.featuredRate > 0
                  ? en ? `Featured: ${Math.round(value.featuredRate * 100)}%, guaranteed after ${value.featuredGuarantee > 0 ? value.featuredGuarantee : '—'} misses` : `UP: ${Math.round(value.featuredRate * 100)}%,连歪 ${value.featuredGuarantee > 0 ? value.featuredGuarantee : '—'} 次必中`
                  : en ? 'No featured banner' : '无 UP 池'}</div>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="growth-review">
        <div><h3>{en ? 'Pre-save diff' : '保存前 diff'}</h3>{diff.length === 0 ? <p className="muted">{en ? 'No difference from baseline.' : '相对基线无差异。'}</p> : <ul>{diff.map((row) => <li key={row.field}>{row.field}: {row.from} → {row.to}</li>)}</ul>}</div>
        <div><h3>{en ? 'Impact scope' : '影响范围'}</h3><ul>{diff.length === 0 ? <li>{en ? 'No write impact.' : '无写入影响。'}</li> : <li className="mono">model.gacha</li>}</ul></div>
      </div>
      {report.issues.length > 0 && (
        <div className="error-wall" role="alert" aria-label={en ? 'Gacha errors' : '抽签错误列表'}>
          <ul>{report.issues.map((issue) => <li key={issue.message}>{issue.message}</li>)}</ul>
        </div>
      )}
      <div className="growth-actions">
        <button className="btn" disabled={!report.valid || draft.checking} onClick={() => setDraft((s) => ({ ...s, checking: true, approved: false }))}>{draft.checking ? en ? 'Checking' : '校验中' : en ? 'Check and validate' : '预检并校验'}</button>
        <button className="btn primary" disabled={!canApply} onClick={apply}>{en ? 'Write candidate and save version' : '写入候选并存版本'}</button>
      </div>
    </section>
  )
}

function parseConfigured(source: string): GachaConfig | null {
  try {
    const parsed = parseConfig(source)
    if (parsed.errors.length > 0) throw new Error(`第 ${parsed.errors[0].line} 行:${parsed.errors[0].message}`)
    const root = yamlToValue(source) as { model?: { gacha?: GachaConfig } }
    return root.model?.gacha ?? null
  } catch {
    return null
  }
}

function parseGacha(source: string): Parsed {
  try {
    const parsed = parseConfig(source)
    if (parsed.errors.length > 0) return { ok: false, error: `第 ${parsed.errors[0].line} 行:${parsed.errors[0].message}` }
    const root = yamlToValue(source) as { model?: { gacha?: GachaConfig } }
    return { ok: true, value: root.model?.gacha ?? { base_rate: 0.02, pity_hard: 0, pity_soft_start: 0, pity_soft_step: 0 } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'YAML 无效' }
  }
}
