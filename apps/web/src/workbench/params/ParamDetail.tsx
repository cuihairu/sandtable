// WB-02.06 · 参数详情(参数检查器):聚焦参数的定义、编辑方式与恢复操作。
// WB-05 · 数据源 = 注册表定义 × 基线/候选 YAML;缺值如实显示(不回退默认);
// 注册表默认值只作参考标注,不冒充配置值。dur/expr/table 显示只读口径并给
// 高级编辑入口(WB-05.02);内核校验失败时展示原始错误详情(WB-05.07)。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import type { ParamRowModel } from './paramsLogic.ts'
import { displayParamName } from './paramRegistry.ts'

export type ParamDetailProps = {
  row: ParamRowModel
  changedCount: number
  savedLabel: string
  /** 内核完整校验失败的原始详情(null = 最近校验通过/未失败) */
  kernelError: { path: string | null; message: string } | null
  onResetOne: () => void
  onAdvancedEdit: () => void
  onNewExperiment?: () => void
  locale: string
}

const KIND_LABEL: Record<string, string> = {
  u32: '无符号 32 位整数',
  u64: '无符号 64 位整数',
  i64: '有符号 64 位整数',
  f64: '浮点数',
  mix: '分群权重(比例)',
  dur: '天数时长(如 30d)',
  expr: '公式表达式',
  table: '结构参数',
}

export function ParamDetail({
  row,
  changedCount,
  savedLabel,
  kernelError,
  onResetOne,
  onAdvancedEdit,
  onNewExperiment,
  locale,
}: ParamDetailProps): JSX.Element {
  const name = displayParamName(row.def.path, locale)
  const editableLabel = row.editable ? '数值编辑' : '只读 · 高级编辑'
  return (
    <aside className="selection-inspector" aria-label="参数详情">
      <div className="inspector-header">
        <WbIcon name="sliders" />
        参数检查器
      </div>
      <section className="inspector-section">
        <div className="inspector-eyebrow">{`${row.group.toUpperCase()} / PARAMETER`}</div>
        <div className="inspector-title">{name}</div>
        <code className="inspector-code">{row.def.path}</code>
        <div className="parameter-value">
          {row.candidate.present ? row.candidate.text : '缺值'}
          <small>候选值</small>
        </div>
        <div className="inspector-kv">
          <span>基线值(基线配置实际写入)</span>
          <span className="mono">{row.baseline.present ? row.baseline.text : '缺值'}</span>
        </div>
        <div className="inspector-kv">
          <span>注册表默认值(参考)</span>
          <span className="mono">{row.def.default}</span>
        </div>
        <div className="inspector-kv">
          <span>数据类型</span>
          <span className="mono">{KIND_LABEL[row.def.kind] ?? row.def.kind}</span>
        </div>
        <div className="inspector-kv">
          <span>编辑方式</span>
          <span>{editableLabel}</span>
        </div>
        {!row.editable && (
          <button className="btn inspector-action" onClick={onAdvancedEdit}>
            <WbIcon name="file-code" />
            高级 YAML 编辑
          </button>
        )}
        <button className="btn inspector-action" onClick={onResetOne}>
          <WbIcon name="reset" />
          恢复此项基线值
        </button>
      </section>
      <section className="inspector-section">
        <h3>定义与校验</h3>
        <p className="note">{`${row.def.desc}。路径、类型与默认值取自 Sandtable 参数注册表(registry.rs)。`}</p>
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
          表格侧只做基础检查(有限数/整数域/概率与权重范围)。
          最终配置有效性由内核在应用/保存/运行时完整校验,失败会定位到参数并保留待修复输入。
        </div>
      </section>
      {kernelError && (
        <section className="inspector-section">
          <h3>内核校验失败</h3>
          <div className="inspector-kv">
            <span>定位参数</span>
            <span className="mono">{kernelError.path ?? '(未定位到具体参数)'}</span>
          </div>
          <p className="note">{kernelError.message}</p>
          <p className="note">待修复输入已保留在单元格中,修正后重新提交;或撤销该次修改。</p>
        </section>
      )}
      <section className="inspector-section">
        <h3>方案修改摘要</h3>
        <div className="inspector-kv">
          <span>相对基线</span>
          <span>{changedCount} 项变更</span>
        </div>
        <div className="inspector-kv">
          <span>保存状态</span>
          <span>{savedLabel}</span>
        </div>
        <p className="note">修改参数会改变下一次运行的项目配置输入(以保存/运行时冻结的版本为准)。</p>
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
