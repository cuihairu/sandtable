// WB-02.07 · WB-06.10~06.14 · 运行计划栏:
// - 候选数 / replicates / 总运行数 / player-days 全部来自内核 planSweep
//   返回(WB-06.10,不靠前端猜测通过校验);耗时无性能基准时如实显示
//   「尚无性能基准」,不编造估算(WB-06.12);
// - 预览请求加版本:表单字段已修改而新计划未返回时,旧计划标注「已失效」,
//   不再当作当前输入的预算(WB-06.11/06.14);
// - 内核预算 / 错误原因如实上墙并接按钮禁用;给缩小规模 / 换执行端的
//   可行操作提示(WB-06.13)。提交经单飞守卫,双击只创建一个任务(WB-06.15)。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import { METHOD_LABEL, planSummary, planErrorLines, budgetActions } from './designerLogic.ts'
import type { DesignDraft, PlanShape } from './designerLogic.ts'
import type { DesignError } from './designerLogic.ts'
import { fmtNumber } from '../../lib/i18n/format.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type PlanState =
  | { stamp: number; status: 'pending' | 'stale' }
  | { stamp: number; status: 'ok'; plan: PlanShape }
  | { stamp: number; status: 'error'; message: string }

export type RunPlanSidebarProps = {
  design: DesignDraft
  /** 当前方法的表单级错误(WB-06 校验) */
  errors: readonly DesignError[]
  /** planSweep 预览状态(stamp = 请求版本,详见 DesignerPage 传参) */
  plan: PlanState | null
  /** A/B 方法只有演示队列计数(2 方案 × replicates),没有内核 sweep 计划 */
  abCandidates?: number
  submitting: boolean
  submitBlocked?: string
  onSubmit: () => void
}

/** 内核预算 / 校验错误来源消息整理到行(实现移 designerLogic.planErrorLines);本文件仅渲染。 */

export function RunPlanSidebar({
  design,
  errors,
  plan,
  abCandidates,
  submitting,
  submitBlocked,
  onSubmit,
}: RunPlanSidebarProps): JSX.Element {
  const locale = useLocale()
  const localErrors = errors.filter((e) => e.scope !== 'scenario')
  const scenarioErrors = errors.filter((e) => e.scope === 'scenario')
  const planError = plan?.status === 'error' ? plan.message : null
  const thePlan = plan?.status === 'ok' ? plan : null
  // 计划是否反映当前输入:stamp 由 DesignerPage 以输入指纹递增;ok/stale 分支。
  const planObsolete = plan === null || plan.status === 'pending' || plan.status === 'stale'
  const showPlan = (() => {
    if (design.method === 'ab') {
      const count = abCandidates ?? 0
      return {
        label: t(locale, 'experiment.abPlanLabel', { count, reps: design.reps }),
        tasks: count * design.reps,
        caption: t(locale, 'experiment.abPlanCaption'),
      }
    }
    if (thePlan) {
      const s = planSummary(thePlan.plan)
      return {
        label: t(locale, 'experiment.sweepPlanLabel', { candidates: s.candidates, replicates: s.replicates }),
        tasks: s.sims,
        caption: t(locale, 'experiment.sweepPlanCaption', { mode: s.mode }),
      }
    }
    return null
  })()
  const canSubmit =
    localErrors.length === 0 && scenarioErrors.length === 0 && !planObsolete && planError === null && !submitting && submitBlocked === undefined
  const blockedReasons: string[] = [
    ...localErrors.map((e) => (e.locator ? `${e.locator}: ${e.message}` : e.message)),
    ...scenarioErrors.map((e) => e.message),
    ...(plan?.status === 'pending' ? [t(locale, 'experiment.planPending')] : []),
    ...(plan?.status === 'stale' ? [t(locale, 'experiment.planStaleReason')] : []),
    ...(planError ? planErrorLines(planError) : []),
    ...(submitBlocked ? [submitBlocked] : []),
  ]
  const summary = thePlan ? planSummary(thePlan.plan) : null
  return (
    <aside className="form-summary" aria-label={t(locale, 'experiment.planAria')}>
      <h3>{t(locale, 'experiment.planTitle')}</h3>
      {showPlan ? (
        <>
          <div className="budget-value">
            {fmtNumber(locale, showPlan.tasks)}
            {planObsolete && design.method !== 'ab' && (
              <span className="badge amber" style={{ marginLeft: 8, verticalAlign: 'middle' }}>{t(locale, 'experiment.planStale')}</span>
            )}
          </div>
          <div className="budget-caption">{showPlan.caption}</div>
          <div className="summary-formula">{showPlan.label}</div>
        </>
      ) : (
        <div className="budget-caption">{t(locale, 'experiment.noPlan')}</div>
      )}
      {summary && (
        <>
          <div className="inspector-kv">
            <span>{t(locale, 'experiment.planConfigHash')}</span>
            <span className="mono" style={{ fontSize: 9 }}>{summary.configHash.slice(0, 16)}…</span>
          </div>
          <div className="inspector-kv">
            <span>{t(locale, 'experiment.planBaseSeed')}</span>
            <span className="mono">{summary.baseSeed}</span>
          </div>
          <div className="inspector-kv">
            <span>{t(locale, 'experiment.planSims')}</span>
            <span className="mono">{fmtNumber(locale, summary.sims)}</span>
          </div>
          <div className="inspector-kv">
            <span>{t(locale, 'experiment.planPlayerDays')}</span>
            <span className="mono">{fmtNumber(locale, summary.playerDays)}</span>
          </div>
        </>
      )}
      <div className="inspector-kv">
        <span>{t(locale, 'experiment.planPerRun')}</span>
        <span>{design.method !== 'ab' && thePlan
          ? t(locale, 'experiment.planPerRunValue', { players: fmtNumber(locale, thePlan.plan.players), days: thePlan.plan.days })
          : t(locale, 'experiment.planPerRunPending')}
        </span>
      </div>
      <div className="inspector-kv">
        <span>{t(locale, 'experiment.etdLabel')}</span>
        <span className="muted">{t(locale, 'experiment.etdNone')}</span>
      </div>
      <div className="preflight">
        <h3>{t(locale, 'experiment.preflightTitle')}</h3>
        {blockedReasons.length > 0 ? (
          blockedReasons.map((e, i) => (
            <div className="check-row error" key={`${e}:${i}`}>
              <WbIcon name="warning" />
              <span>{e}</span>
            </div>
          ))
        ) : (
          <>
            <div className="check-row">
              <WbIcon name="circlecheck" />
              <span>{t(locale, 'experiment.checkFactors')}</span>
            </div>
            <div className="check-row">
              <WbIcon name="circlecheck" />
              <span>{t(locale, 'experiment.checkKpi')}</span>
            </div>
            <div className="check-row">
              <WbIcon name="circlecheck" />
              <span>{t(locale, 'experiment.checkPlan', { method: METHOD_LABEL[design.method] })}</span>
            </div>
          </>
        )}
        {planError && budgetActions(planError, locale) !== null && (
          <div className="check-row info">
            <WbIcon name="info" />
            <span>{budgetActions(planError, locale)}</span>
          </div>
        )}
      </div>
      <button
        className="btn primary"
        onClick={onSubmit}
        disabled={!canSubmit}
        title={canSubmit ? undefined : blockedReasons[0]}
      >
        <WbIcon name="play" />
        {submitting ? t(locale, 'experiment.submitting') : t(locale, 'experiment.submitLabel')}
      </button>
      <p className="note" style={{ marginTop: 11 }}>
        {t(locale, 'experiment.submitNote', {
          n: thePlan ? thePlan.plan.candidates.length : '—',
        })}
      </p>
    </aside>
  )
}
