// P1-04 · 候选并排比较面板(项目与场景管理 ④):分析页候选草稿 ≥2 时给出
// 字段级并排 diff(参数路径并集、缺失显式 null、差异行与「与基线不同」列)。
// 数值来源:候选草稿自带 values(analysis/resultModel 同一数据面),YAML
// 编辑后的行以 parseConfig + numericValuesOf 重算(与参数页同口径),
// 本面板不做内核语义判断。
import type { JSX } from 'react'
import { useMemo, useState } from 'react'
import { compareCandidates } from './candidateCompare.ts'
import { parseConfig, numericValuesOf } from '../params/configYaml.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import type { CandidateDraft } from '../analysis/resultModel.ts'

export function CandidateComparePanel({ drafts, baselineYaml }: {
  drafts: readonly CandidateDraft[]
  /** 基线参照(候选的 baselineYaml 一致时取其一;否则不展示基线列) */
  baselineYaml: string | null
}): JSX.Element | null {
  const locale = useLocale()
  const [changedOnly, setChangedOnly] = useState(false)
  const compare = useMemo(() => {
    const cands = drafts.map((d) => {
      // YAML 被用户编辑过 → 以编辑后的 YAML 重算(与参数页同口径);
      // 解析失败回落到快照 values(不虚构数值)
      const parsed = parseConfig(d.yaml)
      const values = parsed.errors.length === 0 ? numericValuesOf(parsed) : d.values
      return { id: d.id, label: d.id.slice(0, 10), values }
    })
    const base = baselineYaml === null ? undefined : (() => {
      const parsed = parseConfig(baselineYaml)
      return parsed.errors.length === 0 ? numericValuesOf(parsed) : undefined
    })()
    return compareCandidates(cands, base)
  }, [drafts, baselineYaml])
  if (drafts.length < 2) return null
  const rows = changedOnly ? compare.rows.filter((r) => r.changed || r.diffVsBase === true) : compare.rows
  return (
    <section className="form-section" aria-label={t(locale, 'analysis.compare.aria')}>
      <div className="form-section-heading">
        <h2>{t(locale, 'analysis.compare.title', { n: drafts.length })}</h2>
        <span className="badge" role="status">{t(locale, 'analysis.compare.changedCount', { n: compare.changedPaths.length })}</span>
        <label style={{ display: 'inline-flex', gap: 4, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
          {t(locale, 'analysis.compare.changedOnly')}
        </label>
      </div>
      <div className="candidate-table-wrap">
        <table className="candidate-table" data-wb-compare="candidate-drafts">
          <thead>
            <tr>
              <th>{t(locale, 'analysis.compare.field')}</th>
              {drafts.map((d) => <th key={d.id} className="mono">{d.id.slice(0, 10)}…</th>)}
              {baselineYaml !== null && <th>{t(locale, 'analysis.compare.diff')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.path} className={r.changed ? undefined : 'muted'}>
                <td className="mono">{r.path}</td>
                {drafts.map((d) => {
                  const v = r.values[d.id]
                  return <td key={d.id} className="mono">{v === null || v === undefined ? t(locale, 'analysis.compare.missing') : String(v)}</td>
                })}
                {baselineYaml !== null && (
                  <td>{r.diffVsBase === null ? '—' : r.diffVsBase ? t(locale, 'analysis.compare.diffYes') : t(locale, 'analysis.compare.diffNo')}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
