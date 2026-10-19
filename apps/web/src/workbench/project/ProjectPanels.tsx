// WB-04 · 项目面板(打开真实 .sandtable 项目时挂接):
// - ProjectConfigEditors:选中场景/实验的 YAML 草稿编辑器,草稿按对象
//   (归档路径)隔离,切换对象不覆盖另一对象(WB-04.06);
// - ProjectResultsPanel:打开项目时载入的已保存结果与版本状态,
//   未知 schema_version 给出可读提示(WB-04.04);
// - RunRegistry:运行提交时登记的不可变输入快照(配置哈希/版本/seed/
//   实验条件)与产物路径(WB-04.09/08)。内核执行接入前(WB-07)如实
//   标注:只有输入快照,没有产物。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import { dispatch } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import { baseContentOf, draftOf } from '../state/projectDoc.ts'
import type { ResultFileStatus } from '../state/projectDoc.ts'

function DraftEditor({
  state, path, label, icon,
}: {
  state: WorkbenchState
  path: string
  label: string
  icon: string
}): JSX.Element {
  const doc = state.project!
  const base = baseContentOf(doc, path)
  const d = draftOf(state.objectDrafts, path, base)
  const dirty = d.content !== base
  return (
    <section className="form-section" aria-label={`${label}配置草稿`} data-wb-object={path}>
      <div className="form-section-heading">
        <span className="step">{icon === 'flask' ? '02' : '01'}</span>
        <h2>{label}:<span className="mono" style={{ fontSize: 12 }}>{path}</span></h2>
        <span className={`badge${d.saved ? '' : ' amber'}`} role="status">
          {d.saved ? '与项目文件一致' : '未保存'}
        </span>
      </div>
      <textarea
        value={d.content}
        rows={10}
        spellCheck={false}
        aria-label={`${label}配置 YAML(${path})`}
        onChange={(e) => dispatch({ type: 'object/draft', key: path, content: e.target.value })}
      />
      {dirty && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn" onClick={() => dispatch({ type: 'object/undo', key: path })}>
            <WbIcon name="undo" />
            撤销本次修改
          </button>
          <button className="btn" onClick={() => dispatch({ type: 'object/reset', key: path })}>
            <WbIcon name="reset" />
            放弃修改(回到项目文件)
          </button>
        </div>
      )}
    </section>
  )
}

/** WB-04.06 · 项目配置草稿编辑器:每个对象独立缓冲,互不覆盖。 */
export function ProjectConfigEditors({ state }: { state: WorkbenchState }): JSX.Element | null {
  const doc = state.project
  if (!doc) return null
  const scenarioPath = state.selection.scenario || null
  const experimentPath = state.selection.experiment || null
  if (!scenarioPath && !experimentPath) return null
  return (
    <>
      {scenarioPath && <DraftEditor state={state} path={scenarioPath} label="场景" icon="sliders" />}
      {experimentPath && <DraftEditor state={state} path={experimentPath} label="实验" icon="flask" />}
    </>
  )
}

function statusText(st: ResultFileStatus | undefined): { text: string; error: boolean } {
  if (!st) return { text: '产物', error: false }
  if (st.state === 'known') return { text: `report schema ${st.version}`, error: false }
  if (st.state === 'unknown-version') return { text: st.message, error: true }
  return { text: '产物(按字节保留,不解析)', error: false }
}

/** WB-04.04 · 已保存结果:打开项目时全部载入并列出版本状态。 */
export function ProjectResultsPanel({ state }: { state: WorkbenchState }): JSX.Element | null {
  const doc = state.project
  if (!doc) return null
  const results = doc.objects.filter((o) => o.kind === 'result')
  return (
    <section className="form-section" aria-label="项目已保存结果">
      <div className="form-section-heading">
        <h2>项目已保存结果({results.length})</h2>
      </div>
      {results.length === 0 ? (
        <p className="muted">项目内没有已保存结果;运行并保存后这里会出现结果条目。</p>
      ) : (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {results.map((o) => {
            const st = statusText(doc.resultStatus[o.path])
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
  if (!state.project) return null
  const runs = state.runs
  return (
    <section className="form-section" aria-label="运行快照登记">
      <div className="form-section-heading">
        <h2>运行快照登记({runs.length})</h2>
      </div>
      {runs.length === 0 ? (
        <p className="muted">尚无登记的运行;提交运行时会生成不可变输入快照(配置哈希 / 模型与 schema 版本 / seed / 实验条件)。</p>
      ) : (
        <table style={{ width: '100%', marginTop: 8, fontSize: 12 }}>
          <thead>
            <tr>
              <th>run ID</th>
              <th>输入 sha256</th>
              <th>seed</th>
              <th>model / schema</th>
              <th>实验条件</th>
              <th>产物路径</th>
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
                <td className="mono">{r.files.join(' ') || '—(执行接入后补充)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted" style={{ marginTop: 8 }}>
        快照在提交时冻结(同输入恒得同 run ID);内核执行接入前如实标注 model/schema = unknown,不冒充已知版本。
        保存项目时登记与产物按 results/&lt;run_id&gt;.&lt;产物&gt; 平铺写入,并附 results/runs.json 索引。
      </p>
    </section>
  )
}
