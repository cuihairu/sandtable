// WB-02.07 · 因子表:Grid(等距域)与 Random/LHS(固定预算)的因子输入。
// 因子按"参数路径 + 类型 + 取值域"组织,可扩展多行(接注册表后按 WB-06.03
// 动态生成);本批承载单因子样例,范围非法就地提示。
import type { JSX } from 'react'

export type FactorRow = {
  path: string
  type: string
  min: number
  max: number
  /** Grid 步长;random/lhs 忽略 */
  step?: number
  /** Random/LHS 采样数;grid 忽略 */
  samples?: number
  error?: string
}

export type FactorTableProps = {
  method: 'grid' | 'random'
  rows: readonly FactorRow[]
  onChange: (path: string, patch: Partial<FactorRow>) => void
}

export function FactorTable({ method, rows, onChange }: FactorTableProps): JSX.Element {
  return (
    <div className="factor-grid" role="grid" aria-label="实验因子">
      <span role="rowheader">因子 / 参数路径</span>
      <label className="muted" style={{ fontSize: 10 }} htmlFor="factor-min">
        最小值
      </label>
      <label className="muted" style={{ fontSize: 10 }} htmlFor="factor-max">
        最大值
      </label>
      <label className="muted" style={{ fontSize: 10 }} htmlFor={method === 'grid' ? 'factor-step' : 'factor-samples'}>
        {method === 'grid' ? '步长' : '采样数'}
      </label>
      {rows.map((row) => (
        <FactorCells key={row.path} method={method} row={row} onChange={(patch) => onChange(row.path, patch)} />
      ))}
    </div>
  )
}

function FactorCells({
  method,
  row,
  onChange,
}: {
  method: 'grid' | 'random'
  row: FactorRow
  onChange: (patch: Partial<FactorRow>) => void
}): JSX.Element {
  return (
    <>
      <span className="factor-name" role="gridcell">
        {row.path}
        <br />
        <span style={{ color: '#82939a' }}>{`${row.type} · 注册表参数`}</span>
      </span>
      <input
        id="factor-min"
        type="number"
        value={row.min}
        aria-label={`${row.path} 最小值`}
        onChange={(e) => onChange({ min: Number(e.target.value) })}
      />
      <input
        id="factor-max"
        type="number"
        value={row.max}
        aria-label={`${row.path} 最大值`}
        onChange={(e) => onChange({ max: Number(e.target.value) })}
      />
      {method === 'grid' ? (
        <input
          id="factor-step"
          type="number"
          value={row.step ?? 1}
          aria-label={`${row.path} 步长`}
          onChange={(e) => onChange({ step: Number(e.target.value) })}
        />
      ) : (
        <input
          id="factor-samples"
          type="number"
          value={row.samples ?? 1}
          aria-label={`${row.path} 采样数`}
          onChange={(e) => onChange({ samples: Number(e.target.value) })}
        />
      )}
      {row.error && (
        <span role="alert" style={{ gridColumn: '1 / -1', color: 'var(--wb-red)', fontSize: 10 }}>
          {row.error}
        </span>
      )}
    </>
  )
}
