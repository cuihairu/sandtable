// WB-02.07 · 方法选择:A/B / Grid / Random-LHS 三卡选择。
// 受控;aria-pressed 表达当前方法。方法说明走词典(WB-11.13);
// METHOD_INFO 的 id 集合仍由 designerLogic 锁定,本组件只做显示名解析。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import { METHOD_INFO } from './designerLogic.ts'
import type { DesignerMethod } from './designerLogic.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

/** 方法 ID → 词典 key(字面量键面,保住 t() 的 key 类型检查)。 */
const METHOD_TITLE: Record<DesignerMethod, 'experiment.methodTitle.ab' | 'experiment.methodTitle.grid' | 'experiment.methodTitle.random'> = {
  ab: 'experiment.methodTitle.ab',
  grid: 'experiment.methodTitle.grid',
  random: 'experiment.methodTitle.random',
}
const METHOD_DESC: Record<DesignerMethod, 'experiment.methodDesc.ab' | 'experiment.methodDesc.grid' | 'experiment.methodDesc.random'> = {
  ab: 'experiment.methodDesc.ab',
  grid: 'experiment.methodDesc.grid',
  random: 'experiment.methodDesc.random',
}

export type MethodSelectProps = {
  value: DesignerMethod
  onChange: (method: DesignerMethod) => void
}

export function MethodSelect({ value, onChange }: MethodSelectProps): JSX.Element {
  const locale = useLocale()
  return (
    <div className="method-options" role="group" aria-label={t(locale, 'experiment.methodGroupAria')}>
      {METHOD_INFO.map((m) => (
        <button
          key={m.id}
          className={`method-option${value === m.id ? ' active' : ''}`}
          aria-pressed={value === m.id}
          onClick={() => onChange(m.id)}
        >
          <strong>
            {t(locale, METHOD_TITLE[m.id])}
            {value === m.id && <WbIcon name="circlecheck" />}
          </strong>
          <small>{t(locale, METHOD_DESC[m.id])}</small>
        </button>
      ))}
    </div>
  )
}
