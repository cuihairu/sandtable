// A/B 分析视图 · 分面配对效应图(WB-08.12):每个 KPI 一个分面、一根独立轴。
// 铁则:不同单位不得共用一个轴——分面 x 域由 effectDomain 逐分面独立计算,
// 聚合层不存在跨指标共用轴;比例差用百分点 pp、绝对量用本地化单位(formatMetric
// 显示层唯一换算口径)。纯聚合数据 + SVG(图表性能铁则),无插值、无合成点。
import type { JSX } from 'react'
import { effectDomain } from '../../lib/abEffect.ts'
import type { AbFacet } from '../../lib/abEffect.ts'
import { metricLabel, metricUnit } from '../../lib/metricMeta.ts'
import { fmtNumber } from '../../lib/i18n/format.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type AbEffectChartProps = {
  facets: readonly AbFacet[]
  /** 配对差/CI 数值格式化(调用方传 formatMetric,保持显示层唯一换算口径) */
  format: (value: number, metric: AbFacet['metric']) => string
  sourceTitle?: string
}

const W = 420
const H = 96
const LEFT = 14
const RIGHT = 14
const MID = 52

export function AbEffectChart({ facets, format, sourceTitle }: AbEffectChartProps): JSX.Element {
  const locale = useLocale()
  return <div className="ab-facet-grid" role="group" aria-label={t(locale, 'analysis.abFacetsAria', { count: facets.length })}>
    {facets.map((f) => {
      const domain = effectDomain(f)
      const x = (v: number): number => LEFT + (v - domain.min) / (domain.max - domain.min) * (W - LEFT - RIGHT)
      const zero = x(0)
      const y = MID
      const label = `${metricLabel(f.metric, locale)} · ${metricUnit(f.metric, locale)}`
      const summary = `${t(locale, 'analysis.abFacetDiff')}: ${format(f.diffMean, f.metric)} · 95% CI [${format(f.diffCi95Lo, f.metric)}, ${format(f.diffCi95Hi, f.metric)}] · d=${f.effectSizeD}`
      return <figure key={f.metric} className="ab-facet" data-metric={f.metric} data-dimension={f.dimension}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label} · ${summary}`}>
          <title>{sourceTitle ? `${sourceTitle} · ${label}` : label}</title>
          {/* 分面标题:指标名 + 该分面自己的单位(不与任何其他分面共轴) */}
          <text x={LEFT} y={16} className="chart-label">{label}</text>
          {/* 零参考线:配对差是否显著 = CI 是否跨过它(内核 CI 的直接读数) */}
          <line x1={zero} x2={zero} y1={26} y2={H - 26} className="chart-grid" data-zero="true" />
          {/* 配对差均值点 + 95% CI 横向须线(该分面自己的轴域) */}
          <line x1={x(f.diffCi95Lo)} x2={x(f.diffCi95Hi)} y1={y} y2={y} className="chart-ci" />
          <line x1={x(f.diffCi95Lo)} x2={x(f.diffCi95Lo)} y1={y - 6} y2={y + 6} className="chart-ci" />
          <line x1={x(f.diffCi95Hi)} x2={x(f.diffCi95Hi)} y1={y - 6} y2={y + 6} className="chart-ci" />
          <circle className="chart-point" cx={x(f.diffMean)} cy={y} r={5} />
          <text x={W - RIGHT} y={H - 10} textAnchor="end" className="chart-text">{summary}</text>
        </svg>
        <figcaption className="note">
          {t(locale, f.significant ? 'analysis.abFacetSignificant' : 'analysis.abFacetOverlap')}
          {' · '}{t(locale, 'analysis.abFacetRel', {
            rel: f.relativeChangePct === null ? t(locale, 'analysis.unavailable') : `${fmtNumber(locale, f.relativeChangePct, { maxFractionDigits: 1 })}%`,
          })}
        </figcaption>
      </figure>
    })}
  </div>
}
