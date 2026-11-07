import type { JSX } from 'react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { abCompare, kpiEval, runSimulation } from '../../lib/wasm.ts'
import type { Comparison, MetricKey } from '../../lib/types.ts'
import { localizeWasmErrorText } from '../../lib/i18n/errorText.ts'
import { histogramBins, pairedDiff, PREVIEW_METRICS } from './livePreview.ts'
import { useDebouncedValue } from './useDebouncedValue.ts'
import { getState, paramYamlView, subscribe } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import { useLocale } from '../state/localeStore.ts'

// 参数候选的实时预览(ST-WB-011):候选 YAML 防抖 400ms 后直接跑 WASM 核
// (瞬时预览,刻意不走 runManager——不持久、不可取消,reps 小、防抖防逐键)。
// 纪律红线:统计结论只出自内核——双臂 CI/配对差 CI/verdict 全部来自
// abCompare 的 Comparison;直方图与配对差散点只画 kpi_eval 回传的逐
// replicate 值,前端不重算均值/CI/显著性。

type PreviewOut = {
  basePerReplicate: (number | null)[]
  candPerReplicate: (number | null)[]
  comparison: Comparison
}

type DoneState = { key: string; out: PreviewOut | null; error: string | null } | null

const PREVIEW_REPS = [4, 8, 16] as const

// useSyncExternalStore 的 getSnapshot 必须返回缓存值(workbenchStore 每次状
// 态变更整体替换 state 对象,身份不变即视图不变,这里按 state 身份做缓存)。
let lastState: WorkbenchState | null = null
let lastView: { base: string; cand: string; scenarioPath: string | null } | null = null
function yamlSnapshot(): { base: string; cand: string; scenarioPath: string | null } {
  const state = getState()
  if (state !== lastState) {
    lastState = state
    lastView = paramYamlView(state)
  }
  return lastView!
}

const nonNull = (values: readonly (number | null)[]): number[] =>
  values.filter((value): value is number => value !== null)

export function LivePreviewPanel(): JSX.Element {
  const locale = useLocale()
  const en = locale.startsWith('en')
  const view = useSyncExternalStore(subscribe, yamlSnapshot)
  const [metric, setMetric] = useState<MetricKey>('win_rate')
  const [reps, setReps] = useState<number>(8)
  const [nonce, setNonce] = useState(0)
  const debouncedCand = useDebouncedValue(view.cand, 400)
  const [done, setDone] = useState<DoneState>(null)

  const ready = view.base !== '' && debouncedCand !== ''
  const trigger = `${nonce}|${view.base}|${debouncedCand}|${metric}|${reps}`
  const fresh = done !== null && done.key === trigger
  const out = fresh ? done.out : null
  const error = fresh ? done.error : null
  const loading = ready && !fresh

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    const baseYaml = view.base
    const candYaml = debouncedCand
    void (async () => {
      try {
        const [baseOut, candOut] = await Promise.all([
          runSimulation(baseYaml, reps),
          runSimulation(candYaml, reps),
        ])
        // kpi_eval:内核逐 replicate 值(缺席记 null,不填 0);表达式 = 指标名。
        const baseKpi = await kpiEval(metric, baseOut.results)
        const candKpi = await kpiEval(metric, candOut.results)
        const comparison = await abCompare(baseYaml, candYaml, metric, baseOut.results, candOut.results)
        if (!cancelled) {
          setDone({
            key: trigger, error: null,
            out: { basePerReplicate: baseKpi.per_replicate, candPerReplicate: candKpi.per_replicate, comparison },
          })
        }
      } catch (e) {
        if (!cancelled) setDone({ key: trigger, out: null, error: String(e) })
      }
    })()
    return () => { cancelled = true }
  }, [ready, trigger, view.base, debouncedCand, metric, reps])

  const meta = PREVIEW_METRICS.find((row) => row.key === metric) ?? PREVIEW_METRICS[0]

  return (
    <section className="form-section live-preview" data-testid="live-preview" aria-label={en ? 'Live preview (baseline vs candidate)' : '实时预览(基线 vs 候选)'}>
      <div className="form-section-heading">
        <h2>{en ? 'Live preview' : '实时预览'}</h2>
        <span className="badge amber">{en ? 'Transient · not persisted · kernel stats only' : '瞬时预览 · 不落盘 · 统计只出自内核'}</span>
      </div>
      <div className="live-controls">
        <label>
          {en ? 'Metric' : '指标'}
          <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)} data-testid="live-metric">
            {PREVIEW_METRICS.map((row) => <option key={row.key} value={row.key}>{row.label}</option>)}
          </select>
        </label>
        <label>
          {en ? 'Replicates' : '重复次数'}
          <select value={reps} onChange={(e) => setReps(Number(e.target.value))} data-testid="live-reps">
            {PREVIEW_REPS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => setNonce((n) => n + 1)} data-testid="live-rerun">{en ? 'Re-run now' : '立即重跑'}</button>
      </div>
      {!ready && <p className="note" role="status" data-testid="live-empty">{en ? 'Open a scenario with a baseline and candidate to preview.' : '请先打开场景(基线与候选)后再预览。'}</p>}
      {ready && loading && <p className="note" role="status" data-testid="live-loading">{en ? 'Running kernel preview…' : '正在跑内核预览…'}</p>}
      {ready && error !== null && <p className="note" role="alert" aria-live="assertive" data-testid="live-error">{localizeWasmErrorText(locale, error).text}</p>}
      {ready && out !== null && <LivePreviewCharts locale={locale} meta={meta} out={out} />}
    </section>
  )
}

/** 三图:候选直方图(内核逐 replicate 值)+ 双臂/配对差 CI95(forest)+
 * CRN 配对差散点(零参考线);统计结论 = Comparison。 */
function LivePreviewCharts({ locale, meta, out }: {
  locale: 'zh-CN' | 'en-US'
  meta: (typeof PREVIEW_METRICS)[number]
  out: PreviewOut
}): JSX.Element {
  const en = locale.startsWith('en')
  const fmt = (value: number): string => meta.percent ? `${(value * 100).toFixed(2)}%` : value.toFixed(2)
  const comparison = out.comparison
  const verdictText: Record<Comparison['verdict'], string> = {
    BHigher: en ? 'Candidate higher' : '候选更高',
    AHigher: en ? 'Baseline higher' : '基线更高',
    NoDifference: en ? 'No detectable difference' : '无显著差异',
    InsufficientEvidence: en ? 'Insufficient evidence' : '证据不足',
  }

  // —— 直方图(候选臂内核逐 replicate 值,等宽 12 箱)——
  const candValues = nonNull(out.candPerReplicate)
  const bins = histogramBins(candValues, 12)
  const histWidth = 320
  const histHeight = 140
  const histBottom = 24
  const histMax = Math.max(...bins.map((bin) => bin.count), 1)
  const histBars = bins.map((bin, index) => ({
    x: (index * histWidth) / bins.length,
    w: histWidth / bins.length - 2,
    y: histHeight - histBottom - (bin.count / histMax) * (histHeight - histBottom - 8),
    h: (bin.count / histMax) * (histHeight - histBottom - 8),
    title: `${fmt(bin.lo)}–${fmt(bin.hi)}: ${bin.count}`,
  }))

  // —— forest:双臂均值 + 内核 CI95,外加配对差行(零参考)——
  const ciWidth = 320
  const ciHeight = 118
  const ciLeft = 64
  const ciRight = 12
  const ciRows = [
    { label: en ? 'baseline' : '基线', mean: comparison.arm_a.mean, lo: comparison.arm_a.ci95_lo, hi: comparison.arm_a.ci95_hi },
    { label: en ? 'candidate' : '候选', mean: comparison.arm_b.mean, lo: comparison.arm_b.ci95_lo, hi: comparison.arm_b.ci95_hi },
    { label: en ? 'diff (CRN)' : '配对差', mean: comparison.diff_mean, lo: comparison.diff_ci95_lo, hi: comparison.diff_ci95_hi },
  ]
  const ciValues = ciRows.flatMap((row) => [row.lo, row.hi, 0])
  const ciMin = Math.min(...ciValues)
  const ciMax = Math.max(...ciValues)
  const ciSpan = ciMax - ciMin || Math.abs(ciMax) || 1
  const ciX = (value: number): number => ciLeft + ((value - ciMin) / ciSpan) * (ciWidth - ciLeft - ciRight)
  const zeroX = ciX(0)

  // —— CRN 配对差散点(逐 replicate;任一臂缺席跳过,与内核同口径)——
  const diffs = pairedDiff(out.basePerReplicate, out.candPerReplicate)
  const pdWidth = 320
  const pdHeight = 96
  const pdMin = diffs.length === 0 ? -1 : Math.min(0, ...diffs)
  const pdMax = diffs.length === 0 ? 1 : Math.max(0, ...diffs)
  const pdSpan = pdMax - pdMin || Math.abs(pdMax) || 1
  const pdX = (value: number): number => 12 + ((value - pdMin) / pdSpan) * (pdWidth - 24)
  const pdZeroX = pdX(0)

  return (
    <div className="live-figures" data-testid="live-figures">
      <div className="mini-figures">
        <div className="mini-figure">
          <svg className="mini-chart" data-testid="live-histogram" viewBox={`0 0 ${histWidth} ${histHeight}`} role="img" aria-label={en ? 'Candidate replicate histogram' : '候选逐 replicate 直方图'}>
            {histBars.map((bar, index) => (
              <rect key={index} className="live-hist-bar" x={bar.x} y={bar.y} width={Math.max(bar.w, 1)} height={Math.max(bar.h, 0)}>
                <title>{bar.title}</title>
              </rect>
            ))}
            <text x={4} y={12} className="chart-label">{en ? 'candidate' : '候选'} · n={candValues.length}</text>
            <text x={4} y={histHeight - 8} className="chart-text">{fmt(bins[0]?.lo ?? 0)}</text>
            <text x={histWidth - 4} y={histHeight - 8} textAnchor="end" className="chart-text">{fmt(bins[bins.length - 1]?.hi ?? 0)}</text>
          </svg>
        </div>
        <div className="mini-figure">
          <svg className="mini-chart" data-testid="live-ci" viewBox={`0 0 ${ciWidth} ${ciHeight}`} role="img" aria-label={en ? 'Kernel CI95 per arm and paired diff' : '双臂与配对差的内核 CI95'}>
            {ciRows.map((row, index) => {
              const y = 30 + index * 30
              return <g key={row.label}>
                <text x={ciLeft - 6} y={y + 4} textAnchor="end" className="chart-text">{row.label}</text>
                <line className="live-ci-line" x1={ciX(row.lo)} x2={ciX(row.hi)} y1={y} y2={y} />
                <circle className="live-ci-point" cx={ciX(row.mean)} cy={y} r="4">
                  <title>{`${row.label}: ${fmt(row.mean)} [${fmt(row.lo)}, ${fmt(row.hi)}]`}</title>
                </circle>
              </g>
            })}
            <line className="live-zero-line" x1={zeroX} x2={zeroX} y1={18} y2={ciHeight - 8} />
            <text x={ciLeft} y={12} className="chart-label">CI95</text>
          </svg>
        </div>
        <div className="mini-figure">
          <svg className="mini-chart" data-testid="live-paired" viewBox={`0 0 ${pdWidth} ${pdHeight}`} role="img" aria-label={en ? 'CRN paired diff per replicate' : 'CRN 逐 replicate 配对差'}>
            <line className="live-zero-line" x1={pdZeroX} x2={pdZeroX} y1={10} y2={pdHeight - 18} />
            {diffs.map((value, index) => (
              <circle key={index} className="live-paired-point" cx={pdX(value)} cy={pdHeight / 2} r="3">
                <title>{`#${index + 1}: ${fmt(value)}`}</title>
              </circle>
            ))}
            <text x={12} y={12} className="chart-label">{en ? 'paired diff (cand − base)' : '配对差(候选 − 基线)'}</text>
            <text x={12} y={pdHeight - 6} className="chart-text">{fmt(pdMin)}</text>
            <text x={pdWidth - 12} y={pdHeight - 6} textAnchor="end" className="chart-text">{fmt(pdMax)}</text>
          </svg>
        </div>
      </div>
      <div className="candidate-table-wrap">
        <table className="candidate-table" data-testid="live-table">
          <tbody>
            <tr>
              <td>{en ? 'baseline' : '基线'}</td>
              <td data-field="base-mean" data-value={comparison.arm_a.mean}>{fmt(comparison.arm_a.mean)}</td>
              <td data-lo={comparison.arm_a.ci95_lo} data-hi={comparison.arm_a.ci95_hi}>[{fmt(comparison.arm_a.ci95_lo)}, {fmt(comparison.arm_a.ci95_hi)}]</td>
            </tr>
            <tr>
              <td>{en ? 'candidate' : '候选'}</td>
              <td data-field="cand-mean" data-value={comparison.arm_b.mean}>{fmt(comparison.arm_b.mean)}</td>
              <td data-lo={comparison.arm_b.ci95_lo} data-hi={comparison.arm_b.ci95_hi}>[{fmt(comparison.arm_b.ci95_lo)}, {fmt(comparison.arm_b.ci95_hi)}]</td>
            </tr>
            <tr>
              <td>{en ? 'diff (CRN)' : '配对差'}</td>
              <td data-field="diff-mean" data-value={comparison.diff_mean}>{fmt(comparison.diff_mean)}</td>
              <td data-lo={comparison.diff_ci95_lo} data-hi={comparison.diff_ci95_hi}>[{fmt(comparison.diff_ci95_lo)}, {fmt(comparison.diff_ci95_hi)}]</td>
            </tr>
            <tr>
              <td>{en ? 'verdict' : '结论'}</td>
              <td colSpan={2}>
                <span className={`badge ${comparison.degraded ? '' : 'teal'}`} data-testid="live-verdict" data-degraded={comparison.degraded}>
                  {verdictText[comparison.verdict]}{comparison.degraded ? (en ? ' (degraded CI)' : '(CI 退化)') : ''} · d={comparison.effect_size_d.toFixed(3)}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
