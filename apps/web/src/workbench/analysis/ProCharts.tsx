// WB-12 · 专业图型(todo L365):双轴 Grid 离散热图、Random/LHS 散点、
// OAT 敏感性矩阵、可行候选 + Pareto 前沿,附失败点追踪。
// 红线(与 lib/proChartsModel.ts 同源,渲染层不再有第二套口径):
// - 聚合先行:SVG 只画模型输出(L370:先聚合数据 + SVG);
// - 缺失候选/未产出指标留空,不 0 填空、不插值;
// - config_error / 硬约束 fail 候选不入图形,但 id 与原因如实列出;
// - 选点联动:每个可点元素携带内容寻址候选 ID,回调直连候选表/检查器
//   同一条 select(候选配置联动)+ selection.run(运行记录联动);
// - OAT 矩阵只整理内核 sweep_recommend 弹性;内核未覆盖 = 留空,
//   多因子运行内核推荐如实不可用(不自行重算)。
import { useState } from 'react'
import type { JSX } from 'react'
import { METRIC_KEYS } from '../../lib/types.ts'
import type { MetricKey, SweepPlan } from '../../lib/types.ts'
import { heatmapGrid, oatMatrix, paretoFront, scatterPoints } from '../../lib/proChartsModel.ts'
import type { ParetoGoal } from '../../lib/proChartsModel.ts'
import { trackFailedPoints } from '../../lib/sweepDesign.ts'
import type { CandidateView } from '../../lib/sweepView.ts'
import { METRIC_META, metricLabel, metricUnit } from '../../lib/metricMeta.ts'
import { fmtNumber } from '../../lib/i18n/format.ts'
import { t } from '../../lib/i18n/index.ts'
import type { Locale, TranslationKey } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import type { Job } from '../state/jobLogic.ts'
import type { ResultRow } from './resultModel.ts'

/** 指标默认优化方向:流失/抽卡保底次数取最小,其余取最大(可切) */
const DEFAULT_GOAL: Partial<Record<MetricKey, ParetoGoal>> = {
  churn_rate: 'min',
  gacha_pulls_to_hit: 'min',
}

const VIEW_LABEL: Readonly<Record<ProView, TranslationKey>> = {
  heat: 'analysis.proView.heat',
  scatter: 'analysis.proView.scatter',
  oat: 'analysis.proView.oat',
  pareto: 'analysis.proView.pareto',
}

export type ProChartsSectionProps = {
  job: Job
  rows: readonly ResultRow[]
  views: readonly CandidateView[]
  plan: SweepPlan | null
  selectedId: string | null
  onSelect: (id: string) => void
}

type ProView = 'heat' | 'scatter' | 'oat' | 'pareto'

export function ProChartsSection({ job, rows, views, plan, selectedId, onSelect }: ProChartsSectionProps): JSX.Element {
  const locale = useLocale()
  const exec = job.exec!
  const axes = plan?.axes ?? []
  // 离散热图只对 grid 计划成立(Random/LHS 候选不在规则网格上 → 默认看散点)
  const gridMode = plan?.mode === 'grid'
  const [view, setView] = useState<ProView>(gridMode ? 'heat' : 'scatter')
  const [heatXState, setHeatX] = useState(axes[0]?.path ?? '')
  const [heatYState, setHeatY] = useState(axes[1]?.path ?? '')
  // 轴选择按当前计划校准:换 run / 计划后到时旧路径失效 → 回落前两个互不相同轴
  const pickAxis = (path: string, skip?: string): string =>
    axes.some((a) => a.path === path && a.path !== skip) ? path : (axes.find((a) => a.path !== skip)?.path ?? '')
  const heatX = pickAxis(heatXState)
  const heatY = pickAxis(heatYState, heatX)
  const [metric, setMetric] = useState<MetricKey>('win_rate')
  const [paretoX, setParetoX] = useState<MetricKey>('win_rate')
  const [paretoY, setParetoY] = useState<MetricKey>('gold_per_player')
  const [goalX, setGoalX] = useState<ParetoGoal>(DEFAULT_GOAL['win_rate'] ?? 'max')
  const [goalY, setGoalY] = useState<ParetoGoal>(DEFAULT_GOAL['gold_per_player'] ?? 'max')

  const fmt = (v: number, key: MetricKey): string =>
    METRIC_META[key].dimension === 'percent'
      ? `${fmtNumber(locale, v * 100, { maxFractionDigits: METRIC_META[key].decimals })}%`
      : fmtNumber(locale, v, { maxFractionDigits: METRIC_META[key].decimals })

  // 失败点追踪:计划槽 × 实际返回,三态(没跑完也如实显示)
  const tracking = trackFailedPoints(
    rows.map((r) => r.values),
    rows.map((r) => (r.result ? { status: r.result.status } : null)),
  )

  const axisOptions = (value: string, onChange: (path: string) => void, id: string): JSX.Element => (
    <label htmlFor={id}><select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {axes.map((a) => <option key={a.path} value={a.path}>{a.path}</option>)}
    </select></label>
  )
  const metricOptions = (value: MetricKey, onChange: (m: MetricKey) => void, id: string): JSX.Element => (
    <label htmlFor={id}><select id={id} value={value} onChange={(e) => onChange(e.target.value as MetricKey)}>
      {METRIC_KEYS.map((m) => <option key={m} value={m}>{metricLabel(m, locale)}</option>)}
    </select></label>
  )

  const xa = axes.find((a) => a.path === heatX)
  const ya = axes.find((a) => a.path === heatY)
  return <section className="pro-charts" aria-label={t(locale, 'analysis.proTitle')}>
    <h2>{t(locale, 'analysis.proTitle')}</h2>
    <p className="note">{t(locale, 'analysis.proNote')}</p>
    <div className="workspace-toolbar pro-toolbar" role="tablist" aria-label={t(locale, 'analysis.proTitle')}>
      {(['heat', 'scatter', 'oat', 'pareto'] as const).map((v) => (
        <button key={v} role="tab" aria-selected={view === v} className={`btn${view === v ? ' primary' : ''}`}
          onClick={() => setView(v)}>{t(locale, VIEW_LABEL[v])}</button>
      ))}
    </div>
    {view === 'heat' && (!gridMode
      ? <p className="note-block">{t(locale, 'analysis.proHeatGridOnly')}</p>
      : xa && ya
        ? <>
          <div className="workspace-toolbar pro-toolbar">
            <span className="toolbar-label">{t(locale, 'analysis.proXAxis')}</span>{axisOptions(heatX, setHeatX, 'pro-heat-x')}
            <span className="toolbar-label">{t(locale, 'analysis.proYAxis')}</span>{axisOptions(heatY, setHeatY, 'pro-heat-y')}
            {metricOptions(metric, setMetric, 'pro-heat-metric')}
          </div>
          <HeatmapChart model={heatmapGrid(views, { xPath: heatX, yPath: heatY, metric, xAxis: xa, yAxis: ya })}
            metric={metric} locale={locale} selectedId={selectedId} onSelect={onSelect} format={fmt}
            runId={exec.runId} />
        </>
        : <p className="note-block">{t(locale, 'analysis.proAxesNeed')}</p>)}
    {view === 'scatter' && (xa && ya
      ? <>
        <div className="workspace-toolbar pro-toolbar">
          <span className="toolbar-label">{t(locale, 'analysis.proXAxis')}</span>{axisOptions(heatX, setHeatX, 'pro-scatter-x')}
          <span className="toolbar-label">{t(locale, 'analysis.proYAxis')}</span>{axisOptions(heatY, setHeatY, 'pro-scatter-y')}
          {metricOptions(metric, setMetric, 'pro-scatter-metric')}
        </div>
        <ScatterChart model={scatterPoints(views, heatX, heatY, metric)} metric={metric}
          xAxis={xa} yAxis={ya} locale={locale} selectedId={selectedId} onSelect={onSelect} format={fmt}
          runId={exec.runId} />
      </>
      : <p className="note-block">{t(locale, 'analysis.proAxesNeed')}</p>)}
    {view === 'oat' && (exec.recommendation
      ? <OatMatrixChart model={oatMatrix(exec.recommendation.elasticities)} locale={locale} runId={exec.runId} />
      : <p className="note-block">{t(locale, 'analysis.proOatUnavailable', { message: exec.recommendationError ?? t(locale, 'analysis.recIncomplete') })}</p>)}
    {view === 'pareto' && <>
      <div className="workspace-toolbar pro-toolbar">
        {metricOptions(paretoX, (m) => { setParetoX(m); setGoalX(DEFAULT_GOAL[m] ?? 'max') }, 'pro-pareto-x')}
        <select aria-label={t(locale, 'analysis.proGoal')} value={goalX} onChange={(e) => setGoalX(e.target.value as ParetoGoal)}>
          <option value="max">{t(locale, 'analysis.proGoalMax')}</option><option value="min">{t(locale, 'analysis.proGoalMin')}</option>
        </select>
        {metricOptions(paretoY, (m) => { setParetoY(m); setGoalY(DEFAULT_GOAL[m] ?? 'max') }, 'pro-pareto-y')}
        <select aria-label={t(locale, 'analysis.proGoal')} value={goalY} onChange={(e) => setGoalY(e.target.value as ParetoGoal)}>
          <option value="max">{t(locale, 'analysis.proGoalMax')}</option><option value="min">{t(locale, 'analysis.proGoalMin')}</option>
        </select>
      </div>
      <ParetoChart model={paretoFront(views, paretoX, paretoY, goalX, goalY)}
        xMetric={paretoX} yMetric={paretoY} locale={locale} selectedId={selectedId} onSelect={onSelect}
        format={fmt} runId={exec.runId} />
    </>}
    <FailureTracking tracking={tracking} locale={locale} />
  </section>
}

type Fmt = (value: number, key: MetricKey) => string

/* —— 双轴 Grid 离散热图 —— */
function HeatmapChart({ model, metric, locale, selectedId, onSelect, format, runId }: {
  model: ReturnType<typeof heatmapGrid>
  metric: MetricKey
  locale: Locale
  selectedId: string | null
  onSelect: (id: string) => void
  format: Fmt
  runId: string
}): JSX.Element {
  const W = 870, H = 330, left = 120, right = 30, top = 34, bottom = 62
  const cols = Math.max(model.xLevels.length, 1)
  const rowsN = Math.max(model.yLevels.length, 1)
  const cw = (W - left - right) / cols
  const ch = (H - top - bottom) / rowsN
  const means = [...model.cells.values()].map((c) => c.mean)
  const vmin = Math.min(...means), vmax = Math.max(...means)
  const xAt = (x: number): number => left + model.xLevels.indexOf(x) * cw
  const yAt = (y: number): number => top + model.yLevels.indexOf(y) * ch
  return <svg className="main-chart pro-chart" viewBox={`0 0 ${W} ${H}`} role="group"
    aria-label={t(locale, 'analysis.proHeatAria', { rows: rowsN, cols, metric: metricLabel(metric, locale) })}>
    <title>{`kernel · run ${runId} · ${t(locale, 'analysis.proView.heat')} · ${metricLabel(metric, locale)}/${metricUnit(metric, locale)}`}</title>
    {[...model.cells.values()].map((c) => {
      const tt = vmax === vmin ? 1 : (c.mean - vmin) / (vmax - vmin)
      const selected = selectedId !== null && c.ids.includes(selectedId)
      const label = `${c.ids.join(', ')} · ${model.xPath}=${c.x}, ${model.yPath}=${c.y} · ${metricLabel(metric, locale)} ${format(c.mean, metric)} (n=${c.n})`
      return <g key={`${c.x}|${c.y}`} className={`pro-heat-cell${selected ? ' selected' : ''}`} role="button" tabIndex={0}
        data-candidate={c.ids[0]} aria-label={label} aria-pressed={selected}
        onClick={() => onSelect(c.ids[0])}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.ids[0]) } }}>
        <title>{label}</title>
        <rect x={xAt(c.x) + 1.5} y={yAt(c.y) + 1.5} width={cw - 3} height={ch - 3} rx={3}
          fill="var(--wb-teal)" fillOpacity={0.12 + 0.78 * tt} stroke={selected ? 'var(--wb-amber)' : 'transparent'} strokeWidth={selected ? 2.5 : 0} />
        <text x={xAt(c.x) + cw / 2} y={yAt(c.y) + ch / 2 + 4} textAnchor="middle" className="pro-heat-value">{format(c.mean, metric)}</text>
      </g>
    })}
    {/* 缺失候选:计划内但无结果 → 虚线空格(留空,不 0 填) */}
    {model.missing.map((m) => <g key={`miss-${m.x}|${m.y}`}>
      <title>{t(locale, 'analysis.proHeatMissing')}</title>
      <rect x={xAt(m.x) + 1.5} y={yAt(m.y) + 1.5} width={cw - 3} height={ch - 3} rx={3}
        fill="none" stroke="var(--wb-soft-line)" strokeDasharray="4 3" className="pro-heat-missing" />
    </g>)}
    {model.xLevels.map((x) => <text key={`x-${x}`} x={xAt(x) + cw / 2} y={H - bottom + 18} textAnchor="middle" className="chart-text">{fmtNumber(locale, x, { maxFractionDigits: 4 })}</text>)}
    {model.yLevels.map((y) => <text key={`y-${y}`} x={left - 8} y={yAt(y) + ch / 2 + 4} textAnchor="end" className="chart-text">{fmtNumber(locale, y, { maxFractionDigits: 4 })}</text>)}
    <text x={left} y={16} className="chart-label">{`${metricLabel(metric, locale)} / ${metricUnit(metric, locale)}`}</text>
    <text x={(W + left - right) / 2} y={H - 8} textAnchor="middle" className="chart-label">{model.xPath}</text>
    <text x={12} y={(H - bottom + top) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(H - bottom + top) / 2})`} className="chart-label">{model.yPath}</text>
  </svg>
}

/* —— Random / LHS 散点 —— */
function ScatterChart({ model, metric, xAxis, yAxis, locale, selectedId, onSelect, format, runId }: {
  model: ReturnType<typeof scatterPoints>
  metric: MetricKey
  xAxis: { path: string; min: number; max: number } | undefined
  yAxis: { path: string; min: number; max: number } | undefined
  locale: Locale
  selectedId: string | null
  onSelect: (id: string) => void
  format: Fmt
  runId: string
}): JSX.Element {
  const W = 870, H = 330, left = 90, right = 30, top = 34, bottom = 56
  const pts = model.drawable
  const auto = (vs: number[]): [number, number] => {
    if (!vs.length) return [0, 1]
    const lo = Math.min(...vs), hi = Math.max(...vs)
    return hi === lo ? [lo - 1, hi + 1] : [lo, hi]
  }
  const [xmin, xmax] = xAxis ? [xAxis.min, xAxis.max] : auto(pts.map((p) => p.x))
  const [ymin, ymax] = yAxis ? [yAxis.min, yAxis.max] : auto(pts.map((p) => p.y))
  const x = (v: number): number => left + (v - xmin) / (xmax - xmin || 1) * (W - left - right)
  const y = (v: number): number => top + (ymax - v) / (ymax - ymin || 1) * (H - top - bottom)
  return <svg className="main-chart pro-chart" viewBox={`0 0 ${W} ${H}`} role="group"
    aria-label={t(locale, 'analysis.proScatterAria', { count: pts.length })}>
    <title>{`kernel · run ${runId} · ${t(locale, 'analysis.proView.scatter')} · ${metricLabel(metric, locale)}/${metricUnit(metric, locale)}`}</title>
    {Array.from({ length: 5 }, (_, i) => {
      const val = xmin + (xmax - xmin) * i / 4
      return <g key={`gx-${i}`}><line x1={x(val)} x2={x(val)} y1={top} y2={H - bottom} className="chart-grid" />
        <text x={x(val)} y={H - bottom + 18} textAnchor="middle" className="chart-text">{fmtNumber(locale, val, { maxFractionDigits: 3 })}</text></g>
    })}
    {Array.from({ length: 5 }, (_, i) => {
      const val = ymin + (ymax - ymin) * i / 4
      return <g key={`gy-${i}`}><line x1={left} x2={W - right} y1={y(val)} y2={y(val)} className="chart-grid" />
        <text x={left - 8} y={y(val) + 4} textAnchor="end" className="chart-text">{fmtNumber(locale, val, { maxFractionDigits: 3 })}</text></g>
    })}
    {pts.map((p) => {
      const selected = selectedId === p.id
      const label = `${p.id} · ${model.xPath}=${p.x}, ${model.yPath}=${p.y} · ${metricLabel(metric, locale)} ${format(p.value, metric)} (n=${p.n})`
      return <g key={p.id} className={`pro-scatter-point${selected ? ' selected' : ''}`} role="button" tabIndex={0}
        data-candidate={p.id} aria-label={label} aria-pressed={selected}
        onClick={() => onSelect(p.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id) } }}>
        <title>{label}</title>
        <circle cx={x(p.x)} cy={y(p.y)} r={selected ? 7 : 5} />
      </g>
    })}
    <text x={left} y={16} className="chart-label">{`${metricLabel(metric, locale)} / ${metricUnit(metric, locale)}`}</text>
    <text x={(W + left - right) / 2} y={H - 8} textAnchor="middle" className="chart-label">{model.xPath}</text>
    {!pts.length && <text x={W / 2} y={H / 2} textAnchor="middle" className="chart-text">{t(locale, 'analysis.proScatterEmpty')}</text>}
  </svg>
}

/* —— OAT 敏感性矩阵 —— */
function OatMatrixChart({ model, locale, runId }: {
  model: ReturnType<typeof oatMatrix>
  locale: Locale
  runId: string
}): JSX.Element {
  const W = 870
  const left = 190, top = 46, cellW = (W - left - 16) / Math.max(model.metrics.length, 1), cellH = 44
  const H = top + model.params.length * cellH + 30
  return <svg className="main-chart pro-chart" viewBox={`0 0 ${W} ${Math.max(H, 120)}`} role="group"
    aria-label={t(locale, 'analysis.proOatAria', { params: model.params.length, metrics: model.metrics.length })}>
    <title>{`kernel · run ${runId} · ${t(locale, 'analysis.proView.oat')}`}</title>
    {model.metrics.map((m, i) => <text key={m} x={left + i * cellW + cellW / 2} y={top - 10} textAnchor="middle" className="chart-text">{metricLabel(m, locale)}</text>)}
    {model.params.map((param, r) => <g key={param}>
      <text x={left - 8} y={top + r * cellH + cellH / 2 + 4} textAnchor="end" className="pro-oat-param">{param}</text>
      {model.metrics.map((m, c) => {
        const cell = model.rows[r].cells[c]
        const cx = left + c * cellW, cy = top + r * cellH
        if (!cell) return <rect key={m} x={cx + 2} y={cy + 2} width={cellW - 4} height={cellH - 4} rx={3} className="pro-oat-blank" data-oat-blank={`${param}|${m}`} />
        if (cell.e === null) return <rect key={m} x={cx + 2} y={cy + 2} width={cellW - 4} height={cellH - 4} rx={3} className="pro-oat-blank" data-oat-blank={`${param}|${m}`}><title>{`${param} × ${m}: ${cell.note}`}</title></rect>
        const label = `${param} × ${m} · e=${fmtNumber(locale, cell.e, { maxFractionDigits: 4 })} · 95% CI [${cell.e_lo === null ? '—' : fmtNumber(locale, cell.e_lo, { maxFractionDigits: 4 })}, ${cell.e_hi === null ? '—' : fmtNumber(locale, cell.e_hi, { maxFractionDigits: 4 })}] · ${cell.significant ? t(locale, 'analysis.proOatSig') : t(locale, 'analysis.proOatNotSig')}`
        return <g key={m}><title>{label}</title>
          <rect x={cx + 2} y={cy + 2} width={cellW - 4} height={cellH - 4} rx={3}
            className={cell.significant ? 'pro-oat-sig' : 'pro-oat-nsig'} data-oat-cell={`${param}|${m}`} />
          <text x={cx + cellW / 2} y={cy + cellH / 2 + 4} textAnchor="middle" className="pro-oat-value">{fmtNumber(locale, cell.e, { maxFractionDigits: 3 })}</text>
        </g>
      })}
    </g>)}
    {!model.params.length && <text x={W / 2} y={H / 2} textAnchor="middle" className="chart-text">{t(locale, 'analysis.proOatEmpty')}</text>}
  </svg>
}

/* —— 可行候选 + Pareto 前沿 —— */
function ParetoChart({ model, xMetric, yMetric, locale, selectedId, onSelect, format, runId }: {
  model: ReturnType<typeof paretoFront>
  xMetric: MetricKey
  yMetric: MetricKey
  locale: Locale
  selectedId: string | null
  onSelect: (id: string) => void
  format: Fmt
  runId: string
}): JSX.Element {
  const W = 870, H = 330, left = 90, right = 30, top = 34, bottom = 56
  const all = [...model.feasible]
  const auto = (vs: number[]): [number, number] => {
    if (!vs.length) return [0, 1]
    const lo = Math.min(...vs), hi = Math.max(...vs)
    return hi === lo ? [lo - 1, hi + 1] : [lo, hi]
  }
  const [xmin, xmax] = auto(all.map((p) => p.x))
  const [ymin, ymax] = auto(all.map((p) => p.y))
  const x = (v: number): number => left + (v - xmin) / (xmax - xmin || 1) * (W - left - right)
  const y = (v: number): number => top + (ymax - v) / (ymax - ymin || 1) * (H - top - bottom)
  const point = (p: { id: string; x: number; y: number }, kind: 'frontier' | 'dominated'): JSX.Element => {
    const selected = selectedId === p.id
    const label = `${p.id} · ${metricLabel(xMetric, locale)} ${format(p.x, xMetric)} · ${metricLabel(yMetric, locale)} ${format(p.y, yMetric)} · ${kind === 'frontier' ? t(locale, 'analysis.proParetoOnFront') : t(locale, 'analysis.proParetoDominatedTag')}`
    return <g key={p.id} className={`pro-pareto-point ${kind}${selected ? ' selected' : ''}`} role="button" tabIndex={0}
      data-candidate={p.id} aria-label={label} aria-pressed={selected}
      onClick={() => onSelect(p.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id) } }}>
      <title>{label}</title>
      <circle cx={x(p.x)} cy={y(p.y)} r={selected ? 7 : 5} />
    </g>
  }
  return <svg className="main-chart pro-chart" viewBox={`0 0 ${W} ${H}`} role="group"
    aria-label={t(locale, 'analysis.proParetoAria', { count: model.frontier.length })}>
    <title>{`kernel · run ${runId} · ${t(locale, 'analysis.proView.pareto')}`}</title>
    {Array.from({ length: 5 }, (_, i) => {
      const val = xmin + (xmax - xmin) * i / 4
      return <line key={`gx-${i}`} x1={x(val)} x2={x(val)} y1={top} y2={H - bottom} className="chart-grid" />
    })}
    {Array.from({ length: 5 }, (_, i) => {
      const val = ymin + (ymax - ymin) * i / 4
      return <g key={`gy-${i}`}><line x1={left} x2={W - right} y1={y(val)} y2={y(val)} className="chart-grid" />
        <text x={left - 8} y={y(val) + 4} textAnchor="end" className="chart-text">{format(val, yMetric)}</text></g>
    })}
    {Array.from({ length: 5 }, (_, i) => {
      const val = xmin + (xmax - xmin) * i / 4
      return <text key={`tx-${i}`} x={x(val)} y={H - bottom + 18} textAnchor="middle" className="chart-text">{format(val, xMetric)}</text>
    })}
    {model.frontier.length > 1 && <polyline className="pro-pareto-front"
      points={model.frontier.map((p) => `${x(p.x)},${y(p.y)}`).join(' ')} />}
    {model.dominated.map((p) => point(p, 'dominated'))}
    {model.frontier.map((p) => point(p, 'frontier'))}
    <text x={left} y={16} className="chart-label">
      {t(locale, 'analysis.proParetoFrontier', { count: model.frontier.length })} · {t(locale, 'analysis.proParetoDominated', { count: model.dominated.length })} · {t(locale, 'analysis.proParetoExcluded', { count: model.excluded.length })}
    </text>
    <text x={(W + left - right) / 2} y={H - 8} textAnchor="middle" className="chart-label">{metricLabel(xMetric, locale)}</text>
    {!all.length && <text x={W / 2} y={H / 2} textAnchor="middle" className="chart-text">{t(locale, 'analysis.proParetoEmpty')}</text>}
  </svg>
}

/* —— 失败点追踪 —— */
function FailureTracking({ tracking, locale }: {
  tracking: ReturnType<typeof trackFailedPoints>
  locale: Locale
}): JSX.Element {
  const total = tracking.ok + tracking.configErrors.length + tracking.missing.length
  return <div className="pro-failures" data-testid="pro-failure-tracking">
    <h3>{t(locale, 'analysis.proFailTitle')}</h3>
    {tracking.configErrors.length === 0 && tracking.missing.length === 0
      ? <p className="note">{t(locale, 'analysis.proFailNone', { ok: tracking.ok, total })}</p>
      : <p className="note">{t(locale, 'analysis.proFailSummary', { ok: tracking.ok, errors: tracking.configErrors.length, missing: tracking.missing.length, total })}</p>}
    {tracking.configErrors.length > 0 && <div className="candidate-table-wrap"><table className="candidate-table">
      <thead><tr><th>{t(locale, 'analysis.proFailColIndex')}</th><th>{t(locale, 'analysis.proFailColParams')}</th><th>{t(locale, 'analysis.proFailColReason')}</th></tr></thead>
      <tbody>{tracking.configErrors.map((f) => <tr key={f.index}>
        <td className="numeric">{f.index}</td>
        <td className="mono">{Object.entries(f.values).map(([p, v]) => `${p}=${v}`).join(', ')}</td>
        {/* 内核 config_error 原文逐字保留,不转写不归因 */}
        <td>{f.message}</td>
      </tr>)}</tbody>
    </table></div>}
    {tracking.missing.length > 0 && <p className="note">{t(locale, 'analysis.proFailMissing', { count: tracking.missing.length, slots: tracking.missing.map((m) => m.index).join(', ') })}</p>}
  </div>
}
