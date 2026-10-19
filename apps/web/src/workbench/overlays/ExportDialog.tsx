// WB-02.09 · 导出对话框:范围/格式选择 + 来源标注。
// 接替原型 exportDialog 的 DOM 拼接;导出内容由调用方提供
// (本批 = 演示数据导出,WB-09 接真实 run)。
import { useState } from 'react'
import type { JSX } from 'react'
import { OverlayDialog } from './OverlayDialog.tsx'
import { WbIcon } from '../components/icons.tsx'

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
  const [scope, setScope] = useState<ExportScope>(initialScope)
  const [format, setFormat] = useState<ExportFormat>('csv')
  return (
    <OverlayDialog
      open={open}
      onClose={onClose}
      title="导出分析数据"
      footer={
        <>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={() => onConfirm(scope, format)}>
            <WbIcon name="download" />
            下载文件
          </button>
        </>
      }
    >
      <div className="export-options">
        <label>
          数据范围
          <select value={scope} onChange={(e) => setScope(e.target.value as ExportScope)}>
            <option value="all">全部 {counts.all} 个候选</option>
            <option value="filtered">当前筛选 · {counts.filtered} 个候选</option>
            <option value="selected">所选候选 {selectedLabel}</option>
          </select>
        </label>
        <label>
          文件格式
          <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
            <option value="csv">CSV · Excel / JMP / Origin</option>
            <option value="json">JSON · 实验与参数草稿快照</option>
            <option value="svg">SVG · 参数响应图</option>
          </select>
        </label>
        <div className="note-block">
          导出文件会标注 synthetic_demo 数据来源。JSON 同时包含当前编辑草稿和独立的样例实验快照,
          避免把未运行的修改归到旧结果上。
        </div>
      </div>
    </OverlayDialog>
  )
}
