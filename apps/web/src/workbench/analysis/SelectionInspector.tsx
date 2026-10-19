// WB-02.05 · 选择检查器:当前所选对象的详情侧栏(约束判定 / 统计口径 /
// 后续操作)。可独立接数据:输入是通用字段(标题、路径、值、约束行、
// 统计键值、来源徽标),不绑定演示数据。
import type { JSX, ReactNode } from 'react'
import { WbIcon, WbVerdictIcon } from '../components/icons.tsx'
import type { Verdict } from '../demo/sampleProject.ts'
import { VERDICT_LABEL } from '../demo/sampleProject.ts'

export type InspectorConstraint = {
  label: string
  verdict: Verdict
  value: string
  op: string
  target: string
  /** 约束条位置 0–100(展示用) */
  position: number
  ci: string
}

export type SelectionInspectorProps = {
  eyebrow: string
  title: string
  titleVerdict?: Verdict
  code: string
  /** 大数值(如参数值);缺省不显示 */
  value?: { display: string; note: string }
  actions?: JSX.Element
  onToggle?: () => void
  open?: boolean
  constraints?: readonly InspectorConstraint[]
  stats?: ReadonlyArray<[string, ReactNode]>
  sourceBadge?: { text: string; tone?: 'teal' | 'amber' | 'red' | 'default' }
  notes?: ReactNode
}

export function SelectionInspector({
  eyebrow,
  title,
  titleVerdict,
  code,
  value,
  actions,
  onToggle,
  open = true,
  constraints = [],
  stats = [],
  sourceBadge,
  notes,
}: SelectionInspectorProps): JSX.Element | null {
  if (!open) return null
  return (
    <aside className="selection-inspector" aria-label="选择检查器">
      <div className="inspector-header">
        <WbIcon name="sliders" />
        选择检查器
        {onToggle && (
          <button className="icon-button" onClick={onToggle} aria-label="收起选择检查器" title="收起检查器">
            <WbIcon name="panel-right" />
          </button>
        )}
      </div>
      <section className="inspector-section">
        <div className="inspector-eyebrow">{eyebrow}</div>
        <div className="inspector-title">
          {title}
          {titleVerdict && <VerdictBadge verdict={titleVerdict} />}
        </div>
        <span className="inspector-code">{code}</span>
        {value && (
          <div className="parameter-value">
            {value.display}
            <small>{value.note}</small>
          </div>
        )}
        {actions}
      </section>
      {constraints.length > 0 && (
        <section className="inspector-section">
          <h3>硬约束 · 展示区间判定</h3>
          {constraints.map((c) => (
            <div className="constraint-row" key={c.label}>
              <div>
                <span>{c.label}</span>
                <VerdictBadge verdict={c.verdict} />
              </div>
              <div className="constraint-values">
                <span>{c.value}</span>
                <span>
                  {c.op} {c.target}
                </span>
              </div>
              <div className={`constraint-bar ${c.verdict}`}>
                <span style={{ width: `${Math.min(100, Math.max(10, c.position))}%` }} />
              </div>
              <div className="constraint-values">
                <span>展示区间</span>
                <span>{c.ci}</span>
              </div>
            </div>
          ))}
        </section>
      )}
      {stats.length > 0 && (
        <section className="inspector-section">
          <h3>统计口径</h3>
          {stats.map(([k, v]) => (
            <div className="inspector-kv" key={k}>
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          {sourceBadge && (
            <div className="inspector-kv">
              <span>数据来源</span>
              <span className={`badge${sourceBadge.tone && sourceBadge.tone !== 'default' ? ` ${sourceBadge.tone}` : ''}`}>
                {sourceBadge.text}
              </span>
            </div>
          )}
          {notes && <p className="note">{notes}</p>}
        </section>
      )}
    </aside>
  )
}

function VerdictBadge({ verdict }: { verdict: Verdict }): JSX.Element {
  return (
    <span className={`verdict ${verdict}`}>
      <WbVerdictIcon verdict={verdict} />
      {VERDICT_LABEL[verdict]}
    </span>
  )
}

export { WbIcon }
