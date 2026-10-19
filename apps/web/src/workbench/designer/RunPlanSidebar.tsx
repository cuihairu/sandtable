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
  const localErrors = errors.filter((e) => e.scope !== 'scenario')
  const scenarioErrors = errors.filter((e) => e.scope === 'scenario')
  const planError = plan?.status === 'error' ? plan.message : null
  const thePlan = plan?.status === 'ok' ? plan : null
  // 计划是否反映当前输入:stamp 由 DesignerPage 以输入指纹递增;ok/stale 分支。
  const planObsolete = plan === null || plan.status === 'pending' || plan.status === 'stale'
  const showPlan = (() => {
    if (design.method === 'ab') {
      const count = abCandidates ?? 0
      return { label: `${count} 方案 × ${design.reps} replicates`, tasks: count * design.reps, caption: 'A/B 配对比较 · 演示任务(执行桥接 WB-07)' }
    }
    if (thePlan) {
      const s = planSummary(thePlan.plan)
      return { label: `${s.candidates} 候选 × ${s.replicates} replicates`, tasks: s.sims, caption: `内核计划 · 模式 ${s.mode}` }
    }
    return null
  })()
  const canSubmit =
    localErrors.length === 0 && scenarioErrors.length === 0 && !planObsolete && planError === null && !submitting && submitBlocked === undefined
  const blockedReasons: string[] = [
    ...localErrors.map((e) => (e.locator ? `${e.locator}: ${e.message}` : e.message)),
    ...scenarioErrors.map((e) => e.message),
    ...(plan?.status === 'pending' ? ['内核计划计算中…'] : []),
    ...(plan?.status === 'stale' ? ['预览已失效:表单改动尚未通过内核计划校验'] : []),
    ...(planError ? planErrorLines(planError) : []),
    ...(submitBlocked ? [submitBlocked] : []),
  ]
  const summary = thePlan ? planSummary(thePlan.plan) : null
  return (
    <aside className="form-summary" aria-label="运行计划">
      <h3>运行计划</h3>
      {showPlan ? (
        <>
          <div className="budget-value">
            {showPlan.tasks.toLocaleString()}
            {planObsolete && design.method !== 'ab' && (
              <span className="badge amber" style={{ marginLeft: 8, verticalAlign: 'middle' }}>计划已失效</span>
            )}
          </div>
          <div className="budget-caption">{showPlan.caption}</div>
          <div className="summary-formula">{showPlan.label}</div>
        </>
      ) : (
        <div className="budget-caption">尚无内核计划:修正因子/方法前一提示后重算(WB-06.10)</div>
      )}
      {summary && (
        <>
          <div className="inspector-kv">
            <span>内核 config_hash</span>
            <span className="mono" style={{ fontSize: 9 }}>{summary.configHash.slice(0, 16)}…</span>
          </div>
          <div className="inspector-kv">
            <span>base_seed(复现锚)</span>
            <span className="mono">{summary.baseSeed}</span>
          </div>
          <div className="inspector-kv">
            <span>总运行数(sims)</span>
            <span className="mono">{summary.sims.toLocaleString()}</span>
          </div>
          <div className="inspector-kv">
            <span>总 player-days</span>
            <span className="mono">{summary.playerDays.toLocaleString()}</span>
          </div>
        </>
      )}
      <div className="inspector-kv">
        <span>每次运行(规模)</span>
        <span>{design.method !== 'ab' && thePlan ? `${thePlan.plan.players.toLocaleString()} 玩家 / ${thePlan.plan.days} 天` : '读取场景 YAML'}</span>
      </div>
      <div className="inspector-kv">
        <span>耗时估算</span>
        <span className="muted">尚无性能基准(不估算)</span>
      </div>
      <div className="preflight">
        <h3>运行前校验</h3>
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
              <span>因子域与样本参数有效</span>
            </div>
            <div className="check-row">
              <WbIcon name="circlecheck" />
              <span>KPI 约束在当前配置下可用(WB-06.07)</span>
            </div>
            <div className="check-row">
              <WbIcon name="circlecheck" />
              <span>内核计划({METHOD_LABEL[design.method]})通过,预算内</span>
            </div>
          </>
        )}
        {planError && budgetActions(planError) && (
          <div className="check-row info">
            <WbIcon name="info" />
            <span>{budgetActions(planError)}</span>
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
        {submitting ? '提交中…' : '提交实验(绑定计划快照)'}
      </button>
      <p className="note" style={{ marginTop: 11 }}>
        提交动作会重新冻结实验输入并登记计划(候选 {thePlan ? thePlan.plan.candidates.length : '—'});
        演示队列(WB-07 前不产真实仿真产物)。
      </p>
    </aside>
  )
}
