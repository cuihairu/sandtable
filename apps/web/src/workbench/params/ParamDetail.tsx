// WB-02.06 · 参数详情(参数检查器):聚焦参数的定义、编辑方式与恢复操作。
// WB-05 · 数据源 = 注册表定义 × 基线/候选 YAML;缺值如实显示(不回退默认);
// 注册表默认值只作参考标注,不冒充配置值。dur/expr/table 显示只读口径并给
// 高级编辑入口(WB-05.02);内核校验失败时展示原始错误详情(WB-05.07)。
// WB-11.12 · 检查器文案走词典;注册表原始 desc 按原文回显(WB-11.19/.20 口径)。
import type { JSX } from 'react'
import type { ReactNode } from 'react'
import { WbIcon } from '../components/icons.tsx'
import type { ParamRowModel } from './paramsLogic.ts'
import { displayParamName, paramGroupLabel } from './paramRegistry.ts'
import { t } from '../../lib/i18n/index.ts'
import type { Locale } from '../../lib/i18n/index.ts'

export type ParamDetailProps = {
  row: ParamRowModel
  changedCount: number
  savedLabel: string
  /** 内核完整校验失败的原始详情(null = 最近校验通过/未失败) */
  kernelError: { path: string | null; message: string } | null
  /** P1 · 参数元信息区(缺失显式「未定义」;不注入时保留占位行) */
  metaSection?: ReactNode
  onResetOne: () => void
  onAdvancedEdit: () => void
  onNewExperiment?: () => void
  locale: Locale
}

/** 参数类型 → 词典 key(字面量键面,保住 t() 的 key 类型检查)。 */
const KIND_LABEL: Record<string, 'params.kind.u32' | 'params.kind.u64' | 'params.kind.i64' | 'params.kind.f64' | 'params.kind.mix' | 'params.kind.dur' | 'params.kind.expr' | 'params.kind.table'> = {
  u32: 'params.kind.u32',
  u64: 'params.kind.u64',
  i64: 'params.kind.i64',
  f64: 'params.kind.f64',
  mix: 'params.kind.mix',
  dur: 'params.kind.dur',
  expr: 'params.kind.expr',
  table: 'params.kind.table',
}

export function ParamDetail({
  row,
  changedCount,
  savedLabel,
  kernelError,
  metaSection,
  onResetOne,
  onAdvancedEdit,
  onNewExperiment,
  locale,
}: ParamDetailProps): JSX.Element {
  const name = displayParamName(row.def.path, locale)
  const kindKey = KIND_LABEL[row.def.kind]
  return (
    <aside className="selection-inspector" aria-label={t(locale, 'params.inspectorAria')}>
      <div className="inspector-header">
        <WbIcon name="sliders" />
        {t(locale, 'params.inspector')}
      </div>
      <section className="inspector-section">
        <div className="inspector-eyebrow">{`${paramGroupLabel(row.group, locale).toUpperCase()} / ${t(locale, 'params.eyebrowParam')}`}</div>
        <div className="inspector-title">{name}</div>
        <code className="inspector-code">{row.def.path}</code>
        <div className="parameter-value">
          {row.candidate.present ? row.candidate.text : t(locale, 'params.missing')}
          <small>{t(locale, 'params.colCandidate')}</small>
        </div>
        <div className="inspector-kv">
          <span>{t(locale, 'params.baselineValue')}</span>
          <span className="mono">{row.baseline.present ? row.baseline.text : t(locale, 'params.missing')}</span>
        </div>
        <div className="inspector-kv">
          <span>{t(locale, 'params.registryDefault')}</span>
          <span className="mono">{row.def.default}</span>
        </div>
        <div className="inspector-kv">
          <span>{t(locale, 'params.dataType')}</span>
          <span className="mono">{kindKey !== undefined ? t(locale, kindKey) : row.def.kind}</span>
        </div>
        <div className="inspector-kv">
          <span>{t(locale, 'params.editMode')}</span>
          <span>{row.editable ? t(locale, 'params.editNumeric') : t(locale, 'params.editAdvanced')}</span>
        </div>
        {!row.editable && (
          <button className="btn inspector-action" onClick={onAdvancedEdit}>
            <WbIcon name="file-code" />
            {t(locale, 'params.yamlEditButton')}
          </button>
        )}
        <button className="btn inspector-action" onClick={onResetOne}>
          <WbIcon name="reset" />
          {t(locale, 'params.resetOne')}
        </button>
      </section>
      <section className="inspector-section">
        <h3>{t(locale, 'params.sectionDefinition')}</h3>
        <p className="note">{row.def.desc}。{t(locale, 'params.registryNote')}</p>
        {/* P1 · 参数元信息层:八项字段逐项展示(缺失显式「未定义」)、收藏、
            编辑与校验问题点名;由页面容器注入(状态在 paramMeta 会话)。 */}
        {metaSection ?? (
          <>
            <div className="inspector-kv">
              <span>{t(locale, 'params.unitMeta')}</span>
              <span className="muted">{t(locale, 'params.metaUndefined')}</span>
            </div>
            <div className="inspector-kv">
              <span>{t(locale, 'params.rangeMeta')}</span>
              <span className="muted">{t(locale, 'params.metaUndefined')}</span>
            </div>
          </>
        )}
        <div className="inspector-kv">
          <span>{t(locale, 'params.registrySource')}</span>
          <span className="mono">registry.rs</span>
        </div>
        <div className="note-block" style={{ marginTop: 12 }}>
          {t(locale, 'params.basicCheckNote')}
        </div>
      </section>
      {kernelError && (
        <section className="inspector-section">
          <h3>{t(locale, 'params.kernelSection')}</h3>
          <div className="inspector-kv">
            <span>{t(locale, 'params.errorPath')}</span>
            <span className="mono">{kernelError.path ?? t(locale, 'params.errorNoPath')}</span>
          </div>
          <p className="note">{kernelError.message}</p>
          <p className="note">{t(locale, 'params.fixHint')}</p>
        </section>
      )}
      <section className="inspector-section">
        <h3>{t(locale, 'params.sectionSummary')}</h3>
        <div className="inspector-kv">
          <span>{t(locale, 'params.vsBaseline')}</span>
          <span>{t(locale, 'params.changeCount', { n: changedCount })}</span>
        </div>
        <div className="inspector-kv">
          <span>{t(locale, 'params.saveState')}</span>
          <span>{savedLabel}</span>
        </div>
        <p className="note">{t(locale, 'params.freezeNote')}</p>
        {onNewExperiment && (
          <button className="btn inspector-action primary" onClick={onNewExperiment}>
            <WbIcon name="flask" />
            {t(locale, 'params.newExperiment')}
          </button>
        )}
      </section>
    </aside>
  )
}
