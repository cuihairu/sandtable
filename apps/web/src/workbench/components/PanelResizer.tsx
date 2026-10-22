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
    const target = event.currentTarget
    if (event.button !== 0) return
    const origin = orientation === 'vertical' ? event.clientX : event.clientY
    const base = onStart()
    target.setPointerCapture(event.pointerId)
    event.preventDefault()

    const move = (moveEvent: Event) => {
      if (!(moveEvent instanceof window.PointerEvent)) return
      const pointer = orientation === 'vertical' ? moveEvent.clientX : moveEvent.clientY
      onUpdate(base + pointer - origin)
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
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
