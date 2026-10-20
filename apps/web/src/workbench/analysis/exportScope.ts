// WB-09.01 · 导出范围与真实 run 绑定:导出对话框的计数与内容一律由
// 当前 run(job)派生——全部=计划内候选全集,筛选=分析页当前筛选,
// 所选=当前选中候选;绝不把另一个 run 的行或演示数据混进真实导出。
// 范围是纯逻辑(候选无独立 ID,results 与计划按位对齐,范围经行下标
// 对位回 exec.results);JSON 信封字段(run 快照/版本/来源)由 WB-09.04
// 细化,本模块只定绑定、范围与对位,不产文案。
import type { Job } from '../state/jobLogic.ts'
import { machineJson } from '../../lib/machineExport.ts'
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
