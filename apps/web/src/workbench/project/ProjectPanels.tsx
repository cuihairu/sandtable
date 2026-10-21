// WB-04 · 项目面板(打开真实 .sandtable 项目时挂接):
// - ProjectConfigEditors:选中场景/实验的 YAML 草稿编辑器,草稿按对象
//   (归档路径)隔离,切换对象不覆盖另一对象(WB-04.06);
// - ProjectResultsPanel:打开项目时载入的已保存结果与版本状态,
//   未知 schema_version 给出可读提示(WB-04.04);
// - RunRegistry:运行提交时登记的不可变输入快照(配置哈希/版本/seed/
//   实验条件)与产物路径(WB-04.09/08);WB-09.07 起真实 run 终局落档,
//   在场产物可下载再导出,缺失产物仍点名(audit)。
// WB-11.16 · 面板文案走词典(data.project.*);report schema 版本行与
// unknown-version 的内核消息保持原文(内核契约)。
import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { WbIcon } from '../components/icons.tsx'
import { addCandidateDraft } from '../analysis/analysisStore.ts'
import { dispatch } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import {
  auditRunArtifacts,
  baseContentOf,
  draftOf,
  filterRunHistory,
  runIndexEntryOf,
  runInputSnapshotOf,
  snapshotRun,
} from '../state/projectDoc.ts'
import type { RunIndexEntry, ResultFileStatus } from '../state/projectDoc.ts'
import { createId, hashId, ID_PREFIXES } from '../ids.ts'
import type { BaselineId } from '../ids.ts'
import type { CandidateDraft } from '../analysis/resultModel.ts'
import * as runManager from '../state/runManager.ts'
import { notify } from '../state/notifications.ts'
import { ScenarioVersionsPanel } from './ScenarioVersionsPanel.tsx'
import { download } from '../demo/export.ts'
import { t } from '../../lib/i18n/index.ts'
import type { Locale } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

function DraftEditor({
  state, path, label, icon,
}: {
  state: WorkbenchState
  path: string
  label: string
  icon: string
}): JSX.Element {
  const locale = useLocale()
  const doc = state.project!
  const base = baseContentOf(doc, path)
  const d = draftOf(state.objectDrafts, path, base)
  const dirty = d.content !== base
  return (
    <section className="form-section" aria-label={t(locale, 'data.project.draftAria', { label })} data-wb-object={path}>
      <div className="form-section-heading">
        <span className="step">{icon === 'flask' ? '02' : '01'}</span>
        <h2>{label}:<span className="mono" style={{ fontSize: 12 }}>{path}</span></h2>
        <span className={`badge${d.saved ? '' : ' amber'}`} role="status">
          {d.saved ? t(locale, 'data.project.saved') : t(locale, 'common.unsaved')}
        </span>
      </div>
      <textarea
        value={d.content}
        rows={10}
        spellCheck={false}
        aria-label={t(locale, 'data.project.draftAriaYaml', { label, path })}
        onChange={(e) => dispatch({ type: 'object/draft', key: path, content: e.target.value })}
      />
      {dirty && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn" onClick={() => dispatch({ type: 'object/undo', key: path })}>
            <WbIcon name="undo" />
            {t(locale, 'data.project.undoEdit')}
          </button>
          <button className="btn" onClick={() => dispatch({ type: 'object/reset', key: path })}>
            <WbIcon name="reset" />
            {t(locale, 'data.project.discardEdit')}
          </button>
        </div>
      )}
      {/* P1-02/03/05 · 场景配置版本:每场景独立历史 + 可指定/可回切基线 + 改动备注 */}
      {doc.objects.find((o) => o.path === path)?.kind === 'scenario' && (
        <ScenarioVersionsPanel
          path={path}
          content={d.content}
          baseContent={base}
        />
      )}
    </section>
  )
}

/** WB-04.06 · 项目配置草稿编辑器:每个对象独立缓冲,互不覆盖。 */
export function ProjectConfigEditors({ state }: { state: WorkbenchState }): JSX.Element | null {
  const locale = useLocale()
  const doc = state.project
  if (!doc) return null
  const scenarioPath = state.selection.scenario || null
  const experimentPath = state.selection.experiment || null
  if (!scenarioPath && !experimentPath) return null
  return (
    <>
      {scenarioPath && <DraftEditor state={state} path={scenarioPath} label={t(locale, 'data.project.labelScenario')} icon="sliders" />}
      {experimentPath && <DraftEditor state={state} path={experimentPath} label={t(locale, 'data.project.labelExperiment')} icon="flask" />}
    </>
  )
}

function statusText(st: ResultFileStatus | undefined, locale: Locale): { text: string; error: boolean } {
  if (!st) return { text: t(locale, 'data.project.artifact'), error: false }
  if (st.state === 'known') return { text: `report schema ${st.version}`, error: false }
  if (st.state === 'unknown-version') return { text: st.message, error: true }
  return { text: t(locale, 'data.project.artifactRaw'), error: false }
}

function copyRunCandidate(entry: RunIndexEntry, state: WorkbenchState, locale: Locale): void {
  const snapshot = runInputSnapshotOf(entry, state.runArtifacts)
  if (!snapshot.experimentYaml) {
    notify('error', t(locale, 'data.project.snapshotUnavailable'))
    return
  }
  const draft: CandidateDraft = {
    id: String(createId(ID_PREFIXES.candidate)),
    sourceRunId: entry.run_id,
    sourceCandidateId: '',
    baselineId: hashId(ID_PREFIXES.baseline, state.project!.projectId, entry.scenario_path ?? '') as BaselineId,
    baselineYaml: snapshot.scenarioYaml ?? snapshot.experimentYaml,
    values: {},
    yaml: snapshot.experimentYaml,
  }
  addCandidateDraft(draft)
  notify('success', t(locale, 'data.project.copyRunDone', { runId: entry.run_id }))
}

function rerunSpecIsExecutable(spec: unknown): spec is Parameters<typeof runManager.enqueueRun>[0]['spec'] {
  return Boolean(spec && typeof spec === 'object' && 'kind' in spec)
}

function restoreRunDrafts(entry: RunIndexEntry, state: WorkbenchState, locale: Locale): void {
  const snapshot = runInputSnapshotOf(entry, state.runArtifacts)
  if (!snapshot.scenarioYaml && !snapshot.experimentYaml) {
    notify('error', t(locale, 'data.project.snapshotUnavailable'))
    return
  }
  if (snapshot.scenarioYaml && entry.scenario_path) {
    dispatch({ type: 'object/draft', key: entry.scenario_path, content: snapshot.scenarioYaml })
  }
  if (snapshot.experimentYaml && entry.experiment_path) {
    dispatch({ type: 'object/draft', key: entry.experiment_path, content: snapshot.experimentYaml })
  }
  notify('success', t(locale, 'data.project.restoreRunDone', { runId: entry.run_id }))
}

function rerunHistoryEntry(entry: RunIndexEntry, state: WorkbenchState, locale: Locale): void {
  void (async () => {
    const snapshot = runInputSnapshotOf(entry, state.runArtifacts)
    const yaml = snapshot.experimentYaml
    if (!yaml) {
      notify('error', t(locale, 'data.project.snapshotUnavailable'))
      return
    }
    try {
      const rerun = await snapshotRun({
        experimentId: entry.experiment_id,
        scenarioPath: entry.scenario_path,
        experimentPath: entry.experiment_path,
        yaml,
        modelVersion: entry.model_version,
        schemaVersion: entry.schema_version,
        seed: entry.seed,
        conditions: { ...entry.conditions, rerun_of: entry.run_id },
        dataSource: entry.data_source,
      })
      if (!rerunSpecIsExecutable(snapshot.spec)) throw new Error('run snapshot mismatch')
      const spec = snapshot.spec
      const job = runManager.enqueueRun({
        experimentId: entry.experiment_id,
        runId: rerun.runId,
        name: `Rerun ${entry.run_id}`,
        method: spec.kind.toUpperCase(),
        spec,
      })
      if (job) {
        dispatch({ type: 'run/register', entry: runIndexEntryOf(rerun, undefined) })
        dispatch({ type: 'navigate', page: 'runs' })
        notify('success', t(locale, 'data.project.rerunQueued', { runId: rerun.runId }))
      }
    } catch {
      notify('error', t(locale, 'data.project.rerunUnavailable'))
    }
  })()
}

/** WB-04.04 · 已保存结果:打开项目时全部载入并列出版本状态。 */
export function ProjectResultsPanel({ state }: { state: WorkbenchState }): JSX.Element | null {
  const locale = useLocale()
  const doc = state.project
  if (!doc) return null
  const results = doc.objects.filter((o) => o.kind === 'result')
  return (
    <section className="form-section" aria-label={t(locale, 'data.project.resultsAria')}>
      <div className="form-section-heading">
        <h2>{t(locale, 'data.project.resultsTitle', { n: results.length })}</h2>
      </div>
      {results.length === 0 ? (
        <p className="muted">{t(locale, 'data.project.resultsEmpty')}</p>
      ) : (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {results.map((o) => {
            const st = statusText(doc.resultStatus[o.path], locale)
            return (
              <li key={o.path} className="mono" style={{ fontSize: 12, lineHeight: 1.9 }}>
                {o.path}
                {st.error ? (
                  <span role="alert" style={{ color: 'var(--wb-red)' }}>
                    <WbIcon name="warning" /> {st.text}
                  </span>
                ) : (
                  <span className="muted"> — {st.text}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** WB-04.09/08 · 运行快照登记簿:提交时生成的不可变输入快照。 */
export function RunRegistry({ state }: { state: WorkbenchState }): JSX.Element | null {
  const locale = useLocale()
  const [query, setQuery] = useState('')
  const [fromDay, setFromDay] = useState('')
  const [toDay, setToDay] = useState('')
  const runs = useMemo(
    () => filterRunHistory(state.runs, { query, fromDay: fromDay || undefined, toDay: toDay || undefined }),
    [state.runs, query, fromDay, toDay],
  )
  if (!state.project) return null
  const doc = state.project
  // WB-03.02 · 索引声称的产物逐条与在场文件对照:缺失的点名标出,不静默跳过
  const present = new Set<string>([
    ...(doc.files.keys()),
    ...Object.keys(state.runArtifacts),
  ])
  const missing = new Set(auditRunArtifacts(runs, present).map((m) => m.file))
  // WB-09.07 · 在场产物内容:本会话终局落档优先,归档回读的文件字节兜底;
  // 两者都没有 = 缺失(上面点名),此处不再触发下载(不显示成功)
  const artifactOf = (f: string): string | Uint8Array | undefined =>
    state.runArtifacts[f] ?? doc.files.get(f)
  const mimeOf = (f: string): string =>
    f.endsWith('.json') ? 'application/json' : f.endsWith('.csv') ? 'text/csv' : 'application/octet-stream'
  return (
    <section className="form-section" aria-label={t(locale, 'data.project.registryAria')}>
      <div className="form-section-heading">
        <h2>{t(locale, 'data.project.registryTitle', { n: state.runs.length })}</h2>
      </div>
      <div className="history-filter" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <input
          value={query}
          placeholder={t(locale, 'data.project.searchPlaceholder')}
          aria-label={t(locale, 'data.project.searchAria')}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input type="date" value={fromDay} aria-label={t(locale, 'data.project.fromDateAria')} onChange={(e) => setFromDay(e.target.value)} />
        <input type="date" value={toDay} aria-label={t(locale, 'data.project.toDateAria')} onChange={(e) => setToDay(e.target.value)} />
      </div>
      {state.runs.length === 0 ? (
        <p className="muted">{t(locale, 'data.project.registryEmpty')}</p>
      ) : runs.length === 0 ? (
        <p className="muted" role="status">{t(locale, 'data.project.historyNoMatches')}</p>
      ) : (
        <table style={{ width: '100%', marginTop: 8, fontSize: 12 }}>
          <thead>
            <tr>
              <th>run ID</th>
              <th>{t(locale, 'data.project.colInputHash')}</th>
              <th>seed</th>
              <th>model / schema</th>
              <th>{t(locale, 'data.project.colConditions')}</th>
              <th>{t(locale, 'data.project.colArtifacts')}</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.run_id}>
                <td className="mono">{r.run_id.slice(0, 15)}…</td>
                <td className="mono">{r.config_hash.slice(0, 12)}…</td>
                <td className="mono">{String(r.seed)}</td>
                <td className="mono">{r.model_version} / {r.schema_version}</td>
                <td className="mono">
                  {Object.entries(r.conditions).map(([k, v]) => `${k}=${String(v)}`).join(', ')}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className="btn" data-action="copy-run" onClick={() => copyRunCandidate(r, state, locale)}>{t(locale, 'data.project.copyRun')}</button>
                    <button className="btn" data-action="rerun-run" onClick={() => rerunHistoryEntry(r, state, locale)}>{t(locale, 'data.project.rerunRun')}</button>
                    <button className="btn" data-action="restore-run" onClick={() => restoreRunDrafts(r, state, locale)}>{t(locale, 'data.project.restoreRun')}</button>
                  </div>
                </td>
                <td className="mono">
                  {r.files.length === 0
                    ? t(locale, 'data.project.noFiles')
                    : r.files.flatMap((f, i) => {
                        const node = missing.has(f)
                          ? (
                            <span key={f} role="alert" style={{ color: 'var(--wb-red)' }}>
                              <WbIcon name="warning" /> {f} · {t(locale, 'data.project.missingArtifact')}
                            </span>
                          )
                          : (
                            <span key={f} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                              <span>{f}</span>
                              <button
                                className="btn"
                                style={{ padding: '0 6px', fontSize: 11 }}
                                onClick={() => {
                                  const data = artifactOf(f)
                                  // 内容不在场(竞态)不下载也不提示成功
                                  if (data !== undefined) download(f.split('/').pop() ?? f, data, mimeOf(f))
                                }}
                              >
                                {t(locale, 'data.project.downloadArtifact')}
                              </button>
                            </span>
                          )
                        return i === 0 ? [node] : [' ', node]
                      })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ marginTop: 8 }}>
        {t(locale, 'data.project.registryNote')}
      </p>
    </section>
  )
}
