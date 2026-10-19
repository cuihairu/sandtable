// WB-02.07 · 运行计划栏:预算预览 + 运行前校验 + 入队动作。
// 诚实口径:耗时无基准时显示"尚无性能基准"(不编造);入队的是演示任务
// (不执行内核),按钮禁用原因完整可见。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import { designCounts, designErrors, METHOD_LABEL } from './designerLogic.ts'
import type { DesignDraft } from './designerLogic.ts'

export type RunPlanSidebarProps = {
  design: DesignDraft
  onEnqueue: () => void
  enqueueDisabled?: boolean
  enqueueDisabledReason?: string
}

export function RunPlanSidebar({ design, onEnqueue, enqueueDisabled, enqueueDisabledReason }: RunPlanSidebarProps): JSX.Element {
  const counts = designCounts(design)
  const errors = designErrors(design)
  return (
    <aside className="form-summary" aria-label="运行计划">
      <h3>运行计划</h3>
      <div className="budget-value">{counts.tasks.toLocaleString()}</div>
      <div className="budget-caption">次单方案运行 · 演示任务</div>
      <div className="summary-formula">
        {counts.candidates} 个{design.method === 'ab' ? '方案' : '候选'} × {design.reps} replicates
      </div>
      <div className="inspector-kv">
        <span>实验方法</span>
        <span>{METHOD_LABEL[design.method]}</span>
      </div>
      <div className="inspector-kv">
        <span>每次运行</span>
        <span>
          {design.players.toLocaleString()} 玩家 / {design.days} 天
        </span>
      </div>
      <div className="inspector-kv">
        <span>总 player-days</span>
        <span className="mono">{counts.playerDays.toLocaleString()}</span>
      </div>
      <div className="inspector-kv">
        <span>耗时估算</span>
        <span className="muted">尚无性能基准</span>
      </div>
      <div className="preflight">
        <h3>运行前基础校验</h3>
        {errors.length > 0 ? (
          errors.map((e) => (
            <div className="check-row error" key={e}>
              <WbIcon name="warning" />
              <span>{e}</span>
            </div>
          ))
        ) : (
          <>
            <div className="check-row">
              <WbIcon name="circlecheck" />
              <span>因子范围与类型有效</span>
            </div>
            <div className="check-row">
              <WbIcon name="circlecheck" />
              <span>D7 指标满足运行天数要求</span>
            </div>
            <div className="check-row">
              <WbIcon name="circlecheck" />
              <span>任务数在演示预算内</span>
            </div>
          </>
        )}
        <div className="check-row info">
          <WbIcon name="info" />
          <span>完整 schema、公式、资源检查由实际内核接入后提供(sweep_plan / validate)。</span>
        </div>
      </div>
      <button
        className="btn primary"
        onClick={onEnqueue}
        disabled={errors.length > 0 || enqueueDisabled === true}
        title={enqueueDisabledReason}
      >
        <WbIcon name="play" />
        加入演示队列
      </button>
      <p className="note" style={{ marginTop: 11 }}>
        用于体验进度与取消流程。演示任务不执行仿真,不生成新的统计结果。
        {enqueueDisabledReason ?? ''}
      </p>
    </aside>
  )
}
