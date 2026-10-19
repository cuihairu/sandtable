// WB-02.05 · 选择检查器:当前所选对象的详情侧栏(约束判定 / 统计口径 /
// 后续操作)。可独立接数据:输入是通用字段(标题、路径、值、约束行、
// 统计键值、来源徽标),不绑定演示数据。
import type { JSX, ReactNode } from 'react'
import { WbIcon, WbVerdictIcon } from '../components/icons.tsx'
import type { Verdict } from '../demo/sampleProject.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

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
  // WB-11.14:检查器自身 chrome 随当前语言;标题/约束/统计内容由调用方传已译文案
  const locale = useLocale()
  if (!open) return null
  return (
    <aside className="selection-inspector" aria-label={t(locale, 'analysis.inspectorTitle')}>
      <div className="inspector-header">
        <WbIcon name="sliders" />
        {t(locale, 'analysis.inspectorTitle')}
        {onToggle && (
          <button className="icon-button" onClick={onToggle} aria-label={t(locale, 'analysis.inspectorCollapse')} title={t(locale, 'analysis.inspectorCollapseTitle')}>
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
          <h3>{t(locale, 'analysis.inspectorHard')}</h3>
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
                <span>{t(locale, 'analysis.inspectorDisplayRange')}</span>
                <span>{c.ci}</span>
              </div>
            </div>
          ))}
        </section>
      )}
      {stats.length > 0 && (
        <section className="inspector-section">
          <h3>{t(locale, 'analysis.inspectorStats')}</h3>
          {stats.map(([k, v]) => (
            <div className="inspector-kv" key={k}>
              <span>{k}</span>
              <span>{v}</span>
            </div>
          ))}
          {sourceBadge && (
            <div className="inspector-kv">
              <span>{t(locale, 'analysis.inspectorSource')}</span>
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

const VERDICT_KEY: Record<Verdict, 'analysis.verdict.pass' | 'analysis.verdict.border' | 'analysis.verdict.fail'> = {
  pass: 'analysis.verdict.pass',
  border: 'analysis.verdict.border',
  fail: 'analysis.verdict.fail',
}

function VerdictBadge({ verdict }: { verdict: Verdict }): JSX.Element {
  const locale = useLocale()
  return (
    <span className={`verdict ${verdict}`}>
      <WbVerdictIcon verdict={verdict} />
      {t(locale, VERDICT_KEY[verdict])}
    </span>
  )
}

export { WbIcon }
