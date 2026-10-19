// WB-08: real jobs are the default source. Synthetic data requires explicit source selection.
import { useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { METRIC_KEYS } from '../../lib/types.ts'
import type { MetricKey } from '../../lib/types.ts'
import { METRIC_META } from '../../lib/metricMeta.ts'
import { abView, dailyRows, interpolationText, overallOutcome, recommendationView, responsePoints, sensitivityNoteLabel, stepSelection, yAutoDomain } from '../../lib/analysisView.ts'
import type { ResultFilter } from '../../lib/analysisView.ts'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { ResponseChart } from '../analysis/ResponseChart.tsx'
import { CandidateTable } from '../analysis/CandidateTable.tsx'
import type { CandidateColumn } from '../analysis/CandidateTable.tsx'
import { DemoAnalysisPage } from '../analysis/DemoAnalysisPage.tsx'
import { addCandidateDraft, analysisSnapshot, defaultResultUI, editCandidateDraft, patchResultUI, setAnalysisJob, subscribeAnalysis } from '../analysis/analysisStore.ts'
import { copyCandidate, feasibility, formatMetric, fullValues, orderedRows, ranBaseline, resultRows, rowState, statText } from '../analysis/resultModel.ts'
import type { ResultRow } from '../analysis/resultModel.ts'
import { dispatch } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import * as runManager from '../state/runManager.ts'
import type { Job } from '../state/jobLogic.ts'
import { notify } from '../state/notifications.ts'
import { createId, ID_PREFIXES } from '../ids.ts'
import type { CandidateId } from '../ids.ts'
import { download } from '../demo/export.ts'
import { machineJson } from '../../lib/machineExport.ts'
import { parseConfig } from '../params/configYaml.ts'
import '../analysis/analysis.css'

export type AnalysisPageProps = { state: WorkbenchState; onExport: () => void }
export function AnalysisPage({ state, onExport }: AnalysisPageProps): JSX.Element {
  const jobs = useSyncExternalStore(runManager.subscribe, runManager.listJobs)
  const a = useSyncExternalStore(subscribeAnalysis, analysisSnapshot)
  const realJobs = jobs.filter((j) => !j.demo && j.exec)
  const job = realJobs.find((j) => j.id === a.jobId) ?? realJobs.find((j) => j.exec?.runId === state.selection.run) ?? realJobs.at(-1)
  if (state.selection.source === 'synthetic_demo') return <>
    <div className="workspace-toolbar" role="status"><strong>独立来源: synthetic_demo · 合成演示</strong><button className="btn" onClick={() => dispatch({ type: 'selection', patch: { source: 'kernel' } })}>返回真实运行</button></div>
    <DemoAnalysisPage state={state} onExport={onExport} />
  </>
  return <>
    <WorkspaceHeading title={job?.name ?? '真实结果分析'} crumb="结果 / 内核运行" badge={{ text: 'KERNEL', tone: 'teal' }} actions={<button className="btn" onClick={() => dispatch({ type: 'navigate', page: 'designer' })}>配置实验</button>} />
    <div className="workspace-toolbar result-toolbar">
      <label htmlFor="analysis-run">运行</label><select id="analysis-run" value={job?.id ?? ''} onChange={(e) => setAnalysisJob(e.target.value)}>
        {!realJobs.length && <option value="">尚无真实运行</option>}
        {realJobs.map((j) => <option key={j.id} value={j.id}>{j.name} · {j.exec!.runId} · {j.status}</option>)}
      </select>
      <button className="btn" onClick={() => dispatch({ type: 'selection', patch: { source: 'synthetic_demo' } })}>打开合成演示（独立来源）</button>
    </div>
    {job ? <RealResult key={job.id} job={job} state={state} /> : <div className="empty-state">尚无真实执行结果。请配置并提交实验；运行中和取消后的部分结果也可在此查看。</div>}
  </>
}

function RealResult({ job, state }: { job: Job; state: WorkbenchState }): JSX.Element {
  const a = useSyncExternalStore(subscribeAnalysis, analysisSnapshot)
  const ui = a.byJob[job.id] ?? defaultResultUI
  const exec = job.exec!
  const context = exec.spec.analysis
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
      <h3>{meta.label} · {meta.unit}</h3>
      <ResponseChart mini={mini} metric={{ id: key, label: meta.label, unit: meta.unit, decimals: meta.decimals,
        min: domain?.min ?? 0, max: domain?.max ?? 1, targets, baseline: base, format: (v) => formatMetric(v, key) }}
        xAxis={{ label: axis, path: axis }} points={points} selectedId={selected?.id ?? null} onSelect={select}
        sourceTitle={`kernel · run ${exec.runId} · ${key} · 观测均值与内核 95% CI`} />
      <p className="note">{points.length} 个观测点 · {rows.length - points.length} 个未绘制候选（等待/失败/指标不可用，见表） · 独立纵轴 {meta.unit}</p>
    </div>
  }
  const columns: CandidateColumn<ResultRow>[] = [
    ...axes.map((path) => ({ key: `param:${path}`, label: path, numeric: true, value: (r: ResultRow) => r.values[path] ?? '缺失坐标' })),
    { key: 'status', label: '状态 / 原因', value: (r) => rowState(r, job) },
    ...metrics.flatMap((key): CandidateColumn<ResultRow>[] => [
      { key: `metric:${key}`, label: `${METRIC_META[key].label} / ${METRIC_META[key].unit}`, numeric: true,
        value: (r) => r.result?.stats.get(key) ? formatMetric(r.result.stats.get(key)!.mean, key) : r.result ? '不可用 · 内核未产出' : '等待结果' },
      { key: `ci:${key}`, label: `${key} · 95% CI / n（下界排序）`, ci: true, value: (r) => statText(r.result?.stats.get(key), key) },
      { key: `outcome:${key}`, label: `${key} · 内核约束`, value: (r) => r.result?.outcomes.filter((o) => o.metric === key).map((o) => `${o.kind}: ${o.verdict}`).join(' / ') || '未判定 / 无约束' },
    ]),
    { key: 'verdict', label: '整体可行（硬约束聚合）', value: feasibility },
  ]
  const runEntry = state.runs.find((r) => r.run_id === exec.runId)
  const sim = exec.sim ?? exec.arms?.[ui.arm] ?? null
  const daily = dailyRows(sim, ui.replicate)
  const rec = exec.recommendation ? recommendationView(exec.recommendation) : null
  const completed = all.filter((r) => r.result).length
  const src = selected?.result
  const verdict = src ? overallOutcome(src) : null
  const copy = (): void => {
    if (!selected) return
    try { addCandidateDraft(copyCandidate(job, selected, String(createId(ID_PREFIXES.candidate)))); notify('success', '已创建独立方案草稿，见本页下方；原输入与结果保留') }
    catch (e) { notify('error', String(e)) }
  }
  return <div className="real-analysis page-scroll">
    <p role="status" className="note">来源 kernel · {exec.runId} · {job.status} · {exec.kind === 'sweep' ? `${completed}/${all.length} 候选已返回 · ${exec.replicates} replicates/候选` : `${exec.replicates} replicates/臂`}</p>
    {exec.errorMessage && <p className="note-block" role="alert">{exec.errorClass}: {exec.errorMessage}。已收到的结果保留；未执行候选不会记为零。</p>}
    {exec.kind === 'sweep' ? <>
      <div className="workspace-toolbar result-toolbar">
        <label htmlFor="real-metric">主指标</label><select id="real-metric" value={metric} onChange={(e) => patch({ metric: e.target.value as MetricKey })}>{METRIC_KEYS.map((m) => <option key={m} value={m}>{METRIC_META[m].label} · {METRIC_META[m].unit}</option>)}</select>
        <label htmlFor="real-axis">参数轴</label><select id="real-axis" value={axis} onChange={(e) => patch({ axis: e.target.value })}>{axes.map((p) => <option key={p}>{p}</option>)}</select>
        <label htmlFor="real-filter">筛选</label><select id="real-filter" value={ui.order.filter} onChange={(e) => patch({ order: { ...ui.order, filter: e.target.value as ResultFilter } })}>
          <option value="all">全部（含未执行与失败）</option><option value="pass">hard pass</option><option value="borderline">hard borderline</option><option value="fail">hard fail</option>
        </select>
        <button className="btn" onClick={() => download(`${exec.runId}.json`, machineJson({ source: 'kernel', run_id: exec.runId, spec: exec.spec, status: job.status, results: exec.results, recommendation: exec.recommendation }), 'application/json')}>下载真实结果 JSON</button>
      </div>
      {selected && !rows.some((r) => r.id === selected.id) && <p className="note-block" role="status">所选候选不在当前筛选中；检查器仍保留原选择。<button className="btn" onClick={() => patch({ order: { ...ui.order, filter: 'all' } })}>显示全部以恢复</button></p>}
      <div className="real-result-grid">
        <section className="real-result-main">
          <h2>{METRIC_META[metric].label} · 参数响应</h2>
          <p className="note">观测均值 / 内核 95% CI；约束线来自提交计划；基线仅在扫描确实运行了同一基线配置时显示。hard 长虚线，soft 点线。多轴结果按所选轴投影，不插值。</p>
          {chart(metric)}
          <div className="mini-figures">{metrics.filter((m) => m !== metric).map((m) => chart(m, true))}</div>
          <h2>候选结果 · {rows.length}/{all.length}</h2>
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
        <aside className="real-inspector" aria-label="真实候选检查器">
          <h2>选择检查器</h2>
          {selected ? <>
            <p className="mono">{selected.id}</p><p>{rowState(selected, job)}</p>
            <p>{`hard: ${verdict?.hard ?? '未判定'} · soft: ${verdict?.soft ?? '未判定'} · 整体硬约束: ${verdict?.overall ?? '未判定'}`}</p>
            <h3>候选参数快照</h3><dl>{Object.entries(fullValues(job, selected.values)).map(([p, v]) => <div key={p}><dt className="mono">{p}</dt><dd>{v}</dd></div>)}</dl>
            <button className="btn" disabled={!context || src?.status !== 'ok'} onClick={copy}>复制到新方案草稿</button>
            <h3>内核约束（原样判定）</h3>{src?.outcomes.map((o, i) => <p key={i}>{o.kind} · {o.metric} · {o.verdict}<br />{o.min !== null ? `≥ ${formatMetric(o.min, o.metric)} ` : ''}{o.max !== null ? `≤ ${formatMetric(o.max, o.metric)}` : ''}<br />{statText(o.stats, o.metric)}</p>)}
            <p>{statText(src?.stats.get(metric), metric)}</p>
          </> : <p>没有选中候选</p>}
          <h3>统计来源</h3><dl>
            <div><dt>run</dt><dd className="mono">{exec.runId}</dd></div>
            <div><dt>基线引用</dt><dd className="mono">{context?.baselineId ?? '缺失'}</dd></div>
            <div><dt>计划配置哈希</dt><dd className="mono">{plan?.config_hash ?? '缺失'}</dd></div>
            <div><dt>输入文件 SHA-256</dt><dd className="mono">{runEntry?.config_hash ?? '缺失'}</dd></div>
            <div><dt>候选配置哈希</dt><dd>扫描内核未返回，不编造</dd></div>
            <div><dt>model / schema</dt><dd>{context?.modelVersion ?? sim?.meta.model_version ?? '缺失'} / {context?.schemaVersion ?? sim?.meta.schema_version ?? '缺失'}</dd></div>
            <div><dt>随机策略</dt><dd>{plan ? `${plan.mode} · 共用 base_seed ${plan.base_seed}（replicate 配对）` : '缺失'}</dd></div>
            <div><dt>统计单位</dt><dd>replicate 均值；计划 {exec.replicates}；所选指标 n={src?.stats.get(metric)?.n ?? '不可用'}</dd></div>
            <div><dt>场景</dt><dd>{plan ? `${plan.players} 玩家 × ${plan.days} 天` : '缺失'}</dd></div>
          </dl>
        </aside>
      </div>
      <section className="result-recommendation"><h2>内核敏感性与单轴推荐</h2>
        <p className="note">仅完整候选集的单轴区间可供推荐；多轴交互、缺失指标、无括号等限制以原始理由保留。区间端点插值不作为观测结果绘图。</p>
        {rec ? <><p>{rec.param} · 基线 {rec.baseline ?? '不可用'} · 区间 {rec.interval ? `[${rec.interval.join(', ')}]` : '不可推荐'} · {rec.confidence}</p><p>{interpolationText(rec)}</p><ul>{rec.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          <div className="candidate-table-wrap"><table className="candidate-table"><thead><tr><th>参数</th><th>指标</th><th>弹性 / 区间</th><th>显著</th><th>限制</th></tr></thead><tbody>{rec.elasticities.map((e, i) => <tr key={i}><td>{e.param}</td><td>{e.metric}</td><td>{e.e ?? '不可用'} / [{e.e_lo ?? '不可用'}, {e.e_hi ?? '不可用'}]</td><td>{String(e.significant)}</td><td>{e.note}: {sensitivityNoteLabel(e.note)}</td></tr>)}</tbody></table></div>
        </> : <p>{exec.recommendationError ?? (completed < all.length ? '结果不完整，尚无推荐；已返回候选可继续分析。' : '内核未提供推荐。')}</p>}
      </section>
    </> : <section><h2>{exec.kind === 'single' ? '单次运行观测' : 'A/B 配对差值（B − A）'}</h2>
      {exec.kind === 'single' ? <p>单次运行逐日观测见下方；没有 A/B 差值统计。</p> : exec.comparison ? (() => { const v = abView(exec.comparison!); return <>
        <p>{METRIC_META[v.metric].label} · 内核判定 {v.verdict}</p><p>A: {statText(v.armA, v.metric)}</p><p>B: {statText(v.armB, v.metric)}</p>
        <p>配对差 {formatMetric(v.diffMean, v.metric, true)} · 95% CI [{formatMetric(v.diffCi95Lo, v.metric, true)}, {formatMetric(v.diffCi95Hi, v.metric, true)}] · 效应量 d={v.effectSizeD}</p>
        <p className="note">配对差、CI 与效应量直接来自 Comparison；比例差显示百分点 pp。与扫描绝对值图分开展示。</p>
      </> })() : <p>尚无真实 Comparison。{exec.errorMessage ?? '等待内核比较结果'}；不会从双臂均值自行推算差值 CI。</p>}
    </section>}
    {(exec.sim || exec.arms) && <section><h2>逐日观测（无日级 CI）</h2>
      <label>臂 <select value={ui.arm} onChange={(e) => patch({ arm: e.target.value as 'base' | 'cand' })}><option value="base">A / 单次运行</option><option value="cand">B</option></select></label>
      <label>replicate <select value={ui.replicate} onChange={(e) => patch({ replicate: Number(e.target.value) })}>{(sim?.results ?? []).map((r) => <option key={r.replicate} value={r.replicate}>{r.replicate + 1}（kernel {r.replicate}）</option>)}</select></label>
      <p className="note">run {exec.runId} · 只展示所选 replicate 的 results.day_stats；days_csv 默认仅为首个 replicate（UI 1 / kernel 0）。</p>
      {daily.ok ? <table className="candidate-table"><thead><tr><th>day</th><th>win_rate</th><th>inflation</th></tr></thead><tbody>{daily.rows.map((r) => <tr key={r.day}><td>{r.day}</td><td>{r.win_rate}</td><td>{r.inflation}</td></tr>)}</tbody></table> : <p>{daily.reason}</p>}
    </section>}
    {a.drafts.length > 0 && <section><h2>复制的新方案草稿（未运行）</h2>{a.drafts.map((d) => <div key={d.id} className="result-draft">
      <p>{d.id} · 来源 {d.sourceRunId} / {d.sourceCandidateId} · 基线 {d.baselineId}</p>
      <label htmlFor={d.id}>方案 YAML（独立编辑缓冲）</label><textarea id={d.id} value={d.yaml} rows={12} onChange={(e) => editCandidateDraft(d.id, e.target.value)} />
      <p className="note">只创建草稿，不改写原场景或运行。请将下载的 YAML 作为新场景打开，内核校验后再运行。</p>
      <button className="btn" disabled={parseConfig(d.yaml).errors.length > 0} onClick={() => download(`${d.id}.yaml`, d.yaml, 'application/yaml')}>下载新方案草稿 YAML</button>
      <button className="btn" onClick={() => download(`${d.id}.source.json`, machineJson(d), 'application/json')}>下载方案与来源 JSON</button>
      {parseConfig(d.yaml).errors.length > 0 && <p role="alert">草稿解析失败，请修正后下载。</p>}
    </div>)}{a.draftPersistenceError && <p role="alert">{a.draftPersistenceError}</p>}</section>}
  </div>
}
