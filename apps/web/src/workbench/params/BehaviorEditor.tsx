import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { applyBehaviorConfig, applyTrainingConfig, parseConfig } from './configYaml.ts'
import type { BehaviorConfig } from '../../lib/types.ts'
import {
  behaviorDiff, behaviorDraft, behaviorToYaml, COHORTS, defaultTraining, draftBehavior,
  hasTrainingSection, readTraining, reviewBehavior,
} from './behaviorYaml.ts'
import type { BehaviorCohort, BehaviorDraft } from './behaviorYaml.ts'
import { kernelCheck } from './paramsLogic.ts'
import { yamlToValue } from './yamlValue.ts'
import { useLocale } from '../state/localeStore.ts'

type DraftState = { text: string; checking: boolean; approved: boolean; kernelError: string | null }
type Parsed = { ok: true; value: BehaviorDraft } | { ok: false; error: string }
type EditorBehavior = {
  -readonly [K in keyof BehaviorDraft]: BehaviorDraft[K]
}

const initialDraft: DraftState = { text: '', checking: false, approved: false, kernelError: null }

/** 写回序列:behavior 整段 → training 整段(仅启用时),两段都成才算候选。 */
function mergedYaml(candidateYaml: string, value: BehaviorDraft): { ok: true; yaml: string } | { ok: false; error: string } {
  const outcomeB = applyBehaviorConfig(candidateYaml, draftBehavior(value))
  if (!outcomeB.ok) return outcomeB
  if (value.training === null) return outcomeB
  return applyTrainingConfig(outcomeB.yaml, value.training)
}

const GROUP_FIELDS = [
  ['sessionsInt', 'sessions_int', 'numeric'],
  ['sessionsFrac', 'sessions_frac', 'decimal'],
  ['pDungeon', 'p_dungeon', 'decimal'],
  ['pUpgrade', 'p_upgrade', 'decimal'],
  ['pTraining', 'p_training', 'decimal'],
] as const

/** 行为画像结构化编辑器:三群体表单 + 练级产出面 + 批量 YAML,写回走
 * applyBehaviorConfig + applyTrainingConfig 两段手术。骨架与 LootTableEditor 同构。 */
export function BehaviorEditor({ open, onClose, baseYaml, candidateYaml, onApply, onSaveVersion }: {
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
  const parsed = useMemo(() => parseBehavior(draft.text), [draft.text])
  const value = parsed.ok ? parsed.value : null
  const report = useMemo(() => value === null
    ? { issues: [{ row: null as number | null, message: parsed.ok ? '' : parsed.error }], valid: false }
    : reviewBehavior(value, hasTrainingSection(candidateYaml)), [parsed, value, candidateYaml])
  const diff = useMemo(() => value === null ? [] : behaviorDiff(base, value), [base, value])
  const canApply = Boolean(value && report.valid && draft.approved && !draft.checking && draft.kernelError === null)

  const update = (mutate: (draft: EditorBehavior) => void): void => {
    if (value === null) return
    const next = structuredClone(value) as { -readonly [K in keyof BehaviorDraft]: BehaviorDraft[K] }
    mutate(next)
    setDraft((s) => ({ ...s, text: behaviorToYaml(next), approved: false, kernelError: null, checking: false }))
  }

  const setGroup = (cohort: BehaviorCohort, field: (typeof GROUP_FIELDS)[number][0], raw: string): void => {
    update((d) => { d.groups = { ...d.groups, [cohort]: { ...d.groups[cohort], [field]: Number(raw) } } })
  }

  useEffect(() => {
    if (!draft.checking || value === null) return
    let active = true
    const outcome = mergedYaml(candidateYaml, value)
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
    const outcome = mergedYaml(candidateYaml, value)
    if (!outcome.ok) { setDraft((s) => ({ ...s, kernelError: outcome.error })); return }
    onApply(outcome.yaml)
    onSaveVersion(outcome.yaml)
  }

  const cohortNames: Record<BehaviorCohort, string> = {
    casual: en ? 'Casual' : '休闲',
    core: en ? 'Core' : '核心',
    whale: en ? 'Whale' : '鲸鱼',
  }
  const groupLabels: Record<(typeof GROUP_FIELDS)[number][0], string> = {
    sessionsInt: en ? 'Sessions (int)' : '会话数(整数)',
    sessionsFrac: en ? 'Sessions (frac)' : '会话补抽(小数)',
    pDungeon: en ? 'P(dungeon)' : '副本概率',
    pUpgrade: en ? 'P(upgrade)' : '升级概率',
    pTraining: en ? 'P(training)' : '练级概率',
  }

  return (
    <section className="form-section growth-editor behavior-editor" aria-label={en ? 'Behavior profile structured editor' : '行为画像结构化编辑器'}>
      <div className="form-section-heading">
        <h2>{en ? 'Behavior profiles' : '行为画像'}</h2>
        <span className="badge amber">{en ? 'Baseline read-only · candidate write' : '基线只读 · 候选写入'}</span>
        <button className="btn subtle" onClick={() => { onClose(); setDraft(initialDraft) }}>{en ? 'Close' : '关闭'}</button>
      </div>
      <div className="growth-grid">
        <table className="growth-table">
          <thead><tr>{[en ? 'Cohort' : '群体', ...GROUP_FIELDS.map(([draftKey]) => groupLabels[draftKey])].map((label, index) => <th key={index}>{label}</th>)}</tr></thead>
          <tbody>
            {COHORTS.map((cohort) => (
              <tr key={cohort}>
                <td>{cohortNames[cohort]}</td>
                {GROUP_FIELDS.map(([draftKey, , inputMode]) => (
                  <td key={draftKey}>
                    <input inputMode={inputMode} value={value?.groups[cohort][draftKey] ?? ''} onChange={(e) => setGroup(cohort, draftKey, e.target.value)} data-field={`${cohort}.${GROUP_FIELDS.find(([k]) => k === draftKey)?.[1]}`} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="growth-side">
          <label>
            <input type="checkbox" checked={value?.training !== null} onChange={(e) => update((d) => { d.training = e.target.checked ? defaultTraining() : null })} />
            {en ? 'Training yields (xp/gold per session)' : '练级产出面(每次会话 经验/金币)'}
          </label>
          {value?.training !== null && (
            <>
              <label>xp<input inputMode="numeric" value={value?.training?.xp ?? ''} onChange={(e) => update((d) => { d.training = d.training === null ? null : { ...d.training, xp: Number(e.target.value) } })} /></label>
              <label>gold<input inputMode="numeric" value={value?.training?.gold ?? ''} onChange={(e) => update((d) => { d.training = d.training === null ? null : { ...d.training, gold: Number(e.target.value) } })} /></label>
            </>
          )}
          <label>{en ? 'Bulk YAML (TSV-safe structure)' : '批量编辑 YAML'}<textarea rows={9} value={draft.text} onChange={(e) => setDraft((s) => ({ ...s, text: e.target.value, approved: false, kernelError: null, checking: false }))} /></label>
          <div className="loot-totals" role="status">
            {COHORTS.map((cohort) => value === null ? null : (
              <div key={cohort}>
                {cohort}: {value.groups[cohort].sessionsInt + value.groups[cohort].sessionsFrac} {en ? 'sessions/day idle' : '次/日在闲'}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="growth-review">
        <div><h3>{en ? 'Pre-save diff' : '保存前 diff'}</h3>{diff.length === 0 ? <p className="muted">{en ? 'No difference from baseline.' : '相对基线无差异。'}</p> : <ul>{diff.map((row) => <li key={row.field}>{row.field}: {row.from} → {row.to}</li>)}</ul>}</div>
        <div><h3>{en ? 'Impact scope' : '影响范围'}</h3><ul>{diff.length === 0 ? <li>{en ? 'No write impact.' : '无写入影响。'}</li> : <li className="mono">model.behavior{value?.training !== null ? ' + model.training' : ''}</li>}</ul></div>
      </div>
      {report.issues.length > 0 && (
        <div className="error-wall" role="alert" aria-label={en ? 'Behavior errors' : '行为画像错误列表'}>
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

function parseConfigured(source: string): BehaviorConfig | null {
  try {
    const parsed = parseConfig(source)
    if (parsed.errors.length > 0) throw new Error(`第 ${parsed.errors[0].line} 行:${parsed.errors[0].message}`)
    const root = yamlToValue(source) as { model?: { behavior?: BehaviorConfig } }
    return root.model?.behavior ?? null
  } catch {
    return null
  }
}

function parseBehavior(source: string): Parsed {
  try {
    const parsed = parseConfig(source)
    if (parsed.errors.length > 0) return { ok: false, error: `第 ${parsed.errors[0].line} 行:${parsed.errors[0].message}` }
    const root = yamlToValue(source) as { model?: { behavior?: BehaviorConfig } }
    const training = readTraining(source, yamlToValue)
    return { ok: true, value: { ...behaviorDraft(root.model?.behavior ?? null), training } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'YAML 无效' }
  }
}
