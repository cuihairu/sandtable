// VS Code-style panel drag handle: pointer events only, integer CSS pixels,
// clamped by the caller. The pointer is captured so drags survive fast motion.
import type { JSX, PointerEvent } from 'react'

export type PanelResizerProps = {
  orientation: 'vertical' | 'horizontal'
  label: string
  onStart: () => number
  onUpdate: (pointerDelta: number) => void
}

export function PanelResizer({ orientation, label, onStart, onUpdate }: PanelResizerProps): JSX.Element {
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    const origin = orientation === 'vertical' ? event.clientX : event.clientY
    const base = onStart()
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()

    const move = (moveEvent: Event) => {
      if (!(moveEvent instanceof window.PointerEvent)) return
      const pointer = orientation === 'vertical' ? moveEvent.clientX : moveEvent.clientY
      onUpdate(base + pointer - origin)
    }
    const up = () => {
      event.currentTarget.removeEventListener('pointermove', move)
      event.currentTarget.removeEventListener('pointerup', up)
      event.currentTarget.removeEventListener('pointercancel', up)
    }
    event.currentTarget.addEventListener('pointermove', move)
    event.currentTarget.addEventListener('pointerup', up)
    event.currentTarget.addEventListener('pointercancel', up)
  }

  return (
    <button
      className={`panel-resizer${orientation === 'horizontal' ? ' vertical' : ''}`}
      type="button"
      aria-label={label}
      aria-orientation={orientation}
      onPointerDown={onPointerDown}
    />
  )
}
