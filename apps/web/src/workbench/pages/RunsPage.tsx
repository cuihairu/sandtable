// WB-02.04 · 运行任务页容器:任务列表(订阅运行管理器)+ 样例结果卡。
// 运行管理器是模块级单例——切页只换这个视图组件,队列与定时器不受影响。
// WB-07.02/13 · 真实执行任务在此列表(与抽屉/状态栏同一数据源,切页不丢);
// WB-07.14 · 失败任务的重试动作(同一执行快照重新入队)接 runManager.retryJob。
// WB-11.16 · 页面骨架走词典(nav.runs / tasks.queueTitle / tasks.page.*)。
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
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export function RunsPage({ state }: { state?: WorkbenchState }): JSX.Element {
  const locale = useLocale()
  const jobs = useSyncExternalStore(runManager.subscribe, runManager.listJobs)
  const cancel = (id: Job['id']): void => {
    void runManager.cancelJob(id)
  }
  return (
    <>
      <WorkspaceHeading
        title={t(locale, 'nav.runs')}
        crumb={t(locale, 'tasks.queueTitle')}
        badge={{ text: t(locale, 'tasks.page.badge'), tone: 'amber' }}
        actions={
          <button className="btn primary" onClick={() => dispatch({ type: 'navigate', page: 'designer' })}>
            <WbIcon name="plus" />
            {t(locale, 'tasks.page.newExperiment')}
          </button>
        }
      />
      <div className="page-scroll runs-page">
        {/* WB-04.09/08 · 项目模式:运行快照登记簿(输入快照 + 产物路径) */}
        {state?.project && <RunRegistry state={state} />}
        <div className="runs-heading">
          <h2>{t(locale, 'tasks.page.sessionTitle')}</h2>
          <p className="note" style={{ margin: '7px 0 0' }}>
            {t(locale, 'tasks.page.sessionNote')}
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
                {t(locale, 'tasks.page.configure')}
              </button>
            }
          />
        </div>
        <section className="runs-heading">
          <h2>{t(locale, 'tasks.page.resultsTitle')}</h2>
          {jobs.filter((j) => !j.demo && j.exec).length === 0 && <p className="note">{t(locale, 'tasks.page.noResults')}</p>}
          {jobs.filter((j) => !j.demo && j.exec).map((j) => <div className="job" key={j.id}>
            <div className="job-title"><strong>{j.name}</strong><span>{j.status}</span>
              <button className="btn" onClick={() => {
                setAnalysisJob(j.id)
                dispatch({ type: 'selection', patch: { source: 'kernel', run: j.exec!.runId } })
                dispatch({ type: 'navigate', page: 'analysis' })
              }}>{t(locale, 'tasks.page.openResult')}</button>
            </div>
            <p className="job-body mono">{t(locale, 'tasks.page.resultMeta', { runId: j.exec!.runId, done: j.exec!.results.length, total: j.exec!.candidatesTotal, replicates: j.exec!.replicates })}</p>
          </div>)}
        </section>
      </div>
    </>
  )
}
