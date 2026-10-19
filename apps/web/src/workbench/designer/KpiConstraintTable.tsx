// WB-02.07 · KPI 约束表:hard 约束阈值编辑(min/max 方向由指标 op 决定)。
// 红线:阈值口径是 UI 的 0–100 百分数;接内核时按 WB-03.03 转成比例原口径,
// 这里不做静默换算,表头明确标注口径。
import type { JSX } from 'react'
import { METRICS, METRIC_KEYS } from '../demo/sampleProject.ts'
import type { MetricValues } from '../demo/sampleProject.ts'

export type KpiConstraintTableProps = {
  thresholds: MetricValues
  errors?: Partial<Record<keyof MetricValues, string>>
  onChange: (key: keyof MetricValues, value: number) => void
}

export function KpiConstraintTable({ thresholds, errors = {}, onChange }: KpiConstraintTableProps): JSX.Element {
  return (
    <section className="form-section">
      <div className="form-section-heading">
        <span className="step">04</span>
        <h2>KPI 约束(UI 口径 0–100,内核比例口径接入时换算)</h2>
      </div>
      <table className="constraint-table" aria-label="KPI 约束">
        <thead>
          <tr>
            <th>指标</th>
            <th>方向</th>
            <th>阈值</th>
            <th>展示区间半宽(演示)</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_KEYS.map((key) => {
            const m = METRICS[key]
            return (
              <tr key={key}>
                <td>
                  {m.label}
                  <span className="mono muted" style={{ display: 'block', fontSize: 10 }}>
                    {m.id}
                    {m.unit !== '' ? ` / ${m.unit}` : ''}
                  </span>
                </td>
                <td>
                  {m.op} {m.target}
                  {m.unit}
                </td>
                <td>
                  <input
                    type="number"
                    aria-label={`${m.label}阈值`}
                    value={thresholds[key]}
                    aria-invalid={errors[key] !== undefined}
                    onChange={(e) => onChange(key, Number(e.target.value))}
                  />
                  {errors[key] && (
                    <span role="alert" style={{ color: 'var(--wb-red)', fontSize: 10, display: 'block' }}>
                      {errors[key]}
                    </span>
                  )}
                </td>
                <td className="mono muted">±{m.ci}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </section>
  )
}
