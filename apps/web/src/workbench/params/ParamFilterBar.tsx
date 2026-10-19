// WB-02.06 · 参数筛选栏:搜索 / 系统分组 / 只看变更。
// 受控组件,状态由页面容器(或共享 store)持有;筛选是 UI 状态,
// 不写进实验输入(WB-02.12 会再统一)。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'

export type ParamFilterBarProps = {
  search: string
  onSearch: (q: string) => void
  group: string
  groups: readonly string[]
  onGroup: (g: string) => void
  changedOnly: boolean
  changedCount: number
  onChangedOnly: (on: boolean) => void
  onResetAll?: () => void
}

export function ParamFilterBar({
  search,
  onSearch,
  group,
  groups,
  onGroup,
  changedOnly,
  changedCount,
  onChangedOnly,
  onResetAll,
}: ParamFilterBarProps): JSX.Element {
  return (
    <div className="workspace-toolbar">
      <label className="search-field">
        <WbIcon name="search" />
        <input
          type="search"
          placeholder="搜索名称或参数路径"
          aria-label="搜索参数"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      <select
        aria-label="按系统分组筛选"
        value={group}
        onChange={(e) => onGroup(e.target.value)}
      >
        <option value="all">全部系统</option>
        {groups.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <label className="checkbox-line" style={{ margin: 0 }}>
        <input
          className="checkbox"
          type="checkbox"
          checked={changedOnly}
          onChange={(e) => onChangedOnly(e.target.checked)}
        />
        仅变更 <span className="mono">{changedCount}</span>
      </label>
      <div className="toolbar-end">
        {onResetAll && (
          <button className="btn subtle" onClick={onResetAll}>
            <WbIcon name="reset" />
            恢复全部
          </button>
        )}
      </div>
    </div>
  )
}
