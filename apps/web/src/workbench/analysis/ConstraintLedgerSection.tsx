// todo L381 批五 · 目标/约束管理:跨候选看整批实验对每个目标的表现。
// 单个候选的判定明细在 SelectionInspector(内核 TargetOutcome 原文);这里补
// 「整批对账」:每个目标的判定分布、通过占比、最紧候选及其余量——用来回答
// 「哪条约束最卡、放宽哪条性价比最高」,以及未判定候选是否被静默当通过。
// 口径纪律:全部数字来自内核 TargetOutcome / SweepTarget,前端只做计数与取最小。
import type { JSX } from 'react'
import type { CandidateView } from '../../lib/sweepView.ts'
import type { SweepTarget } from '../../lib/types.ts'
import { constraintLedger } from '../../lib/constraintLedger.ts'
import { metricLabel, metricUnit } from '../../lib/metricMeta.ts'
import { fmtPercent } from '../../lib/i18n/format.ts'
import { formatMetric } from './resultModel.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type ConstraintLedgerSectionProps = {
  views: readonly CandidateView[]
  targets: readonly SweepTarget[]
  runId: string
}

/** 阈值文本:无界的一侧不出(与 SelectionInspector 同一写法,口径一致) */
function thresholdText(target: SweepTarget, locale: ReturnType<typeof useLocale>): string {
  const bounds = [
    target.min !== null ? `≥ ${formatMetric(target.min, target.metric, false, locale)}` : '',
    target.max !== null ? `≤ ${formatMetric(target.max, target.metric, false, locale)}` : '',
  ].filter((text) => text.length > 0)
  return bounds.length > 0 ? bounds.join(' ') : t(locale, 'analysis.ledgerNoBound')
}

export function ConstraintLedgerSection({ views, targets, runId }: ConstraintLedgerSectionProps): JSX.Element {
  const locale = useLocale()
  const rows = constraintLedger(views, targets)
  const unjudged = rows.reduce((sum, row) => sum + row.unjudged, 0)

  return (
    <section className="result-recommendation" aria-label={t(locale, 'analysis.ledgerTitle')}>
      <h2>{t(locale, 'analysis.ledgerTitle')}</h2>
      <p className="note">{t(locale, 'analysis.ledgerNote', { run: runId, targets: rows.length, unjudged })}</p>
      {rows.length === 0 ? (
        <p role="status">{t(locale, 'analysis.ledgerEmpty')}</p>
      ) : (
        <div className="candidate-table-wrap">
          <table className="candidate-table" aria-label={t(locale, 'analysis.ledgerTableAria')}>
            <thead>
              <tr>
                <th>{t(locale, 'analysis.ledgerColTarget')}</th>
                <th>{t(locale, 'analysis.ledgerColBound')}</th>
                <th>{t(locale, 'analysis.ledgerColVerdicts')}</th>
                <th>{t(locale, 'analysis.ledgerColShare')}</th>
                <th>{t(locale, 'analysis.ledgerColTightest')}</th>
                <th>{t(locale, 'analysis.ledgerColUnjudged')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.metric}|${row.kind}|${row.min ?? 'na'}|${row.max ?? 'na'}`}>
                  <td>
                    {metricLabel(row.metric, locale)} · {row.kind}
                    <span className="mono muted" style={{ display: 'block', fontSize: 10 }}>
                      {row.metric} · {metricUnit(row.metric, locale)}
                    </span>
                  </td>
                  <td>{thresholdText(row, locale)}</td>
                  <td>
                    {t(locale, 'analysis.ledgerVerdicts', {
                      pass: row.pass,
                      borderline: row.borderline,
                      fail: row.fail,
                      judged: row.judged,
                    })}
                  </td>
                  <td className="numeric">
                    {row.passShare === null ? t(locale, 'analysis.unavailable') : fmtPercent(locale, row.passShare)}
                  </td>
                  <td className="numeric">
                    {row.worstDistance === null || row.worstMean === null ? t(locale, 'analysis.unavailable') : (
                      <>
                        {t(locale, 'analysis.ledgerTightest', {
                          distance: formatMetric(row.worstDistance, row.metric, false, locale),
                          mean: formatMetric(row.worstMean, row.metric, false, locale),
                          unit: metricUnit(row.metric, locale),
                        })}
                      </>
                    )}
                  </td>
                  <td className="numeric">{row.unjudged}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="note">{t(locale, 'analysis.ledgerScaleNote')}</p>
    </section>
  )
}
