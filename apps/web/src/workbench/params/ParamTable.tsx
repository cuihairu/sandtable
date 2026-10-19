// WB-05 · 参数表:基线只读列 + 候选值编辑列(数据源 = 注册表 × 配置 YAML)。
// 编辑安全(WB-05.04/05.05):
// - 输入先落本地缓冲(未提交),Enter/失焦提交、Esc 撤销当前输入;
// - 非法值保留待修复输入并就地标错,不写进候选;
// - 行 key = 注册路径(稳定 ID),提交后的重渲染不重建输入框,焦点保留,
//   不会把失焦提交变成点击丢失;
// - dur/expr/table 类型不进数值通道:只读显示 + 高级编辑入口(WB-05.02)。
// WB-11.12 · 表头/状态/aria 走词典(locale 由页面容器传入,与显示名同源)。
import { useState } from 'react'
import type { JSX } from 'react'
import type { ParamRowModel } from './paramsLogic.ts'
import { parseCellInput } from './paramsLogic.ts'
import { paramDelta } from './configYaml.ts'
import { displayParamName } from './paramRegistry.ts'
import { t } from '../../lib/i18n/index.ts'
import type { Locale } from '../../lib/i18n/index.ts'

export type ParamTableProps = {
  id: string
  /** 当前可见行(全选只作用于可见项,WB-05.10) */
  rows: readonly ParamRowModel[]
  selected: ReadonlySet<string>
  focusId: string | null
  /** 内核校验失败定位的参数路径(状态列给出标记,WB-05.07) */
  kernelErrorPath: string | null
  /** 提交单元格:返回错误消息('' = 成功);失败时单元格保留待修复输入 */
  onCommit: (row: ParamRowModel, input: string) => string
  onSelect: (path: string, checked: boolean) => void
  onSelectAll: (checked: boolean) => void
  onFocusRow: (path: string) => void
  onAdvancedEdit: (row: ParamRowModel) => void
  locale: Locale
}

export function ParamTable({
  id,
  rows,
  selected,
  focusId,
  kernelErrorPath,
  onCommit,
  onSelect,
  onSelectAll,
  onFocusRow,
  onAdvancedEdit,
  locale,
}: ParamTableProps): JSX.Element {
  return (
    <table className="parameter-table" aria-label={t(locale, 'params.tableAria')} id={id}>
      <thead>
        <tr>
          <th>
            <input
              id="all-params"
              className="checkbox"
              type="checkbox"
              aria-label={t(locale, 'params.selectAllAria')}
              checked={rows.length > 0 && rows.every((p) => selected.has(p.def.path))}
              onChange={(e) => onSelectAll(e.target.checked)}
            />
          </th>
          <th>{t(locale, 'params.colName')}</th>
          <th>{t(locale, 'params.colType')}</th>
          <th className="numeric">{t(locale, 'params.colBaseline')}</th>
          <th className="numeric">{t(locale, 'params.colCandidate')}</th>
          <th className="numeric">{t(locale, 'params.colDelta')}</th>
          <th>{t(locale, 'params.colStatus')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={7}>
              <div className="empty-state">{t(locale, 'params.empty')}</div>
            </td>
          </tr>
        )}
        {rows.map((row) => (
          <ParamRow
            key={row.def.path}
            row={row}
            selected={selected.has(row.def.path)}
            focused={focusId === row.def.path}
            kernelError={kernelErrorPath === row.def.path}
            onCommit={onCommit}
            onSelect={onSelect}
            onFocusRow={onFocusRow}
            onAdvancedEdit={onAdvancedEdit}
            locale={locale}
          />
        ))}
      </tbody>
    </table>
  )
}

function ParamRow({
  row,
  selected,
  focused,
  kernelError,
  onCommit,
  onSelect,
  onFocusRow,
  onAdvancedEdit,
  locale,
}: {
  row: ParamRowModel
  selected: boolean
  focused: boolean
  kernelError: boolean
  onCommit: (row: ParamRowModel, input: string) => string
  onSelect: (path: string, checked: boolean) => void
  onFocusRow: (path: string) => void
  onAdvancedEdit: (row: ParamRowModel) => void
  locale: Locale
}): JSX.Element {
  // 编辑缓冲(WB-05.04):null = 无未提交输入;error = 非法值详情
  const [buffer, setBuffer] = useState<string | null>(null)
  const [error, setError] = useState('')
  const name = displayParamName(row.def.path, locale)
  const committed = row.candidate
  const changed = row.modified
  const delta = paramDelta(row.baseline.num, row.candidate.num)

  const commit = (): void => {
    if (buffer === null) return
    const parsed = parseCellInput(buffer, row.def)
    if (parsed.state !== 'ok') {
      // 非法值:保留待修复输入,不提交
      setError(parsed.error)
      return
    }
    const commitError = onCommit(row, buffer)
    if (commitError === '') {
      setBuffer(null)
      setError('')
    } else {
      setError(commitError)
    }
  }

  return (
    <tr className={focused ? 'selected' : ''} data-param-row={row.def.path}>
      <td>
        <input
          className="checkbox"
          type="checkbox"
          checked={selected}
          aria-label={t(locale, 'params.selectRowAria', { name })}
          onChange={(e) => onSelect(row.def.path, e.target.checked)}
        />
      </td>
      <td>
        <button
          style={{ padding: 0, textAlign: 'left', border: 0, background: 'none' }}
          onClick={() => onFocusRow(row.def.path)}
        >
          <span className="parameter-name">{name}</span>
          <span className="parameter-path">{row.def.path}</span>
        </button>
      </td>
      <td className="mono muted" style={{ fontSize: 10 }}>
        {row.def.kind}
      </td>
      <td className="numeric muted" title={row.baseline.present
        ? row.def.desc
        : t(locale, 'params.baselineMissingTitle', { default: row.def.default })}
      >
        {row.baseline.present ? row.baseline.text : <span className="muted">{t(locale, 'params.missing')}</span>}
      </td>
      <td className="numeric">
        {row.editable ? (
          <>
            <input
              className={`cell-value${changed ? ' changed' : ''}${error ? ' invalid' : ''}`}
              type="number"
              step={row.def.kind === 'f64' || row.def.kind === 'mix' ? 'any' : '1'}
              value={buffer ?? (committed.present ? committed.text : '')}
              aria-label={t(locale, 'params.cellCandidateAria', { name })}
              onChange={(e) => setBuffer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commit()
                } else if (e.key === 'Escape') {
                  // Esc 撤销当前输入:回到已提交值
                  setBuffer(null)
                  setError('')
                }
              }}
              onBlur={commit}
            />
            <span className="parameter-error" aria-live="polite">
              {error}
            </span>
          </>
        ) : (
          <>
            <span className="mono muted" style={{ fontSize: 10 }}>
              {committed.present ? committed.text : t(locale, 'params.unset')}
            </span>
            <button
              className="btn subtle"
              style={{ fontSize: 10, padding: '1px 6px', marginLeft: 4 }}
              onClick={() => onAdvancedEdit(row)}
              aria-label={t(locale, 'params.advancedAria', { name })}
            >
              {t(locale, 'params.advancedEdit')}
            </button>
          </>
        )}
      </td>
      <td className={`numeric ${changed ? 'positive' : 'muted'}`}>{delta.text}</td>
      <td>
        {error !== '' ? (
          <span className="badge red" title={error}>{t(locale, 'params.invalid')}</span>
        ) : buffer !== null ? (
          <span className="badge amber">{t(locale, 'params.editing')}</span>
        ) : kernelError ? (
          <span className="badge red">{t(locale, 'params.kernelFailed')}</span>
        ) : changed ? (
          <span className="badge amber">{t(locale, 'params.modifiedBadge')}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  )
}
