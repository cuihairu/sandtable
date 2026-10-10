// SQL 查询面板(DuckDB-Wasm):查询结果表 + 选中数值列画折线;
// 可载入项目文件(.sandtable,解包校验同 CLI project check)或散装 CSV,
// CSV 产物注册为 DuckDB 表后直接 SQL(文档 22 章)。
import { useMemo, useState } from 'react'
import LineChart from './LineChart'
import { loadProjectCsvs } from '../lib/duck'
import { unpackProject } from '../lib/project'
import type { QueryColumn } from '../lib/duck'

const MAX_ROWS = 100

export default function QueryPanel({
  run,
}: {
  run: (sql: string) => Promise<QueryColumn[]>
}) {
  const [sql, setSql] = useState(
    'SELECT day, active, win_rate, gold_supply FROM days ORDER BY day',
  )
  const [cols, setCols] = useState<QueryColumn[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plotCol, setPlotCol] = useState<string | null>(null)
  const [loaded, setLoaded] = useState<string | null>(null)

  async function loadFile(f: File) {
    setBusy(true)
    setError(null)
    try {
      const bytes = new Uint8Array(await f.arrayBuffer())
      if (f.name.toLowerCase().endsWith('.csv') || f.name.toLowerCase().endsWith('.parquet')) {
        const tables = await loadProjectCsvs([{ name: f.name, bytes }])
        setLoaded(
          tables.length > 0
            ? `已载入表:${tables.join(', ')}(旧项目表已清)`
            : '没有可载入的 CSV',
        )
        return
      }
      const proj = await unpackProject(bytes)
      const csvs = proj.entries
        .filter(
          (e) =>
            e.kind === 'result' &&
            (e.path.endsWith('.csv') || e.path.endsWith('.parquet')),
        )
        .map((e) => ({ name: e.path, bytes: proj.files.get(e.path)! }))
      const tables = await loadProjectCsvs(csvs)
      setLoaded(
        tables.length > 0
          ? `${proj.name}:CSV 产物已载入表 ${tables.join(', ')}`
          : `${proj.name}:归档有效,但无 CSV 产物(配置复现走顶部「导入配置文件」)`,
      )
    } catch (e) {
      setError(String(e))
      setLoaded(null)
    } finally {
      setBusy(false)
    }
  }

  async function exec() {
    setBusy(true)
    setError(null)
    try {
      const result = await run(sql)
      setCols(result)
      const numeric = result.find((c) => c.values.some((v) => typeof v === 'number'))
      setPlotCol(
        result.some((c) => c.name === 'day') && numeric ? numeric.name : null,
      )
    } catch (e) {
      setError(String(e))
      setCols(null)
    } finally {
      setBusy(false)
    }
  }

  const rows = useMemo(() => {
    if (!cols || cols.length === 0) return []
    const n = Math.min(cols[0].values.length, MAX_ROWS)
    return Array.from({ length: n }, (_, i) =>
      cols.map((c) => c.values[i]),
    )
  }, [cols])

  const plot = useMemo(() => {
    if (!cols || !plotCol) return null
    const x = cols.find((c) => c.name === 'day')
    const y = cols.find((c) => c.name === plotCol)
    if (!x || !y) return null
    return {
      xs: x.values.map(Number),
      ys: y.values.map((v) => (typeof v === 'number' ? v : Number(v))),
    }
  }, [cols, plotCol])

  const numericCols = cols?.filter((c) => c.values.some((v) => typeof v === 'number')) ?? []

  return (
    <div>
      <div className="sql-row">
        <textarea
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          rows={3}
          spellCheck={false}
          aria-label="SQL 查询"
        />
        <button className="primary" disabled={busy} onClick={exec}>
          {busy ? '查询中…' : '查询'}
        </button>
      </div>
      <div className="toolbar" style={{ margin: '8px 0' }}>
        <label className="reps">
          载入项目 / CSV
          <input
            type="file"
            accept=".sandtable,.csv"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void loadFile(f)
              e.target.value = ''
            }}
          />
        </label>
        <span className="note">
          .sandtable 解包校验同 CLI project check;CSV 产物进 DuckDB 表
        </span>
        {loaded && <span className="note">{loaded}</span>}
      </div>
      {error && <p className="error">{error}</p>}
      {cols && (
        <>
          <table>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th key={c.name}>{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {r.map((v, j) => (
                    <td key={j}>{typeof v === 'number' ? v.toLocaleString() : (v ?? 'NULL')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {cols[0] && cols[0].values.length > MAX_ROWS && (
            <p className="hash">仅显示前 {MAX_ROWS} 行(共 {cols[0].values.length} 行)</p>
          )}
          {numericCols.length > 0 && cols.some((c) => c.name === 'day') && (
            <div className="reps" style={{ margin: '10px 0' }}>
              画折线
              <select
                value={plotCol ?? ''}
                onChange={(e) => setPlotCol(e.target.value || null)}
              >
                <option value="">不画</option>
                {numericCols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {plot && (
            <LineChart title={`${plotCol} · by day`} xs={plot.xs} ys={plot.ys} />
          )}
        </>
      )}
    </div>
  )
}
