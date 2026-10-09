// 参数扫描面板(文档 12/14/15 章):实验 YAML → 候选逐个本地运行
// (JS 驱动、候选间让出主线程,进度可渲染;网格笛卡尔积或 Random 采样,
// 同源 core::sweep SweepMode)→ 候选 × 指标表 + 单轴图
// (网格折线 / 采样散点(Random / LHS),CI 须、判定着色、推荐带)
// + 两轴联合可行域矩阵(SweepMatrix,三色判定)+ 敏感性矩阵与推荐块。
// 与 CLI sweep / recommend 同源(core 纯函数);预算门在 sandtable-wasm
// (MAX_SWEEP_SIMS / MAX_SWEEP_SIM_SCALE)。
import { useState } from 'react'
import SweepChart from './SweepChart'
import SweepMatrix from './SweepMatrix'
import { SWEEP_PRESETS } from '../lib/presets'
import { planSweep, recommendSweep, runSweepCandidate } from '../lib/wasm'
import type {
  CandidateResult,
  ConstraintVerdict,
  SweepPlan,
  SweepRecOutput,
} from '../lib/types'

const VERDICT_LABEL: Record<ConstraintVerdict, string> = {
  pass: 'PASS',
  borderline: 'BORDER',
  fail: 'FAIL',
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export default function SweepPanel() {
  const [yaml, setYaml] = useState(SWEEP_PRESETS[0].yaml)
  const [override, setOverride] = useState(0) // 0 = 跟随配置
  const [plan, setPlan] = useState<SweepPlan | null>(null)
  const [results, setResults] = useState<CandidateResult[]>([])
  const [rec, setRec] = useState<SweepRecOutput | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    setPlan(null)
    setResults([])
    setRec(null)
    try {
      const p = await planSweep(yaml, override)
      setPlan(p)
      const rs: CandidateResult[] = []
      for (let i = 0; i < p.candidates.length; i++) {
        setProgress(`候选 ${i + 1}/${p.candidates.length} · 共 ${p.sims} 次仿真`)
        await new Promise((r) => setTimeout(r, 0)) // 让出主线程,进度可渲染
        rs.push(await runSweepCandidate(yaml, p.replicates, p.candidates[i]))
        setResults([...rs])
      }
      setProgress('')
      // MVP 红线(文档 15 章):推荐仅单参数轴;多轴只出表不出带
      if (p.axes.length === 1) {
        setRec(await recommendSweep(yaml, rs))
      }
    } catch (e) {
      setError(String(e))
      setPlan(null)
      setResults([])
      setRec(null)
      setProgress('')
    } finally {
      setBusy(false)
    }
  }

  const axis = plan?.axes[0]
  const targetMetrics = plan?.targets.map((t) => t.metric) ?? []
  const chartMetric = targetMetrics[0]

  const chartData = (() => {
    if (!plan || !axis || !chartMetric || results.length < 2) return null
    const rows = results
      .filter((r) => r.status === 'ok')
      .map((r) => ({
        x: r.values[axis.path],
        outcome: r.target_outcomes.find((o) => o.metric === chartMetric),
      }))
      .filter((r) => r.outcome)
      .sort((a, b) => a.x - b.x)
    if (rows.length < 2) return null
    return {
      xs: rows.map((r) => r.x),
      means: rows.map((r) => r.outcome!.stats.mean),
      los: rows.map((r) => r.outcome!.stats.ci95_lo),
      his: rows.map((r) => r.outcome!.stats.ci95_hi),
      verdicts: rows.map((r) => r.outcome!.verdict),
    }
  })()

  return (
    <details>
      <summary>参数扫描(网格 / Random + 推荐带)</summary>
      <div className="panel">
        <div className="toolbar">
          <button className="primary" disabled={busy} onClick={run}>
            {busy ? '扫描中…' : '运行扫描'}
          </button>
          <label className="reps">
            replicates
            <select
              value={override}
              onChange={(e) => setOverride(Number(e.target.value))}
            >
              <option value={0}>跟随配置</option>
              {[1, 2, 4, 8].map((r) => (
                <option key={r} value={r}>
                  {r}(粗筛)
                </option>
              ))}
            </select>
          </label>
          <label className="reps">
            预设
            <select
              value={SWEEP_PRESETS.find((p) => p.yaml === yaml)?.name ?? ''}
              onChange={(e) => {
                const p = SWEEP_PRESETS.find((x) => x.name === e.target.value)
                if (p) setYaml(p.yaml)
              }}
            >
              {SWEEP_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
              {!SWEEP_PRESETS.some((p) => p.yaml === yaml) && (
                <option value="">自定义</option>
              )}
            </select>
          </label>
          {progress && <span className="note">{progress}</span>}
          <span className="note">
            实验文件 = scenario + model + sweep 三节(文档 12 章);候选串行本地执行
          </span>
        </div>
        <textarea
          value={yaml}
          onChange={(e) => setYaml(e.target.value)}
          rows={16}
          spellCheck={false}
          aria-label="扫描实验 YAML"
        />
        {error && <p className="error">{error}</p>}
      </div>

      {plan && (
        <div className="panel">
          <p className="hash">
            {plan.candidates.length} 候选 × {plan.replicates} replicates(mode{' '}
            {plan.mode},共 {plan.sims} 次仿真)· players {plan.players} × days{' '}
            {plan.days} · config_hash {plan.config_hash.slice(0, 16)}…
          </p>
          <table>
            <thead>
              <tr>
                <th>{axis ? axis.path.split('.').pop() : '候选'}</th>
                {plan.targets.map((t) => (
                  <th key={t.metric}>
                    {t.metric}
                    <br />
                    <span className="note">
                      目标 [{t.min ?? '−∞'}, {t.max ?? '+∞'}]
                    </span>
                  </th>
                ))}
                {plan.targets.length === 0 && <th>指标(mean ± CI95)</th>}
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>
                    {axis
                      ? r.values[axis.path]
                      : Object.values(r.values).join(' / ')}
                  </td>
                  {r.status !== 'ok' ? (
                    <td colSpan={Math.max(plan.targets.length, 1)} className="error">
                      配置错误:{r.status.config_error}
                    </td>
                  ) : plan.targets.length > 0 ? (
                    r.target_outcomes.map((o) => (
                      <td key={o.metric}>
                        {o.stats.mean.toFixed(4)} ± {(o.stats.ci95_hi - o.stats.mean).toFixed(4)}{' '}
                        <span className={`chip chip-${o.verdict}`}>
                          {VERDICT_LABEL[o.verdict]}
                        </span>
                      </td>
                    ))
                  ) : (
                    <td>
                      {r.metric_stats
                        .map(([m, s]) => `${m} ${s.mean.toFixed(3)}`)
                        .join(' · ')}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          {plan.axes.length === 2 && results.length > 0 && plan.targets.length > 0 && (
            <>
              <h3>联合可行域(两轴 × 目标判定)</h3>
              {plan.targets.map((t) => (
                <SweepMatrix
                  key={t.metric}
                  yPath={plan.axes[0].path}
                  xPath={plan.axes[1].path}
                  metric={t.metric}
                  results={results}
                />
              ))}
              <p className="note">
                格 = 判定;· = 未采样(Random 稀疏覆盖)。单轴推荐带(文档 15 章)不适用于两轴。
              </p>
            </>
          )}
          {plan.axes.length > 2 && (
            <p className="note">
              多参数轴(≥3):仅列候选表;单轴推荐带(文档 15 章)不适用。
            </p>
          )}

          {chartData && rec && (
            <>
              <SweepChart
                title={`${chartMetric} vs ${axis!.path.split('.').pop()}(CI95 须,绿带 = 推荐区间${plan.mode !== 'grid' ? `,${plan.mode === 'latin_hypercube' ? 'LHS' : 'Random'} 散点` : ''})`}
                xs={chartData.xs}
                means={chartData.means}
                los={chartData.los}
                his={chartData.his}
                verdicts={chartData.verdicts}
                band={rec.recommendation.interval}
                baseline={rec.recommendation.baseline}
                scatter={plan.mode !== 'grid'}
              />
              <div className="rec">
                <strong>推荐区间</strong>{' '}
                {rec.recommendation.interval ? (
                  <>
                    [{rec.recommendation.interval[0]}, {rec.recommendation.interval[1]}]
                    {rec.recommendation.interpolated[0] && <sup>↓插值</sup>}
                    {rec.recommendation.interpolated[1] && <sup>↑插值</sup>}{' '}
                    <span className="note">
                      (候选是离散点,端点由相邻可行段边界插值)
                    </span>
                  </>
                ) : (
                  '无可行区间(hard 约束无 PASS 点或交集为空)'
                )}
                {' · '}Confidence{' '}
                {CONFIDENCE_LABEL[rec.recommendation.confidence] ?? rec.recommendation.confidence}
                <ul>
                  {rec.recommendation.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>

              <h3>敏感性(OAT 弹性,{axis!.path})</h3>
              <table>
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>E</th>
                    <th>CI95</th>
                    <th>δ_eff</th>
                    <th>判定</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.elasticities.map((e) => (
                    <tr key={e.metric}>
                      <td>{e.metric}</td>
                      {e.note === 'ok' ? (
                        <>
                          <td>{e.e >= 0 ? '+' : ''}{e.e.toFixed(3)}</td>
                          <td>
                            [{e.e_lo.toFixed(3)}, {e.e_hi.toFixed(3)}]
                          </td>
                          <td>{e.delta_eff.toFixed(3)}</td>
                          <td>{e.significant ? '显著' : '不显著(区间跨零)'}</td>
                        </>
                      ) : (
                        <td colSpan={4}>不可算({e.note})</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </details>
  )
}
