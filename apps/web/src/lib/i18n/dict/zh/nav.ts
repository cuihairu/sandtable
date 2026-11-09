// 中文词典·导航域(前缀 nav.)。真值源分片,入口见 ../zh.ts(WB-11.04)。
export const nav = {
  // 导航(五个工作区,与 routing.ts 对齐)
  'nav.analysis': '结果分析',
  'nav.parameters': '参数编辑',
  'nav.designer': '实验设计',
  'nav.runs': '运行任务',
  'nav.exchange': '数据与导出',
  // nav 增补(WB-11.11):功能轨短标签、文档标签标题
  'nav.workspaces': '功能工作区',
  'nav.workspace': '当前工作区',
  'nav.shortcuts': '快捷键',
  'nav.short.analysis': '分析',
  'nav.short.parameters': '参数',
  'nav.short.designer': '实验',
  'nav.short.runs': '任务',
  'nav.short.exchange': '数据',
  'nav.tab.analysis': '攻击力扫描结果',
  'nav.tab.parameters': '候选方案 A',
  'nav.tab.designer': '初始攻击力扫描',
  'nav.tab.runs': '任务队列',
  'nav.tab.exchange': '数据交换',
  // WB-11.11 · 资源树演示数据侧文案:分组名/演示文档名/描述行走词典
  // (文件名候选汇总.csv / 实验快照.json 与 registry / defaults 是数据本体,保持原文)
  'nav.explorer.config': '模型与配置',
  'nav.explorer.experiments': '实验',
  'nav.explorer.results': '结果集',
  'nav.explorer.exchange': '数据交换',
  'nav.explorer.baseline': '基础参数表',
  'nav.explorer.scenario': '实验配置',
  'nav.explorer.metaChanges.one': '{n} 项参数变更',
  'nav.explorer.metaChanges.other': '{n} 项参数变更',
  'nav.explorer.metaSameAsBaseline': '与基线一致',
  'nav.explorer.metaScenario': '{days} 天 · {players} 玩家',
  'nav.explorer.metaSweepMode': 'Grid · 单参数',
  'nav.explorer.metaResults': '{candidates} 候选 · {replicates} replicates',
} as const
