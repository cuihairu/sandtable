// WB-02.05 · 候选表:排序 / 筛选 / 选中与当前行联动。
// 可独立接数据:泛型 rows + 列定义 + getId,不绑定演示数据结构。
// 身份纪律:选中/排序都以 getId(row) 的稳定 ID 为准(数组下标只用于
// React key 的兜底?不——key 也用稳定 ID)。
import type { JSX } from 'react'
import { WbIcon, WbVerdictIcon } from '../components/icons.tsx'
import type { Verdict } from '../demo/sampleProject.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type CandidateColumn<T> = {
  key: string
  label: string
  numeric?: boolean
  /** 单元格取值;ci 提供时输出等宽展示区间 */
  value: (row: T) => string | number
  /** 排序键取值(缺省用 value 的数值/字符串) */
  sortValue?: (row: T) => number
  /** 是否为 95% CI 列(等宽展示) */
  ci?: boolean
}

export type CandidateTableProps<T> = {
  id: string
  rows: readonly T[]
  getId: (row: T) => string
  columns: readonly CandidateColumn<T>[]
  /** 判定列:提供则渲染通过/临界/未通过徽标 */
  verdictOf?: (row: T) => Verdict
  selectedId: string | null
  onSelect?: (id: string) => void
  sortKey?: string
  sortDir?: 1 | -1
  onSort?: (key: string) => void
  /** 基线标记(如 paramValue===基线) */
  isBaseline?: (row: T) => boolean
  emptyMessage?: string
  expanded?: boolean
}

export function CandidateTable<T>({
  id,
  rows,
  getId,
  columns,
  verdictOf,
  selectedId,
  onSelect,
  sortKey,
  sortDir = 1,
  onSort,
  isBaseline,
  emptyMessage,
  expanded = false,
}: CandidateTableProps<T>): JSX.Element {
  // WB-11.14:表头/空态/判定徽标随当前语言;列 label 由调用方传词典值
  const locale = useLocale()
  const cols = columns.length
  const verdictCol = verdictOf !== undefined
  return (
    <div className="candidate-table-wrap" style={expanded ? { maxHeight: 'none' } : undefined}>
      <table className="candidate-table" aria-label={t(locale, 'analysis.table.aria')} id={id}>
        <thead>
          <tr>
            <th>{t(locale, 'analysis.table.colCandidate')}</th>
            {columns.map((col) => (
              <th key={col.key} className={col.numeric === true ? 'numeric' : col.ci === true ? 'ci' : ''} aria-sort={sortKey === col.key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none'}>
                {onSort !== undefined ? (
                  <button className="sort-button" onClick={() => onSort(col.key)}>
                    {col.label}
                    <span>{sortKey === col.key ? (sortDir === 1 ? '↑' : '↓') : '↕'}</span>
                  </button>
                ) : (
                  col.label
                )}
              </th>
            ))}
            {verdictCol && (
              <th>
                {onSort !== undefined ? (
                  <button className="sort-button" onClick={() => onSort('verdict')}>
                    {t(locale, 'analysis.table.colVerdict')} <span>↕</span>
                  </button>
                ) : (
                  t(locale, 'analysis.table.colVerdict')
                )}
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={cols + 1 + (verdictCol ? 1 : 0)}>
                <div className="empty-state">{emptyMessage ?? t(locale, 'analysis.table.empty')}</div>
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const rowId = getId(row)
            const selected = rowId === selectedId
            return (
              <tr
                key={rowId}
                className={`candidate-row${selected ? ' selected' : ''}`}
                aria-selected={selected}
                data-candidate={rowId}
                onClick={() => onSelect?.(rowId)}
              >
                <td>
                  <div className="table-id">
                    <button
                      className="candidate-select"
                      aria-label={t(locale, 'analysis.table.selectAria', { id: rowId })}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect?.(rowId)
                      }}
                    >
                      {rowId.slice(0, 11)}
                    </button>
                    {isBaseline?.(row) === true && <span className="badge">{t(locale, 'analysis.table.baselineBadge')}</span>}
                  </div>
                </td>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`${col.numeric === true ? 'numeric' : ''}${col.ci === true ? ' mono' : ''}`}
                  >
                    {col.value(row)}
                  </td>
                ))}
                {verdictCol && (
                  <td>
                    <VerdictChip verdict={verdictOf(row)} />
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function VerdictChip({ verdict }: { verdict: Verdict }): JSX.Element {
  const locale = useLocale()
  // WB-11.14:判定徽标显示名走词典;verdict 枚举值稳定不翻译
  return (
    <span className={`verdict ${verdict}`}>
      <WbVerdictIcon verdict={verdict} />
      {t(locale, VERDICT_KEY[verdict])}
    </span>
  )
}

const VERDICT_KEY: Record<Verdict, 'analysis.verdict.pass' | 'analysis.verdict.border' | 'analysis.verdict.fail'> = {
  pass: 'analysis.verdict.pass',
  border: 'analysis.verdict.border',
  fail: 'analysis.verdict.fail',
}

export { WbIcon }
