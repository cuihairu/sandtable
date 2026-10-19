// WB-02.04 · 数据交换页容器:导出入口(走 WB-02.09 导出对话框/组件),
// 明确商业软件互通边界(与原型一致,不夸大已接通能力)。
// WB-02.17 · 已有能力入位不丢:SQL 查询面板与 Parquet 导出从现役单页应用
// 迁入本页(duckdb-wasm 按需加载,首次打开才进包;演示候选注册为内存表,
// 也可载入 .sandtable 项目 / CSV 产物查自己的数据)。
// WB-11.16 · 导出入口/格式说明/互通边界走词典(data.exchange.*;提示走
// 结构化词条,与 runManager 同口径)。表名与 CLI 命令保持原文。
import { useState } from 'react'
import type { ComponentProps, JSX } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'
import { DEMO_RESULT } from '../demo/sampleProject.ts'
import { demoCsv, download } from '../demo/export.ts'
import { notify } from '../state/notifications.ts'
import type { QueryColumn } from '../../lib/duck.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

/** 查询面板组件类型(仅类型引用,运行时动态导入)。 */
type QueryPanelComponent = (typeof import('../../components/QueryPanel.tsx'))['default']

export type ExchangePageProps = {
  onExport: () => void
}

export function ExchangePage({ onExport }: ExchangePageProps): JSX.Element {
  const locale = useLocale()
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
      notify('info', { key: 'data.exchange.toastQueryReady', params: { tables: tables.join(', ') } })
    } catch (e) {
      // 初始化失败按钮回到可点状态,再点即重试(WB-02.15)
      notify('error', { key: 'data.exchange.toastQueryInit', params: { detail: String(e) } })
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
      notify('success', { key: 'data.exchange.toastParquetDone', params: { file: 'sandtable-demo-candidates.parquet' } })
    } catch (e) {
      notify('error', { key: 'data.exchange.toastParquetFailed', params: { detail: String(e) } })
    } finally {
      setParquetBusy(false)
    }
  }

  return (
    <>
      <WorkspaceHeading
        title={t(locale, 'nav.exchange')}
        crumb={t(locale, 'nav.tab.exchange')}
        actions={
          <button className="btn primary" onClick={onExport}>
            <WbIcon name="download" />
            {t(locale, 'data.exchange.wizard')}
          </button>
        }
      />
      <div className="page-scroll">
        <div className="exchange-page">
          <p className="exchange-intro">
            {t(locale, 'data.exchange.intro')}
          </p>
          <div className="exchange-row">
            <div className="exchange-icon">CSV</div>
            <div>
              <h2>{t(locale, 'data.exchange.csvTitle')}</h2>
              <p>
                {t(locale, 'data.exchange.csvBody')}
                <br />
                <span className="mono">{t(locale, 'data.exchange.csvMeta')}</span>
              </p>
            </div>
            <div className="actions">
              <button className="btn" onClick={onExport}>
                <WbIcon name="download" />
                {t(locale, 'data.download.csv')}
              </button>
            </div>
          </div>
          <div className="exchange-row">
            <div className="exchange-icon">JSON</div>
            <div>
              <h2>{t(locale, 'data.exchange.jsonTitle')}</h2>
              <p>
                {t(locale, 'data.exchange.jsonBody1')}
                <br />
                {t(locale, 'data.exchange.jsonBody2')}
              </p>
            </div>
            <div className="actions">
              <button className="btn" onClick={onExport}>
                <WbIcon name="download" />
                {t(locale, 'data.download.json')}
              </button>
            </div>
          </div>
          <div className="exchange-row">
            <div className="exchange-icon">PQ</div>
            <div>
              <h2>{t(locale, 'data.exchange.pqTitle')}</h2>
              <p>
                {t(locale, 'data.exchange.pqBody')}
                <br />
                <span className="mono">{t(locale, 'data.exchange.pqMeta')}</span>
              </p>
            </div>
            <div className="actions">
              <button className="btn" onClick={() => void downloadParquet()} disabled={parquetBusy}>
                <WbIcon name="download" />
                {parquetBusy ? t(locale, 'data.exchange.converting') : t(locale, 'data.download.parquet')}
              </button>
            </div>
          </div>
          <div className="exchange-row">
            <div className="exchange-icon">SVG</div>
            <div>
              <h2>{t(locale, 'data.exchange.svgTitle')}</h2>
              <p>
                {t(locale, 'data.exchange.svgBody1')}
                <br />
                {t(locale, 'data.exchange.svgBody2')}
              </p>
            </div>
            <div className="actions">
              <button className="btn" onClick={onExport}>
                <WbIcon name="download" />
                {t(locale, 'data.download.svg')}
              </button>
            </div>
          </div>
          <div className="exchange-row">
            <div className="exchange-icon">SQL</div>
            <div>
              <h2>{t(locale, 'data.exchange.sqlTitle')}</h2>
              <p>
                {t(locale, 'data.exchange.sqlBody')}
                <br />
                <span className="mono">{t(locale, 'data.exchange.sqlMeta')}</span>
              </p>
            </div>
            <div className="actions">
              <button
                className="btn"
                onClick={() => void openQueryPanel()}
                disabled={queryBusy}
              >
                <WbIcon name="terminal" />
                {queryBusy ? t(locale, 'data.exchange.initializing') : queryOpen ? t(locale, 'data.exchange.collapseQuery') : t(locale, 'data.exchange.openQuery')}
              </button>
            </div>
          </div>
          {query !== null && queryOpen && (
            <div className="exchange-query">
              <query.Panel
                run={query.run}
                initialSql="SELECT * FROM sandtable_demo_candidates"
                hint={t(locale, 'data.exchange.queryHint')}
              />
            </div>
          )}
          <div className="integration-note">
            <strong>{t(locale, 'data.exchange.integrationTitle')}</strong>
            <br />
            {t(locale, 'data.exchange.integrationBody1')}
            <br />
            {t(locale, 'data.exchange.integrationBody2')}
          </div>
        </div>
      </div>
    </>
  )
}

// QueryPanelProps 仅为类型完整性提示(实际渲染走动态导入的组件)
export type QueryPanelProps = ComponentProps<QueryPanelComponent>
