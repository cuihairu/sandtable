/** Read only a cell's visible text, including text inside inputs and buttons. */
export function visibleCellText(cell: HTMLElement | null): string {
  if (cell === null) return ''
  const controls = [...cell.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')]
  if (controls.length > 0) {
    return controls.map((control) => control.value).join(' ').trim()
  }
  return (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
}
