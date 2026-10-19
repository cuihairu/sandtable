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

export type ExportScope = 'all' | 'filtered' | 'selected'
export type ExportFormat = 'csv' | 'json' | 'svg'

export type ExportDialogProps = {
  open: boolean
  onClose: () => void
  onConfirm: (scope: ExportScope, format: ExportFormat) => void
  counts: { all: number; filtered: number; selected: number }
  selectedLabel: string
  initialScope?: ExportScope
}

export function ExportDialog({
  open,
  onClose,
  onConfirm,
  counts,
  selectedLabel,
  initialScope = 'all',
}: ExportDialogProps): JSX.Element {
  const locale = useLocale()
  const [scope, setScope] = useState<ExportScope>(initialScope)
  const [format, setFormat] = useState<ExportFormat>('csv')
  return (
    <OverlayDialog
      open={open}
      onClose={onClose}
      title={t(locale, 'data.exportDialog.title')}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t(locale, 'common.cancel')}</button>
          <button className="btn primary" onClick={() => onConfirm(scope, format)}>
            <WbIcon name="download" />
            {t(locale, 'data.exportDialog.download')}
          </button>
        </>
      }
    >
      <div className="export-options">
        <label>
          {t(locale, 'data.exportDialog.scope')}
          <select value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
            <option value="all">{t(locale, 'data.exportDialog.scopeAll', { n: counts.all })}</option>
            <option value="filtered">{t(locale, 'data.exportDialog.scopeFiltered', { n: counts.filtered })}</option>
            <option value="selected">{t(locale, 'data.exportDialog.scopeSelected', { label: selectedLabel })}</option>
          </select>
        </label>
        <label>
          {t(locale, 'data.exportDialog.format')}
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="csv">{t(locale, 'data.exportDialog.formatCsv')}</option>
            <option value="json">{t(locale, 'data.exportDialog.formatJson')}</option>
            <option value="svg">{t(locale, 'data.exportDialog.formatSvg')}</option>
          </select>
        </label>
        <div className="note-block">
          {t(locale, 'data.exportDialog.note')}
        </div>
      </div>
    </OverlayDialog>
  )
}
