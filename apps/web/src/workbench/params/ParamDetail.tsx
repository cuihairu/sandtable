// WB-02.06 · 参数详情(参数检查器):聚焦参数的定义、校验边界与恢复操作。
// 元信息缺失时如实显示"未定义"(不编造单位/建议区间——P1 参数元信息层
// 落地前的口径)。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import type { ParamDef, ParamValues } from '../demo/sampleProject.ts'

export type ParamDetailProps = {
  def: ParamDef
  value: number | undefined
  baseline: number
  changedCount: number
  savedLabel: string
  onResetOne: () => void
  onNewExperiment?: () => void
}

export function ParamDetail({
  def,
  value,
  baseline,
  changedCount,
  savedLabel,
  onResetOne,
  onNewExperiment,
}: ParamDetailProps): JSX.Element {
  return (
    <aside className="selection-inspector" aria-label="参数详情">
      <div className="inspector-header">
        <WbIcon name="sliders" />
        参数检查器
      </div>
      <section className="inspector-section">
        <div className="inspector-eyebrow">{`${def.group.toUpperCase()} / PARAMETER`}</div>
        <div className="inspector-title">{def.name}</div>
        <code className="inspector-code">{def.id}</code>
        <div className="parameter-value">
          {value ?? '—'}
          <small>候选值</small>
        </div>
        <div className="inspector-kv">
          <span>基线默认值</span>
          <span className="mono">{baseline}</span>
        </div>
        <div className="inspector-kv">
          <span>数据类型</span>
          <span className="mono">{def.type}</span>
        </div>
        <button className="btn inspector-action" onClick={onResetOne}>
          <WbIcon name="reset" />
          恢复此项基线值
        </button>
      </section>
      <section className="inspector-section">
        <h3>定义与校验</h3>
        <p className="note">{`${def.name}。路径、类型和基线值取自 Sandtable 参数注册表。`}</p>
        <div className="inspector-kv">
          <span>单位元数据</span>
          <span className="muted">未定义</span>
        </div>
        <div className="inspector-kv">
          <span>建议区间元数据</span>
          <span className="muted">未定义</span>
        </div>
        <div className="inspector-kv">
          <span>注册表来源</span>
          <span className="mono">registry.rs</span>
        </div>
        <div className="note-block" style={{ marginTop: 12 }}>
          表格侧只检查数值类型{def.id.includes('.p_') ? '及概率范围' : ''}。完整配置有效性与跨参数关系需要内核校验。
        </div>
      </section>
      <section className="inspector-section">
        <h3>方案修改摘要</h3>
        <div className="inspector-kv">
          <span>相对默认基线</span>
          <span>{changedCount} 项变更</span>
        </div>
        <div className="inspector-kv">
          <span>保存状态</span>
          <span>{savedLabel}</span>
        </div>
        <p className="note">修改参数不会重算内置样例结果。完成配置后,可在实验设计器设置新的比较方式。</p>
        {onNewExperiment && (
          <button className="btn inspector-action primary" onClick={onNewExperiment}>
            <WbIcon name="flask" />
            配置新实验
          </button>
        )}
      </section>
    </aside>
  )
}

export type ParamValuesLike = ParamValues
