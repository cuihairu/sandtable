// WB-02.04 · 运行任务页容器:任务列表(订阅运行管理器)+ 样例结果卡。
// 运行管理器是模块级单例——切页只换这个视图组件,队列与定时器不受影响。
import { useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'
import { TaskList } from '../tasks/TaskList.tsx'
import { dispatch } from '../state/workbenchStore.ts'
import * as runManager from '../state/runManager.ts'
import type { Job } from '../state/jobLogic.ts'

export function RunsPage(): JSX.Element {
  const jobs = useSyncExternalStore(runManager.subscribe, runManager.listJobs)
  const cancel = (id: Job['id']): void => runManager.cancelJob(id)
  return (
    <>
      <WorkspaceHeading
        title="运行任务"
        crumb="任务队列"
        badge={{ text: '演示队列', tone: 'amber' }}
        actions={
          <button className="btn primary" onClick={() => dispatch({ type: 'navigate', page: 'designer' })}>
            <WbIcon name="plus" />
            新建实验
          </button>
        }
      />
      <div className="page-scroll runs-page">
        <div className="runs-heading">
          <h2>当前会话任务</h2>
          <p className="note" style={{ margin: '7px 0 0' }}>
            演示队列在工作区切换时持续运行(运行管理器为模块级单例,不随页面卸载)。
            刷新页面会清空队列;已有样例结果始终独立保留。
          </p>
        </div>
        <div id="jobs-list">
          <TaskList
            jobs={jobs}
            onCancel={cancel}
            emptyAction={
              <button className="btn" onClick={() => dispatch({ type: 'navigate', page: 'designer' })}>
                <WbIcon name="flask" />
                配置实验
              </button>
            }
          />
        </div>
        <div style={{ marginTop: 28 }}>
          <h2 style={{ marginBottom: 12 }}>已有结果样例</h2>
          <div className="job">
            <div className="job-title">
              <WbIcon name="chart" />
              <strong>初始攻击力扫描 · 内置样例</strong>
              <span className="badge teal">可查看</span>
              <div className="actions">
                <button className="btn" onClick={() => dispatch({ type: 'navigate', page: 'analysis' })}>
                  打开结果
                  <WbIcon name="arrow" />
                </button>
              </div>
            </div>
            <div className="job-body">
              <span className="mono">11 候选 × 20 replicates</span>
              <span className="muted" style={{ fontSize: 11 }}>3 个观察指标 · 展示区间为演示对称区间</span>
            </div>
            <div className="job-footer">
              合成数据用于评审图表、表格和检查器之间的联动。没有执行记录与可复现哈希。
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
