// WB-02.06 · 批量操作栏:勾选参数后出现的就地批量修改条。
// WB-05.11 · 编辑安全:先预览/校验整批(逐项 from→to + 内核对整批草稿的
// 完整校验),再一次性应用;任一项失败不产生半批修改。预览状态由页面容器
// 持有,本组件只展示。
import { useState } from 'react'
import type { JSX } from 'react'
import type { BulkPreview } from './paramsLogic.ts'

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
  const [factor, setFactor] = useState('1.1')
  const badRows = preview ? preview.rows.filter((r) => r.error !== '') : []
  return (
    <div className="bulk-bar">
      <strong>已选 {count} 项</strong>
      <span>候选值 ×</span>
      <input
        type="number"
        value={factor}
        step="0.1"
        aria-label="批量修改倍率"
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
        {checking ? '校验中…' : '预览整批'}
      </button>
      <button
        className="btn primary"
        disabled={!preview?.ok || checking}
        title={preview?.ok ? '整批一次性应用,可撤销' : '先预览并通过整批校验'}
        onClick={onApply}
      >
        应用整批
      </button>
      <button className="btn subtle" onClick={onClear}>
        取消选择
      </button>
      <span className="muted">整数参数自动四舍五入</span>
      {preview && !preview.ok && preview.error && (
        <span className="parameter-error" role="alert">{preview.error}</span>
      )}
      {preview && badRows.length > 0 && (
        <span className="parameter-error" role="alert">
          {badRows.length} 项校验失败,未应用批量修改(如 {badRows[0].path}: {badRows[0].error})
        </span>
      )}
      {preview?.ok && (
        <span className="muted" aria-live="polite">
          整批校验通过:{preview.rows.length} 项将一次写入
        </span>
      )}
    </div>
  )
}
