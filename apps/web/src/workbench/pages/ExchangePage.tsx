// WB-02.04 · 数据交换页容器:导出入口(走 WB-02.09 导出对话框/组件),
// 明确商业软件互通边界(与原型一致,不夸大已接通能力)。
import type { JSX } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'

export type ExchangePageProps = {
  onExport: () => void
}

export function ExchangePage({ onExport }: ExchangePageProps): JSX.Element {
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
