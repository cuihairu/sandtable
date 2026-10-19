// WB-11.04:中文词典(真值源)。词条按八领域前缀组织:
// common. 公共控件 / nav. 导航 / params. 参数 / experiment. 实验 /
// analysis. 分析 / tasks. 任务 / data. 数据与导出 / errors. 错误信息。
// 约定:插值用 {name} 命名占位(计数/复数规则见 WB-11.17,不在词典层做);
// nav 词条与 routing.ts 的 label/short 对齐,接 WB-11.05 时替换硬编码。
export const zh = {
  // 公共控件
  'common.language': '语言',
  'common.confirm': '确认',
  'common.cancel': '取消',
  'common.retry': '重试',
  'common.loading': '加载中…',

  // 导航(五个工作区,与 routing.ts 对齐)
  'nav.analysis': '结果分析',
  'nav.parameters': '参数编辑',
  'nav.designer': '实验设计',
  'nav.runs': '运行任务',
  'nav.exchange': '数据与导出',

  // 参数
  'params.search': '搜索参数',
  'params.baseline': '基线配置',
  'params.candidate': '候选配置',
  'params.changed': '已修改 {n} 项',

  // 实验
  'experiment.method': '扫描方式',
  'experiment.method.grid': '网格',
  'experiment.method.random': '随机',
  'experiment.method.lhs': '拉丁超立方',
  'experiment.replicates': '重复次数',

  // 分析
  'analysis.candidateTable': '候选结果表',
  'analysis.selection': '当前选择',
  'analysis.baseline': '基线',

  // 任务
  'tasks.queued': '排队中',
  'tasks.running': '运行中',
  'tasks.succeeded': '已完成',
  'tasks.failed': '失败',
  'tasks.cancelled': '已取消',
  // 计数复数形:zh 无单复变化,.one 仅为与 en 键集对齐,运行时恒走 .other
  'tasks.remaining.one': '剩余 {n} 个任务',
  'tasks.remaining.other': '剩余 {n} 个任务',

  // 数据与导出
  'data.export': '导出',
  'data.export.csv': '导出 CSV',
  'data.export.json': '导出 JSON',
  'data.export.svg': '导出 SVG',
  'data.rowsExported.one': '已按 {where} 导出 {n} 行',
  'data.rowsExported.other': '已按 {where} 导出 {n} 行',

  // 错误信息(前缀与绑定层错误串对齐,见 lib/errors.ts)
  'errors.config': '配置错误',
  'errors.param': '参数错误',
  'errors.serialize': '候选结果序列化失败',
  'errors.unknown': '未知错误',
} as const

export type ZhDict = typeof zh
