// WB-09.01 · 导出范围与真实 run 绑定:导出对话框的计数与内容一律由
// 当前 run(job)派生——全部=计划内候选全集,筛选=分析页当前筛选,
// 所选=当前选中候选;绝不把另一个 run 的行或演示数据混进真实导出。
// 范围是纯逻辑(候选无独立 ID,results 与计划按位对齐,范围经行下标
// 对位回 exec.results);JSON 信封字段(run 快照/版本/来源)由 WB-09.04
// 细化,本模块只定绑定、范围与对位,不产文案。
import type { Job } from '../state/jobLogic.ts'
import { machineJson, toCsv } from '../../lib/machineExport.ts'
import { METRIC_KEYS } from '../../lib/types.ts'
import type { MetricKey } from '../../lib/types.ts'
import { METRIC_META } from '../../lib/metricMeta.ts'
import { overallOutcome } from '../../lib/analysisView.ts'
import { resultRows, orderedRows } from './resultModel.ts'
import type { ResultRow } from './resultModel.ts'
import type { ResultOrder } from '../../lib/analysisView.ts'

/** 导出范围:全部计划内候选 / 分析页当前筛选 / 当前选中(单个) */
export type ExportScope = 'all' | 'filtered' | 'selected'

/** 范围计算需要的分析页 UI 状态(选中候选 + 排序筛选) */
export type ScopeUI = { selectedId: string | null; order: ResultOrder }

/**
 * 当前真实 run 的唯一解析口径(分析页与导出对话框共用):
 * 会话选中的 job 优先,其次选择器里的 runId,最后最新一个真实 job。
 * 不看演示 job(demo 标记),不虚构默认 run。
 */
export function currentRealJob(
  jobs: readonly Job[],
  jobId: string | null,
  selectedRun: string | null | undefined,
): Job | null {
  const realJobs = jobs.filter((j) => !j.demo && j.exec)
  return (
    realJobs.find((j) => j.id === jobId)
    ?? realJobs.find((j) => j.exec?.runId === selectedRun)
    ?? realJobs.at(-1)
    ?? null
  )
}

/** 范围对应的行(含未运行/失败/取消的槽位,不静默丢弃) */
export function scopeRows(job: Job, ui: ScopeUI, scope: ExportScope): ResultRow[] {
  const all = resultRows(job)
  if (scope === 'all') return all
  if (scope === 'filtered') return orderedRows(all, ui.order)
  return ui.selectedId ? all.filter((r) => r.id === ui.selectedId) : []
}

/** 对话框三个范围选项显示的实际数量 */
export function scopeCounts(job: Job, ui: ScopeUI): { all: number; filtered: number; selected: number } {
  return {
    all: resultRows(job).length,
    filtered: orderedRows(resultRows(job), ui.order).length,
    selected: ui.selectedId && resultRows(job).some((r) => r.id === ui.selectedId) ? 1 : 0,
  }
}

/**
 * 绑定当前 run 的范围导出 JSON:run 元数据原样透传,data_source 恒 kernel,
 * results 按范围行的计划下标对位保留(未进入范围的候选不出现在产物里,
 * 但 export_scope 如实记录范围与全集数量,便于重开核对)。
 */
export function scopedRunJson(job: Job, ui: ScopeUI, scope: ExportScope): string {
  const exec = job.exec!
  const rows = scopeRows(job, ui, scope)
  const kept = new Set(rows.map((r) => r.index))
  return machineJson({
    data_source: 'kernel',
    run_id: exec.runId,
    spec: exec.spec,
    status: job.status,
    results: exec.results.filter((_r, i) => kept.has(i)),
    recommendation: exec.recommendation,
    export_scope: { scope, candidates: rows.length, total: exec.spec.plan.candidates.length },
  })
}

/* —— WB-09.02 · 真实 run 候选表 CSV —— */

/**
 * 量纲的机器标注(locale 无关,中英文列名一致,WB-11.09):
 * percent 维度 = 内核 0–1 比例口径(存储与导出绝不乘 100,×100 只发生在
 * 显示层 fmtPercent,follows WB-03.03 的唯一换算入口约定);
 * amount 维度 = 绝对量原样,不做缩放。
 */
function scaleToken(m: MetricKey): 'ratio_0_1' | 'amount' {
  return METRIC_META[m].dimension === 'percent' ? 'ratio_0_1' : 'amount'
}

/** 行级机器状态:ok/config_error 来自内核判定;未运行行按运行终态归类 */
function rowStatus(job: Job, row: ResultRow): 'ok' | 'config_error' | 'pending' | 'failed' | 'cancelled' {
  if (row.result) return typeof row.result.status === 'object' ? 'config_error' : 'ok'
  if (job.status === 'failed') return 'failed'
  return job.status === 'cancelled' ? 'cancelled' : 'pending'
}

/** 失败原因:候选级 = 内核 config_error 原文;运行级失败落到未运行行,不静默留空 */
function rowFailReason(job: Job, row: ResultRow): string {
  if (row.result && typeof row.result.status === 'object') return row.result.status.config_error
  if (!row.result && job.status === 'failed') return job.exec?.errorMessage ?? ''
  return ''
}

/** 全 run 指标集(范围无关 → 列名稳定):计划 targets + 实际产出过的指标 */
function runMetrics(job: Job): MetricKey[] {
  const rows = resultRows(job)
  return METRIC_KEYS.filter((m) =>
    job.exec!.spec.plan.targets.some((tg) => tg.metric === m)
    || rows.some((r) => r.result?.stats.has(m)),
  )
}

/**
 * 绑定当前 run 的候选表 CSV(WB-09.02):稳定机器列名(data_source /
 * run_id / experiment_id / candidate_id / candidate_index / replicates /
 * 参数 ID 列 / status / fail_reason / verdict / 指标统计列),统计列名
 * `<metric>.<stat>[量纲]`(mean / ci95_lo / ci95_hi / sd / n);不可用统计
 * = 空单元格(csvCell,null 绝不写 0),失败原因 = 内核原文(RFC4180 引号
 * 由 toCsv 收口),BOM + CRLF 与演示 CSV 同一封装。
 */
export function scopedRunCsv(job: Job, ui: ScopeUI, scope: ExportScope, experimentId: string | null): string {
  const exec = job.exec!
  const axes = Object.keys(exec.spec.plan.candidates[0] ?? {})
  const metrics = runMetrics(job)
  const header = [
    'data_source', 'run_id', 'experiment_id', 'candidate_id', 'candidate_index', 'replicates',
    ...axes, 'status', 'fail_reason', 'verdict',
    ...metrics.flatMap((m) => {
      const s = scaleToken(m)
      return [`${m}.mean[${s}]`, `${m}.ci95_lo[${s}]`, `${m}.ci95_hi[${s}]`, `${m}.sd[${s}]`, `${m}.n[count]`]
    }),
  ]
  const rows = scopeRows(job, ui, scope).map((row) => [
    'kernel', exec.runId, experimentId ?? '', row.id, row.index, exec.replicates,
    ...axes.map((a) => row.values[a] ?? null),
    rowStatus(job, row), rowFailReason(job, row),
    row.result ? overallOutcome(row.result).overall ?? '' : '',
    ...metrics.flatMap((m) => {
      const ms = row.result?.stats.get(m)
      return ms ? [ms.mean, ms.ci95_lo, ms.ci95_hi, ms.sd, ms.n] as const : [null, null, null, null, null] as const
    }),
  ])
  return '\uFEFF' + toCsv(header, rows)
}
