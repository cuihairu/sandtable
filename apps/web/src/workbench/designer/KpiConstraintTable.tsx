// WB-02.07 · WB-06.07/06.08 · KPI 约束表:
// - 指标池 = 内核 8 指标(MetricKey::ALL 同序,lib/types.ts METRIC_KEYS 只读
//   引用);只允许勾选当前配置可用的指标,不可用给内核同口径原因并禁选;
//   仿真天数不足 7 天时 D7 明示「不可用」并阻止相关任务提交(WB-06.07);
// - kind hard/soft 与 min/max 直接对应内核 sweep.targets;比例类指标
//   (retention/win_rate/churn_rate)UI 以百分数输入,写入 YAML 时 ÷100
//   成比例口径(就地标注,不静默混算);绝对值类指标不换算(WB-06.08)。
import type { JSX } from 'react'
import { METRIC_KEYS } from '../../lib/types.ts'
import { kpiInfo, isRatioMetric, kernelToUiPercent } from './designerLogic.ts'
import type { ConstraintDraft } from './designerLogic.ts'

export type KpiConstraintTableProps = {
  targets: readonly ConstraintDraft[]
  /** 每 KPI 可用性(缺 days / 缺 gacha/loot 节;WB-06.07) */
  availability: Readonly<Record<string, { ok: boolean; reason: string | null }>>
  onToggle: (metric: string, on: boolean) => void
  onKindChange: (metric: string, kind: 'hard' | 'soft') => void
  /** UI 文本提交(百分数或绝对值);页面负责 parse + 换算内核口径,空串 = 清除 */
  onThresholdChange: (metric: string, field: 'min' | 'max', text: string) => void
}

/** 已选指标 → 草稿行 */
function draftOf(targets: readonly ConstraintDraft[], metric: string): ConstraintDraft | null {
  return targets.find((t) => t.metric === metric) ?? null
}

/** 比例阈值的单个 min/max 输入(UI 百分数渲染,Esc 撤回) */
function ThresholdField({
  metric,
  label,
  field,
  draft,
  onThresholdChange,
}: {
  metric: string
  label: string
  field: 'min' | 'max'
  draft: ConstraintDraft
  onThresholdChange: KpiConstraintTableProps['onThresholdChange']
}): JSX.Element {
  const ratio = isRatioMetric(metric)
  const kernel = draft[field]
  const shown = kernel === null ? '' : String(kernelToUiPercent(metric, kernel)!)
  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        aria-label={`${label} ${field}${ratio ? '(UI 百分数)' : ''}`}
        defaultValue={shown}
        key={shown}
        aria-invalid={kernel === null}
        onBlur={(e) => onThresholdChange(metric, field, e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') e.currentTarget.value = shown
        }}
        style={{ width: 73, textAlign: 'right', fontFamily: 'var(--wb-mono)' }}
      />
      {ratio && <span className="mono muted" style={{ fontSize: 9 }}>%</span>}
    </>
  )
}

export function KpiConstraintTable({
  targets,
  availability,
  onToggle,
  onKindChange,
  onThresholdChange,
}: KpiConstraintTableProps): JSX.Element {
  const hasUnavailableTarget = targets.some((t) => availability[t.metric] && !availability[t.metric].ok)
  return (
    <section className="form-section">
      <div className="form-section-heading">
        <span className="step">04</span>
        <h2>KPI 约束(内核 sweep.targets;比例类 UI 百分数 ⇄ 比例)</h2>
      </div>
      {hasUnavailableTarget && (
        <div className="note-block" role="alert">
          存在当前配置不可用的 KPI 约束,提交被阻止;请提高场景天数或补配 model.gacha / model.loot 节。
        </div>
      )}
      <table className="constraint-table" aria-label="KPI 约束">
        <thead>
          <tr>
            <th>选择</th>
            <th>指标(内核 ID)</th>
            <th>kind</th>
            <th>min</th>
            <th>max</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_KEYS.map((key) => {
            const info = kpiInfo(key)
            if (!info) return null
            const av = availability[key] ?? { ok: false, reason: '指标不在内核清单' }
            const draft = draftOf(targets, key)
            const disabled = !av.ok
            const active = !disabled && draft !== null
            return (
              <tr key={key}>
                <td>
                  <input
                    type="checkbox"
                    className="checkbox"
                    aria-label={`选择 ${info.label} 约束`}
                    checked={active}
                    disabled={disabled}
                    onChange={!disabled
                      ? (e) => onToggle(key, e.currentTarget.checked)
                      : undefined}
                  />
                </td>
                <td>
                  {info.label}
                  <span className="mono muted" style={{ display: 'block', fontSize: 10 }}>
                    {key} / {info.unitText}
                  </span>
                  {disabled && (
                    <span role="alert" style={{ color: 'var(--wb-red)', fontSize: 10, display: 'block' }}>
                      不可用:{av.reason}
                    </span>
                  )}
                </td>
                <td>
                  {active && draft ? (
                    <select
                      aria-label={`${info.label} hard/soft`}
                      value={draft.kind}
                      onChange={(e) => onKindChange(key, e.currentTarget.value as 'hard' | 'soft')}
                    >
                      <option value="hard">hard</option>
                      <option value="soft">soft</option>
                    </select>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {active && draft ? (
                    <ThresholdField
                      metric={key}
                      label={info.label}
                      field="min"
                      draft={draft}
                      onThresholdChange={onThresholdChange}
                    />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  {active && draft ? (
                    <ThresholdField
                      metric={key}
                      label={info.label}
                      field="max"
                      draft={draft}
                      onThresholdChange={onThresholdChange}
                    />
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="note">min/max 留空 = 不设该界(内核 Option 口径);选择集由当前场景配置限制,内核加载期会再做最终校验。</p>
    </section>
  )
}
