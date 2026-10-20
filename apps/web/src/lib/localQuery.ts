// WB-02.18 · 本地文件查询(桌面独有)的纯逻辑面:路径 → 视图名、路径清单
// 合并、native 查询结果列整形。注册规则与桌面壳 query 命令(duckdb-rs,
// 与 CLI query 同源)对齐:视图名 = 文件名词根。查询结果单元格是显示
// 文本——能安全转数字的转数字(折线选择与千分位渲染才有数可用),非数值
// 列保持文本。万级行大文件在 native 侧聚合,前端只拿查询结果,不经内存。
import type { LocalQueryResult } from './types.ts'
import type { QueryColumn } from './columns.ts'

/** 视图名 = 文件名词根(接受 / 与 \ 分隔;去扩展名,无扩展名原样) */
export function viewNameOf(path: string): string {
  const stem = path.split(/[\\/]/).pop() ?? path
  return stem.replace(/\.[^.]*$/, '')
}

/** 追加一条路径:trim、去空、去重(顺序稳定;手输与原生对话框可混用) */
export function mergePath(paths: readonly string[], p: string): readonly string[] {
  const t = p.trim()
  if (!t || paths.includes(t)) return paths
  return [...paths, t]
}

/** native 查询结果 → 查询列(空串保持空;数字可转则转,其余保持文本) */
export function columnsFromLocal(r: LocalQueryResult): QueryColumn[] {
  return r.columns.map((name, i) => ({
    name,
    values: r.rows.map((row) => {
      const s = row[i] ?? ''
      if (s === '') return s
      const n = Number(s)
      return Number.isFinite(n) ? n : s
    }),
  }))
}
