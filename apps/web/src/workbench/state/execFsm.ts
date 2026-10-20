// WB-07.01 · 执行状态机(纯函数):六态不变,新增"部分结果"维度与迁移守卫。
// - 迁移表是唯一权威:executor/runManager 推进状态必须经 canTransition 守卫,
//   竞争条件(WB-07.16)下终态先到先得,后到的迁移被拒绝(不变量测试锁定);
// - "区分有部分结果的状态":终态三分 = complete(全部完成)/ partial(保留了
//   真实中间产物:已完成候选、双臂输出或单次输出)/ empty(无任何保留产物)。
//   cancelled/failed 都可能带部分结果——界面必须区分展示,不得一律当失败清零。
// - WB-07.13 · activeJob:任务页/状态栏/抽屉共用的"当前任务"判定(同一数据源)。
import type { ExecErrorClass, ExecKind, Job, JobStatus } from './jobLogic.ts'
import { isTerminal } from './jobLogic.ts'

/** 允许的迁移(不含自环)。queued → cancelled:未启动任务的本地取消,不经取消中。
 *  cancelling → succeeded:取消与完成的竞争——完成先落(WB-07.16)。 */
const ALLOWED: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  queued: ['running', 'cancelled', 'failed'],
  running: ['cancelling', 'succeeded', 'failed'],
  cancelling: ['cancelled', 'failed', 'succeeded'],
  cancelled: [],
  succeeded: [],
  failed: [],
}

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return false
  return ALLOWED[from].includes(to)
}

/** 终态产出:complete / partial(有部分结果)/ empty;非终态返回 null。 */
export type TerminalOutcome = 'complete' | 'partial' | 'empty'

/** 保留的真实产物计数:已完成且 ok 的候选 + 双臂 + 单次输出(config_error
 *  候选是"已定位的错误结果",不算可用产物,但留在结果集——WB-07.14)。 */
export function keptResultCount(job: Job): number {
  const ex = job.exec
  if (!ex) return 0
  const okResults = ex.results.filter((r) => r.status === 'ok').length
  return okResults + (ex.arms !== null ? 2 : 0) + (ex.sim !== null ? 1 : 0)
}

export function terminalOutcome(job: Job): TerminalOutcome | null {
  if (!isTerminal(job.status)) return null
  if (job.status === 'succeeded') return 'complete'
  return keptResultCount(job) > 0 ? 'partial' : 'empty'
}

/** WB-07.13 · 当前任务 = 最新一个非终态任务(queued/running/cancelling)。
 *  任务页、状态栏、抽屉都调这一个函数,切换工作区后显示同一个任务。 */
export function activeJob(jobs: readonly Job[]): Job | null {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (!isTerminal(jobs[i].status)) return jobs[i]
  }
  return null
}

/** WB-07.14 · 错误分类的展示文案(取消用状态机 cancelled,不算错误类)。 */
export const ERROR_CLASS_LABEL: Readonly<Record<ExecErrorClass, string>> = {
  init: '初始化失败',
  run: '运行错误',
  budget: '超出内存预算',
  bridge: '内核桥接未接入',
}

/** WB-07.14 · 恢复动作(界面按 errorClass 给不同操作提示;init 可重试初始化)。 */
export function recoveryFor(errorClass: ExecErrorClass | null, kind: ExecKind): string {
  switch (errorClass) {
    case 'init':
      return '重试初始化:重新提交任务即可重新初始化 Worker(WASM 初始化失败可重试)'
    case 'run':
      return '查看错误详情,修正配置后重新提交(已完成候选保留在结果集)'
    case 'budget':
      return '缩小实验规模(候选数在内存预算内)后重新提交'
    case 'bridge':
      return kind === 'ab'
        ? '统计比较桥接未接入(WB-03.10/11):前端构建缺少内核桥接导出,重建/更新前端产物后重新提交(双臂结果保留)'
        : '内核桥接未接入(WB-03.10/11):重建/更新前端产物后重试'
    case null:
      return '调整后重新提交'
  }
}
