// SQL 查询面板(DuckDB-Wasm):查询结果表 + 选中数值列画折线
import { useMemo, useState } from 'react'
import LineChart from './LineChart'
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
