import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { applyLootConfig, parseConfig } from './configYaml.ts'
import type { LootConfig } from '../../lib/types.ts'
import {
  lootDiff, lootDraft, lootRewardExpectation, lootToYaml, lootTotalWeight, removeLootTable,
  renameLootItem, reviewLoot, setLootReward, setLootWeight,
} from './lootYaml.ts'
import { kernelCheck } from './paramsLogic.ts'
import { useLocale } from '../state/localeStore.ts'

type DraftState = { text: string; checking: boolean; approved: boolean; kernelError: string | null }
type Parsed = { ok: true; value: LootConfig } | { ok: false; error: string }
type EditorLoot = {
  -readonly [K in keyof NonNullable<ReturnType<typeof lootDraft>>]: NonNullable<ReturnType<typeof lootDraft>>[K]
}

const initialDraft: DraftState = { text: '', checking: false, approved: false, kernelError: null }

export function LootTableEditor({ open, onClose, baseYaml, candidateYaml, onApply, onSaveVersion }: {
  open: boolean
  onClose: () => void
  baseYaml: string
  candidateYaml: string
  onApply: (yaml: string) => void
  onSaveVersion: (yaml: string) => void
}): JSX.Element | null {
  const locale = useLocale()
  const [draft, setDraft] = useState<DraftState>({ ...initialDraft, text: candidateYaml })
  const base = useMemo(() => parseConfigured(baseYaml), [baseYaml])
  const parsed = useMemo(() => parseLoot(draft.text), [draft.text])
  const value = parsed.ok ? lootDraft(parsed.value) : null
  const report = useMemo(() => value === null
    ? { issues: [{ row: null, message: parsed.ok ? '' : parsed.error }], valid: false }
    : reviewLoot(value), [parsed, value])
  const totals = value === null ? [] : lootTotalWeight(value)
  const expectations = value === null ? [] : lootRewardExpectation(value)
  const diff = useMemo(() => value === null ? [] : lootDiff(base, value), [base, value])
  const canApply = Boolean(value && report.valid && draft.approved && !draft.checking && draft.kernelError === null)

  const update = (mutate: (draft: EditorLoot) => void): void => {
    if (value === null) return
    const next = structuredClone(value)
    mutate(next)
    setDraft((s) => ({ ...s, text: lootToYaml(next), approved: false, kernelError: null, checking: false }))
  }

  useEffect(() => {
    if (!draft.checking || value === null) return
    let active = true
    const outcome = applyLootConfig(candidateYaml, value)
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
    const outcome = applyLootConfig(candidateYaml, value)
    if (!outcome.ok) { setDraft((s) => ({ ...s, kernelError: outcome.error })); return }
    onApply(outcome.yaml)
    onSaveVersion(outcome.yaml)
  }

  return (
    <section className="form-section growth-editor loot-editor" aria-label={locale.startsWith('en') ? 'Loot table structured editor' : '掉落表结构化编辑器'}>
      <div className="form-section-heading">
        <h2>{locale.startsWith('en') ? 'Loot tables' : '掉落/权重表'}</h2>
        <span className="badge amber">{locale.startsWith('en') ? 'Baseline read-only · candidate write' : '基线只读 · 候选写入'}</span>
        <button className="btn subtle" onClick={() => { onClose(); setDraft(initialDraft) }}>{locale.startsWith('en') ? 'Close' : '关闭'}</button>
      </div>
      <div className="growth-grid">
        <table className="growth-table">
          <thead><tr>{['Table', 'Item', 'Weight', 'Gold', 'XP', ''].map((label) => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>
            {value?.tables.flatMap((table, tableIndex) => table.items.map((item, itemIndex) => (
              <tr key={`${table.name}-${item.name}`}>
                <td>{tableIndex === 0 ? <input value={table.name} onChange={(e) => update((d) => { d.tables = d.tables.map((row, index) => index === tableIndex ? { ...row, name: e.target.value } : row) })} /> : table.name}</td>
                <td><input value={item.name} onChange={(e) => update((d) => { Object.assign(d, renameLootItem(d, item.name, e.target.value)) })} /></td>
                <td><input inputMode="decimal" value={item.weight} onChange={(e) => update((d) => { Object.assign(d, setLootWeight(d, item.name, Number(e.target.value))) })} /></td>
                <td><input inputMode="numeric" value={dReward(value, item.name)?.gold ?? ''} onChange={(e) => update((d) => { Object.assign(d, setLootReward(d, item.name, Number(e.target.value), dReward(d, item.name)?.xp ?? 0)) })} /></td>
                <td><input inputMode="numeric" value={dReward(value, item.name)?.xp ?? ''} onChange={(e) => update((d) => { Object.assign(d, setLootReward(d, item.name, dReward(d, item.name)?.gold ?? 0, Number(e.target.value))) })} /></td>
                <td>{itemIndex === 0 ? <button className="btn subtle" onClick={() => update((d) => { Object.assign(d, removeLootTable(d, table.name)) })}>×</button> : null}</td>
              </tr>
            )))}
          </tbody>
        </table>
        <div className="growth-side">
          <label>{locale.startsWith('en') ? 'Rate multiplier' : '掉率倍率'}<input inputMode="decimal" value={value?.rateMult ?? ''} onChange={(e) => update((d) => { d.rateMult = Number(e.target.value) })} /></label>
          <label>{locale.startsWith('en') ? 'On victory' : '胜利掉落表'}<select value={value?.onVictory ?? ''} onChange={(e) => update((d) => { d.onVictory = e.target.value })}><option value="">—</option>{value?.tables.map((table) => <option key={table.name} value={table.name}>{table.name}</option>)}</select></label>
          <label>{locale.startsWith('en') ? 'Bulk YAML (TSV-safe structure)' : '批量编辑 YAML'}<textarea rows={9} value={draft.text} onChange={(e) => setDraft((s) => ({ ...s, text: e.target.value, approved: false, kernelError: null, checking: false }))} /></label>
          <div className="loot-totals" role="status">
            {totals.map((total) => <div key={total.table}>{total.table}: {Number.isFinite(total.total) ? total.total : '—'}</div>)}
            {expectations.map((row) => <div key={row.reward}>{row.reward}: p={row.weight.toFixed(3)}, E[gold]={row.gold.toFixed(2)}, E[xp]={row.xp.toFixed(2)}</div>)}
          </div>
        </div>
      </div>
      <div className="growth-review">
        <div><h3>{locale.startsWith('en') ? 'Pre-save diff' : '保存前 diff'}</h3>{diff.length === 0 ? <p className="muted">{locale.startsWith('en') ? 'No difference from baseline.' : '相对基线无差异。'}</p> : <ul>{diff.map((row) => <li key={`${row.kind}-${row.key}-${row.field}`}>{row.key}.{row.field}: {row.from} → {row.to}</li>)}</ul>}</div>
        <div><h3>{locale.startsWith('en') ? 'Impact scope' : '影响范围'}</h3><ul>{diff.length === 0 ? <li>{locale.startsWith('en') ? 'No write impact.' : '无写入影响。'}</li> : <li className="mono">model.loot</li>}</ul></div>
      </div>
      {report.issues.length > 0 && <div className="error-wall" role="alert"><ul>{report.issues.map((issue) => <li key={issue.message}>{issue.row ? `#${issue.row} ` : ''}{issue.message}</li>)}</ul></div>}
      <div className="growth-actions">
        <button className="btn" disabled={!report.valid || draft.checking} onClick={() => setDraft((s) => ({ ...s, checking: true, approved: false }))}>{draft.checking ? locale.startsWith('en') ? 'Checking' : '校验中' : locale.startsWith('en') ? 'Check and validate' : '预检并校验'}</button>
        <button className="btn primary" disabled={!canApply} onClick={apply}>{locale.startsWith('en') ? 'Write candidate and save version' : '写入候选并存版本'}</button>
      </div>
    </section>
  )
}

function dReward(draft: EditorLoot, name: string): { gold: number; xp: number } | undefined {
  return draft.rewards.find((reward) => reward.name === name)
}

function parseConfigured(source: string): LootConfig | null {
  try {
    const parsed = parseConfig(source)
    if (parsed.errors.length > 0) throw new Error(`第 ${parsed.errors[0].line} 行:${parsed.errors[0].message}`)
    const root = yamlToValue(source) as { model?: { loot?: LootConfig } }
    return root.model?.loot ?? null
  } catch {
    return null
  }
}

function parseLoot(source: string): Parsed {
  try {
    const parsed = parseConfig(source)
    if (parsed.errors.length > 0) return { ok: false, error: `第 ${parsed.errors[0].line} 行:${parsed.errors[0].message}` }
    const root = yamlToValue(source) as { model?: { loot?: LootConfig } }
    return { ok: true, value: root.model?.loot ?? { rate_mult: 1, on_victory: '', tables: {}, rewards: {} } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'YAML 无效' }
  }
}

function yamlToValue(source: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [{ indent: -2, value: root }]
  for (const raw of source.split('\n')) {
    const comment = raw.indexOf('#')
    const visible = comment === -1 ? raw : raw.slice(0, comment)
    if (visible.trim() === '') continue
    const indent = visible.length - visible.trimStart().length
    const match = /^([^:]+):\s*(.*)$/.exec(visible.trim())
    if (!match) continue
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    const key = match[1].trim()
    if (match[2] === '') {
      const child: Record<string, unknown> = {}
      stack[stack.length - 1].value[key] = child
      stack.push({ indent, value: child })
    } else stack[stack.length - 1].value[key] = parseScalar(match[2])
  }
  return root
}

function parseScalar(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  const flow = /^\{(.*)\}$/.exec(raw)
  if (flow) {
    const value: Record<string, unknown> = {}
    for (const part of flow[1].split(',')) {
      const pair = part.split(':')
      if (pair.length === 2) value[pair[0].trim()] = parseScalar(pair[1].trim())
    }
    return value
  }
  return raw.replace(/^['"]|['"]$/g, '')
}
