import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { applyParamEdit, parseConfig, readText } from './configYaml.ts'
import { FORMULA_VARIABLES, evalFormula, reviewFormula } from './formulaLogic.ts'
import { useLocale } from '../state/localeStore.ts'

type Inputs = Record<'level' | 'xp_base' | 'xp_pow', string>

export function FormulaEditor({ open, onClose, baseYaml, candidateYaml, onApply, onSaveVersion }: {
  open: boolean
  onClose: () => void
  baseYaml: string
  candidateYaml: string
  onApply: (yaml: string) => void
  onSaveVersion: (yaml: string) => void
}): JSX.Element | null {
  const locale = useLocale()
  const [text, setText] = useState(() => readText(parseConfig(candidateYaml), 'model.formulas.xp_needed') ?? '')
  const [inputs, setInputs] = useState<Inputs>({ level: '3', xp_base: '60', xp_pow: '1.3' })
  const base = useMemo(() => readText(parseConfig(baseYaml), 'model.formulas.xp_needed'), [baseYaml])
  const report = useMemo(() => reviewFormula(text), [text])
  const numericInputs = {
    level: Number(inputs.level), xp_base: Number(inputs.xp_base), xp_pow: Number(inputs.xp_pow),
  }
  const inputValid = Object.values(numericInputs).every(Number.isFinite)
  const preview = report.valid && inputValid ? evalFormula(text, numericInputs) : Number.NaN
  if (!open) return null

  const apply = (): void => {
    if (!report.valid) return
    const outcome = applyParamEdit(candidateYaml, parseConfig(candidateYaml), 'model.formulas.xp_needed', `'${text}'`)
    if (!outcome.ok) return
    onApply(outcome.yaml)
    onSaveVersion(outcome.yaml)
  }

  return (
    <section className="form-section growth-editor" aria-label={locale.startsWith('en') ? 'formula structured editor' : '公式结构化编辑器'}>
      <div className="form-section-heading">
        <h2>{locale.startsWith('en') ? 'Formula' : '公式'}</h2>
        <span className="badge amber">model.formulas.xp_needed</span>
        <button className="btn subtle" onClick={onClose}>{locale.startsWith('en') ? 'Close' : '关闭'}</button>
      </div>
      <label className="form-field">
        {locale.startsWith('en') ? 'Expression' : '表达式'}
        <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <p className="muted">{locale.startsWith('en')
        ? `References: ${FORMULA_VARIABLES.join(', ')}; functions: min/max/clamp/floor/ceil/abs/round.`
        : `可用变量:${FORMULA_VARIABLES.join(', ')};函数:min / max / clamp / floor / ceil / abs / round。`}</p>
      <div className="growth-grid">
        <table className="growth-table"><tbody>{FORMULA_VARIABLES.map((name) => (
          <tr key={name}><th>{name}</th><td><input value={inputs[name]} onChange={(event) => setInputs((s) => ({ ...s, [name]: event.target.value }))} /></td></tr>
        ))}</tbody></table>
        <div className="growth-side">
          <div className="loot-totals" role="status">
            {locale.startsWith('en') ? 'Preview' : '示例求值'}: <strong>{Number.isFinite(preview) ? preview : '—'}</strong>
          </div>
        </div>
      </div>
      <div className="growth-review">
        <div><h3>{locale.startsWith('en') ? 'Pre-save diff' : '保存前 diff'}</h3>
          {base === text ? <p className="muted">{locale.startsWith('en') ? 'No difference from baseline.' : '相对基线无差异。'}</p>
            : <p><span className="mono">{base ?? 'default'}</span> → <span className="mono">{text}</span></p>}
        </div>
        <div><h3>{locale.startsWith('en') ? 'Impact scope' : '影响范围'}</h3><ul><li className="mono">model.formulas.xp_needed</li></ul></div>
      </div>
      {report.issues.length > 0 && <div className="error-wall" role="alert"><ul>{report.issues.map((issue) => <li key={issue.message}>{issue.message}</li>)}</ul></div>}
      <div className="growth-actions"><button className="btn primary" disabled={!report.valid} onClick={apply}>{locale.startsWith('en') ? 'Write candidate and save version' : '写入候选并存版本'}</button></div>
    </section>
  )
}
