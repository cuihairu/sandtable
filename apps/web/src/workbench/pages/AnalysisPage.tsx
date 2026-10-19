// WB-02.04 · 结果分析页容器:组合 WB-02.05 的三个独立组件
// (响应图 / 候选表 / 选择检查器)。数据当前来自演示结果集;
// 组件层已可独立接数据,WB-08 换真实扫描适配器时页面容器只改取数。
import { useMemo } from 'react'
import type { JSX } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'
import { ResponseChart } from '../analysis/ResponseChart.tsx'
import { CandidateTable } from '../analysis/CandidateTable.tsx'
import { SelectionInspector } from '../analysis/SelectionInspector.tsx'
import { dispatch } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import { ProjectResultsPanel } from '../project/ProjectPanels.tsx'
import {
  DEMO_RESULT, METRICS, METRIC_KEYS, ciText, filterAndSort, fmtMetric,
  metricValues, verdictFor, verdictOf,
} from '../demo/sampleProject.ts'
import type { MetricKey } from '../demo/sampleProject.ts'

export type AnalysisPageProps = {
  state: WorkbenchState
  onExport: () => void
}

export function AnalysisPage({ state, onExport }: AnalysisPageProps): JSX.Element {
  const { metric, selectedCandidateId, resultView, resultFilter, sortKey, sortDir, inspectorOpen } = state
  const selected = DEMO_RESULT.candidates.find((c) => c.id === selectedCandidateId) ?? DEMO_RESULT.candidates[6]
  const rows = useMemo(
    () => filterAndSort(DEMO_RESULT.candidates, { filterVerdict: resultFilter, sortKey, sortDir }),
    [resultFilter, sortKey, sortDir],
  )
  const m = METRICS[metric]
  const others = METRIC_KEYS.filter((k) => k !== metric)

  const selectCandidate = (id: string): void => {
    dispatch({ type: 'candidate/select', id: id as typeof selected.id })
    dispatch({ type: 'selection', patch: { candidate: id } })
  }

  return (
    <>
      <WorkspaceHeading
        title="初始攻击力扫描"
        crumb="结果集 / Grid 单参数"
        badge={{ text: 'GRID', tone: 'teal' }}
        actions={
          <>
            <button className="btn" onClick={() => dispatch({ type: 'navigate', page: 'designer' })}>
              <WbIcon name="flask" />
              调整实验
            </button>
            <button className="btn primary" onClick={onExport}>
              <WbIcon name="download" />
              导出
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
        <div className="segmented" aria-label="结果显示方式">
          <button data-view="chart" className={resultView === 'chart' ? 'active' : ''} aria-pressed={resultView === 'chart'} onClick={() => dispatch({ type: 'candidate/view', view: 'chart' })}>
            <WbIcon name="chart" />
            响应图
          </button>
          <button data-view="table" className={resultView === 'table' ? 'active' : ''} aria-pressed={resultView === 'table'} onClick={() => dispatch({ type: 'candidate/view', view: 'table' })}>
            <WbIcon name="table" />
            数据表
          </button>
        </div>
        <span className="divider" />
        <label className="toolbar-label" htmlFor="metric-select">主指标</label>
        <select
          id="metric-select"
          aria-label="主图指标"
          value={metric}
          onChange={(e) => {
            const key = e.target.value as MetricKey
            dispatch({ type: 'candidate/metric', metric: key })
            dispatch({ type: 'selection', patch: { metric: key } })
          }}
        >
          {METRIC_KEYS.map((k) => (
            <option key={k} value={k}>{METRICS[k].label}</option>
          ))}
        </select>
        <div className="toolbar-end">
          <span className="muted" style={{ fontSize: 10 }}>
            {DEMO_RESULT.candidates.length} 候选 · 20 replicates / 候选
          </span>
          <button className="icon-button" onClick={() => dispatch({ type: 'toggle-inspector' })} aria-label={`${inspectorOpen ? '收起' : '显示'}选择检查器`}>
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
                  <h2>{`参数响应 · ${m.label}`}</h2>
                  <div className="figure-subtitle">
                    单参数观测点与展示区间 <span className="muted">/</span> 选点查看候选
                  </div>
                </div>
                <div className="legend">
                  <span><i className="legend-dot" />候选均值</span>
                  <span><i className="legend-ci" />展示区间</span>
                  <span><i className="legend-line" />目标边界</span>
                </div>
              </div>
              <div className="chart-viewport">
                <ResponseChart
                  metric={m}
                  xAxis={{ label: '初始攻击力', path: 'model.warrior.attack' }}
                  points={DEMO_RESULT.candidates.map((c) => ({ id: c.id, x: c.paramValue, mean: c[metric], ciHalf: m.ci }))}
                  selectedId={selected.id}
                  onSelect={selectCandidate}
                />
              </div>
              <div className="chart-footer">
                <span>浅绿区域:当前指标的目标范围 · 虚线:约束 / 基线</span>
                <span>离散采样 · 无插值</span>
              </div>
              <div className="mini-figures">
                {others.map((k) => (
                  <div className="mini-figure" key={k}>
                    <div className="mini-figure-header">
                      <strong>{METRICS[k].label}</strong>
                      <span className="mono">{`${fmtMetric(selected[k], k)} · 展示区间 ${ciText(selected, k)}`}</span>
                    </div>
                    <ResponseChart
                      mini
                      metric={METRICS[k]}
                      xAxis={{ label: '初始攻击力', path: 'model.warrior.attack' }}
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
                  <h2>候选结果数据表</h2>
                  <div className="figure-subtitle">全部候选 · 展示区间与判定</div>
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
                  { key: 'paramValue', label: '初始攻击力', numeric: true, value: (c) => c.paramValue },
                  { key: 'win', label: '战斗胜率', numeric: true, value: (c) => fmtMetric(c.win, 'win') },
                  { key: 'retention', label: 'D7 留存率', numeric: true, value: (c) => fmtMetric(c.retention, 'retention') },
                  { key: 'gold', label: '人均金币产出', numeric: true, value: (c) => fmtMetric(c.gold, 'gold') },
                  { key: 'win_ci', label: '胜率展示区间', value: (c) => ciText(c, 'win'), ci: true },
                ]}
              />
            </div>
          )}
          <section className="candidate-section">
            <div className="section-heading">
              <div>
                <h2>
                  候选表
                  <span className="muted" style={{ fontSize: 10 }}>
                    {` ${rows.length} / ${DEMO_RESULT.candidates.length} 候选`}
                  </span>
                </h2>
              </div>
              <div className="actions">
                <label className="toolbar-label" htmlFor="filter-verdict">筛选</label>
                <select
                  id="filter-verdict"
                  value={resultFilter}
                  aria-label="按约束判定筛选"
                  onChange={(e) => dispatch({ type: 'candidate/filter', filter: e.target.value as typeof resultFilter })}
                >
                  <option value="all">全部候选</option>
                  <option value="pass">仅通过</option>
                  <option value="border">仅临界</option>
                  <option value="fail">仅未通过</option>
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
                { key: 'paramValue', label: '初始攻击力', numeric: true, value: (c) => c.paramValue },
                { key: 'win', label: '战斗胜率', numeric: true, value: (c) => fmtMetric(c.win, 'win') },
                { key: 'retention', label: 'D7 留存率', numeric: true, value: (c) => fmtMetric(c.retention, 'retention') },
                { key: 'gold', label: '人均金币产出', numeric: true, value: (c) => fmtMetric(c.gold, 'gold') },
                { key: 'win_ci', label: '胜率展示区间', value: (c) => ciText(c, 'win'), ci: true },
              ]}
            />
            <div className="table-foot">
              <span>来源:内置合成样例(synthetic_demo)· 展示区间为演示对称区间</span>
              <span>选择与筛选/排序均为 UI 状态,不写进实验输入</span>
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
            note: `基线 100 · ${selected.paramValue >= 100 ? '+' : ''}${(((selected.paramValue - 100) / 100) * 100).toFixed(0)}%`,
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
              复制参数到候选方案 A
            </button>
          }
          constraints={METRIC_KEYS.map((k) => {
            const km = METRICS[k]
            const verdict = verdictFor(selected[k], k)
            return {
              label: km.label,
              verdict,
              value: fmtMetric(selected[k], k),
              op: km.op,
              target: `${km.target}${km.unit}`,
              position: ((selected[k] - km.min) / (km.max - km.min)) * 100,
              ci: ciText(selected, k),
            }
          })}
          stats={[
            ['方法', 'Grid / 离散观测'],
            ['统计单位', <span className="mono" key="rep">20 replicates</span>],
            ['场景规模', '10,000 玩家 × 30 天'],
          ]}
          sourceBadge={{ text: '内置合成样例', tone: 'amber' }}
          notes={'展示区间完全满足阈值才判"通过";区间与边界相交判"临界"。图中点之间不做插值。'}
        />
      </div>
    </>
  )
}
