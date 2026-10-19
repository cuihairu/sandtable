// WB-11.03:英文词典。`satisfies Record<keyof typeof zh, string>` 在编译期锁
// 「与中文词典同一 key 集合」——多 key/少 key/类型非 string 都过不了 tsc;
// 运行时侧由 tests/i18n.test.mjs 再锁一遍(双保险,防 satisfies 被绕过)。
// 占位符 {name} 与中文侧同名同数量。
import { zh } from './zh.ts'

export const en = {
  // 公共控件
  'common.language': 'Language',
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',

  // 导航
  'nav.analysis': 'Analysis',
  'nav.parameters': 'Parameters',
  'nav.designer': 'Experiment Design',
  'nav.runs': 'Runs',
  'nav.exchange': 'Data & Export',

  // 参数
  'params.search': 'Search parameters',
  'params.baseline': 'Baseline',
  'params.candidate': 'Candidate',
  'params.changed': '{n} modified',

  // 实验
  'experiment.method': 'Sweep method',
  'experiment.method.grid': 'Grid',
  'experiment.method.random': 'Random',
  'experiment.method.lhs': 'Latin hypercube',
  'experiment.replicates': 'Replicates',

  // 分析
  'analysis.candidateTable': 'Candidate results',
  'analysis.selection': 'Selection',
  'analysis.baseline': 'Baseline',

  // 任务
  'tasks.queued': 'Queued',
  'tasks.running': 'Running',
  'tasks.succeeded': 'Succeeded',
  'tasks.failed': 'Failed',
  'tasks.cancelled': 'Cancelled',
  // 计数复数形:en 有 one/other 之分,形句整体重写而非在句子里拼词
  'tasks.remaining.one': '{n} task remaining',
  'tasks.remaining.other': '{n} tasks remaining',

  // 数据与导出
  'data.export': 'Export',
  'data.export.csv': 'Export CSV',
  'data.export.json': 'Export JSON',
  'data.export.svg': 'Export SVG',
  'data.rowsExported.one': '{n} row exported as {where}',
  'data.rowsExported.other': '{n} rows exported as {where}',

  // 错误信息
  'errors.config': 'Configuration error',
  'errors.param': 'Parameter error',
  'errors.serialize': 'Failed to serialize candidate results',
  'errors.unknown': 'Unknown error',
} satisfies Record<keyof typeof zh, string>
