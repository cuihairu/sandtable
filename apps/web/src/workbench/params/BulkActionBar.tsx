// WB-02.06 · 批量操作栏:勾选参数后出现的就地批量修改条。
// WB-05.11 · 编辑安全:先预览/校验整批(逐项 from→to + 内核对整批草稿的
// 完整校验),再一次性应用;任一项失败不产生半批修改。预览状态由页面容器
// 持有,本组件只展示。
// WB-11.12 · 文案走词典。
import { useState } from 'react'
import type { JSX } from 'react'
import type { BulkPreview } from './paramsLogic.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type BulkActionBarProps = {
  count: number
  /** 预览结果(null = 尚未预览;ok=false 时不允许应用) */
  preview: BulkPreview | null
  /** 预览进行中(内核校验异步) */
  checking: boolean
  onPreview: (factor: number) => void
  onApply: () => void
  onClear: () => void
}

export function BulkActionBar({ count, preview, checking, onPreview, onApply, onClear }: BulkActionBarProps): JSX.Element {
  const locale = useLocale()
  const [factor, setFactor] = useState('1.1')
  const badRows = preview ? preview.rows.filter((r) => r.error !== '') : []
  return (
    <div className="bulk-bar">
      <strong>{t(locale, 'params.selectedCount', { n: count })}</strong>
      <span>{t(locale, 'params.multiplyHint')}</span>
      <input
        type="number"
        value={factor}
        step="0.1"
        aria-label={t(locale, 'params.factorAria')}
        onChange={(e) => setFactor(e.target.value)}
      />
      <button
        className="btn"
        disabled={checking}
        onClick={() => {
          const parsed = Number(factor)
          onPreview(Number.isNaN(parsed) ? Number.NaN : parsed)
        }}
      >
        {checking ? t(locale, 'params.checking') : t(locale, 'params.previewBulk')}
      </button>
      <button
        className="btn primary"
        disabled={!preview?.ok || checking}
        title={preview?.ok ? t(locale, 'params.applyTitleOk') : t(locale, 'params.applyTitleLocked')}
        onClick={onApply}
      >
        {t(locale, 'params.applyBulk')}
      </button>
      <button className="btn subtle" onClick={onClear}>
        {t(locale, 'params.clearSelection')}
      </button>
      <span className="muted">{t(locale, 'params.roundHint')}</span>
      {preview && !preview.ok && preview.error && (
        <span className="parameter-error" role="alert">{preview.error}</span>
      )}
      {preview && badRows.length > 0 && (
        <span className="parameter-error" role="alert">
          {t(locale, 'params.bulkRowsFailed', {
            n: badRows.length, path: badRows[0].path, error: badRows[0].error,
          })}
        </span>
      )}
      {preview?.ok && (
        <span className="muted" aria-live="polite">
          {t(locale, 'params.bulkOk', { n: preview.rows.length })}
        </span>
      )}
    </div>
  )
}
