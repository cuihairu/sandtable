// P1-02/03/05 · 场景配置版本面板(挂在项目场景草稿编辑器下):
// - 每场景独立的版本历史(同内容去重),版本带标签与改动备注;
// - 当前基线可指定到任一已存版本、可回切(上一指定 → 项目文件原文);
// - 场景级改动备注;生效基线如实标注来源(版本 / 项目文件)。
// 基线只读语义不变:切换只改参照系指向,不改写任何已存内容(数据层
// scenarioVersions.ts;React 只组合)。
import type { JSX } from 'react'
import { useSyncExternalStore, useState } from 'react'
import {
  scenarioVersionsSnapshot, subscribeScenarioVersions,
  versionsSaveVersion, versionsSetBaseline, versionsRevertBaseline,
  versionsSetScenarioNote, versionsUpdateNote, effectiveBaseline,
} from './scenarioVersions.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import { fmtDate } from '../../lib/i18n/format.ts'

export function ScenarioVersionsPanel({ path, content, baseContent }: {
  path: string
  /** 当前编辑缓冲(保存版本 = 给当前内容拍快照) */
  content: string
  baseContent: string
}): JSX.Element {
  const locale = useLocale()
  const store = useSyncExternalStore(subscribeScenarioVersions, scenarioVersionsSnapshot)
  const [note, setNoteText] = useState('')
  const [label, setLabelText] = useState('')
  const versions = store.versions[path] ?? []
  const baseline = effectiveBaseline(store, path, baseContent)
  const scenarioNote = store.notes[path] ?? ''
  const saveCurrent = (): void => {
    const draft = versionsSaveVersion(path, content, { label, note })
    if (draft.ok) {
      setNoteText('')
      setLabelText('')
    }
  }
  return (
    <section className="form-section" aria-label={t(locale, 'data.versions.aria', { path })} data-wb-versions={path}>
      <div className="form-section-heading">
        <h2>{t(locale, 'data.versions.title', { n: versions.length })}</h2>
        <span className={`badge${baseline.source === 'version' ? '' : ' amber'}`} role="status">
          {t(locale, 'data.versions.baselineSource')}{' '}
          {baseline.source === 'version'
            ? `${versionLabelOf(store, path, baseline.versionId)} · ${String(baseline.versionId).slice(0, 12)}…`
            : t(locale, 'data.versions.fileBaseline')}
        </span>
      </div>
      {versions.length > 0 && (
        <table style={{ width: '100%', marginTop: 8, fontSize: 12 }}>
          <thead>
            <tr>
              <th>{t(locale, 'data.versions.colVersion')}</th>
              <th>{t(locale, 'data.versions.colNote')}</th>
              <th>{t(locale, 'data.versions.colTime')}</th>
              <th>{t(locale, 'data.versions.colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => {
              const isBaseline = baseline.versionId === v.versionId
              return (
                <tr key={v.versionId}>
                  <td className="mono">
                    {v.label}
                    {isBaseline && <span className="badge"> {t(locale, 'data.versions.baselineBadge')}</span>}
                    <span className="muted"> {v.versionId.slice(0, 10)}…</span>
                  </td>
                  <td>
                    <input
                      value={v.note}
                      size={18}
                      aria-label={t(locale, 'data.versions.noteEditAria', { label: v.label })}
                      onChange={(e) => versionsUpdateNote(path, v.versionId, e.target.value)}
                    />
                  </td>
                  <td className="mono">{fmtDate(locale, new Date(v.createdAtUnix * 1000).toISOString())}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    {!isBaseline && (
                      <button className="btn" style={{ padding: '0 6px', fontSize: 11 }} onClick={() => versionsSetBaseline(path, v.versionId)}>
                        {t(locale, 'data.versions.setBaseline')}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {versions.length === 0 && <p className="muted" style={{ marginTop: 8 }}>{t(locale, 'data.versions.empty')}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <input
          value={label}
          size={8}
          placeholder={t(locale, 'data.versions.labelLabel')}
          aria-label={t(locale, 'data.versions.labelAria')}
          onChange={(e) => setLabelText(e.target.value)}
        />
        <input
          value={note}
          size={28}
          placeholder={t(locale, 'data.versions.noteLabel')}
          aria-label={t(locale, 'data.versions.noteAria')}
          onChange={(e) => setNoteText(e.target.value)}
        />
        <button className="btn" onClick={saveCurrent}>{t(locale, 'data.versions.save')}</button>
        <button className="btn" onClick={() => versionsRevertBaseline(path)}>{t(locale, 'data.versions.revertBaseline')}</button>
      </div>
      <label style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
        {t(locale, 'data.versions.scenarioNote')}
        <textarea
          value={scenarioNote}
          rows={2}
          style={{ display: 'block', width: '100%' }}
          aria-label={t(locale, 'data.versions.scenarioNoteAria')}
          onChange={(e) => versionsSetScenarioNote(path, e.target.value)}
        />
      </label>
      <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>{t(locale, 'data.versions.note')}</p>
    </section>
  )
}

function versionLabelOf(
  store: ReturnType<typeof scenarioVersionsSnapshot>,
  path: string,
  versionId: string | null,
): string {
  if (versionId === null) return ''
  return (store.versions[path] ?? []).find((v) => v.versionId === versionId)?.label ?? versionId.slice(0, 8)
}
