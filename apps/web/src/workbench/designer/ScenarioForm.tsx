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
  const mixField = (label: string, leaf: ScenarioLeaf, raw: number | null): JSX.Element => (
    <div className="field">
      <label htmlFor={`scenario-${leaf}`}>{label}(%)</label>
      <NumField
        id={`scenario-${leaf}`}
        value={raw === null ? null : Math.round(raw * 100 * 100) / 100}
        ariaLabel={`${label}配比(UI 百分数)`}
        onCommit={(text) => onScenarioEdit(leaf, text)}
      />
      <small>UI 百分数输入,YAML 写比例(÷100);缺值不回退默认</small>
    </div>
  )
  return (
    <section className="form-section">
      <div className="form-section-heading">
        <span className="step">03</span>
        <h2>场景与统计样本(读 scenario 节 · 缺值如实显示)</h2>
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
          <label htmlFor="scenario-players">玩家数(规模)</label>
          <NumField
            id="scenario-players"
            value={stats.players}
            ariaLabel="玩家数(单次运行规模)"
            onCommit={(t) => onScenarioEdit('population', t)}
          />
          <small>scenario.population;群体规模 ≠ 统计样本量</small>
        </div>
        <div className="field">
          <label htmlFor="scenario-days">仿真天数(规模)</label>
          <NumField
            id="scenario-days"
            value={stats.days}
            ariaLabel="仿真天数"
            onCommit={(t) => onScenarioEdit('duration_days', t)}
          />
          <small>scenario.duration「{stats.durationText ?? '缺值'}」;不足 7 天时 D7 指标不可用</small>
        </div>
        <div className="field">
          <label htmlFor="scenario-seed">场景 seed(CRN 基准)</label>
          <NumField
            id="scenario-seed"
            value={stats.seed}
            ariaLabel="场景基础种子"
            onCommit={(t) => onScenarioEdit('seed', t)}
          />
          <small>scenario.seed(u64 文本提交,防大整数精度丢失);A/B 两侧共用 = CRN 配对</small>
        </div>
        {mixField('casual 配比', 'mix_casual', stats.mix.casual)}
        {mixField('core 配比', 'mix_core', stats.mix.core)}
        {mixField('whale 配比', 'mix_whale', stats.mix.whale)}
        <div className="field">
          <label htmlFor="scenario-reps">replicates(统计样本量)</label>
          <NumField
            id="scenario-reps"
            value={reps}
            ariaLabel="replicates(每个候选的独立重复运行次数)"
            onCommit={(t) => onRepsChange(Number(t))}
          />
          <small>{repsError ?? '每候选独立重复运行次数(内核 sweep.replicates)'}</small>
        </div>
        {method === 'random' && onSamplingChange !== undefined && (
          <div className="field">
            <label htmlFor="scenario-sampling">随机采样策略(仅 Random / LHS 方法)</label>
            <select
              id="scenario-sampling"
              value={sampling ?? 'lhc'}
              onChange={(e) => onSamplingChange(e.target.value as 'lhc' | 'uniform')}
            >
              <option value="lhc">拉丁超立方(latin_hypercube)</option>
              <option value="uniform">均匀随机(random)</option>
            </select>
            <small>LHS 逐维分层采样,与普通均匀随机语义不同(内核执行,不前端口算)。</small>
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
