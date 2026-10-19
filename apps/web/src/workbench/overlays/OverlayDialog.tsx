// WB-02.09 · 弹层基座:原生 <dialog> 包装(showModal/Esc/焦点归还由浏览器
// 提供),内容全部由 React 渲染——接替原型的 openDialog/innerHTML 拼接。
import { useEffect, useRef } from 'react'
import type { JSX, ReactNode } from 'react'
import { WbIcon } from '../components/icons.tsx'

export type OverlayDialogProps = {
  open: boolean
  onClose: () => void
  title: string
  /** 无障碍:对话框标题 id */
  titleId?: string
  children: ReactNode
  footer?: ReactNode
  /** 关闭时是否保留 Esc 语义(默认允许 Esc 关闭) */
  dismissable?: boolean
}

export function OverlayDialog({
  open,
  onClose,
  title,
  titleId = 'dialog-title',
  children,
  footer,
  dismissable = true,
}: OverlayDialogProps): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        if (!dismissable) e.preventDefault()
        else onClose()
      }}
      onClose={() => {
        if (open) onClose()
      }}
    >
      <header className="modal-header">
        <h2 id={titleId}>{title}</h2>
        {dismissable && (
          <button className="icon-button" onClick={onClose} aria-label="关闭对话框">
            <WbIcon name="cross" />
          </button>
        )}
      </header>
      <div className="modal-body">{children}</div>
      {footer !== undefined && <footer className="modal-footer">{footer}</footer>}
    </dialog>
  )
}
