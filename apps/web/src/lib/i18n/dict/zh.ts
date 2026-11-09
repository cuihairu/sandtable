// WB-11.04:中文词典(真值源)。词条按九领域前缀组织,分片在 zh/ 下按域一文件:
// common. 公共控件 / nav. 导航 / params. 参数 / experiment. 实验 /
// analysis. 分析 / tasks. 任务 / data. 数据与导出 / errors. 错误信息 / report. 设计报告。
// 约定:插值用 {name} 命名占位(计数/复数规则见 WB-11.17,不在词典层做);
// nav 词条与 routing.ts 的 label/short 对齐,接 WB-11.05 时替换硬编码。
import { common } from './zh/common.ts'
import { params } from './zh/params.ts'
import { nav } from './zh/nav.ts'
import { experiment } from './zh/experiment.ts'
import { analysis } from './zh/analysis.ts'
import { tasks } from './zh/tasks.ts'
import { data } from './zh/data.ts'
import { report } from './zh/report.ts'
import { errors } from './zh/errors.ts'

export const zh = {
  ...common,
  ...params,
  ...nav,
  ...experiment,
  ...analysis,
  ...tasks,
  ...data,
  ...report,
  ...errors,
} as const

export type ZhDict = typeof zh
