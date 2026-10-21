// P1-01/05 · 项目库面板(项目与场景管理 ①⑤):项目创建/复制/归档(可恢复
// 软态)/恢复/重命名与项目级改动备注。数据面:
// - 元数据在 projectRegistry(StorageLike 持久化);项目内容始终走 ProjectDoc
//   → buildProjectSave → packProject 写回 .sandtable(不在此另存内容);
// - 创建 = 注册表条目 + 单场景默认配置文档(内容面交给既有数据层);
// - 复制对当前打开项目执行:新项目 ID + 同内容独立文档,由调用方打开;
// - 归档只翻软态标记,不删条目、不碰归档字节;恢复即翻回。
// WB-11 · 文案全走词典(data.projects.* / common.*)。
import type { JSX } from 'react'
import { useSyncExternalStore, useState } from 'react'
import {
  registrySnapshot, registrySubscribe,
  registryCreate, registryArchive, registryRestore, registryRename, registrySetNote,
} from './projectRegistry.ts'
import { createProjectDoc, duplicateProjectDoc } from './projectOps.ts'
import { OverlayDialog } from '../overlays/OverlayDialog.tsx'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import { fmtDate } from '../../lib/i18n/format.ts'
import type { ProjectDoc } from '../state/projectDoc.ts'

export type ProjectsPanelProps = {
  open: boolean
  onClose: () => void
  /** 当前打开的项目(null = 演示模式,未挂接真实项目) */
  doc: ProjectDoc | null
  /** 采用(打开)新文档:创建/复制成功后由调用方接 project/open 与通知 */
  onAdoptDoc: (doc: ProjectDoc) => void
  /** 当前项目改名(联动 ProjectDoc,保存时落 manifest name) */
  onRenameDoc: (name: string) => void
}

export function ProjectsPanel({ open, onClose, doc, onAdoptDoc, onRenameDoc }: ProjectsPanelProps): JSX.Element {
  const locale = useLocale()
  const registry = useSyncExternalStore(registrySubscribe, registrySnapshot)
  const [newName, setNewName] = useState('')
  const [newNote, setNewNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const active = registry.entries.filter((e) => !e.archived)
  const archived = registry.entries.filter((e) => e.archived)
  const sorted = [...active].sort((a, b) => b.updatedAtUnix - a.updatedAtUnix)
  const create = (): void => {
    const created = registryCreate(newName, newNote)
    if (!created.ok) {
      setError(created.error)
      return
    }
    setError(null)
    setNewName('')
    setNewNote('')
    const made = createProjectDoc(created.entry.name)
    if (made.ok) onAdoptDoc(made.doc)
  }
  const duplicateCurrent = (): void => {
    if (!doc) return
    const copied = duplicateProjectDoc(doc, `${doc.name} copy`)
    if (copied.ok) onAdoptDoc(copied.doc)
  }
  const currentEntry = doc ? registry.entries.find((e) => e.projectId === doc.projectId) ?? null : null
  return (
    <OverlayDialog open={open} onClose={onClose} title={t(locale, 'data.projects.title', { n: registry.entries.length })}>
      <section className="form-section" aria-label={t(locale, 'data.projects.createAria')}>
        <div className="form-section-heading"><h3>{t(locale, 'data.projects.create')}</h3></div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input
            value={newName}
            size={20}
            placeholder={t(locale, 'data.projects.nameLabel')}
            aria-label={t(locale, 'data.projects.nameAria')}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            value={newNote}
            size={28}
            placeholder={t(locale, 'data.projects.noteLabel')}
            aria-label={t(locale, 'data.projects.noteAria')}
            onChange={(e) => setNewNote(e.target.value)}
          />
          <button className="btn" onClick={create}>{t(locale, 'data.projects.createAction')}</button>
        </div>
        {error !== null && <p role="alert" style={{ color: 'var(--wb-red)' }}>{error}</p>}
      </section>
      {doc && (
        <section className="form-section" aria-label={t(locale, 'data.projects.currentAria')}>
          <div className="form-section-heading">
            <h3>{t(locale, 'data.projects.currentTitle')}</h3>
            <span className="badge">{t(locale, 'data.projects.currentTag')}</span>
          </div>
          <p className="mono" style={{ fontSize: 12 }}>{doc.projectId}</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input
              value={currentEntry?.name ?? doc.name}
              size={20}
              aria-label={t(locale, 'data.projects.renameAria')}
              onChange={(e) => {
                onRenameDoc(e.target.value)
                registryRename(doc.projectId, e.target.value)
              }}
            />
            <input
              value={currentEntry?.note ?? ''}
              size={28}
              placeholder={t(locale, 'data.projects.noteLabel')}
              aria-label={t(locale, 'data.projects.currentNoteAria')}
              onChange={(e) => registrySetNote(doc.projectId, e.target.value)}
            />
            <button className="btn" onClick={duplicateCurrent}>{t(locale, 'data.projects.duplicateCurrent')}</button>
            <button className="btn" onClick={() => registryArchive(doc.projectId)}>{t(locale, 'data.projects.archive')}</button>
          </div>
        </section>
      )}
      <section className="form-section" aria-label={t(locale, 'data.projects.listAria')}>
        <div className="form-section-heading"><h3>{t(locale, 'data.projects.listTitle', { n: sorted.length })}</h3></div>
        {sorted.length === 0 && <p className="muted">{t(locale, 'data.projects.empty')}</p>}
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, listStyle: 'none' }}>
          {sorted.map((e) => (
            <li key={e.projectId} style={{ lineHeight: 1.9 }} data-wb-project={e.projectId}>
              <span className="mono" style={{ fontSize: 12 }}>{e.name}</span>
              {doc?.projectId === e.projectId && <span className="badge"> {t(locale, 'data.projects.currentTag')}</span>}
              {e.note !== '' && <span className="muted"> — {e.note}</span>}
              <span className="muted mono" style={{ fontSize: 11 }}> · {fmtDate(locale, new Date(e.updatedAtUnix * 1000).toISOString())}</span>
            </li>
          ))}
        </ul>
        {archived.length > 0 && (
          <>
            <h3 style={{ marginTop: 12 }}>{t(locale, 'data.projects.archivedTitle', { n: archived.length })}</h3>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, listStyle: 'none' }}>
              {archived.map((e) => (
                <li key={e.projectId} style={{ lineHeight: 1.9 }} data-wb-project={e.projectId}>
                  <span className="mono muted" style={{ fontSize: 12 }}>{e.name}</span>
                  <span className="badge amber"> {t(locale, 'data.projects.archivedBadge')}</span>
                  {e.note !== '' && <span className="muted"> — {e.note}</span>}
                  <button className="btn" style={{ marginLeft: 8, padding: '0 6px', fontSize: 11 }} onClick={() => registryRestore(e.projectId)}>
                    {t(locale, 'data.projects.restore')}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <p className="muted" style={{ marginTop: 8 }}>{t(locale, 'data.projects.hint')}</p>
    </OverlayDialog>
  )
}
