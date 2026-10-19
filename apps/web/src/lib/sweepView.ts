// WB-08.01 · 扫描结果适配器:内核 SweepPlan/CandidateResult(lib/types.ts,
// contracts.test.mjs 对真 wasm 锁形)→ 分析视图模型。只读真实内核输出,
// 不引入合成样例结构(demo 层的 11/20/65% 等常量不进来)。
// 红线:
// - 忠实透传 values/status/metric_stats/target_outcomes;config_error 候选
//   保留在结果集中,不静默丢弃(WB-08.10 在视图侧接着表达);
// - 缺失指标 = 不可用(metricStat → null),禁止 0 填空(验收纪律);
// - 口径原样:比例不乘 100、不舍入——×100 唯一发生在 i18n fmtPercent
//   (WB-03.03/WB-11.18 的显示层约定),适配器属于数据层;
// - 候选 ID 由调用方注入(应用侧用 workbench/ids.candidateIdFor,内容寻址:
//   同参数域恒同 ID,排序/筛选/部分返回后选择仍指向同一候选,即 WB-08.02
//   的稳定结果 ID)。lib 不反向依赖 workbench,故作注入。
// - 部分返回:results 与计划候选按位对齐,未返回的位传 null,不产生错位;
//   结果数超过计划数 = 调用方对位错误,明确报错,不静默截断。
import type {
  CandidateResult,
  CandidateStatus,
  MetricKey,
  SampleStats,
  SweepPlan,
  TargetOutcome,
} from './types.ts'

/** ID 派生注入:同参数域必须恒同 ID(内容寻址);应用侧接 candidateIdFor */
export type CandidateIdDeriver = (values: Readonly<Record<string, number>>) => string

export interface CandidateView {
  /** 稳定候选 ID(WB-08.02:排序/筛选/部分返回后仍指同一候选) */
  readonly id: string
  /** 计划内序位:部分返回时仍按计划下标定位,不用渲染顺序冒充 */
  readonly index: number
  readonly values: Readonly<Record<string, number>>
  /** 'ok' 或 {config_error} 原样透传,前端不覆写内核判定 */
  readonly status: CandidateStatus
  /** 指标 → 统计;候选未产出某指标 = 该键不存在(不可用,非 0) */
  readonly stats: ReadonlyMap<MetricKey, SampleStats>
  readonly outcomes: readonly TargetOutcome[]
}

export function candidateViews(
  plan: SweepPlan,
  results: ReadonlyArray<CandidateResult | null>,
  deriveId: CandidateIdDeriver,
): CandidateView[] {
  if (results.length > plan.candidates.length) {
    // results 与 plan.candidates 按位对齐是调用契约;多出来即对位错误
    throw new Error(
      `扫描结果数(${results.length})超过计划候选数(${plan.candidates.length}),对位错误`,
    )
  }
  const views: CandidateView[] = []
  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    if (result === null) continue // 尚未返回的候选不进视图
    views.push({
      id: deriveId(result.values),
      index: i,
      values: result.values,
      status: result.status,
      stats: new Map(result.metric_stats),
      outcomes: result.target_outcomes,
    })
  }
  return views
}

/** 指标统计:未产出 = null(不可用),调用方不得当作 0 */
export function metricStat(view: CandidateView, metric: MetricKey): SampleStats | null {
  return view.stats.get(metric) ?? null
}
