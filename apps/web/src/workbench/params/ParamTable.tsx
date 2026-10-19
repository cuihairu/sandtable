// WB-02.06 · 参数表:基线只读列 + 候选值可编辑列。
// 编辑安全:输入先落本地缓冲(未提交状态),Enter/失焦提交走 onCommit;
// onCommit 返回 false 时保留非法输入并标记 invalid(校验错误由
// validateParam 生成,最终有效性仍归内核校验)。
import { useState } from 'react'
import type { JSX } from 'react'
import type { ParamDef } from '../demo/sampleProject.ts'
import { relativeChange } from './paramsLogic.ts'

export type ParamTableProps = {
  id: string
  defs: readonly ParamDef[]
  values: Readonly<Record<string, number>>
  selected: ReadonlySet<string>
  focusId: string | null
  onCommit: (def: ParamDef, value: number) => boolean
  onSelect: (id: string, checked: boolean, shift?: boolean) => void
  onSelectAll: (checked: boolean) => void
  onFocusRow: (id: string) => void
}

export function ParamTable({
  id,
  defs,
  values,
  selected,
  focusId,
  onCommit,
  onSelect,
  onSelectAll,
  onFocusRow,
}: ParamTableProps): JSX.Element {
  return (
    <table className="parameter-table" aria-label="候选方案参数编辑表" id={id}>
      <thead>
        <tr>
          <th>
            <input
              id="all-params"
              className="checkbox"
              type="checkbox"
              aria-label="选择当前可见参数"
              checked={defs.length > 0 && defs.every((p) => selected.has(p.id))}
              onChange={(e) => onSelectAll(e.target.checked)}
            />
          </th>
          <th>参数名称 / 注册路径</th>
          <th>类型</th>
          <th className="numeric">基线</th>
          <th className="numeric">候选值</th>
          <th className="numeric">相对变化</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {defs.length === 0 && (
          <tr>
            <td colSpan={7}>
              <div className="empty-state">没有匹配的参数。尝试清空搜索或切换系统分组。</div>
            </td>
          </tr>
        )}
        {defs.map((def) => (
          <ParamRow
            key={def.id}
            def={def}
            value={values[def.id]}
            selected={selected.has(def.id)}
            focused={focusId === def.id}
            onCommit={onCommit}
            onSelect={onSelect}
            onFocusRow={onFocusRow}
          />
        ))}
      </tbody>
    </table>
  )
}

function ParamRow({
  def,
  value,
  selected,
  focused,
  onCommit,
  onSelect,
  onFocusRow,
}: {
  def: ParamDef
  value: number | undefined
  selected: boolean
  focused: boolean
  onCommit: (def: ParamDef, value: number) => boolean
  onSelect: (id: string, checked: boolean) => void
  onFocusRow: (id: string) => void
}): JSX.Element {
  const [buffer, setBuffer] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [invalid, setInvalid] = useState(false)
  const committed = value ?? def.base
  const changed = committed !== def.base

  const commit = (): void => {
    if (buffer === null) return
    const parsed = Number(buffer)
    if (Number.isNaN(parsed) && buffer.trim() !== '') {
      setInvalid(true)
      setError('请输入数值')
      return
    }
    const ok = onCommit(def, parsed)
    if (ok) {
      setBuffer(null)
      setError('')
      setInvalid(false)
    } else {
      setInvalid(true)
    }
  }

  return (
    <tr className={focused ? 'selected' : ''} data-param-row={def.id}>
      <td>
        <input
          className="checkbox"
          type="checkbox"
          checked={selected}
          aria-label={`选择${def.name}`}
          onChange={(e) => onSelect(def.id, e.target.checked)}
        />
      </td>
      <td>
        <button
          style={{ padding: 0, textAlign: 'left', border: 0, background: 'none' }}
          onClick={() => onFocusRow(def.id)}
        >
          <span className="parameter-name">{def.name}</span>
          <span className="parameter-path">{def.id}</span>
        </button>
      </td>
      <td className="mono muted" style={{ fontSize: 10 }}>
        {def.type}
      </td>
      <td className="numeric muted">{def.base}</td>
      <td className="numeric">
        <input
          className={`cell-value${changed ? ' changed' : ''}${invalid ? ' invalid' : ''}`}
          type="number"
          step={def.type === 'f64' ? 'any' : '1'}
          value={buffer ?? String(committed)}
          aria-label={`${def.name}候选值`}
          onChange={(e) => setBuffer(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit()
            } else if (e.key === 'Escape') {
              // Esc 撤销当前输入,恢复已提交值
              setBuffer(null)
              setInvalid(false)
              setError('')
            }
          }}
          onBlur={commit}
        />
        <span className="parameter-error" aria-live="polite">
          {error}
        </span>
      </td>
      <td className={`numeric ${changed ? 'positive' : 'muted'}`}>{relativeChange(def, committed)}</td>
      <td>
        {changed ? <span className="badge amber">已修改</span> : <span className="muted">—</span>}
      </td>
    </tr>
  )
}
