// WB-02.09 · 导出对话框:范围/格式选择 + 来源标注。
// 接替原型 exportDialog 的 DOM 拼接;导出内容由调用方提供
// (本批 = 演示数据导出,WB-09 接真实 run)。
// WB-11.16 · 范围/格式选项与说明走词典(data.exportDialog.*)。
import { useState } from 'react'
import type { JSX } from 'react'
import { OverlayDialog } from './OverlayDialog.tsx'
import { WbIcon } from '../components/icons.tsx'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import type { ExportScope } from '../analysis/exportScope.ts'

export type { ExportScope }
export type ExportFormat = 'csv' | 'json' | 'svg'
const ALL_FORMATS: readonly ExportFormat[] = ['csv', 'json', 'svg']

function formatKey(f: ExportFormat): 'data.exportDialog.formatCsv' | 'data.exportDialog.formatJson' | 'data.exportDialog.formatSvg' {
  return f === 'csv' ? 'data.exportDialog.formatCsv' : f === 'json' ? 'data.exportDialog.formatJson' : 'data.exportDialog.formatSvg'
}

export type ExportDialogProps = {
  open: boolean
  onClose: () => void
  onConfirm: (scope: ExportScope, format: ExportFormat) => void
  counts: { all: number; filtered: number; selected: number }
  selectedLabel: string
  initialScope?: ExportScope
  /** 可用格式;真实 run 上下文按已落地格式收窄(WB-09.02/.05 再放开) */
  formats?: readonly ExportFormat[]
  /** 绑定的 run 来源行(真实 run 上下文显示,演示上下文留空) */
  sourceNote?: string
}

export function ExportDialog({
  open,
  onClose,
  onConfirm,
  counts,
  selectedLabel,
  initialScope = 'all',
  formats = ALL_FORMATS,
  sourceNote,
}: ExportDialogProps): JSX.Element {
  const locale = useLocale()
  const [scope, setScope] = useState<ExportScope>(initialScope)
  const [format, setFormat] = useState<ExportFormat>('csv')
  // 收窄格式时已选格式可能已不可用:提交时回退到首个可用格式,不静默导出
  const formatChoice = formats.includes(format) ? format : formats[0]!
  return (
    <OverlayDialog
      open={open}
      onClose={onClose}
      title={t(locale, 'data.exportDialog.title')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t(locale, 'common.cancel')}</button>
          <button className="btn primary" onClick={() => onConfirm(scope, formatChoice)} disabled={counts.all === 0}>
            <WbIcon name="download" />
            {t(locale, 'data.exportDialog.download')}
          </button>
        </>
      }
    >
      {sourceNote !== undefined && <p role="status" className="note-block mono">{sourceNote}</p>}
      <div className="export-options">
        <label>
          {t(locale, 'data.exportDialog.scope')}
          <select value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
            <option value="all">{t(locale, 'data.exportDialog.scopeAll', { n: counts.all })}</option>
            <option value="filtered">{t(locale, 'data.exportDialog.scopeFiltered', { n: counts.filtered })}</option>
            <option value="selected" disabled={counts.selected === 0}>{t(locale, 'data.exportDialog.scopeSelected', { label: selectedLabel })}</option>
          </select>
        </label>
        <label>
          {t(locale, 'data.exportDialog.format')}
          <select value={formatChoice} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            {formats.map((f) => <option key={f} value={f}>{t(locale, formatKey(f))}</option>)}
          </select>
        </label>
        <div className="note-block">
          {t(locale, 'data.exportDialog.note')}
        </div>
      </div>
    </OverlayDialog>
  )
}
