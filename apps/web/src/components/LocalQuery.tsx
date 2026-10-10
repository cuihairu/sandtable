// 本地结果文件分析(桌面独有):dialog 选 CSV / Parquet → 桌面壳 query 命令
// (duckdb-rs,与 CLI query 同源)按文件名词根只读注册视图 → SQL 分析,
// 复用 QueryPanel 的表格 / 折线渲染。与会话内查询面板分工:那边是
// duckdb-wasm 内存表(前端仿真产物),这边读本机磁盘产物——万级行大文件
// 不经前端内存,正是桌面定位(文档 09 章边界)。
import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import QueryPanel from './QueryPanel'
import { queryLocal } from '../lib/wasm'
import type { QueryColumn } from '../lib/duck'

// native 查询单元格是显示文本;能安全转数字的转数字,折线选择与千分位
// 渲染才有数可用(非数值列保持文本)
function toColumns(columns: string[], rows: string[][]): QueryColumn[] {
  return columns.map((name, i) => ({
    name,
    values: rows.map((row) => {
      const s = row[i] ?? ''
      if (s === '') return s
      const n = Number(s)
      return Number.isFinite(n) ? n : s
    }),
  }))
}

export default function LocalQuery() {
  const [paths, setPaths] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  async function pick() {
    setError(null)
    try {
      const files = await open({
        multiple: true,
        filters: [{ name: '结果数据', extensions: ['csv', 'parquet'] }],
      })
      if (!files) return
      setPaths(Array.isArray(files) ? files : [files])
    } catch (e) {
      setError(String(e))
    }
  }

  // 视图名 = 文件名词根(native query 的注册规则)
  const views = paths.map(
    (p) => p.split(/[\\/]/).pop()?.replace(/\.[^.]*$/, '') ?? p,
  )

  return (
    <>
      <QueryPanel
        loader={
          <button onClick={pick}>选择结果文件(CSV / Parquet)</button>
        }
        hint="文件名词根注册为视图;只读打开,不改写产物"
        initialSql="SELECT * FROM summary LIMIT 50"
        run={async (sql) => {
          const r = await queryLocal(paths, sql)
          return toColumns(r.columns, r.rows)
        }}
      />
      {views.length > 0 && (
        <p className="note" style={{ margin: '8px 0' }}>
          已选 {views.length} 个文件,视图:{views.join(', ')}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </>
  )
}
