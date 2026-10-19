// WB-02.09 · 确认框:通用两键确认,替代原型 confirmResetAll 的 DOM 弹窗。
// 编辑安全纪律:破坏性动作(恢复全部默认值等)必须显式确认,文案说明
// 可恢复路径(撤销/草稿保留)。
import type { JSX, ReactNode } from 'react'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import { OverlayDialog } from './OverlayDialog.tsx'

export type ConfirmDialogProps = {
  open: boolean
  title: string
  body: ReactNode
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
  tone?: 'default' | 'danger'
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  tone = 'default',
}: ConfirmDialogProps): JSX.Element {
  const locale = useLocale()
  return (
    <OverlayDialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn" onClick={onClose}>{t(locale, 'common.cancel')}</button>
          <button
            className={`btn${tone === 'danger' ? '' : ' primary'}`}
            style={tone === 'danger' ? { borderColor: 'var(--wb-red)', color: 'var(--wb-red)' } : undefined}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {body}
    </OverlayDialog>
  )
}
