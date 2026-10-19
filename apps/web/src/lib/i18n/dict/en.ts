// WB-11.03:英文词典。`satisfies Record<keyof typeof zh, string>` 在编译期锁
// 「与中文词典同一 key 集合」——多 key/少 key/类型非 string 都过不了 tsc;
// 运行时侧由 tests/i18n.test.mjs 再锁一遍(双保险,防 satisfies 被绕过)。
// 占位符 {name} 与中文侧同名同数量。
import { zh } from './zh.ts'

export const en = {
  // 公共控件
  'common.language': 'Language',
  'common.appTitle': 'sandtable · Digital Sandbox',
  'common.confirm': 'Confirm',
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',

  // Shell chrome (WB-11.11): app bar / project explorer / document tabs / status bar
  'common.wordmarkAria': 'Sandtable results analysis',
  'common.appSubtitle': 'Numeric Experiment Workbench',
  'common.projectTitle': 'Project {id}',
  'common.builtinSample': 'Built-in sample',
  'common.projectFile': 'Project file',
  'common.openProject': 'Open project…',
  'common.openProjectHint': 'Open a .sandtable project file or YAML config',
  'common.saveProject': 'Save project',
  'common.saveProjectHint': 'Save project (.sandtable)',
  'common.commandSearchPlaceholder': 'Search params and commands…',
  'common.demoBadge': 'Demo data · kernel not wired',
  'common.explorer': 'Project explorer',
  'common.collapseExplorer': 'Collapse project explorer',
  'common.demoData': 'Built-in sample data',
  'common.unsavedChanges': 'Has unsaved changes',
  'common.baselineReadonly': 'Baseline read-only',
  'common.openDocuments': 'Open documents',
  'common.unsaved': 'Unsaved',
  'common.project': 'Project',
  'common.tasksRunning': 'Tasks running',
  'common.taskQueue': 'Task queue',
  'common.activeTaskTitle': 'Current active job (same source as tasks page and drawer)',
  'common.dataSourceDemo': 'Data: built-in demo results',
  'common.dataSourceReal': 'Data: real runs',
  'common.viewShortcuts': 'View keyboard shortcuts',

  // 导航
  'nav.analysis': 'Analysis',
  'nav.parameters': 'Parameters',
  'nav.designer': 'Experiment Design',
  'nav.runs': 'Runs',
  'nav.exchange': 'Data & Export',
  // nav extras (WB-11.11): rail short labels and document tab titles
  'nav.workspaces': 'Workspaces',
  'nav.shortcuts': 'Shortcuts',
  'nav.short.analysis': 'Analysis',
  'nav.short.parameters': 'Params',
  'nav.short.designer': 'Design',
  'nav.short.runs': 'Runs',
  'nav.short.exchange': 'Data',
  'nav.tab.analysis': 'Attack sweep results',
  'nav.tab.parameters': 'Candidate A',
  'nav.tab.designer': 'Initial attack sweep',
  'nav.tab.runs': 'Task queue',
  'nav.tab.exchange': 'Data exchange',

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

  // 错误信息({detail} = raw kernel message)
  'errors.config': 'Configuration error: {detail}',
  'errors.param': 'Parameter error: {detail}',
  'errors.serialize': 'Failed to serialize candidate results: {detail}',
  'errors.unknown': 'Unknown error: {detail}',
  // 缺词兜底(WB-11.25):正式界面绝不回显翻译 key
  'errors.missingText': '(missing text)',
} satisfies Record<keyof typeof zh, string>
