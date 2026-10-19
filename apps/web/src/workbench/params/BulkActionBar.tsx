// WB-02.06 · 批量操作栏:勾选参数后出现的就地批量修改条。
// 编辑安全:倍率应用走"整批校验→一次性应用"(paramsLogic.bulkMultiply),
// 失败时不产生半批修改,由页面容器负责通知与撤销栈。
import { useState } from 'react'
import type { JSX } from 'react'

export type BulkActionBarProps = {
  count: number
  onApply: (factor: number) => void
  onClear: () => void
}

export function BulkActionBar({ count, onApply, onClear }: BulkActionBarProps): JSX.Element | null {
  const [factor, setFactor] = useState('1.1')
  return (
    <div className="bulk-bar">
      <strong>已选 {count} 项</strong>
      <span>候选值 ×</span>
      <input
        type="number"
        value={factor}
        step="0.1"
        aria-label="批量修改倍率"
        onChange={(e) => setFactor(e.target.value)}
      />
      <button
        className="btn"
        onClick={() => {
          const parsed = Number(factor)
          onApply(Number.isNaN(parsed) ? Number.NaN : parsed)
        }}
      >
        应用倍率
      </button>
      <button className="btn subtle" onClick={onClear}>
        取消选择
      </button>
      <span className="muted">整数参数自动四舍五入</span>
    </div>
  )
}
