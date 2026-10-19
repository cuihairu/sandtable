// WB-02.04 · 结果分析页容器:组合 WB-02.05 的三个独立组件
// (响应图 / 候选表 / 选择检查器)。数据当前来自演示结果集;
// 组件层已可独立接数据,WB-08 换真实扫描适配器时页面容器只改取数。
import { useMemo } from 'react'
import type { JSX } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'
import { ResponseChart } from './ResponseChart.tsx'
import { CandidateTable } from './CandidateTable.tsx'
import { SelectionInspector } from './SelectionInspector.tsx'
import { dispatch } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import { ProjectResultsPanel } from '../project/ProjectPanels.tsx'
import {
  DEMO_RESULT, METRICS, METRIC_KEYS, ciText, filterAndSort, fmtMetric,
  metricValues, verdictFor, verdictOf,
} from '../demo/sampleProject.ts'
import type { MetricKey } from '../demo/sampleProject.ts'
import type { MetricKey as KernelMetricKey } from '../../lib/types.ts'
import { metricLabel } from '../../lib/metricMeta.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export type AnalysisPageProps = {
  state: WorkbenchState
  onExport: () => void
}

export function DemoAnalysisPage({ state, onExport }: AnalysisPageProps): JSX.Element {
  const { metric, selectedCandidateId, resultView, resultFilter, sortKey, sortDir, inspectorOpen } = state
  const selected = DEMO_RESULT.candidates.find((c) => c.id === selectedCandidateId) ?? DEMO_RESULT.candidates[6]
  const rows = useMemo(
    () => filterAndSort(DEMO_RESULT.candidates, { filterVerdict: resultFilter, sortKey, sortDir }),
    [resultFilter, sortKey, sortDir],
  )
  const m = METRICS[metric]
  const others = METRIC_KEYS.filter((k) => k !== metric)
  // WB-11.14:演示指标 label 从词典出(id = 内核指标 id,显示名同真实视图)
  const locale = useLocale()
  const kmLabel = (k: MetricKey): string => metricLabel(METRICS[k].id as KernelMetricKey, locale)
  const kmMetric = (k: MetricKey) => ({ ...METRICS[k], label: kmLabel(k) })

  const selectCandidate = (id: string): void => {
    dispatch({ type: 'candidate/select', id: id as typeof selected.id })
    dispatch({ type: 'selection', patch: { candidate: id } })
  }

  return (
    <>
      <WorkspaceHeading
        title={t(locale, 'analysis.demo.title')}
        crumb={t(locale, 'analysis.demo.crumb')}
        badge={{ text: 'GRID', tone: 'teal' }}
        actions={
          <>
            <button className="btn" onClick={() => dispatch({ type: 'navigate', page: 'designer' })}>
              <WbIcon name="flask" />
              {t(locale, 'analysis.demo.adjust')}
            </button>
            <button className="btn primary" onClick={onExport}>
              <WbIcon name="download" />
              {t(locale, 'data.export')}
            </button>
          </>
        }
      />
      {/* WB-04.04 · 打开的项目:已保存结果一并载入,版本状态可读 */}
      {state.project && (
        <div style={{ padding: '13px 21px 0' }}>
          <ProjectResultsPanel state={state} />
        </div>
      )}
      <div className="workspace-toolbar">
        <div className="segmented" aria-label={t(locale, 'analysis.demo.viewAria')}>
          <button data-view="chart" className={resultView === 'chart' ? 'active' : ''} aria-pressed={resultView === 'chart'} onClick={() => dispatch({ type: 'candidate/view', view: 'chart' })}>
            <WbIcon name="chart" />
            {t(locale, 'analysis.demo.viewChart')}
          </button>
          <button data-view="table" className={resultView === 'table' ? 'active' : ''} aria-pressed={resultView === 'table'} onClick={() => dispatch({ type: 'candidate/view', view: 'table' })}>
            <WbIcon name="table" />
            {t(locale, 'analysis.demo.viewTable')}
          </button>
        </div>
        <span className="divider" />
        <label className="toolbar-label" htmlFor="metric-select">{t(locale, 'analysis.primaryMetric')}</label>
        <select
          id="metric-select"
          aria-label={t(locale, 'analysis.demo.metricAria')}
          value={metric}
          onChange={(e) => {
            const key = e.target.value as MetricKey
            dispatch({ type: 'candidate/metric', metric: key })
            dispatch({ type: 'selection', patch: { metric: key } })
          }}
        >
          {METRIC_KEYS.map((k) => (
            <option key={k} value={k}>{kmLabel(k)}</option>
          ))}
        </select>
        <div className="toolbar-end">
          <span className="muted" style={{ fontSize: 10 }}>
            {t(locale, 'analysis.demo.counts', { count: DEMO_RESULT.candidates.length })}
          </span>
          <button className="icon-button" onClick={() => dispatch({ type: 'toggle-inspector' })} aria-label={t(locale, 'analysis.demo.toggleInspector', { action: inspectorOpen ? t(locale, 'analysis.demo.collapse') : t(locale, 'analysis.demo.show') })}>
            <WbIcon name="panel-right" />
          </button>
        </div>
      </div>
      <div className={`analysis-body${inspectorOpen ? '' : ' inspector-hidden'}`}>
        <div className="analysis-center">
          {resultView === 'chart' ? (
            <section className="figure-section">
              <div className="section-heading">
                <div>
                  <h2>{t(locale, 'analysis.demo.responseTitle', { label: kmLabel(metric) })}</h2>
                  <div className="figure-subtitle">
                    {t(locale, 'analysis.demo.responseSubtitle')}
                  </div>
                </div>
                <div className="legend">
                  <span><i className="legend-dot" />{t(locale, 'analysis.demo.legendMean')}</span>
                  <span><i className="legend-ci" />{t(locale, 'analysis.demo.legendRange')}</span>
                  <span><i className="legend-line" />{t(locale, 'analysis.demo.legendTarget')}</span>
                </div>
              </div>
              <div className="chart-viewport">
                <ResponseChart
                  metric={kmMetric(metric)}
                  xAxis={{ label: t(locale, 'analysis.demo.axisLabel'), path: 'model.warrior.attack' }}
                  points={DEMO_RESULT.candidates.map((c) => ({ id: c.id, x: c.paramValue, mean: c[metric], ciHalf: m.ci }))}
                  selectedId={selected.id}
                  onSelect={selectCandidate}
                />
              </div>
              <div className="chart-footer">
                <span>{t(locale, 'analysis.demo.chartFootRange')}</span>
                <span>{t(locale, 'analysis.demo.chartFootSample')}</span>
              </div>
              <div className="mini-figures">
                {others.map((k) => (
                  <div className="mini-figure" key={k}>
                    <div className="mini-figure-header">
                      <strong>{kmLabel(k)}</strong>
                      <span className="mono">{t(locale, 'analysis.demo.miniStat', { stat: fmtMetric(selected[k], k), range: ciText(selected, k) })}</span>
                    </div>
                    <ResponseChart
                      mini
                      metric={kmMetric(k)}
                      xAxis={{ label: t(locale, 'analysis.demo.axisLabel'), path: 'model.warrior.attack' }}
                      points={DEMO_RESULT.candidates.map((c) => ({ id: c.id, x: c.paramValue, mean: c[k], ciHalf: METRICS[k].ci }))}
                      selectedId={selected.id}
                      onSelect={selectCandidate}
                    />
                  </div>
                ))}
              </div>
            </section>
          ) : (
            <div className="figure-section">
              <div className="section-heading">
                <div>
                  <h2>{t(locale, 'analysis.demo.tableTitle')}</h2>
                  <div className="figure-subtitle">{t(locale, 'analysis.demo.tableSubtitle')}</div>
                </div>
              </div>
              <CandidateTable
                id="analysis-table"
                rows={rows}
                getId={(c) => c.id}
                selectedId={selected.id}
                onSelect={selectCandidate}
                verdictOf={verdictOf}
                isBaseline={(c) => c.paramValue === 100}
                expanded
                columns={[
                  { key: 'paramValue', label: t(locale, 'analysis.demo.axisLabel'), numeric: true, value: (c) => c.paramValue },
                  { key: 'win', label: kmLabel('win'), numeric: true, value: (c) => fmtMetric(c.win, 'win') },
                  { key: 'retention', label: kmLabel('retention'), numeric: true, value: (c) => fmtMetric(c.retention, 'retention') },
                  { key: 'gold', label: kmLabel('gold'), numeric: true, value: (c) => fmtMetric(c.gold, 'gold') },
                  { key: 'win_ci', label: t(locale, 'analysis.demo.ciCol'), value: (c) => ciText(c, 'win'), ci: true },
                ]}
              />
            </div>
          )}
          <section className="candidate-section">
            <div className="section-heading">
              <div>
                <h2>
                  {t(locale, 'analysis.demo.candidatesTitle')}
                  <span className="muted" style={{ fontSize: 10 }}>
                    {` ${t(locale, 'analysis.demo.candidateCount', { shown: rows.length, total: DEMO_RESULT.candidates.length })}`}
                  </span>
                </h2>
              </div>
              <div className="actions">
                <label className="toolbar-label" htmlFor="filter-verdict">{t(locale, 'analysis.filter')}</label>
                <select
                  id="filter-verdict"
                  value={resultFilter}
                  aria-label={t(locale, 'analysis.demo.filterAria')}
                  onChange={(e) => dispatch({ type: 'candidate/filter', filter: e.target.value as typeof resultFilter })}
                >
                  <option value="all">{t(locale, 'analysis.demo.filterAll')}</option>
                  <option value="pass">{t(locale, 'analysis.demo.filterPass')}</option>
                  <option value="border">{t(locale, 'analysis.demo.filterBorder')}</option>
                  <option value="fail">{t(locale, 'analysis.demo.filterFail')}</option>
                </select>
              </div>
            </div>
            <CandidateTable
              id="analysis-candidates"
              rows={rows}
              getId={(c) => c.id}
              selectedId={selected.id}
              onSelect={selectCandidate}
              verdictOf={verdictOf}
              isBaseline={(c) => c.paramValue === 100}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={(key) => dispatch({ type: 'candidate/sort', key: key as typeof sortKey })}
              columns={[
                { key: 'paramValue', label: t(locale, 'analysis.demo.axisLabel'), numeric: true, value: (c) => c.paramValue },
                { key: 'win', label: kmLabel('win'), numeric: true, value: (c) => fmtMetric(c.win, 'win') },
                { key: 'retention', label: kmLabel('retention'), numeric: true, value: (c) => fmtMetric(c.retention, 'retention') },
                { key: 'gold', label: kmLabel('gold'), numeric: true, value: (c) => fmtMetric(c.gold, 'gold') },
                { key: 'win_ci', label: t(locale, 'analysis.demo.ciCol'), value: (c) => ciText(c, 'win'), ci: true },
              ]}
            />
            <div className="table-foot">
              <span>{t(locale, 'analysis.demo.sourceNote')}</span>
              <span>{t(locale, 'analysis.demo.uiStateNote')}</span>
            </div>
          </section>
        </div>
        <SelectionInspector
          eyebrow="SELECTED CANDIDATE"
          title={selected.id.slice(0, 11)}
          titleVerdict={verdictOf(metricValues(selected))}
          code="model.warrior.attack"
          open={inspectorOpen}
          onToggle={() => dispatch({ type: 'toggle-inspector' })}
          value={{
            display: String(selected.paramValue),
            note: t(locale, 'analysis.demo.valueNote', { base: 100, sign: selected.paramValue >= 100 ? '+' : '', percent: (((selected.paramValue - 100) / 100) * 100).toFixed(0) }),
          }}
          actions={
            <button
              className="btn inspector-action"
              onClick={() => {
                // WB-05 · 采纳走参数文档历史(单项编辑同一撤销/重做通道)
                dispatch({ type: 'param/adopt', path: 'model.warrior.attack', value: selected.paramValue })
                dispatch({ type: 'navigate', page: 'parameters' })
              }}
            >
              <WbIcon name="copy" />
              {t(locale, 'analysis.demo.adopt')}
            </button>
          }
          constraints={METRIC_KEYS.map((k) => {
            const km = METRICS[k]
            const verdict = verdictFor(selected[k], k)
            return {
              label: kmLabel(k),
              verdict,
              value: fmtMetric(selected[k], k),
              op: km.op,
              target: `${km.target}${km.unit}`,
              position: ((selected[k] - km.min) / (km.max - km.min)) * 100,
              ci: ciText(selected, k),
            }
          })}
          stats={[
            [t(locale, 'analysis.demo.statMethod'), t(locale, 'analysis.demo.methodValue')],
            [t(locale, 'analysis.statUnit'), <span className="mono" key="rep">20 replicates</span>],
            [t(locale, 'analysis.srcScenario'), t(locale, 'analysis.demo.scaleValue')],
          ]}
          sourceBadge={{ text: t(locale, 'analysis.demo.sourceBadge'), tone: 'amber' }}
          notes={t(locale, 'analysis.demo.notes')}
        />
      </div>
    </>
  )
}
