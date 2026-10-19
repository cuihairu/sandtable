// WB-02.04 · 数据交换页容器:导出入口(走 WB-02.09 导出对话框/组件),
// 明确商业软件互通边界(与原型一致,不夸大已接通能力)。
// WB-02.17 · 已有能力入位不丢:SQL 查询面板与 Parquet 导出从现役单页应用
// 迁入本页(duckdb-wasm 按需加载,首次打开才进包;演示候选注册为内存表,
// 也可载入 .sandtable 项目 / CSV 产物查自己的数据)。
import { useState } from 'react'
import type { ComponentProps, JSX } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'
import { DEMO_RESULT } from '../demo/sampleProject.ts'
import { demoCsv, download } from '../demo/export.ts'
import { notify } from '../state/notifications.ts'
import type { QueryColumn } from '../../lib/duck.ts'

/** 查询面板组件类型(仅类型引用,运行时动态导入)。 */
type QueryPanelComponent = (typeof import('../../components/QueryPanel.tsx'))['default']

export type ExchangePageProps = {
  onExport: () => void
}

export function ExchangePage({ onExport }: ExchangePageProps): JSX.Element {
  // WB-02.17 · 查询面板按需挂载:duckdb-wasm 只在首次打开时进包
  const [query, setQuery] = useState<{ Panel: QueryPanelComponent; run: (sql: string) => Promise<QueryColumn[]> } | null>(null)
  const [queryOpen, setQueryOpen] = useState(false)
  const [queryBusy, setQueryBusy] = useState(false)
  const [parquetBusy, setParquetBusy] = useState(false)

  const openQueryPanel = async (): Promise<void> => {
    if (queryBusy) return
    if (query !== null) {
      setQueryOpen((v) => !v)
      return
    }
    setQueryBusy(true)
    try {
      const [{ runQuery, loadProjectCsvs }, { default: Panel }] = await Promise.all([
        import('../../lib/duck.ts'),
        import('../../components/QueryPanel.tsx'),
      ])
      // 打开即注册演示候选表:查询不空转;来源仍是 synthetic_demo(CSV 同口径)
      const tables = await loadProjectCsvs([
        {
          name: 'sandtable-demo-candidates.csv',
          bytes: new TextEncoder().encode(demoCsv(DEMO_RESULT.candidates)),
        },
      ])
      setQuery({ Panel, run: (sql) => runQuery(sql) })
      setQueryOpen(true)
      notify('info', `查询已就绪:内置演示候选注册为表 ${tables.join(', ')}(载入项目 / CSV 会清旧表)`)
    } catch (e) {
      // 初始化失败按钮回到可点状态,再点即重试(WB-02.15)
      notify('error', `查询引擎初始化失败:${String(e)}`)
    } finally {
      setQueryBusy(false)
    }
  }

  const downloadParquet = async (): Promise<void> => {
    if (parquetBusy) return
    setParquetBusy(true)
    try {
      const { exportCsvAsParquet } = await import('../../lib/duck.ts')
      const bytes = await exportCsvAsParquet(demoCsv(DEMO_RESULT.candidates), 'sandtable-demo-candidates')
      download('sandtable-demo-candidates.parquet', bytes, 'application/octet-stream')
      notify('success', '已下载 sandtable-demo-candidates.parquet(与 CSV 同列,CLI query 可直接续分析)')
    } catch (e) {
      notify('error', `Parquet 导出失败:${String(e)}`)
    } finally {
      setParquetBusy(false)
    }
  }

  return (
    <>
      <WorkspaceHeading
        title="数据与导出"
        crumb="数据交换"
        actions={
          <button className="btn primary" onClick={onExport}>
            <WbIcon name="download" />
            导出向导
          </button>
        }
      />
      <div className="page-scroll">
        <div className="exchange-page">
          <p className="exchange-intro">
            把当前分析带到熟悉的工具。导出内容标明样例数据来源,保留参数 ID、指标口径和展示区间。
          </p>
          <div className="exchange-row">
            <div className="exchange-icon">CSV</div>
            <div>
              <h2>候选结果表</h2>
              <p>
                11 个候选、参数值、3 个 KPI 及展示区间、约束判定。
                <br />
                <span className="mono">UTF-8 BOM · 逗号分隔 · 百分比用 0–100 数值</span>
              </p>
            </div>
            <div className="actions">
              <button className="btn" onClick={onExport}>
                <WbIcon name="download" />
                下载 CSV
              </button>
            </div>
          </div>
          <div className="exchange-row">
            <div className="exchange-icon">JSON</div>
            <div>
              <h2>实验与候选方案快照</h2>
              <p>
                当前参数草稿、实验设置、内置样例结果与来源说明。
                <br />
                样例结果绑定其默认实验设置,不会被当前草稿覆盖。
              </p>
            </div>
            <div className="actions">
              <button className="btn" onClick={onExport}>
                <WbIcon name="download" />
                下载 JSON
              </button>
            </div>
          </div>
          <div className="exchange-row">
            <div className="exchange-icon">PQ</div>
            <div>
              <h2>候选结果表(Parquet)</h2>
              <p>
                与 CSV 同列的列式二进制;命令行 query 可直接 read_parquet 续分析。
                <br />
                <span className="mono">DuckDB COPY · 演示数据 synthetic_demo</span>
              </p>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => void downloadParquet()} disabled={parquetBusy}>
                <WbIcon name="download" />
                {parquetBusy ? '转换中…' : '下载 Parquet'}
              </button>
            </div>
          </div>
          <div className="exchange-row">
            <div className="exchange-icon">SVG</div>
            <div>
              <h2>参数响应图</h2>
              <p>
                导出当前主指标图,包含观测点、区间线、基线与目标线。
                <br />
                矢量格式可供报告排版、放大与进一步编辑。
              </p>
            </div>
            <div className="actions">
              <button className="btn" onClick={onExport}>
                <WbIcon name="download" />
                下载 SVG
              </button>
            </div>
          </div>
          <div className="exchange-row">
            <div className="exchange-icon">SQL</div>
            <div>
              <h2>结果查询(SQL)</h2>
              <p>
                浏览器内 DuckDB 查询;打开时内置演示候选已注册为表,也可载入
                .sandtable 项目或 CSV 产物查自己的数据。
                <br />
                <span className="mono">查询引擎首次打开时加载(duckdb-wasm)</span>
              </p>
            </div>
            <div className="actions">
              <button
                className="btn"
                onClick={() => void openQueryPanel()}
                disabled={queryBusy}
              >
                <WbIcon name="terminal" />
                {queryBusy ? '初始化…' : queryOpen ? '收起查询' : '打开 SQL 查询'}
              </button>
            </div>
          </div>
          {query !== null && queryOpen && (
            <div className="exchange-query">
              <query.Panel
                run={query.run}
                initialSql="SELECT * FROM sandtable_demo_candidates"
                hint="演示候选在表 sandtable_demo_candidates;载入 .sandtable / CSV 会清旧表再注册(解包校验同 CLI project check)"
              />
            </div>
          )}
          <div className="integration-note">
            <strong>与商业软件的衔接</strong>
            <br />
            Excel / Origin / JMP:导入 CSV 继续分析。MATLAB:使用 readtable 读取 CSV,或 jsondecode 读取 JSON。
            <br />
            “直接打开软件”、MATLAB Engine、JMP 自动化和原生工作簿连接尚未接入;当前提供文件交换。
          </div>
        </div>
      </div>
    </>
  )
}

// QueryPanelProps 仅为类型完整性提示(实际渲染走动态导入的组件)
export type QueryPanelProps = ComponentProps<QueryPanelComponent>
