// WB-02.07 · 方法选择:A/B / Grid / Random-LHS 三卡选择。
// 受控;aria-pressed 表达当前方法。方法说明来自 METHOD_INFO(可独立接数据)。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import { METHOD_INFO } from './designerLogic.ts'
import type { ExperimentMethod } from './designerLogic.ts'

export type MethodSelectProps = {
  value: ExperimentMethod
  onChange: (method: ExperimentMethod) => void
}

export function MethodSelect({ value, onChange }: MethodSelectProps): JSX.Element {
  return (
    <div className="method-options" role="group" aria-label="实验方法">
      {METHOD_INFO.map((m) => (
        <button
          key={m.id}
          className={`method-option${value === m.id ? ' active' : ''}`}
          aria-pressed={value === m.id}
          onClick={() => onChange(m.id)}
        >
          <strong>
            {m.label}
            {value === m.id && <WbIcon name="circlecheck" />}
          </strong>
          <small>{m.desc}</small>
        </button>
      ))}
    </div>
  )
}
