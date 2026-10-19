// WB-02.07 · WB-06.03/06.04/06.05/06.14 · 因子表:
// - 因子路径从参数注册表选择(可扫描类型 u32/u64/i64/f64),类型与描述来自
//   注册表(不再硬编码单因子样例);
// - Grid 显示步长(整数类型步长须为正整数),Random/LHS 隐藏步长
//   (内核 Random/LHS 只用 min/max;WB-06.14「不适用字段明确隐藏」);
// - 范围非法就地提示(每行独立);采样数 samples 是 Random/LHS 的候选
//   预算(全局,非逐因子)。
import type { JSX } from 'react'
import { sweepableParams, METHOD_LABEL } from './designerLogic.ts'
import type { DesignerMethod, FactorDraft } from './designerLogic.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type FactorRowView = {
  draft: FactorDraft
  /** 注册表类型(不含可扫描 → error) */
  error?: string
}

export type FactorTableProps = {
  method: DesignerMethod
  rows: readonly FactorRowView[]
  /** Random/LHS 候选采样数(内核 sweep.samples) */
  samples: number
  samplesError?: string
  /** path 不在注册表/被移除时 type 显示兜底 */
  onFactorChange: (index: number, draft: FactorDraft) => void
  onFactorAdd: (path: string) => void
  onFactorRemove: (index: number) => void
  onSamplesChange: (samples: number) => void
}

const REGISTRY_PARAMS = sweepableParams()

export function FactorTable({
  method,
  rows,
  samples,
  samplesError,
  onFactorChange,
  onFactorAdd,
  onFactorRemove,
  onSamplesChange,
}: FactorTableProps): JSX.Element {
  const locale = useLocale()
  const sweep = method !== 'ab'
  const showStep = method === 'grid'
  return (
    <div className="factor-grid" role="grid" aria-label={t(locale, 'experiment.factorsAria')}>
      <span role="rowheader">{t(locale, 'experiment.colFactorPath')}</span>
      <label className="muted" style={{ fontSize: 10 }} htmlFor="factor-min-0">
        {t(locale, 'experiment.colMin')}
      </label>
      <label className="muted" style={{ fontSize: 10 }} htmlFor="factor-max-0">
        {t(locale, 'experiment.colMax')}
      </label>
      {showStep && (
        <label className="muted" style={{ fontSize: 10 }} htmlFor="factor-step-0">
          {t(locale, 'experiment.colStep')}
        </label>
      )}
      <span className="muted" style={{ fontSize: 10 }} />
      {rows.map((row, i) => (
        <FactorCells
          key={`${row.draft.path}:${i}`}
          index={i}
          showStep={showStep}
          row={row}
          onChange={(draft) => onFactorChange(i, draft)}
          onRemove={rows.length > 1 ? () => onFactorRemove(i) : undefined}
        />
      ))}
      {sweep && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="muted" htmlFor="factor-add" style={{ fontSize: 10 }}>
            {t(locale, 'experiment.addFactor')}
          </label>
          <select
            id="factor-add"
            value={''}
            aria-label={t(locale, 'experiment.addFactorAria')}
            onChange={(e) => {
              if (e.target.value !== '') onFactorAdd(e.target.value)
              e.target.value = ''
            }}
          >
            <option value="">{t(locale, 'experiment.pickParam')}</option>
            {REGISTRY_PARAMS.map((p) => (
              <option key={p.path} value={p.path}>
                {p.path} · {p.kind} · {p.desc}
              </option>
            ))}
          </select>
        </div>
      )}
      {method === 'random' && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 10, alignItems: 'center' }}>
          <label className="muted" htmlFor="factor-samples" style={{ fontSize: 10 }}>
            {t(locale, 'experiment.samplesLabel')}
          </label>
          <input
            id="factor-samples"
            type="number"
            value={samples}
            aria-invalid={samplesError !== undefined}
            style={{ width: 90 }}
            onChange={(e) => onSamplesChange(Number(e.target.value))}
          />
          {samplesError && (
            <span role="alert" style={{ color: 'var(--wb-red)', fontSize: 10 }}>
              {samplesError}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function FactorCells({
  index,
  showStep,
  row,
  onChange,
  onRemove,
}: {
  index: number
  showStep: boolean
  row: FactorRowView
  onChange: (draft: FactorDraft) => void
  onRemove?: () => void
}): JSX.Element {
  const locale = useLocale()
  return (
    <>
      <span className="factor-name" role="gridcell">
        {row.draft.path}
        <br />
        <span style={{ color: '#82939a' }}>
          {t(locale, 'experiment.registryParamLine', { mode: METHOD_LABEL[showStep ? 'grid' : 'random'] })}
        </span>
      </span>
      <input
        id={`factor-min-${index}`}
        type="number"
        value={row.draft.min}
        aria-label={t(locale, 'experiment.minAria', { path: row.draft.path })}
        aria-invalid={row.error !== undefined}
        onChange={(e) => onChange({ ...row.draft, min: Number(e.target.value) })}
      />
      <input
        id={`factor-max-${index}`}
        type="number"
        value={row.draft.max}
        aria-label={t(locale, 'experiment.maxAria', { path: row.draft.path })}
        aria-invalid={row.error !== undefined}
        onChange={(e) => onChange({ ...row.draft, max: Number(e.target.value) })}
      />
      {showStep && (
        <input
          id={`factor-step-${index}`}
          type="number"
          value={row.draft.step}
          aria-label={t(locale, 'experiment.stepAria', { path: row.draft.path })}
          aria-invalid={row.error !== undefined}
          onChange={(e) => onChange({ ...row.draft, step: Number(e.target.value) })}
        />
      )}
      <span role="gridcell" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {row.error && (
          <span role="alert" style={{ color: 'var(--wb-red)', fontSize: 10 }}>
            {row.error}
          </span>
        )}
        {onRemove && (
          <button
            type="button"
            className="btn subtle"
            aria-label={t(locale, 'experiment.removeFactorAria', { path: row.draft.path })}
            onClick={onRemove}
          >
            {t(locale, 'experiment.remove')}
          </button>
        )}
      </span>
    </>
  )
}
