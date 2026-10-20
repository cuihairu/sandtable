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
import type { CandidateDraft } from './resultModel.ts'
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

/* —— WB-09.04 · run 快照信封的来源与版本;未运行草稿另存 —— */

/** 运行索引里信封需要的字段(结构化;分析侧不依赖 state 模块) */
export type RunIndexLookup = {
  experiment_id: string | null
  config_hash: string | null
  seed: number | string | null
  created_at_unix: number | null
}

/**
 * run 快照信封头部:来源与版本。缺失一律 null(WB-08.16 同口径,不虚构)——
 * 版本取运行自带的分析上下文(model_version / schema_version)与 plan 配置哈希;
 * 索引字段只在运行登记后存在,未登记 → registered:false + 字段 null。
 */
export type RunEnvelope = {
  data_source: 'kernel'
  run_id: string
  status: Job['status']
  version: {
    model_version: string | null
    schema_version: string | null
    plan_config_hash: string | null
    input_config_hash: string | null
  }
  source: {
    data_source: 'kernel'
    registered: boolean
    experiment_id: string | null
    seed: number | string | null
    created_at_unix: number | null
  }
}

export function runEnvelope(job: Job, index: RunIndexLookup | null): RunEnvelope {
  const context = job.exec!.spec.analysis
  return {
    data_source: 'kernel',
    run_id: job.exec!.runId,
    status: job.status,
    version: {
      model_version: context?.modelVersion ?? null,
      schema_version: context?.schemaVersion ?? null,
      plan_config_hash: context?.plan?.config_hash ?? null,
      input_config_hash: index?.config_hash ?? null,
    },
    source: {
      data_source: 'kernel',
      registered: index !== null,
      experiment_id: index?.experiment_id ?? null,
      seed: index?.seed ?? null,
      created_at_unix: index?.created_at_unix ?? null,
    },
  }
}

/**
 * 绑定当前 run 的范围导出 JSON:信封(来源/版本)+ run 元数据原样透传,
 * results 按范围行的计划下标对位保留(未进入范围的候选不出现在产物里,
 * 但 export_scope 如实记录范围与全集数量,便于重开核对)。
 */
export function scopedRunJson(job: Job, ui: ScopeUI, scope: ExportScope, index: RunIndexLookup | null = null): string {
  const exec = job.exec!
  const rows = scopeRows(job, ui, scope)
  const kept = new Set(rows.map((r) => r.index))
  return machineJson({
    ...runEnvelope(job, index),
    spec: exec.spec,
    results: exec.results.filter((_r, i) => kept.has(i)),
    recommendation: exec.recommendation,
    export_scope: { scope, candidates: rows.length, total: resultRows(job).length },
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
  const spec = job.exec!.spec
  const rows = resultRows(job)
  // targets 只在扫描规格里存在:收窄 kind 后从运行自带的分析上下文取计划
  const targets = spec.kind === 'sweep' ? spec.analysis?.plan?.targets ?? [] : []
  return METRIC_KEYS.filter((m) =>
    targets.some((tg) => tg.metric === m)
    || rows.some((r) => r.result?.stats.has(m)),
  )
}

/**
 * 绑定当前 run 的候选表 CSV(WB-09.02):稳定机器列名(data_source /
 * run_id / experiment_id / input_config_hash / plan_config_hash / model_version /
 * schema_version / candidate_id / candidate_index / replicates / 参数 ID 列 /
 * status / fail_reason / verdict / 指标统计列),统计列名
 * `<metric>.<stat>[量纲]`(mean / ci95_lo / ci95_hi / sd / n);不可用统计
 * = 空单元格(csvCell,null 绝不写 0),失败原因 = 内核原文(RFC4180 引号
 * 由 toCsv 收口),BOM + CRLF 与演示 CSV 同一封装。
 * WB-09.10 · 配置版本四列与归档信封 version.* 同名单源,未登记或分析上下文
 * 缺失 = 空单元格不虚构,单份导出表即可对照界面与归档核对配置版本。
 */
export function scopedRunCsv(
  job: Job,
  ui: ScopeUI,
  scope: ExportScope,
  index: RunIndexLookup | null = null,
): string {
  const exec = job.exec!
  // 扫描轴取计划内首个候选的取值键(非扫描规格无扫描轴,故无参数列)
  const axes = Object.keys(resultRows(job)[0]?.values ?? {})
  const metrics = runMetrics(job)
  // 配置版本列:与信封 version.* 一一对应(index 缺失 = 未登记 → 空单元格)
  const context = exec.spec.analysis
  const versionCells = [
    index?.config_hash ?? null,
    context?.plan?.config_hash ?? null,
    context?.modelVersion ?? null,
    context?.schemaVersion ?? null,
  ]
  const header = [
    'data_source', 'run_id', 'experiment_id', 'input_config_hash', 'plan_config_hash', 'model_version', 'schema_version',
    'candidate_id', 'candidate_index', 'replicates',
    ...axes, 'status', 'fail_reason', 'verdict',
    ...metrics.flatMap((m) => {
      const s = scaleToken(m)
      return [`${m}.mean[${s}]`, `${m}.ci95_lo[${s}]`, `${m}.ci95_hi[${s}]`, `${m}.sd[${s}]`, `${m}.n[count]`]
    }),
  ]
  const rows = scopeRows(job, ui, scope).map((row) => [
    'kernel', exec.runId, index?.experiment_id ?? '', ...versionCells, row.id, row.index, exec.replicates,
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

/* \u2014\u2014 WB-09.04 \u00B7 \u672A\u8FD0\u884C\u8349\u7A3F\u53E6\u5B58:\u6C38\u4E0D\u5192\u5145\u8BE5 run \u7684\u8F93\u5165\u6216\u8F93\u51FA \u2014\u2014 */

/** \u8349\u7A3F\u7684\u673A\u5668\u5FEB\u7167(snake_case,\u539F\u59CB\u5185\u5BB9\u4E0D\u7FFB\u8BD1):\u53EA\u542B\u65B9\u6848\u672C\u4F53\u4E0E\u6765\u6E90\u6307\u9488 */
export function draftSnapshot(d: CandidateDraft): {
  id: string
  source_run_id: string
  source_candidate_id: string
  baseline_id: string
  values: Readonly<Record<string, number>>
  plan_yaml: string
  yaml: string
} {
  return {
    id: d.id, source_run_id: d.sourceRunId, source_candidate_id: d.sourceCandidateId,
    baseline_id: d.baselineId, values: d.values, plan_yaml: d.baselineYaml, yaml: d.yaml,
  }
}

export type DraftArtifact = {
  data_source: 'candidate_draft'
  run_status: 'unrun'
  included_in_run_inputs: false
  run_id: string | null
  count: number
  drafts: ReturnType<typeof draftSnapshot>[]
}

/**
 * \u672A\u8FD0\u884C\u8349\u7A3F\u7684\u6279\u91CF\u4EA7\u7269:\u4E09\u5904\u673A\u5668\u58F0\u660E(data_source / run_status /
 * included_in_run_inputs)\u4FDD\u8BC1\u4EFB\u4F55\u4E00\u4EFD\u4E0B\u8F7D\u90FD\u65E0\u6CD5\u88AB\u5F53\u6210\u8BE5 run \u7684\u8F93\u5165\u6216\u8F93\u51FA;
 * \u6BCF\u6761\u8349\u7A3F\u4FDD\u7559\u81EA\u5DF1\u7684\u6765\u6E90 run \u4E0E\u6765\u6E90\u5019\u9009,\u4E0D\u5E76\u5165 run \u7684\u5019\u9009\u8868\u3002
 */
export function draftsJson(drafts: readonly CandidateDraft[], runId: string | null): string {
  const artifact: DraftArtifact = {
    data_source: 'candidate_draft',
    run_status: 'unrun',
    included_in_run_inputs: false,
    run_id: runId,
    count: drafts.length,
    drafts: drafts.map(draftSnapshot),
  }
  return machineJson(artifact)
}

/** \u5355\u4EFD\u8349\u7A3F\u4EA7\u7269:\u540C\u4E00\u7EC4\u58F0\u660E,\u5355\u6761\u4E0B\u8F7D\u540C\u6837\u4E0D\u4F1A\u5192\u5145 run \u8F93\u5165 */
export function draftJson(d: CandidateDraft): string {
  return machineJson({ data_source: 'candidate_draft', run_status: 'unrun', included_in_run_inputs: false, draft: draftSnapshot(d) })
}
