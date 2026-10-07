// DuckDB-Wasm 本地分析(文档 09/22 章):仿真产物进内存表,SQL 本地执行。
// 零外链:worker 与 wasm 都经 vite `?url` 本地打包,不经 CDN。
import { AsyncDuckDB, ConsoleLogger } from '@duckdb/duckdb-wasm'
import duckdb_mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url'
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url'
import type { DayStat } from './types'

let db: AsyncDuckDB | null = null
let connPromise: Promise<import('@duckdb/duckdb-wasm').AsyncDuckDBConnection> | null = null
let loadedHash: string | null = null

async function getConn() {
  if (!db) {
    const worker = new Worker(new URL(duckdb_mvp_worker, import.meta.url), { type: 'module' })
    db = new AsyncDuckDB(new ConsoleLogger(), worker)
    await db.instantiate(new URL(duckdb_wasm, import.meta.url).href)
  }
  connPromise ??= db.connect()
  return connPromise
}

export type QueryColumn = { name: string; values: (string | number | null)[] }

function toColumns(table: {
  schema: { fields: { name: string }[] }
  getChild: (name: string) => { toArray: () => unknown[] } | null
}): QueryColumn[] {
  return table.schema.fields.map((f) => ({
    name: f.name,
    values: (table.getChild(f.name)?.toArray() ?? []) as (string | number | null)[],
  }))
}

/** 把最近一次仿真的按天数据装进内存表 days(重复调用按 config_hash 幂等)。 */
export async function loadDayStats(hash: string, rows: DayStat[]): Promise<void> {
  if (loadedHash === hash) return
  const conn = await getConn()
  await conn.query('DROP TABLE IF EXISTS days')
  // read_json_auto 走注册的虚拟文件(json 扩展静态内置于 mvp wasm)
  const name = `days-${hash.slice(0, 8)}.json`
  const buf = new TextEncoder().encode(JSON.stringify(rows))
  await db!.registerFileBuffer(name, buf)
  await conn.query(
    `CREATE TABLE days AS SELECT * FROM read_json_auto('${name}')`,
  )
  await db!.dropFile(name)
  loadedHash = hash
}

/** 执行只读 SQL,返回列式结果(行数上限由调用方裁剪)。 */
export async function runQuery(sql: string): Promise<QueryColumn[]> {
  const conn = await getConn()
  const result = await conn.query(sql)
  return toColumns(result)
}
