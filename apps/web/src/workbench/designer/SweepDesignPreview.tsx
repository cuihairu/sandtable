// WB-12 · 多维扫描设计预演(todo L364):设计器侧的「先算账后物化」面板。
// 内核计划仍是唯一真值源:本面板只做设计期预演,不替代 planSweep 校验。
// - 多因子边界/步长 → 离散水平表(内核 grid_points 同口径,不补尾点);
// - Grid 组合预算:逐维水平数乘积,超单候选上限即拒绝(内核同账本);
// - Random/LHS:samples ∈ [1, 上限],连续采样无水平表(不编造);
// - 重复候选:内核计划槽按参数域归组(应用侧候选 ID 内容寻址,同域恒同
//   ID,天然聚合);计划未出时如实等待,不猜。
import type { JSX } from 'react'
import { combinationBudget, factorLevels, samplingBudget, duplicateGroups, checkDomain, MAX_CANDIDATES } from '../../lib/sweepDesign.ts'
import type { DesignDraft } from './designerLogic.ts'
import { fmtNumber } from '../../lib/i18n/format.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type SweepDesignPreviewProps = {
  design: DesignDraft
  /** 内核已校验计划(只读候选表即可;未出计划时如实等待,不猜候选域) */
  plan: { readonly candidates: ReadonlyArray<Readonly<Record<string, number>>> } | null
}

export function SweepDesignPreview({ design, plan }: SweepDesignPreviewProps): JSX.Element {
  const locale = useLocale()
  const axes = design.factors.map((f) => ({ path: f.path, min: f.min, max: f.max, step: f.step }))
  const isGrid = design.method === 'grid'
  // Random/LHS 是连续采样:不按步长离散,不编造水平表(取值域合法性仍校验)
  const levels = isGrid ? factorLevels(axes) : []
  const budget = isGrid ? combinationBudget(axes) : null
  const sampling = isGrid ? null : samplingBudget(design.samples)
  const dups = plan && plan.candidates.length > 0 ? duplicateGroups(plan.candidates) : null

  return <div className="design-preview" data-testid="sweep-design-preview" aria-label={t(locale, 'experiment.previewTitle')}>
    <h3>{t(locale, 'experiment.previewTitle')}</h3>
    <p className="note">{t(locale, 'experiment.previewNote')}</p>
    <div className="candidate-table-wrap"><table className="candidate-table" data-testid="preview-factors">
      <thead><tr>
        <th>{t(locale, 'experiment.previewColFactor')}</th>
        <th>{t(locale, 'experiment.previewColLevels')}</th>
        <th className="numeric">{t(locale, 'experiment.previewColCount')}</th>
      </tr></thead>
      <tbody>{design.factors.map((f, i) => {
        const row = levels[i]
        const continuous = !isGrid && checkDomain(f).ok
        return <tr key={f.path}>
          <td className="mono">{f.path}</td>
          <td className="mono">{continuous
            ? t(locale, 'experiment.previewLevelsContinuous')
            : row
              ? (row.levels.length <= 8 ? row.levels.map((v) => fmtNumber(locale, v, { maxFractionDigits: 4 })).join(', ')
                : t(locale, 'experiment.previewLevelsMany', { first: fmtNumber(locale, row.levels[0], { maxFractionDigits: 4 }), last: fmtNumber(locale, row.levels[row.levels.length - 1], { maxFractionDigits: 4 }), count: row.levels.length }))
              : t(locale, 'experiment.previewLevelsInvalid')}</td>
          <td className="numeric">{continuous ? '—' : row ? row.levels.length : '—'}</td>
        </tr>
      })}</tbody>
    </table></div>
    <p className="note" data-testid="preview-budget">
      {budget
        ? budget.ok
          ? t(locale, 'experiment.previewBudgetOk', { total: fmtNumber(locale, budget.total), per: budget.perAxis.map((a) => `${a.path}×${a.levels}`).join(' · ') })
          : budget.reason === 'over_budget'
            ? t(locale, 'experiment.previewBudgetOver', { detail: budget.detail, total: fmtNumber(locale, budget.total), max: fmtNumber(locale, MAX_CANDIDATES) })
            : t(locale, 'experiment.previewBudgetInvalid', { detail: budget.detail })
        : sampling
          ? sampling.ok
            ? t(locale, 'experiment.previewSamplesOk', { samples: fmtNumber(locale, design.samples) })
            : t(locale, 'experiment.previewSamplesBad', { max: fmtNumber(locale, MAX_CANDIDATES) })
          : null}
    </p>
    <h3>{t(locale, 'experiment.previewDupTitle')}</h3>
    {dups
      ? <p className="note" data-testid="preview-duplicates">
        {dups.duplicateSlots === 0
          ? t(locale, 'experiment.previewDupNone', { unique: fmtNumber(locale, dups.uniqueCount), total: fmtNumber(locale, plan!.candidates.length) })
          : t(locale, 'experiment.previewDupSome', { slots: fmtNumber(locale, dups.duplicateSlots), unique: fmtNumber(locale, dups.uniqueCount), total: fmtNumber(locale, plan!.candidates.length) })}
        {dups.groups.length > 0 && <span className="mono"> {dups.groups.map((g) => t(locale, 'experiment.previewDupGroup', { indices: g.indices.map((i) => fmtNumber(locale, i)).join('/') })).join(' · ')}</span>}
      </p>
      : <p className="note">{t(locale, 'experiment.previewAwaitPlan')}</p>}
  </div>
}
