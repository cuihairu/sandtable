// WB-02.07 · WB-06.06 · 场景与统计样本表单:
// - 规模字段(玩家数 / 仿真天数 / cohort 配比)直接读写场景 YAML 的
//   scenario 节(population / duration:"Nd" / seed / population_mix),
//   不再是本地草稿副本;状态统计字段(replicates)是内核 sweep.replicates;
//   规模与统计样本量就地标注,防止混同;
// - cohort 配比 UI 百分数显示、YAML 以比例写入(×100 ⇄ ÷100,口径就地标注);
// - seed 直接对应 scenario.seed(CRN 配对 = 两侧共用该种子;A/B 内核
//   Comparison 用同 rep seed 配对,无需 UI 开关);
// - 随机采样策略(sampling)仅 Random / LHS 方法适用,Grid 方法隐藏
//   (WB-06.14「不适用字段明确隐藏」)。
import type { JSX } from 'react'
import type { ScenarioStats, ScenarioLeaf } from './designerLogic.ts'
import type { DesignerMethod } from './designerLogic.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type ScenarioFormProps = {
  method: DesignerMethod
  stats: ScenarioStats
  reps: number
  repsError?: string
  /** 文本入参(玩家数/天数/seed/配比 UI 百分数);页面侧换算写 YAML */
  onScenarioEdit: (leaf: ScenarioLeaf, text: string) => void
  onRepsChange: (reps: number) => void
  sampling?: 'lhc' | 'uniform'
  onSamplingChange?: (sampling: 'lhc' | 'uniform') => void
}

/** 数值字段:非受控缓冲、Enter/失焦提交、Esc 撤回(参数表 WB-05.05 同纪律);
 *  value 变化后本地才重挂载(key),未提交输入不打断编辑。 */
function NumField({
  id,
  value,
  onCommit,
  error,
  ariaLabel,
}: {
  id: string
  value: number | null
  onCommit: (text: string) => void
  error?: string | null
  ariaLabel: string
}): JSX.Element {
  const shown = value === null ? '' : String(value)
  return (
    <input
      key={shown}
      id={id}
      type="text"
      inputMode="decimal"
      defaultValue={shown}
      aria-label={ariaLabel}
      aria-invalid={error !== undefined || value === null}
      onBlur={(e) => {
        if (e.currentTarget.value !== shown) onCommit(e.currentTarget.value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') e.currentTarget.value = shown
      }}
    />
  )
}

export function ScenarioForm({
  method,
  stats,
  reps,
  repsError,
  onScenarioEdit,
  onRepsChange,
  sampling,
  onSamplingChange,
}: ScenarioFormProps): JSX.Element {
  const locale = useLocale()
  const mixField = (label: string, leaf: ScenarioLeaf, raw: number | null): JSX.Element => (
    <div className="field">
      <label htmlFor={`scenario-${leaf}`}>{label}(%)</label>
      <NumField
        id={`scenario-${leaf}`}
        value={raw === null ? null : Math.round(raw * 100 * 100) / 100}
        ariaLabel={t(locale, 'experiment.mixAria', { label })}
        onCommit={(text) => onScenarioEdit(leaf, text)}
      />
      <small>{t(locale, 'experiment.mixNote')}</small>
    </div>
  )
  return (
    <section className="form-section">
      <div className="form-section-heading">
        <span className="step">03</span>
        <h2>{t(locale, 'experiment.scenarioSectionTitle')}</h2>
      </div>
      {stats.errors.length > 0 && (
        <div className="note-block" role="alert">
          {stats.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="scenario-players">{t(locale, 'experiment.playersLabel')}</label>
          <NumField
            id="scenario-players"
            value={stats.players}
            ariaLabel={t(locale, 'experiment.playersAria')}
            onCommit={(text) => onScenarioEdit('population', text)}
          />
          <small>{t(locale, 'experiment.playersNote')}</small>
        </div>
        <div className="field">
          <label htmlFor="scenario-days">{t(locale, 'experiment.daysLabel')}</label>
          <NumField
            id="scenario-days"
            value={stats.days}
            ariaLabel={t(locale, 'experiment.daysAria')}
            onCommit={(text) => onScenarioEdit('duration_days', text)}
          />
          <small>
            {t(locale, 'experiment.daysNote', { text: stats.durationText ?? t(locale, 'params.missing') })}
          </small>
        </div>
        <div className="field">
          <label htmlFor="scenario-seed">{t(locale, 'experiment.seedLabel')}</label>
          <NumField
            id="scenario-seed"
            value={stats.seed}
            ariaLabel={t(locale, 'experiment.seedAria')}
            onCommit={(text) => onScenarioEdit('seed', text)}
          />
          <small>{t(locale, 'experiment.seedNote')}</small>
        </div>
        {mixField(t(locale, 'experiment.mixCasual'), 'mix_casual', stats.mix.casual)}
        {mixField(t(locale, 'experiment.mixCore'), 'mix_core', stats.mix.core)}
        {mixField(t(locale, 'experiment.mixWhale'), 'mix_whale', stats.mix.whale)}
        <div className="field">
          <label htmlFor="scenario-reps">{t(locale, 'experiment.repsLabel')}</label>
          <NumField
            id="scenario-reps"
            value={reps}
            ariaLabel={t(locale, 'experiment.repsAria')}
            onCommit={(text) => onRepsChange(Number(text))}
          />
          <small>{repsError ?? t(locale, 'experiment.repsNote')}</small>
        </div>
        {method === 'random' && onSamplingChange !== undefined && (
          <div className="field">
            <label htmlFor="scenario-sampling">{t(locale, 'experiment.samplingLabel')}</label>
            <select
              id="scenario-sampling"
              value={sampling ?? 'lhc'}
              onChange={(e) => onSamplingChange(e.target.value as 'lhc' | 'uniform')}
            >
              <option value="lhc">{t(locale, 'experiment.sampling.lhc')}</option>
              <option value="uniform">{t(locale, 'experiment.sampling.uniform')}</option>
            </select>
            <small>{t(locale, 'experiment.samplingNote')}</small>
          </div>
        )}
      </div>
      {stats.errors.length > 0 && (
        <div role="alert" style={{ fontSize: 10, color: 'var(--wb-red)' }}>
          ⚠ {stats.errors[0]}
        </div>
      )}
    </section>
  )
}
