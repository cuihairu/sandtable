// P1 · 参数元信息面板(todo 351 行项 ②④):检查器内的元信息区——八项字段
// 逐项展示(缺失显式「未定义」)、收藏切换、逐字段编辑;写入走 metaUpsert
// (持久化 + 既有版本簿 versionsSaveVersion,同内容去重),校验问题就地
// 点名(metaIssues:范围/步长/类型不一致类规则)。纯展示组件:状态来自
// paramMeta 会话快照,不持第二份事实源。
import { useState, useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import { notify } from '../state/notifications.ts'
import { registryParam } from '../params/paramRegistry.ts'
import {
  metaDisplay, metaIssues, metaSetFavorite, metaUpsert, paramMetaSnapshot,
  subscribeParamMeta,
} from './paramMeta.ts'

type MetaForm = {
  displayName: string
  unit: string
  rangeMin: string
  rangeMax: string
  step: string
  group: string
  tags: string
  source: string
  impactKpi: string
}

const EMPTY_FORM: MetaForm = {
  displayName: '', unit: '', rangeMin: '', rangeMax: '', step: '',
  group: '', tags: '', source: '', impactKpi: '',
}

function numOrNull(text: string): number | undefined {
  const s = text.trim()
  if (s === '') return undefined
  const n = Number(s)
  return Number.isFinite(n) ? n : Number.NaN // NaN = 用户填了但不是数,交给校验点名
}

/** 参数元信息区(key=path:切换参数时表单复位)。 */
export function ParamMetaPanel({ path, projectOpen }: { path: string; projectOpen: boolean }): JSX.Element {
  const locale = useLocale()
  const store = useSyncExternalStore(subscribeParamMeta, paramMetaSnapshot)
  const entry = store.entries[path]
  const favorite = store.favorites[path] === true
  const kind = registryParam(path)?.kind ?? null
  const issues = metaIssues(entry?.meta, kind)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<MetaForm>(EMPTY_FORM)

  const startEdit = (): void => {
    setForm({
      displayName: entry?.meta.displayName ?? '',
      unit: entry?.meta.unit ?? '',
      rangeMin: entry?.meta.range ? String(entry.meta.range.min) : '',
      rangeMax: entry?.meta.range ? String(entry.meta.range.max) : '',
      step: entry?.meta.step !== undefined ? String(entry.meta.step) : '',
      group: entry?.meta.group ?? '',
      tags: entry?.meta.tags ? entry.meta.tags.join(', ') : '',
      source: entry?.meta.source ?? '',
      impactKpi: entry?.meta.impactKpi ?? '',
    })
    setEditing(true)
  }

  const save = (): void => {
    const min = numOrNull(form.rangeMin)
    const max = numOrNull(form.rangeMax)
    const range = min !== undefined && max !== undefined ? { min, max } : undefined
    const outcome = metaUpsert(path, {
      displayName: form.displayName,
      unit: form.unit,
      range,
      step: numOrNull(form.step),
      group: form.group,
      tags: form.tags === '' ? undefined : form.tags.split(/[,，、]/).map((s) => s.trim()).filter((s) => s !== ''),
      source: form.source,
      impactKpi: form.impactKpi,
    })
    if (!outcome.ok) {
      notify('warning', outcome.error ?? t(locale, 'params.metaSaveFailed'))
      return
    }
    setEditing(false)
    notify('success', t(locale, 'params.metaSaved'))
  }

  const kv = (label: string, value: string): JSX.Element => (
    <div className="inspector-kv">
      <span>{label}</span>
      <span className={value === t(locale, 'params.metaUndefined') ? 'muted' : 'mono'}>{value}</span>
    </div>
  )

  return (
    <div data-wb-param-meta={path}>
      <div className="inspector-kv">
        <span>{t(locale, 'params.metaFavorite')}</span>
        <button
          className="btn"
          style={{ padding: '0 6px', fontSize: 11 }}
          disabled={!projectOpen}
          onClick={() => {
            const out = metaSetFavorite(path, !favorite)
            if (!out.ok) notify('warning', out.error ?? t(locale, 'params.metaSaveFailed'))
          }}
          aria-pressed={favorite}
        >
          <WbIcon name="star" />
          {favorite ? t(locale, 'params.metaUnfavorite') : t(locale, 'params.metaFavoriteAction')}
        </button>
      </div>
      {kv(t(locale, 'params.metaDisplayName'), metaDisplay(entry?.meta.displayName))}
      {kv(t(locale, 'params.metaUnitField'), metaDisplay(entry?.meta.unit))}
      {kv(t(locale, 'params.metaRange'), metaDisplay(entry?.meta.range))}
      {kv(t(locale, 'params.metaStep'), metaDisplay(entry?.meta.step))}
      {kv(t(locale, 'params.metaGroup'), metaDisplay(entry?.meta.group))}
      {kv(t(locale, 'params.metaTags'), metaDisplay(entry?.meta.tags))}
      {kv(t(locale, 'params.metaSourceField'), metaDisplay(entry?.meta.source))}
      {kv(t(locale, 'params.metaImpact'), metaDisplay(entry?.meta.impactKpi))}
      {issues.length > 0 && (
        <div role="alert" style={{ marginTop: 6 }}>
          {issues.map((i, idx) => (
            <p key={idx} className="parameter-error" style={{ margin: '2px 0' }}>
              <WbIcon name="warning" /> {i.field}: {i.message}
            </p>
          ))}
        </div>
      )}
      {!projectOpen && (
        <p className="muted" style={{ marginTop: 6 }}>{t(locale, 'params.metaNoProject')}</p>
      )}
      {editing ? (
        <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
          {(
            [
              ['params.metaDisplayName', 'displayName'],
              ['params.metaUnitField', 'unit'],
              ['params.metaGroup', 'group'],
              ['params.metaSourceField', 'source'],
              ['params.metaImpact', 'impactKpi'],
            ] as const
          ).map(([key, field]) => (
            <input
              key={field}
              style={{ width: "100%", fontSize: 12 }}
              aria-label={t(locale, key)}
              placeholder={t(locale, key)}
              value={form[field]}
              onChange={(e) => setForm((s) => ({ ...s, [field]: e.target.value }))}
            />
          ))}
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              style={{ width: "100%", fontSize: 12 }}
              aria-label={t(locale, 'params.metaRangeMin')}
              placeholder={t(locale, 'params.metaRangeMin')}
              value={form.rangeMin}
              onChange={(e) => setForm((s) => ({ ...s, rangeMin: e.target.value }))}
            />
            <input
              style={{ width: "100%", fontSize: 12 }}
              aria-label={t(locale, 'params.metaRangeMax')}
              placeholder={t(locale, 'params.metaRangeMax')}
              value={form.rangeMax}
              onChange={(e) => setForm((s) => ({ ...s, rangeMax: e.target.value }))}
            />
          </div>
          <input
            style={{ width: "100%", fontSize: 12 }}
            aria-label={t(locale, 'params.metaStep')}
            placeholder={t(locale, 'params.metaStep')}
            value={form.step}
            onChange={(e) => setForm((s) => ({ ...s, step: e.target.value }))}
          />
          <input
            style={{ width: "100%", fontSize: 12 }}
            aria-label={t(locale, 'params.metaTags')}
            placeholder={t(locale, 'params.metaTags')}
            value={form.tags}
            onChange={(e) => setForm((s) => ({ ...s, tags: e.target.value }))}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn primary" onClick={save}>{t(locale, 'params.metaSave')}</button>
            <button className="btn" onClick={() => setEditing(false)}>{t(locale, 'common.cancel')}</button>
          </div>
        </div>
      ) : (
        <button className="btn inspector-action" onClick={startEdit} disabled={!projectOpen}>
          <WbIcon name="file-code" />
          {t(locale, 'params.metaEdit')}
        </button>
      )}
    </div>
  )
}
