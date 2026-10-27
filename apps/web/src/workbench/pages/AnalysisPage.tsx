// WB-08: real jobs are the default source. Synthetic data requires explicit source selection.
import { useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { METRIC_KEYS } from '../../lib/types.ts'
import type { MetricKey } from '../../lib/types.ts'
import { METRIC_META, metricLabel, metricUnit } from '../../lib/metricMeta.ts'
import { fmtPercent } from '../../lib/i18n/format.ts'
import { abView, dailyRows, interpolationText, overallOutcome, recommendationView, responsePoints, sensitivityNoteLabel, stepSelection, yAutoDomain } from '../../lib/analysisView.ts'
import type { ResultFilter } from '../../lib/analysisView.ts'
import { abFacets, abUnavailable } from '../../lib/abEffect.ts'
import { fmtNumber } from '../../lib/i18n/format.ts'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { ResponseChart } from '../analysis/ResponseChart.tsx'
import { AbEffectChart } from '../analysis/AbEffectChart.tsx'
import { ProChartsSection } from '../analysis/ProCharts.tsx'
import { DailyCohortSection } from '../analysis/DailyCohortSection.tsx'
import { CrossReplicateSection } from '../analysis/CrossReplicateSection.tsx'
import { EconomySection } from '../analysis/EconomySection.tsx'
import { CustomKpiSection } from '../analysis/CustomKpiSection.tsx'
import { OptimizeSurrogateSection } from '../analysis/OptimizeSurrogateSection.tsx'
import { CandidateTable } from '../analysis/CandidateTable.tsx'
import type { CandidateColumn } from '../analysis/CandidateTable.tsx'
import { DemoAnalysisPage } from '../analysis/DemoAnalysisPage.tsx'
import { addCandidateDraft, analysisSnapshot, defaultResultUI, editCandidateDraft, patchResultUI, setAnalysisJob, subscribeAnalysis } from '../analysis/analysisStore.ts'
import { copyCandidate, feasibility, formatMetric, fullValues, orderedRows, ranBaseline, resultRows, rowState, statText } from '../analysis/resultModel.ts'
import type { ResultRow } from '../analysis/resultModel.ts'
import { currentRealJob, draftJson, draftsJson, scopedRunJson } from '../analysis/exportScope.ts'
import { dispatch } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import * as runManager from '../state/runManager.ts'
import type { Job } from '../state/jobLogic.ts'
import { notify } from '../state/notifications.ts'
import { createId, ID_PREFIXES } from '../ids.ts'
import type { CandidateId } from '../ids.ts'
import { download } from '../demo/export.ts'
import { designReport } from '../../lib/designReport.ts'
import { designReportHtml } from '../../lib/designReportHtml.ts'
import { CandidateComparePanel } from '../project/CandidateComparePanel.tsx'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import { parseConfig, readNumeric, readText } from '../params/configYaml.ts'
import { kpiAvailabilityForTest } from '../../lib/wasm.ts'
import '../analysis/analysis.css'

async function generateDesignReport(job: Job, state: WorkbenchState, locale: ReturnType<typeof useLocale>): Promise<void> {
  const readConditions = (yaml: string): { population: number | null; days: number | null } => {
    const parsed = parseConfig(yaml)
    const durationText = readText(parsed, 'scenario.duration')
    return {
      population: readNumeric(parsed, 'scenario.population') ?? null,
      days: durationText ? Number(/^(\d+)\s*d$/i.exec(durationText.trim())?.[1] ?? Number.NaN) : null,
    }
  }
  const scenarioYamlOf = (spec: Job['exec'] extends null ? never : NonNullable<Job['exec']>['spec']): string => {
    if (spec.kind === 'ab') return spec.candYaml
    const parsed = parseConfig(spec.yaml)
    if (parsed.sections.some((section) => section.path === 'sweep')) {
      const lines = spec.yaml.split('\n')
      const sweep = parsed.sections.find((section) => section.path === 'sweep')!
      return [...lines.slice(0, sweep.startLine - 1), ...lines.slice(sweep.endLine)].join('\n')
    }
    return spec.yaml
  }
  const exec = job.exec!
  const artifactPath = `results/${exec.runId}.report.json`
  const artifactText = state.runArtifacts[artifactPath]
  if (typeof artifactText !== 'string') {
    notify('error', t(locale, 'report.artifactInvalidJson', { path: artifactPath }))
    return
  }
  const runIndex = state.runs.find((run) => run.run_id === exec.runId) ?? null
  const runYaml = exec.spec.kind === 'ab' ? exec.spec.candYaml : scenarioYamlOf(exec.spec)
  const runConditions = readConditions(runYaml)
  const configAvailability = await kpiAvailabilityForTest(runYaml)
  const baseHash = String(runIndex?.conditions.base_config_hash ?? '')
  const baselineEntry = baseHash ? state.runs.find((run) => run.run_id !== exec.runId && run.config_hash === baseHash) ?? null : null
  const baselinePath = baselineEntry ? `results/${baselineEntry.run_id}.report.json` : null
  const baselineText = baselinePath ? state.runArtifacts[baselinePath] : undefined
  const model = designReport({
    runId: exec.runId,
    runStatus: job.status,
    artifactPath,
    artifactText,
    configAvailability,
    index: runIndex ? {
      experiment_id: runIndex.experiment_id,
      config_hash: runIndex.config_hash,
      seed: runIndex.seed,
      created_at_unix: runIndex.created_at_unix,
    } : null,
    population: runConditions.population,
    days: runConditions.days,
  }, baselineEntry && baselinePath && typeof baselineText === 'string' ? {
    runId: baselineEntry.run_id, artifactPath: baselinePath, artifactText: baselineText,
  } : null, locale)
  download(`${exec.runId}.design-report.html`, designReportHtml(model), 'text/html;charset=utf-8')
  notify('success', t(locale, 'report.done', { runId: exec.runId }))
}

export type AnalysisPageProps = { state: WorkbenchState; onExport: () => void }
export function AnalysisPage({ state, onExport }: AnalysisPageProps): JSX.Element {
  const locale = useLocale()
  const jobs = useSyncExternalStore(runManager.subscribe, runManager.listJobs)
  const a = useSyncExternalStore(subscribeAnalysis, analysisSnapshot)
  const realJobs = jobs.filter((j) => !j.demo && j.exec)
  // 当前 run 解析口径与导出对话框共用(WB-09.01:同一口径,不各算一遍)
  const job = currentRealJob(jobs, a.jobId, state.selection.run)
  if (state.selection.source === 'synthetic_demo') return <>
    <div className="workspace-toolbar" role="status"><strong>{t(locale, 'analysis.demoSourceBanner')}</strong><button className="btn" onClick={() => dispatch({ type: 'selection', patch: { source: 'kernel' } })}>{t(locale, 'analysis.backToReal')}</button></div>
    <DemoAnalysisPage state={state} onExport={onExport} />
  </>
  return <>
    <WorkspaceHeading title={job?.name ?? t(locale, 'analysis.realTitle')} crumb={t(locale, 'analysis.realCrumb')} badge={{ text: 'KERNEL', tone: 'teal' }} actions={<button className="btn" onClick={() => dispatch({ type: 'navigate', page: 'designer' })}>{t(locale, 'analysis.configureExperiment')}</button>} />
    <div className="workspace-toolbar result-toolbar">
      <label htmlFor="analysis-run">{t(locale, 'analysis.runLabel')}</label><select id="analysis-run" value={job?.id ?? ''} onChange={(e) => setAnalysisJob(e.target.value)}>
        {!realJobs.length && <option value="">{t(locale, 'analysis.noRealRuns')}</option>}
        {realJobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {j.exec!.runId} · {j.status}</option>)}
      </select>
      <button className="btn" onClick={() => dispatch({ type: 'selection', patch: { source: 'synthetic_demo' } })}>{t(locale, 'analysis.openDemo')}</button>
    </div>
    {job ? <RealResult key={job.id} job={job} state={state} onExport={onExport} /> : <div className="empty-state">{t(locale, 'analysis.emptyState')}</div>}
  </>
}

function RealResult({ job, state, onExport }: { job: Job; state: WorkbenchState; onExport: () => void }): JSX.Element {
  const locale = useLocale()
  const a = useSyncExternalStore(subscribeAnalysis, analysisSnapshot)
  const ui = a.byJob[job.id] ?? defaultResultUI
  const exec = job.exec!
  const context = exec.spec.analysis
  // 扫描实验完整 YAML(含 sweep 节);优化与代理小节据此合成寻优实验
  const sweepYaml = exec.spec.kind === 'sweep' ? exec.spec.yaml : ''
  const plan = context?.plan
  const all = resultRows(job)
  const rows = orderedRows(all, ui.order)
  const selected = all.find((r) => r.id === ui.selectedId) ?? (ui.selectedId ? null : rows[0] ?? null)
  const metric = ui.metric
  const axes = exec.spec.kind === 'sweep' ? Object.keys(exec.spec.plan.candidates[0] ?? {}) : []
  const axis = axes.includes(ui.axis) ? ui.axis : axes[0] ?? ''
  // Requested metrics also remain visible when every candidate failed or produced no value.
  const metrics = METRIC_KEYS.filter((m) => m === metric || plan?.targets.some((t) => t.metric === m) || all.some((r) => r.result?.stats.has(m)))
  const views = rows.flatMap((r) => r.result ? [r.result] : [])
  // WB-12(L365)· 图型吃「本 run 全部已返回候选」,不随表格筛选/排序变化
  // (筛选是 UI 状态,图不能因筛选而伪造缺失格)
  const allViews = all.flatMap((r) => r.result ? [r.result] : [])
  const baseline = ranBaseline(job, all)
  const patch = (p: Parameters<typeof patchResultUI>[1]): void => patchResultUI(job.id, p)
  const select = (id: string): void => {
    patch({ selectedId: id })
    dispatch({ type: 'candidate/select', id: id as CandidateId })
    dispatch({ type: 'selection', patch: { candidate: id, run: exec.runId } })
  }
  const chart = (key: MetricKey, mini = false): JSX.Element => {
    const meta = METRIC_META[key]
    const points = responsePoints(views, key, axis).drawable
    const targets = plan?.targets.filter((t) => t.metric === key) ?? []
    const base = baseline?.result?.stats.get(key)?.mean
    const domain = yAutoDomain(points, [...targets.flatMap((t) => [t.min, t.max]), base ?? null])
    return <div key={key} className={mini ? 'mini-figure' : 'chart-viewport'}>
      <h3>{metricLabel(key, locale)} · {metricUnit(key, locale)}</h3>
      <ResponseChart mini={mini} metric={{ id: key, label: metricLabel(key, locale), unit: metricUnit(key, locale), decimals: meta.decimals,
        min: domain?.min ?? 0, max: domain?.max ?? 1, targets, baseline: base, format: (v) => formatMetric(v, key, false, locale) }}
        xAxis={{ label: axis, path: axis }} points={points} selectedId={selected?.id ?? null} onSelect={select}
        sourceTitle={`kernel · run ${exec.runId} · ${key} · ${t(locale, 'analysis.chart.title', { label: metricLabel(key, locale) })}`} />
      <p className="note">{t(locale, 'analysis.chartNote', { points: points.length, hidden: rows.length - points.length, unit: metricUnit(key, locale) })}</p>
    </div>
  }
  const columns: CandidateColumn<ResultRow>[] = [
    ...axes.map((path) => ({ key: `param:${path}`, label: path, numeric: true, value: (r: ResultRow) => r.values[path] ?? t(locale, 'analysis.missingCoord') })),
    { key: 'status', label: t(locale, 'analysis.colStatus'), value: (r) => rowState(r, job, locale) },
    ...metrics.flatMap((key): CandidateColumn<ResultRow>[] => [
      { key: `metric:${key}`, label: `${metricLabel(key, locale)} / ${metricUnit(key, locale)}`, numeric: true,
        value: (r) => r.result?.stats.get(key) ? formatMetric(r.result.stats.get(key)!.mean, key, false, locale) : r.result ? t(locale, 'analysis.unavailableNoStat') : t(locale, 'analysis.rowPending') },
      { key: `ci:${key}`, label: t(locale, 'analysis.colCi', { key }), ci: true, value: (r) => statText(r.result?.stats.get(key), key, locale) },
      { key: `outcome:${key}`, label: t(locale, 'analysis.colOutcome', { key }), value: (r) => r.result?.outcomes.filter((o) => o.metric === key).map((o) => `${o.kind}: ${o.verdict}`).join(' / ') || t(locale, 'analysis.noVerdict') },
    ]),
    { key: 'verdict', label: t(locale, 'analysis.colOverall'), value: (r) => feasibility(r, locale) },
  ]
  const runEntry = state.runs.find((r) => r.run_id === exec.runId)
  const sim = exec.sim ?? exec.arms?.[ui.arm] ?? null
  const daily = dailyRows(sim, ui.replicate, locale)
  const rec = exec.recommendation ? recommendationView(exec.recommendation) : null
  const completed = all.filter((r) => r.result).length
  const src = selected?.result
  const verdict = src ? overallOutcome(src) : null
  const copy = (): void => {
    if (!selected) return
    try { addCandidateDraft(copyCandidate(job, selected, String(createId(ID_PREFIXES.candidate)))); notify('success', t(locale, 'analysis.copied')) }
    catch (e) { notify('error', String(e)) }
  }
  return <div className="real-analysis page-scroll">
    <p role="status" className="note">{t(locale, 'analysis.sourceLabel')} kernel · {exec.runId} · {job.status} · {exec.kind === 'sweep' ? t(locale, 'analysis.sourceSweep', { completed, total: all.length, reps: exec.replicates }) : t(locale, 'analysis.sourceArms', { reps: exec.replicates })}</p>
    {exec.errorMessage && <p className="note-block" role="alert">{t(locale, 'analysis.errorKept', { class: exec.errorClass ?? '', message: exec.errorMessage })}</p>}
    {exec.kind === 'sweep' ? <>
      <div className="workspace-toolbar result-toolbar">
        <label htmlFor="real-metric">{t(locale, 'analysis.primaryMetric')}</label><select id="real-metric" value={metric} onChange={(e) => patch({ metric: e.target.value as MetricKey })}>{METRIC_KEYS.map((m) => <option key={m} value={m}>{metricLabel(m, locale)} · {metricUnit(m, locale)}</option>)}</select>
        <label htmlFor="real-axis">{t(locale, 'analysis.paramAxis')}</label><select id="real-axis" value={axis} onChange={(e) => patch({ axis: e.target.value })}>{axes.map((p) => <option key={p}>{p}</option>)}</select>
        <label htmlFor="real-filter">{t(locale, 'analysis.filter')}</label><select id="real-filter" value={ui.order.filter} onChange={(e) => patch({ order: { ...ui.order, filter: e.target.value as ResultFilter } })}>
          <option value="all">{t(locale, 'analysis.filterAll')}</option><option value="pass">hard pass</option><option value="borderline">hard borderline</option><option value="fail">hard fail</option>
        </select>
        <button className="btn" onClick={() => download(`${exec.runId}.json`, scopedRunJson(job, ui, 'all', runEntry), 'application/json')}>{t(locale, 'analysis.downloadJson')}</button>
        <button className="btn" data-testid="generate-design-report" onClick={async () => await generateDesignReport(job, state, locale)}>{t(locale, 'report.generate')}</button>
        {/* WB-09.01 · 导出对话框绑定当前 run:范围计数由这份 job 派生 */}
        <button className="btn" onClick={onExport}>{t(locale, 'analysis.exportRun')}</button>
      </div>
      {selected && !rows.some((r) => r.id === selected.id) && <p className="note-block" role="status">{t(locale, 'analysis.selectionFiltered')}<button className="btn" onClick={() => patch({ order: { ...ui.order, filter: 'all' } })}>{t(locale, 'analysis.showAllRestore')}</button></p>}
      <div className="real-result-grid">
        <section className="real-result-main">
          <h2>{t(locale, 'analysis.responseTitle', { label: metricLabel(metric, locale) })}</h2>
          <p className="note">{t(locale, 'analysis.responseNote')}</p>
          {chart(metric)}
          <div className="mini-figures">{metrics.filter((m) => m !== metric).map((m) => chart(m, true))}</div>
          <h2>{t(locale, 'analysis.candidateCount', { shown: rows.length, total: all.length })}</h2>
          <div onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
            const target = (e.target as HTMLElement).closest<HTMLElement>('[data-candidate]')
            if (!target) return
            e.preventDefault()
            const id = stepSelection(rows, target.dataset.candidate ?? selected?.id ?? null, e.key === 'ArrowDown' ? 1 : -1)
            if (id) { select(id); const button = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-candidate]')).find((n) => n.dataset.candidate === id)?.querySelector('button'); button?.focus() }
          }}>
            <CandidateTable id="real-candidates" rows={rows} getId={(r) => r.id} selectedId={selected?.id ?? null} onSelect={select}
              columns={columns} sortKey={ui.order.by} sortDir={ui.order.dir}
              onSort={(by) => patch({ order: { ...ui.order, by, dir: ui.order.by === by && ui.order.dir === 1 ? -1 : 1 } })}
              isBaseline={(r) => r.id === baseline?.id} expanded />
          </div>
        </section>
        <aside className="real-inspector" aria-label={t(locale, 'analysis.realInspectorAria')}>
          <h2>{t(locale, 'analysis.inspectorTitle')}</h2>
          {selected ? <>
            <p className="mono">{selected.id}</p><p>{rowState(selected, job, locale)}</p>
            <p>{t(locale, 'analysis.feasibilitySummary', { hard: verdict?.hard ?? t(locale, 'analysis.notJudged'), soft: verdict?.soft ?? t(locale, 'analysis.notJudged'), overall: verdict?.overall ?? t(locale, 'analysis.notJudged') })}</p>
            <h3>{t(locale, 'analysis.paramSnapshot')}</h3><dl>{Object.entries(fullValues(job, selected.values)).map(([p, v]) => <div key={p}><dt className="mono">{p}</dt><dd>{v}</dd></div>)}</dl>
            <button className="btn" disabled={!context || src?.status !== 'ok'} onClick={copy}>{t(locale, 'analysis.copyToDraft')}</button>
            <h3>{t(locale, 'analysis.kernelConstraints')}</h3>{src?.outcomes.map((o, i) => <p key={i}>{o.kind} · {o.metric} · {o.verdict}<br />{o.min !== null ? `≥ ${formatMetric(o.min, o.metric, false, locale)} ` : ''}{o.max !== null ? `≤ ${formatMetric(o.max, o.metric, false, locale)}` : ''}<br />{statText(o.stats, o.metric, locale)}</p>)}
            <p>{statText(src?.stats.get(metric), metric, locale)}</p>
          </> : <p>{t(locale, 'analysis.noSelection')}</p>}
          <h3>{t(locale, 'analysis.statSources')}</h3><dl>
            <div><dt>run</dt><dd className="mono">{exec.runId}</dd></div>
            <div><dt>{t(locale, 'analysis.srcBaselineRef')}</dt><dd className="mono">{context?.baselineId ?? t(locale, 'analysis.missing')}</dd></div>
            <div><dt>{t(locale, 'analysis.srcPlanHash')}</dt><dd className="mono">{plan?.config_hash ?? t(locale, 'analysis.missing')}</dd></div>
            <div><dt>{t(locale, 'analysis.srcInputSha')}</dt><dd className="mono">{runEntry?.config_hash ?? t(locale, 'analysis.missing')}</dd></div>
            <div><dt>{t(locale, 'analysis.srcCandHash')}</dt><dd>{t(locale, 'analysis.srcCandHashMissing')}</dd></div>
            <div><dt>model / schema</dt><dd>{context?.modelVersion ?? sim?.meta.model_version ?? t(locale, 'analysis.missing')} / {context?.schemaVersion ?? sim?.meta.schema_version ?? t(locale, 'analysis.missing')}</dd></div>
            <div><dt>{t(locale, 'analysis.srcStrategy')}</dt><dd>{plan ? t(locale, 'analysis.srcStrategyValue', { mode: plan.mode, seed: plan.base_seed }) : t(locale, 'analysis.missing')}</dd></div>
            <div><dt>{t(locale, 'analysis.statUnit')}</dt><dd>{t(locale, 'analysis.srcStatUnitValue', { reps: exec.replicates, n: src?.stats.get(metric)?.n ?? t(locale, 'analysis.unavailable') })}</dd></div>
            <div><dt>{t(locale, 'analysis.srcScenario')}</dt><dd>{plan ? t(locale, 'analysis.srcScenarioValue', { players: plan.players, days: plan.days }) : t(locale, 'analysis.missing')}</dd></div>
          </dl>
        </aside>
      </div>
      {/* WB-12(L365)· 专业图型:双轴热图/散点/OAT 矩阵/Pareto + 失败点追踪;
          点选走同一个 select(候选配置候选表 + selection.run 运行记录联动) */}
      <ProChartsSection job={job} rows={all} views={allViews} plan={plan ?? null}
        selectedId={selected?.id ?? null} onSelect={select} />
      <section className="result-recommendation"><h2>{t(locale, 'analysis.recTitle')}</h2>
        <p className="note">{t(locale, 'analysis.recNote')}</p>
        {rec ? <><p>{t(locale, 'analysis.recLine', { param: rec.param, baseline: rec.baseline ?? t(locale, 'analysis.unavailable'), interval: rec.interval ? `[${rec.interval.join(', ')}]` : t(locale, 'analysis.notRecommendable'), confidence: rec.confidence })}</p><p>{interpolationText(rec, locale)}</p><ul>{rec.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div className="candidate-table-wrap"><table className="candidate-table"><thead><tr><th>{t(locale, 'analysis.recColParam')}</th><th>{t(locale, 'analysis.recColMetric')}</th><th>{t(locale, 'analysis.recColElasticity')}</th><th>{t(locale, 'analysis.recColSignificant')}</th><th>{t(locale, 'analysis.recColNote')}</th></tr></thead><tbody>{rec.elasticities.map((e, i) => <tr key={i}><td>{e.param}</td><td>{e.metric}</td><td>{e.e ?? t(locale, 'analysis.unavailable')} / [{e.e_lo ?? t(locale, 'analysis.unavailable')}, {e.e_hi ?? t(locale, 'analysis.unavailable')}]</td><td>{String(e.significant)}</td><td>{e.note}: {sensitivityNoteLabel(e.note, locale)}</td></tr>)}</tbody></table></div>
        </> : <p>{exec.recommendationError ?? (completed < all.length ? t(locale, 'analysis.recIncomplete') : t(locale, 'analysis.recNone'))}</p>}
      </section>
      {/* WB-08.17(L380)· 优化与代理:进化寻优/代理训练/扫描 Pareto 独立标识,
          真实观测·插值·代理估计三层分行,RF 树间分歧不作置信区间 */}
      <OptimizeSurrogateSection exec={exec} yaml={sweepYaml} />
    </> : <section><h2>{exec.kind === 'single' ? t(locale, 'analysis.singleTitle') : t(locale, 'analysis.abTitle')}</h2>
      {exec.kind === 'single' ? <p>{t(locale, 'analysis.singleNote')}</p> : exec.comparison ? (() => {
        const comparisons = exec.comparisons ?? [exec.comparison!]
        const facets = abFacets(comparisons)
        const unavailable = abUnavailable(comparisons, exec.comparisonErrors ?? [])
        const v = abView(exec.comparison!)
        return <>
        <p>{t(locale, 'analysis.abVerdict', { label: metricLabel(v.metric, locale), verdict: v.verdict })}</p><p>A: {statText(v.armA, v.metric, locale)}</p><p>B: {statText(v.armB, v.metric, locale)}</p>
        <p>{t(locale, 'analysis.abStats', { diff: formatMetric(v.diffMean, v.metric, true, locale), lo: formatMetric(v.diffCi95Lo, v.metric, true, locale), hi: formatMetric(v.diffCi95Hi, v.metric, true, locale), d: v.effectSizeD })}</p>
        <p className="note">{t(locale, 'analysis.abNote')}</p>
        <h3>{t(locale, 'analysis.abFacetsTitle')}</h3>
        <p className="note">{t(locale, 'analysis.abFacetsNote')}</p>
        <AbEffectChart facets={facets} sourceTitle={`kernel · run ${exec.runId}`} format={(value, key) => formatMetric(value, key, true, locale)} />
        <div className="candidate-table-wrap"><table className="candidate-table" data-testid="ab-facet-table">
          <thead><tr>
            <th>{t(locale, 'analysis.abColKpi')}</th>
            <th>{t(locale, 'analysis.abColBase')}</th>
            <th>{t(locale, 'analysis.abColCand')}</th>
            <th>{t(locale, 'analysis.abColDiff')}</th>
            <th>{t(locale, 'analysis.abColCi')}</th>
            <th>{t(locale, 'analysis.abColRel')}</th>
            <th>{t(locale, 'analysis.abColEffect')}</th>
            <th>{t(locale, 'analysis.abColVerdict')}</th>
          </tr></thead>
          <tbody>{facets.map((f) => <tr key={f.metric} data-metric={f.metric}>
            <td>{metricLabel(f.metric, locale)} / {metricUnit(f.metric, locale)}</td>
            <td>{formatMetric(f.armA.mean, f.metric, false, locale)}</td>
            <td>{formatMetric(f.armB.mean, f.metric, false, locale)}</td>
            <td>{formatMetric(f.diffMean, f.metric, true, locale)}</td>
            <td>{`[${formatMetric(f.diffCi95Lo, f.metric, true, locale)}, ${formatMetric(f.diffCi95Hi, f.metric, true, locale)}]`}</td>
            <td>{f.relativeChangePct === null ? t(locale, 'analysis.unavailable') : `${fmtNumber(locale, f.relativeChangePct, { maxFractionDigits: 1 })}%`}</td>
            <td>{f.effectSizeD}</td>
            <td>{f.verdict}{f.significant ? '' : ` · ${t(locale, 'analysis.abOverlapTag')}`}</td>
          </tr>)}</tbody>
        </table></div>
        {unavailable.length > 0 && <div>
          <h3>{t(locale, 'analysis.abUnavailableTitle')}</h3>
          <ul>{unavailable.map((u) => <li key={u.metric}>{metricLabel(u.metric, locale)}: {u.message}</li>)}</ul>
        </div>}
      </> })() : <p>{t(locale, 'analysis.noComparison', { message: exec.errorMessage ?? t(locale, 'analysis.waitingComparison') })}</p>}
    </section>}
    {(exec.sim || exec.arms) && <section><h2>{t(locale, 'analysis.dailyTitle')}</h2>
      <label>{t(locale, 'analysis.armLabel')} <select value={ui.arm} onChange={(e) => patch({ arm: e.target.value as 'base' | 'cand' })}><option value="base">{t(locale, 'analysis.armA')}</option><option value="cand">B</option></select></label>
      <label>replicate <select value={ui.replicate} onChange={(e) => patch({ replicate: Number(e.target.value) })}>{(sim?.results ?? []).map((r) => <option key={r.replicate} value={r.replicate}>{t(locale, 'analysis.replicateOption', { ui: r.replicate + 1, kernel: r.replicate })}</option>)}</select></label>
      <p className="note">{t(locale, 'analysis.dailyNote', { run: exec.runId })}</p>
      {daily.ok ? <table className="candidate-table"><thead><tr><th>day</th><th>win_rate</th><th>inflation</th></tr></thead><tbody>{daily.rows.map((r) => <tr key={r.day}><td>{r.day}</td><td>{formatMetric(r.win_rate, 'win_rate', false, locale)}</td><td>{r.inflation === null ? t(locale, 'analysis.unavailable') : fmtPercent(locale, r.inflation)}</td></tr>)}</tbody></table> : <p>{daily.reason}</p>}
      <DailyCohortSection sim={sim} runId={exec.runId} replicate={ui.replicate} />
      {/* 跨 replicate 逐日聚合:CI 走内核 daily_aggregate,单次 days.csv 不套置信带 */}
      <CrossReplicateSection results={sim?.results ?? null} runId={exec.runId} />
      {/* 经济/掉落/抽卡:同一内核聚合,口径各图单轴;未配置的键只报原因 */}
      <EconomySection results={sim?.results ?? null} runId={exec.runId} />
      {/* todo L381 批四:自定义 KPI,校验与求值都进内核,口径行记录可复现要素 */}
      <CustomKpiSection results={sim?.results ?? null} runId={exec.runId} />
    </section>}
    {a.drafts.length > 0 && <section><h2>{t(locale, 'analysis.draftsTitle')}</h2><button className="btn" onClick={() => { download(`${exec.runId}-drafts.json`, draftsJson(a.drafts, exec.runId), 'application/json'); notify('success', t(locale, 'analysis.draftsJsonDone', { count: a.drafts.length })) }}>{t(locale, 'analysis.downloadDraftsJson')}</button>{a.drafts.map((d) => <div key={d.id} className="result-draft">
      <p>{t(locale, 'analysis.draftLine', { id: d.id, run: d.sourceRunId, cand: d.sourceCandidateId, base: d.baselineId })}</p>
      <label htmlFor={d.id}>{t(locale, 'analysis.draftYamlLabel')}</label><textarea id={d.id} value={d.yaml} rows={12} onChange={(e) => editCandidateDraft(d.id, e.target.value)} />
      <p className="note">{t(locale, 'analysis.draftNote')}</p>
      <button className="btn" disabled={parseConfig(d.yaml).errors.length > 0} onClick={() => download(`${d.id}.yaml`, d.yaml, 'application/yaml')}>{t(locale, 'analysis.downloadDraftYaml')}</button>
      <button className="btn" onClick={() => download(`${d.id}.source.json`, draftJson(d), 'application/json')}>{t(locale, 'analysis.downloadDraftJson')}</button>
      {parseConfig(d.yaml).errors.length > 0 && <p role="alert">{t(locale, 'analysis.draftParseError')}</p>}
    </div>)}{a.draftPersistenceError && <p role="alert">{a.draftPersistenceError}</p>}
      <CandidateComparePanel
        drafts={a.drafts}
        baselineYaml={a.drafts.every((d) => d.baselineYaml === a.drafts[0].baselineYaml) ? a.drafts[0].baselineYaml : null}
      />
    </section>}
  </div>
}
