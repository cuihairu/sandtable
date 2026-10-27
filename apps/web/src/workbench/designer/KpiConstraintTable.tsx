// WB-02.07 · WB-06.07/06.08 · KPI 约束表:
// - 指标池 = 内核 8 指标(MetricKey::ALL 同序,lib/types.ts METRIC_KEYS 只读
//   引用);只允许勾选当前配置可用的指标,不可用给内核同口径原因并禁选;
//   仿真天数不足 7 天时 D7 明示「不可用」并阻止相关任务提交(WB-06.07);
// - kind hard/soft 与 min/max 直接对应内核 sweep.targets;比例类指标
//   (retention/win_rate/churn_rate)UI 以百分数输入,写入 YAML 时 ÷100
//   成比例口径(就地标注,不静默混算);绝对值类指标不换算(WB-06.08);
// - L381 指标字典:口径事实源在内核(core::kpi_dict),表下折叠面板只读
//   呈现量纲/小数位/可用性门槛/版本——写阈值时看得见口径,字典与内核
//   漂移由 tests/metric-dictionary-ui.test.mjs 锁死不靠人眼。
import type { JSX } from 'react'
import { METRIC_KEYS } from '../../lib/types.ts'
import type { MetricDefinition, MetricDictionary } from '../../lib/types.ts'
import { kpiInfo, kpiDisplayName, kpiUnitText, isRatioMetric, kernelToUiPercent } from './designerLogic.ts'
import type { ConstraintDraft } from './designerLogic.ts'
import { t } from '../../lib/i18n/index.ts'
import type { Locale } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type KpiConstraintTableProps = {
  targets: readonly ConstraintDraft[]
  /** 每 KPI 可用性(缺 days / 缺 gacha/loot 节;WB-06.07) */
  availability: Readonly<Record<string, { ok: boolean; reason: string | null }>>
  /** 内核指标字典(core::kpi_dict);加载期间为空 → 面板不渲染,不占位 */
  dictionary?: MetricDictionary | null
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
  const locale = useLocale()
  const ratio = isRatioMetric(metric)
  const kernel = draft[field]
  const shown = kernel === null ? '' : String(kernelToUiPercent(metric, kernel)!)
  return (
    <>
      <input
        type="text"
        inputMode="decimal"
        aria-label={ratio
          ? t(locale, 'experiment.thresholdAriaRatio', { label, field })
          : t(locale, 'experiment.thresholdAria', { label, field })}
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

/** 字典门槛文本(内核字段原样 → 显示串;无门槛 = 「无」,不造默认) */
function gateText(def: MetricDefinition, locale: Locale): string {
  const parts: string[] = []
  if (def.days_required > 0) parts.push(t(locale, 'experiment.dictGateDays', { n: def.days_required }))
  if (def.requires_gacha) parts.push(t(locale, 'experiment.dictGateGacha'))
  if (def.requires_loot) parts.push(t(locale, 'experiment.dictGateLoot'))
  return parts.length > 0 ? parts.join(' + ') : t(locale, 'experiment.dictGateNone')
}

/** L381 · 内核指标字典只读面板(折叠;内容仍在 DOM,可读屏/可断言) */
export function MetricDictPanel({ dictionary }: { dictionary: MetricDictionary }): JSX.Element {
  const locale = useLocale()
  return (
    <details className="dict-panel" style={{ marginTop: 8 }}>
      <summary className="note" style={{ cursor: 'pointer' }}>
        {t(locale, 'experiment.dictSummary', { version: dictionary.dict_version })}
      </summary>
      <table className="constraint-table" aria-label={t(locale, 'experiment.dictAria')}>
        <thead>
          <tr>
            <th>{t(locale, 'experiment.colMetric')}</th>
            <th>{t(locale, 'experiment.dictColKind')}</th>
            <th>{t(locale, 'experiment.dictColDecimals')}</th>
            <th>{t(locale, 'experiment.dictColGate')}</th>
            <th>{t(locale, 'experiment.dictColOptional')}</th>
          </tr>
        </thead>
        <tbody>
          {dictionary.metrics.map((def) => (
            <tr key={def.id}>
              <td className="mono" style={{ fontSize: 11 }}>{def.id}</td>
              <td>{def.kind === 'ratio'
                ? t(locale, 'experiment.dictKindRatio')
                : t(locale, 'experiment.dictKindValue')}</td>
              <td className="numeric">{def.decimals}</td>
              <td className="mono" style={{ fontSize: 11 }}>{gateText(def, locale)}</td>
              <td>{def.optional ? t(locale, 'experiment.dictOptionalYes') : t(locale, 'experiment.dictOptionalNo')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="note">{t(locale, 'experiment.dictNote', { version: dictionary.dict_version })}</p>
    </details>
  )
}

export function KpiConstraintTable({
  targets,
  availability,
  dictionary,
  onToggle,
  onKindChange,
  onThresholdChange,
}: KpiConstraintTableProps): JSX.Element {
  const hasUnavailableTarget = targets.some((t) => availability[t.metric] && !availability[t.metric].ok)
  const locale = useLocale()
  return (
    <section className="form-section">
      <div className="form-section-heading">
        <span className="step">04</span>
        <h2>{t(locale, 'experiment.kpiSectionTitle')}</h2>
      </div>
      {hasUnavailableTarget && (
        <div className="note-block" role="alert">
          {t(locale, 'experiment.kpiUnavailableAlert')}
        </div>
      )}
      <table className="constraint-table" aria-label={t(locale, 'experiment.kpiTableAria')}>
        <thead>
          <tr>
            <th>{t(locale, 'experiment.colSelect')}</th>
            <th>{t(locale, 'experiment.colMetric')}</th>
            <th>kind</th>
            <th>min</th>
            <th>max</th>
          </tr>
        </thead>
        <tbody>
          {METRIC_KEYS.map((key) => {
            const info = kpiInfo(key)
            if (!info) return null
            // WB-11.14:指标 id 稳定,显示名与单位后缀走词典
            const label = kpiDisplayName(key, locale)
            const unit = kpiUnitText(key, locale)
            const av = availability[key] ?? { ok: false, reason: '' }
            const draft = draftOf(targets, key)
            const disabled = !av.ok
            const active = !disabled && draft !== null
            return (
              <tr key={key}>
                <td>
                  <input
                    type="checkbox"
                    className="checkbox"
                    aria-label={t(locale, 'experiment.kpiSelectAria', { label })}
                    checked={active}
                    disabled={disabled}
                    onChange={!disabled
                      ? (e) => onToggle(key, e.currentTarget.checked)
                      : undefined}
                  />
                </td>
                <td>
                  {label}
                  <span className="mono muted" style={{ display: 'block', fontSize: 10 }}>
                    {key} / {unit}
                  </span>
                  {disabled && (
                    <span role="alert" style={{ color: 'var(--wb-red)', fontSize: 10, display: 'block' }}>
                      {t(locale, 'experiment.kpiUnavailable', { reason: av.reason ?? '' })}
                    </span>
                  )}
                </td>
                <td>
                  {active && draft ? (
                    <select
                      aria-label={t(locale, 'experiment.kpiKindAria', { label })}
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
                      label={label}
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
                      label={label}
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
      <p className="note">{t(locale, 'experiment.kpiNote')}</p>
      {dictionary && <MetricDictPanel dictionary={dictionary} />}
    </section>
  )
}
