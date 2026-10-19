// WB-02.04 · 页面路由(纯函数部分):hash 深链 `#/workbench/<page>?k=v`
// 可恢复当前位置——页面 ID + 每页选择状态(候选/参数/主指标)编码进 URL,
// 刷新/新开标签即恢复。组件侧 WorkbenchApp 订阅 hashchange 调用它。
export type PageId = 'analysis' | 'parameters' | 'designer' | 'runs' | 'exchange'

export type PageDef = {
  id: PageId
  label: string
  short: string
  icon: string
  /** 文档标签上的标题(WB-02.03 默认文档) */
  tab: string
}

export const PAGES: readonly PageDef[] = [
  { id: 'analysis', label: '结果分析', short: '分析', icon: 'chart', tab: '攻击力扫描结果' },
  { id: 'parameters', label: '参数编辑', short: '参数', icon: 'table', tab: '候选方案 A' },
  { id: 'designer', label: '实验设计', short: '实验', icon: 'flask', tab: '初始攻击力扫描' },
  { id: 'runs', label: '运行任务', short: '任务', icon: 'terminal', tab: '任务队列' },
  { id: 'exchange', label: '数据与导出', short: '数据', icon: 'exchange', tab: '数据交换' },
]

export const DEFAULT_PAGE: PageId = 'analysis'

export function pageDef(page: PageId): PageDef {
  return PAGES.find((p) => p.id === page) ?? PAGES[0]
}

export const HASH_BASE = '#/workbench/'

export type WorkbenchDeepLink = {
  page: PageId
  /** 各页可用状态键,非法键忽略——深链只恢复"位置",不恢复未保存草稿 */
  selection: Record<string, string>
}

/** 允许进深链的选择键(每页当前位置的白名单,避免把整份草稿塞进 URL)。 */
const SELECTION_KEYS: Record<PageId, readonly string[]> = {
  analysis: ['candidate', 'metric', 'view', 'filter', 'sort', 'inspector'],
  parameters: ['param', 'group', 'search'],
  designer: ['method'],
  runs: ['drawer'],
  exchange: [],
}

export function parseHash(hash: string): WorkbenchDeepLink | null {
  if (!hash.startsWith(HASH_BASE)) return null
  const rest = hash.slice(HASH_BASE.length)
  const [pagePath, query = ''] = rest.split('?')
  const page = PAGES.find((p) => p.id === pagePath)?.id
  if (!page) return null
  const allowed = SELECTION_KEYS[page]
  const selection: Record<string, string> = {}
  for (const pair of query.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const key = eq === -1 ? pair : pair.slice(0, eq)
    const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1))
    if (allowed.includes(key) && value !== '') selection[key] = value
  }
  return { page, selection }
}

export function formatHash(deepLink: WorkbenchDeepLink): string {
  const allowed = SELECTION_KEYS[deepLink.page]
  const query = Object.keys(deepLink.selection)
    .filter((k) => allowed.includes(k) && deepLink.selection[k] !== '')
    .map((k) => `${k}=${encodeURIComponent(deepLink.selection[k])}`)
    .join('&')
  return HASH_BASE + deepLink.page + (query === '' ? '' : `?${query}`)
}
