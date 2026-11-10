// 本地文件查询(仅桌面)的 native 命令入口:桌面壳 query 命令(duckdb-rs,与
// CLI query 同源)只读打开本机路径。会话内按天数据走 duckdb-wasm 内存表;CLI /
// 桌面产物在磁盘上,浏览器拿不到本机路径。纯逻辑整形在 localQuery.ts,
// 绑定接线纪律(只允许经本入口 + kernel 服务层)见 tests/contracts.test.mjs。
import { invoke } from '@tauri-apps/api/core'
import type { LocalQueryResult } from './types'
import { isDesktop } from './kernel'

export async function queryLocal(
  inputs: string[],
  sql: string,
): Promise<LocalQueryResult> {
  if (!isDesktop) throw new Error('本地文件查询仅在桌面端可用')
  return invoke('query', { inputs, sql })
}
