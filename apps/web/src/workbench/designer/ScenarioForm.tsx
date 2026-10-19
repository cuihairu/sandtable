// WB-02.07 · 场景设置:规模字段(玩家数 / 天数 / replicates / CRN 配对)。
// 区分"规模"(players/days)与"统计样本量"(replicates)——口径说明就地展示;
// 接真实场景配置是 WB-06.06。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'

export type ScenarioField = {
  key: string
  label: string
  value: number
  helper?: string
  error?: string
}

export type ScenarioFormProps = {
  fields: readonly ScenarioField[]
  paired: boolean
  sampling: 'lhc' | 'uniform'
  onChange: (key: string, value: number) => void
  onPairedChange: (paired: boolean) => void
  onSamplingChange: (sampling: 'lhc' | 'uniform') => void
  crnNote: string
}

export function ScenarioForm({
  fields,
  paired,
  sampling,
  onChange,
  onPairedChange,
  onSamplingChange,
  crnNote,
}: ScenarioFormProps): JSX.Element {
  return (
    <section className="form-section">
      <div className="form-section-heading">
        <span className="step">03</span>
        <h2>场景与统计样本</h2>
      </div>
      <div className="form-grid">
        {fields.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`scenario-${f.key}`}>{f.label}</label>
            <input
              id={`scenario-${f.key}`}
              type="number"
              value={f.value}
              aria-invalid={f.error !== undefined}
              onChange={(e) => onChange(f.key, Number(e.target.value))}
            />
            {f.helper && <small>{f.helper}</small>}
            {f.error && (
              <small role="alert" style={{ color: 'var(--wb-red)' }}>
                {f.error}
              </small>
            )}
          </div>
        ))}
        <div className="field">
          <label htmlFor="scenario-sampling">随机采样策略</label>
          <select
            id="scenario-sampling"
            value={sampling}
            onChange={(e) => onSamplingChange(e.target.value as 'lhc' | 'uniform')}
          >
            <option value="lhc">拉丁超立方(latin_hypercube)</option>
            <option value="uniform">均匀随机(uniform)</option>
          </select>
          <small>LHS 与普通随机采样语义不同,序列化名称与内核契约一致。</small>
        </div>
        <div className="field">
          <label className="checkbox-line" style={{ marginTop: 0 }}>
            <input
              className="checkbox"
              type="checkbox"
              checked={paired}
              onChange={(e) => onPairedChange(e.target.checked)}
            />
            <WbIcon name="check" />
            公共随机数(CRN)配对
          </label>
          <small>{crnNote}</small>
        </div>
      </div>
    </section>
  )
}
