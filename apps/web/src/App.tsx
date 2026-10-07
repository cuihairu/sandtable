// sandtable Web 端(文档 18 章 Phase 6):本地跑小中型仿真,零安装零上传。
// 配置在浏览器编辑,WASM 内核本地执行,结果只在内存里出图。
import { useMemo, useState } from 'react'
import LineChart from './components/LineChart'
import QueryPanel from './components/QueryPanel'
import SweepPanel from './components/SweepPanel'
import { loadDayStats, runQuery } from './lib/duck'
import { PRESETS } from './lib/presets'
import type { RunMetrics, SimOutput } from './lib/types'
import { runSimulation } from './lib/wasm'

function pct(v: number): string {
  return `${(v * 100).toFixed(2)}%`
}

// 结果导出(文档 09 章契约):文件名与列结构与 CLI simulate --out 产物一致,
// 下载后 sandtable report / query 可直接继续分析
function download(text: string, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function dayMetric(m: RunMetrics, key: 'active' | 'win_rate' | 'gold_supply' | 'levelups' | 'churn_rate'): number[] {
  return m.day_stats.map((d) => d[key])
}

export default function App() {
  const [yaml, setYaml] = useState(PRESETS[0].yaml)
  const [replicates, setReplicates] = useState(2)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [out, setOut] = useState<SimOutput | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      setOut(await runSimulation(yaml, replicates))
    } catch (e) {
      setError(String(e))
      setOut(null)
    } finally {
      setBusy(false)
    }
  }

  const mean = useMemo(() => {
    if (!out) return null
    const rs = out.results
    const avg = (f: (m: RunMetrics) => number) => rs.reduce((s, m) => s + f(m), 0) / rs.length
    return {
      d3: avg((m) => {
        const d3 = m.day_stats.find((d) => d.day === 3)
        return d3 ? d3.active / m.day1_cohort : 0
      }),
      d7: avg((m) => {
        const d7 = m.day_stats.find((d) => d.day === 7)
        return d7 ? d7.active / m.day1_cohort : 0
      }),
      winRate: avg((m) => {
        const last = m.day_stats[m.day_stats.length - 1]
        return last ? last.win_rate : 0
      }),
      gold: avg((m) => m.cohort_stats.reduce((s, c) => s + c.mean_gold * c.count, 0) / m.day1_cohort),
      powerP50: avg((m) => m.cohort_stats.reduce((s, c) => s + c.mean_power * c.count, 0) / m.day1_cohort),
      churn: avg((m) => m.churn_rate_total),
    }
  }, [out])

  const days = out?.results[0]?.day_stats.map((d) => d.day) ?? []

  return (
    <main>
      <h1>
        sandtable <span className="sub">配置驱动的游戏系统数字沙盘 · 本地运行,数据不出浏览器</span>
      </h1>

      <section className="panel">
        <div className="toolbar">
          {PRESETS.map((p) => (
            <button key={p.name} onClick={() => setYaml(p.yaml)}>
              {p.name}
            </button>
          ))}
          <label className="file-btn">
            导入配置文件
            <input
              type="file"
              accept=".yaml,.yml,.txt,text/yaml"
              onChange={async (e) => {
                const f = e.target.files?.[0]
                if (!f) return
                setYaml(await f.text())
                setError(null)
                setOut(null)
                e.target.value = ''
              }}
            />
          </label>
          <label className="reps">
            replicates
            <select value={replicates} onChange={(e) => setReplicates(Number(e.target.value))}>
              {[1, 2, 4, 8].map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={busy} onClick={run}>
            {busy ? '运行中…' : '运行仿真'}
          </button>
        </div>
        <textarea
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          rows={14}
          spellCheck={false}
          aria-label="仿真配置 YAML"
        />
        {error && <p className="error">{error}</p>}
      </section>

      {out && mean && (
        <>
          <section className="panel">
            <h2>KPI({replicates} 个 replicate 均值)</h2>
            <div className="kpis">
              {(
                [
                  ['D3 留存', pct(mean.d3)],
                  ['D7 留存', pct(mean.d7)],
                  ['日胜率(D 末)', pct(mean.winRate)],
                  ['总流失率', pct(mean.churn)],
                  ['人均金币', mean.gold.toFixed(0)],
                  ['人均战力', mean.powerP50.toFixed(0)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="kpi">
                  <div className="kpi-label">{label}</div>
                  <div className="kpi-value">{value}</div>
                </div>
              ))}
            </div>
            <p className="hash">config_hash = {out.config_hash}</p>
            <div className="export">
              <button onClick={() => download(out.days_csv, 'days.csv', 'text/csv')}>
                下载 days.csv(replicate 1)
              </button>
              <button
                onClick={() =>
                  download(
                    JSON.stringify(
                      {
                        meta: {
                          // 环境字段(文档 22 绑定纪律):时间戳取导出时刻,
                          // git_sha 由构建注入(VITE_GIT_SHA),未注入回退 unknown(与 CLI 同)
                          generated_at_unix: Math.floor(Date.now() / 1000),
                          git_sha: import.meta.env.VITE_GIT_SHA ?? 'unknown',
                          schema_version: out.meta.schema_version,
                          model_version: out.meta.model_version,
                        },
                        results: out.results,
                      },
                      null,
                      2,
                    ),
                    'report.json',
                    'application/json',
                  )
                }
              >
                下载 report.json
              </button>
              <span className="note">
                与 CLI simulate --out 产物同构,下载后 sandtable report / query 可继续分析
              </span>
            </div>
          </section>

          <section className="panel">
            <h2>按天曲线</h2>
            <div className="charts">
              <LineChart title="日活跃" xs={days} ys={dayMetric(out.results[0], 'active')} />
              <LineChart title="日胜率" xs={days} ys={dayMetric(out.results[0], 'win_rate')} fmt={pct} />
              <LineChart title="金币存量" xs={days} ys={dayMetric(out.results[0], 'gold_supply')} />
              <LineChart title="升级次数" xs={days} ys={dayMetric(out.results[0], 'levelups')} />
            </div>
          </section>

          <section className="panel">
            <h2>分群(replicate 1)</h2>
            <table>
              <thead>
                <tr>
                  <th>分群</th>
                  <th>人数</th>
                  <th>流失</th>
                  <th>均等级</th>
                  <th>均金币</th>
                  <th>均战力</th>
                </tr>
              </thead>
              <tbody>
                {out.results[0].cohort_stats.map((c) => (
                  <tr key={c.cohort}>
                    <td>{c.cohort}</td>
                    <td>{c.count}</td>
                    <td>{c.churned}</td>
                    <td>{c.mean_level.toFixed(1)}</td>
                    <td>{c.mean_gold.toFixed(0)}</td>
                    <td>{c.mean_power.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="panel">
            <h2>SQL 查询(DuckDB 本地,表 days = replicate 1 按天数据)</h2>
            <QueryPanel
              run={async (sql) => {
                await loadDayStats(out.config_hash, out.results[0].day_stats)
                return runQuery(sql)
              }}
            />
          </section>
        </>
      )}

      <SweepPanel />

      <footer>
        <span>
          边界:Web 只承诺小中型仿真(WASM 单线程、内存 4GB 上限);万级玩家大型 sweep 走 CLI / 桌面。
        </span>
      </footer>
    </main>
  )
}
