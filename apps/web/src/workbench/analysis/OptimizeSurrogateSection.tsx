// WB-08.17 · 优化与代理视图(P2):进化寻优(evolutionary 字典序适应度 / pareto
// 约束感知非支配排序)、随机森林代理训练/预测、扫描候选二维 Pareto 前沿三者
// 各自独立标识(口径参数全摊开,不共用一行标签);真实观测 / 插值 / 代理估计
// 三层来源分行展示;RF 树间分歧只作描述性散布呈现,绝不画成置信带或标注 CI。
// 纪律:数值全走内核(optimize / surrogate_train / surrogate_predict 桥接),
// 本组件只做展示派生;缺席即 null(不补 0),内核拒绝原文照录。
import type { JSX } from 'react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { METRIC_KEYS } from '../../lib/types.ts'
import type { MetricKey } from '../../lib/types.ts'
import type { CandidateResult, OptimResult, SurrogatePrediction, SurrogateTrainOutput } from '../../lib/types.ts'
import { optimizeIdentity, interpolatedPoints, importanceRows, observedPoints, optimizeHistoryRows, predictionRows, SOURCE_KIND_KEY, spreadText, surrogateIdentity, surrogatePoints, withPredictions } from '../../lib/optimizeSurrogateModel.ts'
import type { PredictionRow } from '../../lib/optimizeSurrogateModel.ts'
import { metricLabel } from '../../lib/metricMeta.ts'
import { fmtNumber } from '../../lib/i18n/format.ts'
import { localizeWasmErrorText } from '../../lib/i18n/errorText.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import { formatMetric } from './resultModel.ts'
import { optimizeRun, surrogatePredict, surrogateTrain } from '../../lib/wasm.ts'
import type { JobExec } from '../state/jobLogic.ts'

const DEFAULT_TREES = 50
const DEFAULT_MAX_DEPTH = 8
const DEFAULT_MIN_LEAF = 2
const DEFAULT_SEED = 7
const DEFAULT_POPULATION = 8
const DEFAULT_GENERATIONS = 3
const DEFAULT_REPLICATES = 4

/** 扫描候选 → 连续参数域(每条轴取内核候选的 min~max),供寻优复用同一实验。 */
function axesFromGrid(rows: readonly CandidateResult[]): { path: string; min: number; max: number }[] {
  if (rows.length === 0) return []
  const paths = Object.keys(rows[0].values).sort()
  return paths.map((path) => {
    const values = rows.map((row) => row.values[path]).filter((value) => Number.isFinite(value))
    return { path, min: Math.min(...values), max: Math.max(...values) }
  })
}

/** 寻优实验 YAML:scenario/model 逐行保留(去 sweep 节)+ 合成 optimize 节。
 *  内核规定寻优可行域只由 hard 约束定义,soft 目标一律剔除(带空 targets 落 [])。 */
function buildOptimizeYaml(
  yaml: string,
  axes: { path: string; min: number; max: number }[],
  targets: { metric: MetricKey; kind: 'hard' | 'soft'; min: number | null; max: number | null }[],
  mode: 'evolutionary' | 'pareto',
  primary: { metric: MetricKey; direction: 'maximize' | 'minimize' },
  secondary: { metric: MetricKey; direction: 'maximize' | 'minimize' } | null,
  population: number,
  generations: number,
  replicates: number,
): string {
  const lines = yaml.split('\n')
  const parsed = lines.map((line) => line.trim())
  const dropFrom = parsed.findIndex((line) => line === 'sweep:')
  const scenario = dropFrom >= 0 ? lines.slice(0, dropFrom) : lines
  const hardTargets = targets.filter((target) => target.kind === 'hard')
  const targetLine = (target: { metric: MetricKey; kind: 'hard' | 'soft'; min: number | null; max: number | null }): string =>
    `    - {metric: ${target.metric}, ${target.min !== null ? `min: ${target.min}, ` : ''}${target.max !== null ? `max: ${target.max}, ` : ''}kind: ${target.kind}}`
  const block = [
    'optimize:',
    `  mode: ${mode}`,
    `  population: ${population}`,
    `  generations: ${generations}`,
    `  elite: ${Math.max(1, Math.floor(population / 4))}`,
    '  mutation_rate: 0.3',
    '  mutation_scale: 0.2',
    `  replicates: ${replicates}`,
    '  parameters:',
    ...axes.map((axis) => `    ${axis.path}: {min: ${axis.min}, max: ${axis.max}}`),
    ...(hardTargets.length > 0 ? ['  targets:', ...hardTargets.map(targetLine)] : ['  targets: []']),
    ...(mode === 'pareto' && secondary !== null
      ? ['  objectives:', `    - {metric: ${primary.metric}, direction: ${primary.direction}}`, `    - {metric: ${secondary.metric}, direction: ${secondary.direction}}`]
      : ['  objective:', `    metric: ${primary.metric}`, `    direction: ${primary.direction}`]),
  ]
  return [...scenario, ...block].join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

/** 特征重要性条:内核归一值原样,单轴,不做置信带。 */
function ImportanceChart({ rows, locale, title }: {
  rows: { feature: string; importance: number; share: number }[]
  locale: 'zh-CN' | 'en-US'
  title: string
}): JSX.Element {
  const width = 520
  const height = 168
  // 特征名是注册表路径(model.warrior.attack 这类),比数值轴标长得多:
  // 左侧留白按最长特征名的字宽取,右值标只留数值位,条形区不打折
  const longest = rows.reduce((n, row) => Math.max(n, row.feature.length), 0)
  const left = Math.min(28 + longest * 7, width * 0.55)
  const right = 64
  const top = 20
  const bottom = 28
  const max = Math.max(...rows.map((row) => row.importance), 0)
  const domainMax = max > 0 ? max * 1.05 : 1
  const inner = height - top - bottom
  const band = rows.length > 0 ? inner / rows.length : inner
  const x = (value: number): number => left + (value / (domainMax || 1)) * (width - left - right)
  return <svg className="mini-chart" data-testid="surrogate-importance-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
    <title>{title}</title>
    {/* 条形横向生长,值沿 X:刻度与网格线必须竖着落在 x(value) 上、标在下边。
        画成纵向值轴的话,0/1 刻度会挤进左侧留白,正好压在特征名(注册表路径)上。 */}
    {[0, 0.5, 1].map((fraction) => {
      const value = domainMax * fraction
      return <g key={fraction}>
        <line x1={x(value)} x2={x(value)} y1={top} y2={top + inner} className="chart-grid" />
        <text x={x(value)} y={top + inner + 16} textAnchor="middle" className="chart-text">{fmtNumber(locale, value, { maxFractionDigits: 2 })}</text>
      </g>
    })}
    {rows.map((row, i) => {
      const y = top + band * i
      const widthPx = Math.max(0, x(row.importance) - left)
      return <g key={row.feature}>
        <rect x={left} y={y + 3} width={widthPx} height={band - 6} className="pro-oat-sig" rx={2} />
        <text x={left - 6} y={y + band / 2 + 4} textAnchor="end" className="chart-text">{row.feature}</text>
        <text x={x(row.importance) + 6} y={y + band / 2 + 4} className="chart-text">{fmtNumber(locale, row.importance, { maxFractionDigits: 3 })}</text>
      </g>
    })}
  </svg>
}

/** 三层来源预测表:观测/插值/代理分行,树间分歧只写描述性 min~max。 */
function PredictionTable({ rows, metric, locale, format }: {
  rows: readonly PredictionRow[]
  metric: MetricKey
  locale: 'zh-CN' | 'en-US'
  format: (value: number, key: MetricKey, diff: boolean) => string
}): JSX.Element {
  const groups: ('observed' | 'interpolated' | 'surrogate')[] = ['observed', 'interpolated', 'surrogate']
  const unavailable = <span data-testid="opt-unavailable">{t(locale, 'analysis.unavailable')}</span>
  return <div className="candidate-table-wrap"><table className="candidate-table" data-testid="opt-prediction-table">
    <thead><tr>
      <th>{t(locale, 'analysis.optColSource')}</th>
      <th>{t(locale, 'analysis.optColPoint')}</th>
      <th>{t(locale, 'analysis.optColParams')}</th>
      <th>{t(locale, 'analysis.optColObserved')}</th>
      <th>{t(locale, 'analysis.optColPredicted')}</th>
      <th>{t(locale, 'analysis.optColSpread')}</th>
      <th>{t(locale, 'analysis.optColNote')}</th>
    </tr></thead>
    <tbody>{groups.map((group) => {
      const groupRows = rows.filter((row) => row.source === group)
      if (groupRows.length === 0) return null
      return <Fragment key={group}>
        <tr data-testid="opt-source-group" data-source={group}>
          <th colSpan={7}>{t(locale, SOURCE_KIND_KEY[group])}</th>
        </tr>
        {groupRows.map((row) => <tr key={row.id} data-source={row.source} data-point={row.label}>
          <td>{t(locale, SOURCE_KIND_KEY[row.source])}</td>
          <td className="mono">{row.label}</td>
          <td className="mono">{Object.entries(row.params).map(([path, value]) => `${path.split('.').pop()}=${fmtNumber(locale, value, { maxFractionDigits: 2 })}`).join(', ')}</td>
          <td data-observed={row.observed === null ? undefined : String(row.observed)}>{row.observed === null ? unavailable : format(row.observed, metric, false)}</td>
          <td data-predicted={row.predicted === null ? undefined : String(row.predicted)}>{row.predicted === null ? unavailable : format(row.predicted, metric, false)}</td>
          <td data-testid="opt-spread" data-spread-min={row.spreadMin === null ? undefined : String(row.spreadMin)} data-spread-max={row.spreadMax === null ? undefined : String(row.spreadMax)}>{row.trees === null ? unavailable : spreadText(row)}</td>
          <td>{row.note ?? ''}</td>
        </tr>)}
      </Fragment>
    })}</tbody>
  </table></div>
}

export function OptimizeSurrogateSection({ exec, yaml }: { exec: JobExec; yaml: string }): JSX.Element {
  const locale = useLocale()
  const results = useMemo(() => (exec.kind === 'sweep' ? [...exec.results] : []), [exec])
  const axes = useMemo(() => axesFromGrid(results), [results])
  const targets = useMemo(() => {
    const first = results[0]
    if (first === undefined) return []
    return first.target_outcomes.map((outcome) => ({ metric: outcome.metric, kind: outcome.kind, min: outcome.min, max: outcome.max }))
  }, [results])

  const [metric, setMetric] = useState<MetricKey>('win_rate')
  const [trees, setTrees] = useState(DEFAULT_TREES)
  const [maxDepth, setMaxDepth] = useState(DEFAULT_MAX_DEPTH)
  const [minLeaf, setMinLeaf] = useState(DEFAULT_MIN_LEAF)
  const [seed, setSeed] = useState(DEFAULT_SEED)
  const [model, setModel] = useState<SurrogateTrainOutput | null>(null)
  const [trainError, setTrainError] = useState<string | null>(null)
  const [rows, setRows] = useState<readonly PredictionRow[]>([])

  const [mode, setMode] = useState<'evolutionary' | 'pareto'>('evolutionary')
  const [primaryMetric, setPrimaryMetric] = useState<MetricKey>('win_rate')
  const [primaryDir, setPrimaryDir] = useState<'maximize' | 'minimize'>('maximize')
  const [secondaryMetric, setSecondaryMetric] = useState<MetricKey>('gold_per_player')
  const [secondaryDir, setSecondaryDir] = useState<'maximize' | 'minimize'>('minimize')
  const [population, setPopulation] = useState(DEFAULT_POPULATION)
  const [generations, setGenerations] = useState(DEFAULT_GENERATIONS)
  const [optReplicates, setOptReplicates] = useState(DEFAULT_REPLICATES)
  const [optimize, setOptimize] = useState<OptimResult | null>(null)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const [optimizing, setOptimizing] = useState(false)

  const optimizeYaml = useMemo(
    () => buildOptimizeYaml(yaml, axes, targets, mode, { metric: primaryMetric, direction: primaryDir },
      mode === 'pareto' ? { metric: secondaryMetric, direction: secondaryDir } : null, population, generations, optReplicates),
    [yaml, axes, targets, mode, primaryMetric, primaryDir, secondaryMetric, secondaryDir, population, generations, optReplicates],
  )
  const budget = { candidates: population * (generations + 1), sims: population * (generations + 1) * optReplicates }

  // 代理训练 + 逐点预测:全部走内核,缺席保持 null。数据源消失(exec 切换、
  // 非扫描作业)时在异步边界内清空,避免上一份模型的行继续挂着当前结果显示。
  useEffect(() => {
    let live = true
    void (async () => {
      if (results.length === 0 || axes.length === 0) {
        setModel(null)
        setRows([])
        setTrainError(null)
        return
      }
      try {
        const trained = await surrogateTrain(results, metric, { trees, max_depth: maxDepth, min_samples_leaf: minLeaf, seed })
        if (!live) return
        setModel(trained)
        setTrainError(null)
        const grid = results.map((result) => result.values)
        const observed = observedPoints(results, metric)
        const interpolated = interpolatedPoints(exec.recommendation)
        const surrogate = optimize !== null ? surrogatePoints(optimize, grid) : []
        const all = predictionRows(observed, interpolated, surrogate)
        const predictions: (SurrogatePrediction | null)[] = []
        const failures: (string | null)[] = []
        for (const row of all) {
          try {
            predictions.push(await surrogatePredict(trained.model, row.params))
            failures.push(null)
          } catch (e) {
            // 单点不可预测(参数缺特征等)只影响该行:其余点的三层行不丢
            predictions.push(null)
            failures.push(localizeWasmErrorText(locale, String(e)).text)
          }
        }
        if (!live) return
        setRows(
          withPredictions(all, predictions).map((row, i) => {
            const failure = failures[i]
            if (failure === null) return row
            return { ...row, note: row.note === null ? failure : `${row.note} · ${failure}` }
          }),
        )
      } catch (e) {
        if (!live) return
        setTrainError(localizeWasmErrorText(locale, String(e)).text)
        setModel(null)
        setRows([])
      }
    })()
    return () => { live = false }
  }, [results, axes, exec.recommendation, metric, trees, maxDepth, minLeaf, seed, locale, optimize])

  if (exec.kind !== 'sweep' || results.length === 0) {
    return <section className="optimize-surrogate" data-testid="opt-surrogate-section"><h2>{t(locale, 'analysis.optTitle')}</h2>
      <p className="note">{t(locale, 'analysis.optNeedsSweep')}</p></section>
  }

  const runOptimize = async (): Promise<void> => {
    setOptimizing(true)
    setOptimizeError(null)
    try {
      setOptimize(await optimizeRun(optimizeYaml))
    } catch (e) {
      setOptimizeError(localizeWasmErrorText(locale, String(e)).text)
    } finally {
      setOptimizing(false)
    }
  }

  return <section className="optimize-surrogate" data-testid="opt-surrogate-section"><h2>{t(locale, 'analysis.optTitle')}</h2>
    <p className="note">{t(locale, 'analysis.optNote')}</p>

    <h3>{t(locale, 'analysis.optSurrogateTitle')}</h3>
    <div className="pro-toolbar">
      <label>{t(locale, 'analysis.optMetricLabel')} <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
        {METRIC_KEYS.map((key) => <option key={key} value={key}>{metricLabel(key, locale)}</option>)}
      </select></label>
      <label>trees <input type="number" min={1} max={200} value={trees} onChange={(e) => setTrees(Number(e.target.value))} /></label>
      <label>max_depth <input type="number" min={1} max={16} value={maxDepth} onChange={(e) => setMaxDepth(Number(e.target.value))} /></label>
      <label>min_samples_leaf <input type="number" min={1} max={8} value={minLeaf} onChange={(e) => setMinLeaf(Number(e.target.value))} /></label>
      <label>seed <input type="number" min={0} value={seed} onChange={(e) => setSeed(Number(e.target.value))} /></label>
    </div>
    {trainError !== null && <p role="alert" data-testid="opt-train-error">{trainError}</p>}
    {model !== null && (() => {
      const identity = surrogateIdentity(model)
      return <>
        <dl data-testid="opt-surrogate-identity">
          <div><dt>{t(locale, 'analysis.optSurrogateMetric')}</dt><dd>{metricLabel(identity.metric, locale)}</dd></div>
          <div><dt>{t(locale, 'analysis.optSurrogateTrees')}</dt><dd>{identity.trees} / {identity.maxDepth} / {identity.minSamplesLeaf} / seed {identity.seed}</dd></div>
          <div><dt>{t(locale, 'analysis.optSurrogateTrained')}</dt><dd>{identity.trained}</dd></div>
          <div><dt>{t(locale, 'analysis.optSurrogateExcluded')}</dt><dd>{identity.excluded}</dd></div>
          <div><dt>{t(locale, 'analysis.optSurrogateFeatures')}</dt><dd>{identity.featureCount}</dd></div>
        </dl>
        {model.features.length > 0 && <ImportanceChart rows={importanceRows(model)} locale={locale} title={t(locale, 'analysis.optImportanceAria', { count: model.features.length })} />}
        <p className="note">{t(locale, 'analysis.optImportanceNote')}</p>
        <h4>{t(locale, 'analysis.optPredictionTitle')}</h4>
        <p className="note" data-testid="opt-source-note">{t(locale, 'analysis.optSourceNote')}</p>
        <PredictionTable rows={rows} metric={metric} locale={locale} format={(value, key, diff) => formatMetric(value, key, diff, locale)} />
        <p className="note" data-testid="opt-spread-note">{t(locale, 'analysis.optSpreadNote', { trees: model.spec.trees })}</p>
      </>
    })()}

    <h3>{t(locale, 'analysis.optOptimizeTitle')}</h3>
    <p className="note">{t(locale, 'analysis.optOptimizeNote')}</p>
    <div className="pro-toolbar">
      <label>{t(locale, 'analysis.optModeLabel')} <select value={mode} onChange={(e) => setMode(e.target.value as 'evolutionary' | 'pareto')}>
        <option value="evolutionary">evolutionary</option><option value="pareto">pareto</option>
      </select></label>
      <label>{t(locale, 'analysis.optPrimaryLabel')} <select value={primaryMetric} onChange={(e) => setPrimaryMetric(e.target.value as MetricKey)}>
        {METRIC_KEYS.map((key) => <option key={key} value={key}>{metricLabel(key, locale)}</option>)}
      </select></label>
      <select value={primaryDir} onChange={(e) => setPrimaryDir(e.target.value as 'maximize' | 'minimize')} aria-label={t(locale, 'analysis.optDirectionAria')}>
        <option value="maximize">maximize</option><option value="minimize">minimize</option>
      </select>
      {mode === 'pareto' && <><label>{t(locale, 'analysis.optSecondaryLabel')} <select value={secondaryMetric} onChange={(e) => setSecondaryMetric(e.target.value as MetricKey)}>
        {METRIC_KEYS.map((key) => <option key={key} value={key}>{metricLabel(key, locale)}</option>)}
      </select></label>
        <select value={secondaryDir} onChange={(e) => setSecondaryDir(e.target.value as 'maximize' | 'minimize')} aria-label={t(locale, 'analysis.optDirectionAria')}>
          <option value="maximize">maximize</option><option value="minimize">minimize</option>
        </select></>}
      <label>population <input type="number" min={2} max={64} value={population} onChange={(e) => setPopulation(Number(e.target.value))} /></label>
      <label>generations <input type="number" min={0} max={40} value={generations} onChange={(e) => setGenerations(Number(e.target.value))} /></label>
      <label>replicates <input type="number" min={1} max={64} value={optReplicates} onChange={(e) => setOptReplicates(Number(e.target.value))} /></label>
    </div>
    <p className="note">{t(locale, 'analysis.optBudget', { candidates: budget.candidates, replicates: optReplicates, sims: budget.sims })}</p>
    <details><summary>{t(locale, 'analysis.optYamlLabel')}</summary>
      <pre className="mono" data-testid="opt-yaml">{optimizeYaml}</pre></details>
    <button className="btn" data-testid="opt-run" disabled={optimizing || axes.length === 0 || targets.length === 0} onClick={() => { void runOptimize() }}>
      {optimizing ? t(locale, 'analysis.optRunning') : t(locale, 'analysis.optRunButton', { sims: budget.sims })}
    </button>
    {optimizeError !== null && <p role="alert" data-testid="opt-error">{optimizeError}</p>}
    {optimize !== null && (() => {
      const identity = optimizeIdentity(optimize)
      const history = optimizeHistoryRows(optimize)
      const points = optimize.front0.length > 0 ? optimize.front0 : optimize.best !== null ? [optimize.best] : []
      return <>
        <dl data-testid="opt-identity">
          <div><dt>{t(locale, 'analysis.optIdentityMode')}</dt><dd>{identity.mode}</dd></div>
          <div><dt>{t(locale, 'analysis.optIdentityBudget')}</dt><dd>{identity.budget.candidates} × {identity.replicates} = {identity.budget.sims}</dd></div>
          <div><dt>{t(locale, 'analysis.optIdentityEvaluated')}</dt><dd>{optimize.evaluated}</dd></div>
          <div><dt>{t(locale, 'analysis.optIdentitySims')}</dt><dd>{optimize.total_sims}</dd></div>
          <div><dt>{t(locale, 'analysis.optIdentityParams')}</dt><dd>{identity.parameters.join(', ')}</dd></div>
          <div><dt>{t(locale, 'analysis.optIdentityHard')}</dt><dd>{identity.hardTargets.map((target) => `${target.metric}${target.min !== null ? ` ≥ ${fmtNumber(locale, target.min)}` : ''}${target.max !== null ? ` ≤ ${fmtNumber(locale, target.max)}` : ''}`).join(' · ')}</dd></div>
          <div><dt>{t(locale, 'analysis.optIdentityObjectives')}</dt><dd>{identity.objectives.map((objective) => `${objective.metric} ${objective.direction}`).join(' · ')}</dd></div>
        </dl>
        <p className="note" data-testid="opt-vs-pareto">{t(locale, 'analysis.optVsPareto')}</p>
        <h4>{t(locale, 'analysis.optHistoryTitle')}</h4>
        <div className="candidate-table-wrap"><table className="candidate-table" data-testid="opt-history">
          <thead><tr><th>gen</th><th>{t(locale, 'analysis.optColEvaluated')}</th><th>{t(locale, 'analysis.optColFeasible')}</th><th>hard_pass</th><th>score</th><th>front0</th></tr></thead>
          <tbody>{history.map((row) => <tr key={row.generation}><td>{row.generation}</td><td>{row.evaluated}</td><td>{row.feasible}</td><td>{row.bestHardPass}</td><td>{row.score === null ? t(locale, 'analysis.unavailable') : fmtNumber(locale, row.score, { maxFractionDigits: 4 })}</td><td>{row.front0}</td></tr>)}</tbody>
        </table></div>
        <h4>{t(locale, 'analysis.optPointsTitle')}</h4>
        <div className="candidate-table-wrap"><table className="candidate-table" data-testid="opt-points">
          <thead><tr><th>{t(locale, 'analysis.optColPoint')}</th><th>{t(locale, 'analysis.optColParams')}</th>{identity.objectives.map((objective) => <th key={objective.metric}>{metricLabel(objective.metric, locale)}</th>)}</tr></thead>
          <tbody>{points.map((point, i) => <tr key={i}>
            <td>{point.status === 'ok' ? t(locale, 'analysis.optPointIn') : t(locale, 'analysis.optPointOut')}</td>
            <td className="mono">{Object.entries(point.values).map(([path, value]) => `${path.split('.').pop()}=${fmtNumber(locale, value, { maxFractionDigits: 2 })}`).join(', ')}</td>
            {identity.objectives.map((objective) => {
              const stat = point.metric_stats.find(([key]) => key === objective.metric)
              return <td key={objective.metric}>{stat === undefined ? t(locale, 'analysis.unavailable') : formatMetric(stat[1].mean, objective.metric, false)}</td>
            })}
          </tr>)}</tbody>
        </table></div>
      </>
    })()}
  </section>
}
