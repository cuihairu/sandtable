// WB-02.04 · 运行任务页容器:任务列表(订阅运行管理器)+ 样例结果卡。
// 运行管理器是模块级单例——切页只换这个视图组件,队列与定时器不受影响。
// WB-07.02/13 · 真实执行任务在此列表(与抽屉/状态栏同一数据源,切页不丢);
// WB-07.14 · 失败任务的重试动作(同一执行快照重新入队)接 runManager.retryJob。
import { useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'
import { TaskList } from '../tasks/TaskList.tsx'
import { dispatch } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import { RunRegistry } from '../project/ProjectPanels.tsx'
import * as runManager from '../state/runManager.ts'
import type { Job } from '../state/jobLogic.ts'
import { setAnalysisJob } from '../analysis/analysisStore.ts'

export function RunsPage({ state }: { state?: WorkbenchState }): JSX.Element {
  const jobs = useSyncExternalStore(runManager.subscribe, runManager.listJobs)
  const cancel = (id: Job['id']): void => {
    void runManager.cancelJob(id)
  }
  return (
    <>
      <WorkspaceHeading
        title="运行任务"
        crumb="任务队列"
        badge={{ text: '真实执行 + 演示标注', tone: 'amber' }}
        actions={
          <button className="btn primary" onClick={() => dispatch({ type: 'navigate', page: 'designer' })}>
            <WbIcon name="plus" />
            新建实验
          </button>
        }
      />
      <div className="page-scroll runs-page">
        {/* WB-04.09/08 · 项目模式:运行快照登记簿(输入快照 + 产物路径) */}
        {state?.project && <RunRegistry state={state} />}
        <div className="runs-heading">
          <h2>当前会话任务</h2>
          <p className="note" style={{ margin: '7px 0 0' }}>
            任务队列在工作区切换时持续运行(运行管理器为模块级单例,不随页面卸载)。
            真实执行任务的进度来自内核事件;演示任务明确标注「演示」。刷新页面会清空当前会话队列；已登记到项目的产物按项目文件保留。
          </p>
        </div>
        <div id="jobs-list">
          <TaskList
            jobs={jobs}
            onCancel={cancel}
            onRetry={(id) => runManager.retryJob(id)}
            emptyAction={
              <button className="btn" onClick={() => dispatch({ type: 'navigate', page: 'designer' })}>
                <WbIcon name="flask" />
                配置实验
              </button>
            }
          />
        </div>
        <section className="runs-heading">
          <h2>真实运行结果</h2>
          {jobs.filter((j) => !j.demo && j.exec).length === 0 && <p className="note">尚无真实运行，提交实验后可打开结果。</p>}
          {jobs.filter((j) => !j.demo && j.exec).map((j) => <div className="job" key={j.id}>
            <div className="job-title"><strong>{j.name}</strong><span>{j.status}</span>
              <button className="btn" onClick={() => {
                setAnalysisJob(j.id)
                dispatch({ type: 'selection', patch: { source: 'kernel', run: j.exec!.runId } })
                dispatch({ type: 'navigate', page: 'analysis' })
              }}>打开真实结果 / 部分结果</button>
            </div>
            <p className="job-body mono">{j.exec!.runId} · {j.exec!.results.length}/{j.exec!.candidatesTotal} 候选已返回 · {j.exec!.replicates} replicates</p>
          </div>)}
        </section>
      </div>
    </>
  )
}
