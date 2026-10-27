// todo L381 批五 · 目标/约束账本:跨候选的约束判定分布与最紧余量。
// 口径纪律:只读内核已判定的 TargetOutcome(verdict / stats.mean)与已声明的
// SweepTarget 阈值——不重算统计、不自设 pass/borderline 判定边界(那些语义
// 由内核给出)。缺席即缺席:未跑或配置错误(没有 outcomes)的候选计 unjudged,
// 不进分母、不当通过。
import type { CandidateView } from './sweepView.ts'
import type { SweepTarget, TargetOutcome } from './types.ts'

export type ConstraintLedgerRow = {
  metric: SweepTarget['metric']
  kind: 'hard' | 'soft'
  min: number | null
  max: number | null
  /** 已判定候选数(该目标的 outcome 在场) */
  judged: number
  /** 未判定候选数(未跑 / 配置错误,不静默计通过) */
  unjudged: number
  pass: number
  borderline: number
  fail: number
  /** 通过占比 = pass / judged;judged = 0 缺席(null),不写 0 */
  passShare: number | null
  /** 最紧候选:mean 到任一阈值的最小距离(负 = 越界) */
  worstDistance: number | null
  /** 最紧候选的均值(与 worstDistance 同源,便于逐字核对) */
  worstMean: number | null
}

/** 目标身份:同指标可以有 hard 与 soft 两条,阈值不同也是两条 */
export function targetKey(target: Pick<SweepTarget, 'metric' | 'kind' | 'min' | 'max'>): string {
  return `${target.metric}|${target.kind}|${target.min ?? 'na'}|${target.max ?? 'na'}`
}

function matches(target: SweepTarget, outcome: TargetOutcome): boolean {
  return targetKey(target) === targetKey(outcome)
}

/** mean 到阈值的最小距离:无界的一侧不参与(视为无约束) */
function distanceOf(outcome: TargetOutcome): { distance: number; mean: number } | null {
  const mean = outcome.stats.mean
  if (outcome.min === null && outcome.max === null) return null
  const toMin = outcome.min === null ? Number.POSITIVE_INFINITY : mean - outcome.min
  const toMax = outcome.max === null ? Number.POSITIVE_INFINITY : outcome.max - mean
  const distance = Math.min(toMin, toMax)
  return distance === Number.POSITIVE_INFINITY ? null : { distance, mean }
}

/** 跨候选汇总:行序 = 已声明目标的顺序;内核多返回的目标追加在后,不丢数据 */
export function constraintLedger(
  views: readonly CandidateView[],
  targets: readonly SweepTarget[],
): ConstraintLedgerRow[] {
  const totals = new Map<string, { judged: number; unjudged: number; pass: number; borderline: number; fail: number; worst: { distance: number; mean: number } | null }>()
  const touch = (key: string) => {
    let entry = totals.get(key)
    if (!entry) {
      entry = { judged: 0, unjudged: 0, pass: 0, borderline: 0, fail: 0, worst: null }
      totals.set(key, entry)
    }
    return entry
  }
  const keys = targets.map(targetKey)
  for (const target of targets) touch(targetKey(target))

  for (const view of views) {
    const judgedKeys = new Set<string>()
    for (const target of targets) {
      const entry = touch(targetKey(target))
      const hits = view.outcomes.filter((outcome) => matches(target, outcome))
      if (hits.length === 0) {
        entry.unjudged += 1
        continue
      }
      for (const hit of hits) {
        entry.judged += 1
        if (hit.verdict === 'pass') entry.pass += 1
        else if (hit.verdict === 'borderline') entry.borderline += 1
        else entry.fail += 1
        const distance = distanceOf(hit)
        if (distance && (entry.worst === null || distance.distance < entry.worst.distance)) entry.worst = distance
      }
      judgedKeys.add(targetKey(target))
    }
    // 内核返回了未声明的目标(如寻优 spec 自带的软目标):同样入账,不丢
    for (const outcome of view.outcomes) {
      const key = targetKey(outcome)
      if (judgedKeys.has(key) || keys.includes(key)) continue
      const entry = touch(key)
      entry.judged += 1
      if (outcome.verdict === 'pass') entry.pass += 1
      else if (outcome.verdict === 'borderline') entry.borderline += 1
      else entry.fail += 1
      const distance = distanceOf(outcome)
      if (distance && (entry.worst === null || distance.distance < entry.worst.distance)) entry.worst = distance
    }
  }

  const seen = new Set(keys)
  const ordered: SweepTarget[] = [...targets]
  for (const view of views) {
    for (const outcome of view.outcomes) {
      const key = targetKey(outcome)
      if (seen.has(key)) continue
      seen.add(key)
      ordered.push({ metric: outcome.metric, kind: outcome.kind, min: outcome.min, max: outcome.max })
    }
  }

  return ordered.map((target) => {
    const entry = totals.get(targetKey(target)) ?? { judged: 0, unjudged: views.length, pass: 0, borderline: 0, fail: 0, worst: null }
    return {
      metric: target.metric,
      kind: target.kind,
      min: target.min,
      max: target.max,
      judged: entry.judged,
      unjudged: entry.unjudged,
      pass: entry.pass,
      borderline: entry.borderline,
      fail: entry.fail,
      passShare: entry.judged > 0 ? entry.pass / entry.judged : null,
      worstDistance: entry.worst?.distance ?? null,
      worstMean: entry.worst?.mean ?? null,
    }
  })
}
