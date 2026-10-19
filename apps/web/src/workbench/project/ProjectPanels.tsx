// WB-04 · 项目面板(打开真实 .sandtable 项目时挂接):
// - ProjectConfigEditors:选中场景/实验的 YAML 草稿编辑器,草稿按对象
//   (归档路径)隔离,切换对象不覆盖另一对象(WB-04.06);
// - ProjectResultsPanel:打开项目时载入的已保存结果与版本状态,
//   未知 schema_version 给出可读提示(WB-04.04);
// - RunRegistry:运行提交时登记的不可变输入快照(配置哈希/版本/seed/
//   实验条件)与产物路径(WB-04.09/08)。内核执行接入前(WB-07)如实
//   标注:只有输入快照,没有产物。
// WB-11.16 · 面板文案走词典(data.project.*);report schema 版本行与
// unknown-version 的内核消息保持原文(内核契约)。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import { dispatch } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import { auditRunArtifacts, baseContentOf, draftOf } from '../state/projectDoc.ts'
import type { ResultFileStatus } from '../state/projectDoc.ts'
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
  if (!state.project) return null
  const runs = state.runs
  // WB-03.02 · 索引声称的产物逐条与在场文件对照:缺失的点名标出,不静默跳过
  const present = new Set<string>([
    ...(state.project.files.keys()),
    ...Object.keys(state.runArtifacts),
  ])
  const missing = new Set(auditRunArtifacts(runs, present).map((m) => m.file))
  return (
    <section className="form-section" aria-label={t(locale, 'data.project.registryAria')}>
      <div className="form-section-heading">
        <h2>{t(locale, 'data.project.registryTitle', { n: runs.length })}</h2>
      </div>
      {runs.length === 0 ? (
        <p className="muted">{t(locale, 'data.project.registryEmpty')}</p>
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
                          : <span key={f}>{f}</span>
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
