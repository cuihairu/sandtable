// Data-grid column menu using standard DataGrid/Sheets affordances: one
// visibility checkbox per column and exclusive left/right pin actions.
import { useState } from 'react'
import type { JSX } from 'react'
import { t } from '../../lib/i18n/index.ts'
import type { Locale } from '../../lib/i18n/index.ts'
import { DEFAULT_COLUMN_PREF, toggleColumn, togglePin } from './tableState.ts'
import type { TableColumnPref } from './tableState.ts'
import { WbIcon } from '../components/icons.tsx'

export type MenuColumn = {
  key: string
  label: string
}

export type ColumnMenuProps = {
  columns: readonly MenuColumn[]
  pref: TableColumnPref
  onChange: (pref: TableColumnPref) => void
  onCopy: () => void
  locale: Locale
}

export function ColumnMenu({ columns, pref, onChange, onCopy, locale }: ColumnMenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const visibleCount = columns.length - pref.hidden.length
  return (
    <div className="table-tools">
      <button className="btn table-action" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        <WbIcon name="table" />
        {t(locale, 'params.columns')}
        <span className="mono">{visibleCount}/{columns.length}</span>
      </button>
      <button className="btn table-action" onClick={onCopy}>
        <WbIcon name="copy" />
        {t(locale, 'params.copy')}
      </button>
      {open && (
        <div className="column-menu" role="dialog" aria-label={t(locale, 'params.columns')}>
          {columns.map((column) => {
            const visible = !pref.hidden.includes(column.key)
            const leftPinned = pref.pinnedLeft.includes(column.key)
            const rightPinned = pref.pinnedRight.includes(column.key)
            return (
              <label key={column.key}>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(event) => onChange(toggleColumn(pref, column.key, event.target.checked))}
                />
                <span title={column.key}>{column.label}</span>
                <span className="pin-group">
                  <button
                    type="button"
                    className={`pin-button${leftPinned ? ' active' : ''}`}
                    title={t(locale, 'params.pinLeft')}
                    aria-pressed={leftPinned}
                    onClick={() => onChange(togglePin(pref, column.key, 'left'))}
                  >←</button>
                  <button
                    type="button"
                    className={`pin-button${rightPinned ? ' active' : ''}`}
                    title={t(locale, 'params.pinRight')}
                    aria-pressed={rightPinned}
                    onClick={() => onChange(togglePin(pref, column.key, 'right'))}
                  >→</button>
                </span>
              </label>
            )
          })}
          <div className="column-menu-footer">
            <button className="btn subtle" onClick={() => onChange(DEFAULT_COLUMN_PREF)}>
              {t(locale, 'params.resetColumns')}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>{t(locale, 'common.confirm')}</button>
          </div>
        </div>
      )}
    </div>
  )
}
