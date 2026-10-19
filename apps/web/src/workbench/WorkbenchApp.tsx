// WB-02.02~10 · V2 工作台 React 壳根组件。
// 组成:
// - 应用框架(WB-02.02):AppBar / ActivityRail / ProjectExplorer /
//   WorkspaceContainer / StatusBar;
// - 文档标签(WB-02.03):对象 ID + 标题 + 未保存状态 + 激活项;
// - 五个页面容器(WB-02.04):hash 深链恢复位置;
// - 弹层与通知(WB-02.09):导出对话框/确认框/命令搜索/统一通知,
//   接替原型的直接 DOM 拼接(原型保留为只读设计参考);
// - 运行管理器(WB-02.08)为模块级单例,挂载/卸载不影响任务队列。
// 数据来源:内置合成演示项目(synthetic_demo),接真实内核是 WB-03+。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ChangeEvent, JSX } from 'react'
import './workbench.css'
import { AppBar } from './components/AppBar.tsx'
import type { ExplorerGroup } from './components/ProjectExplorer.tsx'
import { ActivityRail } from './components/ActivityRail.tsx'
import { ProjectExplorer } from './components/ProjectExplorer.tsx'
import { WorkspaceContainer } from './components/WorkspaceContainer.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { DocumentTabs } from './components/DocumentTabs.tsx'
import { CommandSearch } from './overlays/CommandSearch.tsx'
import type { CommandEntry } from './overlays/CommandSearch.tsx'
import { ExportDialog } from './overlays/ExportDialog.tsx'
import type { ExportFormat, ExportScope } from './overlays/ExportDialog.tsx'
import { ConfirmDialog } from './overlays/ConfirmDialog.tsx'
import { ToastStack } from './overlays/ToastStack.tsx'
import { GlobalTaskDrawer } from './tasks/GlobalTaskDrawer.tsx'
import { AnalysisPage } from './pages/AnalysisPage.tsx'
import { ParametersPage } from './pages/ParametersPage.tsx'
import { DesignerPage } from './pages/DesignerPage.tsx'
import { RunsPage } from './pages/RunsPage.tsx'
import { ExchangePage } from './pages/ExchangePage.tsx'
import {
  deriveDocuments, explorerGroupsFor, getState, hasUnsavedWork, persistDraft, subscribe, dispatch,
} from './state/workbenchStore.ts'
import type { WorkbenchState } from './state/workbenchStore.ts'
import { parseHash, pageDef } from './routing.ts'
import type { PageId } from './routing.ts'
import {
  DEMO_PROJECT_ID, DEMO_RESULT,
  METRICS, PARAM_DEFS, filterAndSort,
} from './demo/sampleProject.ts'
import { svgFromElement, demoCsv, demoSnapshot, download } from './demo/export.ts'
import { packProject } from '../lib/project.ts'
// WB-04 · 项目打开/保存/草稿/快照(纯逻辑见 state/projectDoc.ts)
import {
  buildProjectSave, openProject, projectFromYaml, readPickedFile, runsIndexFile, unsavedKeys,
} from './state/projectDoc.ts'
import * as runManager from './state/runManager.ts'
import type { Job } from './state/jobLogic.ts'
import { notify } from './state/notifications.ts'
import { candidateIdFor } from './ids.ts'
import { DEMO_BASELINE_ID, DEMO_EXPERIMENT_ID } from './demo/sampleProject.ts'

type OverlayState = {
  commandSearch: boolean
  exportDialog: { open: boolean; scope: 'all' | 'filtered' | 'selected' }
  confirmResetAll: boolean
  about: boolean
  projectInfo: boolean
  shortcuts: boolean
  /** WB-04.12 · 打开其他项目前确认放弃未保存修改(待打开内容挂起) */
  confirmOpen: {
    open: boolean
    pending:
      | { kind: 'archive'; name: string; bytes: Uint8Array }
      | { kind: 'yaml'; name: string; yaml: string }
      | null
  }
  /** WB-04.12 · 关闭项目(回到演示项目)前确认 */
  confirmClose: boolean
}

const INITIAL_OVERLAYS: OverlayState = {
  commandSearch: false,
  exportDialog: { open: false, scope: 'all' },
  confirmResetAll: false,
  about: false,
  projectInfo: false,
  shortcuts: false,
  confirmOpen: { open: false, pending: null },
  confirmClose: false,
}

export default function WorkbenchApp(): JSX.Element {
  const state: WorkbenchState = useSyncExternalStore(subscribe, getState)
  const [overlays, setOverlays] = useState(INITIAL_OVERLAYS)
  const patchOverlays = (patch: Partial<OverlayState>): void =>
    setOverlays((prev) => ({ ...prev, ...patch }))

  /* 深链:浏览器前进/后退与初始 hash 解析 */
  useEffect(() => {
    const onHashChange = (): void => {
      const link = parseHash(window.location.hash)
      if (link) dispatch({ type: 'navigate', page: link.page, selection: link.selection })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  /* WB-04.12 · 退出页面守卫:有未保存修改时拦截浏览器关闭/刷新 */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (hasUnsavedWork(getState())) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  /* —— WB-04 · 项目打开 / 保存(WB-04.01/02/10/12/13) —— */
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** 应用栏项目入口:打开系统文件选择器;取消 = 无 change 事件 = 什么也不发生 */
  const openProjectEntry = (): void => fileInputRef.current?.click()

  const openArchive = async (name: string, bytes: Uint8Array): Promise<void> => {
    // WB-04.02:失败只报错,当前项目与草稿原样保留
    const outcome = await openProject(bytes, name)
    if (!outcome.ok) {
      dispatch({ type: 'project/open-failed', error: outcome.error })
      notify('error', outcome.error)
      return
    }
    const doc = outcome.doc
    const ns = doc.objects.filter((o) => o.kind === 'scenario').length
    const ne = doc.objects.filter((o) => o.kind === 'experiment').length
    const nr = doc.objects.filter((o) => o.kind === 'result').length
    dispatch({ type: 'project/open', doc })
    notify('success', `已打开项目「${doc.name}」:场景 ${ns} / 实验 ${ne} / 已保存结果 ${nr}(结果一并载入)`)
    dispatch({ type: 'navigate', page: 'designer' })
  }

  const openYamlDraft = async (name: string, yaml: string): Promise<void> => {
    const doc = await projectFromYaml(name, yaml)
    dispatch({
      type: 'project/open',
      doc,
      // YAML 是新草稿:尚未存在对应的项目文件 → 未保存状态起笔(WB-04.11)
      initialDrafts: {
        [doc.objects[0].path]: { content: yaml, saved: false, history: [] },
      },
    })
    notify('info', `YAML 已迁入工作台:「${doc.name}」(单场景草稿,实验页可编辑)`)
    dispatch({ type: 'navigate', page: 'designer' })
  }

  const onPickFile = async (e: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const f = e.target.files?.[0]
    e.target.value = '' // 复位:同一文件可再次选择;取消根本不触发本处理器
    const pick = await readPickedFile(f)
    if (pick.ok === 'cancel') return // 取消不报错(WB-04.01/13)
    if (!pick.ok) {
      notify('error', pick.error)
      return
    }
    const isYaml = /\.(yaml|yml|txt)$/i.test(pick.name)
    if (hasUnsavedWork(getState())) {
      // WB-04.12:打开其他项目前确认放弃未保存修改(可恢复:浏览器草稿记录保留)
      setOverlays((prev) => ({
        ...prev,
        confirmOpen: {
          open: true,
          pending: isYaml
            ? { kind: 'yaml', name: pick.name, yaml: new TextDecoder().decode(pick.bytes) }
            : { kind: 'archive', name: pick.name, bytes: pick.bytes },
        },
      }))
      return
    }
    if (isYaml) await openYamlDraft(pick.name, new TextDecoder().decode(pick.bytes))
    else await openArchive(pick.name, pick.bytes)
  }

  /** WB-04.10 · 保存项目:所选对象 + 完整产物一次打包;下载成功才置已保存。 */
  const saveProject = async (): Promise<void> => {
    const s = getState()
    const doc = s.project
    if (!doc) {
      notify('warning', '当前为内置演示项目,没有可保存的项目文件')
      return
    }
    try {
      const build = await buildProjectSave(doc, s.objectDrafts, {
        runArtifacts: s.runArtifacts,
        // 已登记的运行快照随归档保存(运行索引;WB-04.08)
        runsIndex: s.runs.length > 0 ? runsIndexFile(s.runs) : undefined,
      })
      const bytes = await packProject(build) // 打包失败(名空/路径越界)在此抛出
      const fileName = `${(doc.sourceName || doc.name).replace(/\.(sandtable|yaml|yml|txt)$/i, '')}.sandtable`
      download(fileName, bytes, 'application/zip')
      dispatch({ type: 'project/mark-saved' })
      notify('success', `已保存「${doc.name}」→ ${fileName}(含全部配置与产物;桌面端落 ~/Downloads)`)
    } catch (e) {
      // 失败保留草稿:保存状态不更新(WB-04.10)
      notify('error', `保存失败,草稿保留:${String(e)}`)
    }
  }

  const confirmOpenPending = (): void => {
    const pending = overlays.confirmOpen.pending
    if (!pending) return
    if (pending.kind === 'archive') void openArchive(pending.name, pending.bytes)
    else void openYamlDraft(pending.name, pending.yaml)
  }

  /* 全局快捷键(基础集):Ctrl/Cmd+K 命令搜索、Ctrl/Cmd+S 保存、Ctrl/Cmd+Z 撤销 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        patchOverlays({ commandSearch: true })
      } else if (key === 's') {
        e.preventDefault()
        const s = getState()
        // WB-04.10:项目模式 Ctrl+S = 保存项目文件;演示模式 = 浏览器草稿
        if (s.project) {
          void saveProject()
        } else if (persistDraft(s)) {
          dispatch({ type: 'draft/save' })
          notify('success', '候选方案已保存到当前浏览器')
        } else {
          notify('warning', '浏览器存储不可用,草稿仍保留在当前页面')
        }
      } else if (key === 'z') {
        e.preventDefault()
        dispatch({ type: 'draft/undo' })
        notify('info', '已撤销上一次参数修改')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* 恢复全部默认值(确认后) */
  const confirmResetAll = (): void => {
    dispatch({ type: 'draft/reset-all' })
    notify('info', '已恢复默认基线值,可撤销')
  }

  const documents = deriveDocuments(state)
  const activeDoc = documents.find((d) => d.page === state.page) ?? documents[0]
  const draftChanges = PARAM_DEFS.filter((p) => state.draft.values[p.id] !== p.base).length

  /* 命令表:页面 + 文档 + 参数(可独立接数据——后续加动作命令) */
  const commands: CommandEntry[] = useMemo(() => {
    const entries: CommandEntry[] = []
    for (const p of ['analysis', 'parameters', 'designer', 'runs', 'exchange'] as PageId[]) {
      const def = pageDef(p)
      entries.push({
        id: `page:${p}`,
        label: def.label,
        hint: def.tab,
        icon: p === 'analysis' ? 'chart' : p === 'parameters' ? 'table' : p === 'designer' ? 'flask' : p === 'runs' ? 'terminal' : 'exchange',
        run: () => dispatch({ type: 'navigate', page: p }),
      })
    }
    for (const param of PARAM_DEFS) {
      entries.push({
        id: `param:${param.id}`,
        label: param.name,
        hint: param.id,
        icon: 'table',
        run: () => {
          dispatch({ type: 'navigate', page: 'parameters', selection: { param: param.id } })
          dispatch({ type: 'param/focus', id: param.id })
        },
      })
    }
    return entries
  }, [])

  /* 导出(演示数据,明确来源标注;WB-09 接真实 run) */
  const doExport = (scope: ExportScope, format: ExportFormat): void => {
    const rows =
      scope === 'selected'
        ? [currentSelected(state)]
        : scope === 'filtered'
          ? filterAndSort(DEMO_RESULT.candidates, {
              filterVerdict: state.resultFilter,
              sortKey: state.sortKey,
              sortDir: state.sortDir,
            })
          : DEMO_RESULT.candidates
    const mainChart = document.querySelector<SVGSVGElement>('#workspace svg.main-chart')
    if (format === 'csv') {
      download('sandtable-demo-candidates.csv', demoCsv(rows), 'text/csv;charset=utf-8')
      notify('success', `已下载 sandtable-demo-candidates.csv(${rows.length} 候选,来源 ${'synthetic_demo'})`)
    } else if (format === 'json') {
      download(
        'sandtable-demo-snapshot.json',
        demoSnapshot(rows, { values: state.draft.values, design: state.design }),
        'application/json',
      )
      notify('success', '已下载 sandtable-demo-snapshot.json(草稿与样例快照分开标注)')
    } else if (mainChart !== null) {
      const metric = METRICS[state.metric]
      download(`sandtable-demo-${metric.id}.svg`, svgFromElement(mainChart, metric.label, metric.id), 'image/svg+xml')
      notify('success', `已下载 sandtable-demo-${metric.id}.svg(合成演示数据)`)
    } else {
      notify('warning', '当前没有可导出的主图;先在结果分析页打开响应图')
    }
    patchOverlays({ exportDialog: { open: false, scope: 'all' } })
  }

  const cancelJob = (id: Job['id']): void => runManager.cancelJob(id)

  /* —— WB-04 · 项目模式派生:应用栏/浏览器挂接真实项目文档 —— */
  // 演示数据标注保持显示(分析页图表仍来自内置演示结果集,WB-08 才替换)
  const demoMode = true
  const projectName = state.project?.name ?? 'RPG 平衡实验室'
  const projectId = state.project?.projectId ?? DEMO_PROJECT_ID
  const unsavedCount = unsavedKeys(state.objectDrafts).length + (state.draft.saved ? 0 : 1) + (state.designDirty ? 1 : 0)
  const saveLabel = state.project
    ? unsavedCount > 0 ? `${unsavedCount} 项未保存修改` : '与项目文件一致'
    : '演示项目无可保存文件'
  const demoGroups: ExplorerGroup[] = [
    {
      id: 'config',
      title: '模型与配置',
      open: true,
      resources: [
        {
          id: 'resource:baseline',
          page: 'parameters',
          icon: 'file-code',
          title: '基础参数表',
          meta: 'registry / defaults',
        },
        {
          // 候选草稿文档:内容寻址 ID(与文档标签同源)
          id: candidateIdFor(DEMO_BASELINE_ID, state.draft.values),
          page: 'parameters',
          icon: 'git-branch',
          title: '候选方案 A',
          meta: draftChanges > 0 ? `${draftChanges} 项参数变更` : '与基线一致',
          dirty: !state.draft.saved,
        },
        {
          id: 'resource:scenario',
          page: 'designer',
          icon: 'sliders',
          title: '实验配置',
          meta: '30 天 · 10,000 玩家',
        },
      ],
    },
    {
      id: 'experiments',
      title: '实验',
      open: true,
      resources: [
        {
          id: `${DEMO_EXPERIMENT_ID}:design-draft`,
          page: 'designer',
          icon: 'flask',
          title: '初始攻击力扫描',
          meta: 'Grid · 单参数',
        },
      ],
    },
    {
      id: 'results',
      title: '结果集',
      open: true,
      resources: [
        {
          id: String(DEMO_RESULT.runId),
          page: 'analysis',
          icon: 'chart',
          title: '攻击力扫描结果',
          meta: '11 候选 · 20 replicates',
          demoSource: true,
        },
      ],
    },
    {
      id: 'exchange',
      title: '数据交换',
      resources: [
        { id: 'resource:csv', page: 'exchange', icon: 'table', title: '候选汇总.csv' },
        { id: 'resource:json', page: 'exchange', icon: 'file-code', title: '实验快照.json' },
      ],
    },
  ]
  // WB-04.03 · 打开的项目:归档内 scenario/experiment/result 全量映射到
  // 项目浏览器(多配置逐条列出,选择用归档路径,不用下标)
  const projectGroups = explorerGroupsFor(state)
  const openResource = (r: { id: string; page: PageId }): void => {
    const view = projectGroups?.flatMap((g) => g.resources).find((res) => res.id === r.id)
    if (view?.objectKind === 'scenario') {
      dispatch({ type: 'object/select', kind: 'scenario', path: r.id })
      dispatch({ type: 'navigate', page: 'designer', selection: { scenario: r.id } })
    } else if (view?.objectKind === 'experiment') {
      dispatch({ type: 'object/select', kind: 'experiment', path: r.id })
      dispatch({ type: 'navigate', page: 'designer', selection: { experiment: r.id } })
    } else if (view?.objectKind === 'result') {
      dispatch({ type: 'navigate', page: 'analysis', selection: { result: r.id } })
    } else {
      dispatch({ type: 'navigate', page: r.page })
    }
  }
  // 当前活动资源:项目模式 = 选中对象路径(设计页)或选中结果(分析页)
  const activeId = state.project
    ? state.page === 'designer'
      ? state.selection.experiment || state.selection.scenario || null
      : state.page === 'analysis' ? state.selection.result || activeDoc?.id || null : activeDoc?.id ?? null
    : activeDoc?.id ?? null

  return (
    <div className="wb-app" data-wb-root>
      <a className="skip-link" href="#workspace">跳到工作区</a>
      {/* WB-04.01 · YAML 与 .sandtable 文件选择入口(取消不触发 onChange) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".sandtable,.yaml,.yml,.txt"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => void onPickFile(e)}
      />
      <AppBar
        projectName={projectName}
        projectId={projectId}
        demoMode={demoMode}
        onCommandSearch={() => patchOverlays({ commandSearch: true })}
        onAbout={() => patchOverlays({ about: true })}
        onProjectInfo={() => patchOverlays({ projectInfo: true })}
        onOpenProject={openProjectEntry}
        onSaveProject={state.project ? saveProject : null}
        saveLabel={saveLabel}
        sourceLabel={state.project ? '项目文件' : undefined}
      />
      <ActivityRail
        page={state.page}
        onNavigate={(page) => dispatch({ type: 'navigate', page })}
        onShortcuts={() => patchOverlays({ shortcuts: true })}
      />
      <ProjectExplorer
        projectName={projectName}
        collapsed={state.explorerCollapsed}
        onToggle={() => dispatch({ type: 'toggle-explorer' })}
        activeId={activeId}
        onOpen={openResource}
        footerNote={
          state.project
            ? <>项目文件已打开:配置草稿按对象隔离,保存时全部条目与产物一次写入归档。</>
            : <>候选编辑保存在当前浏览器。<br />样例结果与编辑草稿独立。</>
        }
        groups={projectGroups ?? demoGroups}
      />
      <main className="main-area">
        <DocumentTabs
          documents={documents}
          activePage={state.page}
          onActivate={(page) => dispatch({ type: 'navigate', page })}
        />
        <WorkspaceContainer labelledBy={`tab-${state.page}`} focusKey={state.page}>
          {state.page === 'analysis' && (
            <AnalysisPage
              key="analysis"
              state={state}
              onExport={() => patchOverlays({ exportDialog: { open: true, scope: 'all' } })}
            />
          )}
          {state.page === 'parameters' && (
            <ParametersPage key="parameters" state={state} onRequestResetAll={() => patchOverlays({ confirmResetAll: true })} />
          )}
          {state.page === 'designer' && <DesignerPage key="designer" state={state} />}
          {state.page === 'runs' && <RunsPage key="runs" state={state} />}
          {state.page === 'exchange' && (
            <ExchangePage key="exchange" onExport={() => patchOverlays({ exportDialog: { open: true, scope: 'all' } })} />
          )}
        </WorkspaceContainer>
        <GlobalTaskDrawer
          open={state.drawerOpen}
          onToggle={() => dispatch({ type: 'toggle-drawer' })}
          onAllJobs={() => dispatch({ type: 'navigate', page: 'runs' })}
          onCancel={cancelJob}
        />
      </main>
      <StatusBar
        onToggleExplorer={() => dispatch({ type: 'toggle-explorer' })}
        onToggleTasks={() => dispatch({ type: 'toggle-drawer' })}
        onShortcuts={() => patchOverlays({ shortcuts: true })}
        draftSaved={state.project ? unsavedKeys(state.objectDrafts).length === 0 : state.draft.saved}
        draftSavedLabel={
          state.project
            ? unsavedKeys(state.objectDrafts).length === 0
              ? '项目配置与项目文件一致'
              : `项目配置有 ${unsavedKeys(state.objectDrafts).length} 个对象未保存`
            : state.draft.saved ? '浏览器本地草稿已保存' : '存在未保存修改'
        }
      />

      {/* 弹层与通知(WB-02.09) */}
      <CommandSearch open={overlays.commandSearch} onClose={() => patchOverlays({ commandSearch: false })} commands={commands} />
      <ExportDialog
        open={overlays.exportDialog.open}
        onClose={() => patchOverlays({ exportDialog: { open: false, scope: 'all' } })}
        onConfirm={doExport}
        counts={{
          all: DEMO_RESULT.candidates.length,
          filtered: filterAndSort(DEMO_RESULT.candidates, {
            filterVerdict: state.resultFilter,
            sortKey: state.sortKey,
            sortDir: state.sortDir,
          }).length,
          selected: 1,
        }}
        selectedLabel={state.selectedCandidateId?.slice(0, 11) ?? '未选择'}
      />
      <ConfirmDialog
        open={overlays.confirmResetAll}
        title="恢复所有参数的默认基线值"
        confirmLabel="恢复默认值"
        onConfirm={confirmResetAll}
        onClose={() => patchOverlays({ confirmResetAll: false })}
        body={
          <p>
            将把候选方案 A 中 {draftChanges} 项变更恢复为注册表默认值。可以通过"撤销"恢复本次修改。
            已保存的浏览器草稿在再次保存前保持原值。
          </p>
        }
      />
      {/* WB-04.12 · 打开其他项目前:未保存修改守卫(取消 = 保留当前项目) */}
      <ConfirmDialog
        open={overlays.confirmOpen.open}
        title={`打开 ${overlays.confirmOpen.pending?.name ?? ''}`}
        confirmLabel="放弃修改并打开"
        tone="danger"
        onConfirm={confirmOpenPending}
        onClose={() => patchOverlays({ confirmOpen: { open: false, pending: null } })}
        body={
          <p>
            当前有未保存的修改(参数草稿 / 项目配置 / 实验草稿)。打开其他项目会放弃这些修改;
            本项目与对象的浏览器草稿记录保留,重新打开同一项目时仍可恢复。
          </p>
        }
      />
      {/* WB-04.12 · 关闭项目(回到演示项目)前:未保存修改守卫 */}
      <ConfirmDialog
        open={overlays.confirmClose}
        title={`关闭项目「${state.project?.name ?? ''}」`}
        confirmLabel="放弃修改并关闭"
        tone="danger"
        onConfirm={() => {
          dispatch({ type: 'project/close' })
          notify('info', '已关闭项目,回到内置演示项目')
        }}
        onClose={() => patchOverlays({ confirmClose: false })}
        body={
          <p>
            项目「{state.project?.name ?? ''}」有未保存的修改。关闭后将回到演示项目;
            浏览器草稿记录保留,重新打开同一项目文件时仍可恢复。
          </p>
        }
      />
      <AboutDialog
        open={overlays.about}
        onClose={() => patchOverlays({ about: false })}
      />
      <ProjectInfoDialog
        open={overlays.projectInfo}
        onClose={() => patchOverlays({ projectInfo: false })}
        onRequestConfirmClose={() => patchOverlays({ confirmClose: true })}
      />
      <ShortcutsDialog open={overlays.shortcuts} onClose={() => patchOverlays({ shortcuts: false })} />
      <ToastStack />
    </div>
  )
}

function currentSelected(state: WorkbenchState) {
  const id = state.selectedCandidateId
  return DEMO_RESULT.candidates.find((c) => c.id === id) ?? DEMO_RESULT.candidates[6]
}

/* —— 次级弹层(关于 / 项目信息 / 快捷键):内容与原型口径一致 —— */
function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <ConfirmDialog
      open={open}
      title="Sandtable · 第二版工作台(React 版)"
      confirmLabel="开始使用"
      onConfirm={() => {}}
      onClose={onClose}
      body={
        <>
          <p>这个工作台用于评审数值策划的工作流:参数编辑 → 实验设计 → 任务队列 → 候选结果分析。</p>
          <p>
            参数路径、类型与基线值参考当前仓库注册表。图表和候选结果是内置合成数据,
            尚未接入 Rust / WASM 内核(WB-03 起);编辑草稿保存在当前浏览器。
          </p>
          <p>可实际体验:选择图中候选、表格排序和筛选、指标切换、批量编辑与撤销、本地保存、演示任务取消、CSV / JSON / SVG 下载。</p>
        </>
      }
    />
  )
}

function ProjectInfoDialog({ open, onClose, onRequestConfirmClose }: {
  open: boolean
  onClose: () => void
  onRequestConfirmClose: () => void
}): JSX.Element {
  const s = getState()
  const doc = s.project
  return (
    <ConfirmDialog
      open={open}
      title={doc ? doc.name : 'RPG 平衡实验室'}
      confirmLabel={doc ? '打开配置编辑' : '打开参数表'}
      onConfirm={() => dispatch({ type: 'navigate', page: doc ? 'designer' : 'parameters' })}
      onClose={onClose}
      body={
        doc ? (
          <>
            <p>
              当前项目来自文件 {doc.sourceName}(项目 ID {String(doc.projectId)})。
              场景 / 实验 / 结果条目已映射到项目浏览器;配置草稿按对象隔离,未保存状态在标签与状态栏可见。
            </p>
            <p>
              保存项目会把全部配置(含未选中条目)与完整产物一次写入归档;运行提交时的输入快照与运行索引
              results/runs.json 一并保存。内核执行接入前(WB-07)快照如实标注 model/schema = unknown。
            </p>
            <p>
              <button
                className="btn"
                onClick={() => {
                  onClose()
                  if (hasUnsavedWork(getState())) {
                    // 有未保存修改 → 走确认弹层(WB-04.12)
                    onRequestConfirmClose()
                  } else {
                    dispatch({ type: 'project/close' })
                    notify('info', '已关闭项目,回到内置演示项目')
                  }
                }}
              >
                关闭项目(回到演示项目)
              </button>
            </p>
          </>
        ) : (
          <>
            <p>
              这是内置样例项目(项目 ID {String(DEMO_PROJECT_ID)}),参数/基线来自注册表,图表为合成演示数据。
              用应用栏「打开项目…」可载入 .sandtable 项目文件或 YAML 配置(取消选择不报错)。
            </p>
          </>
        )
      }
    />
  )
}

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const rows: Array<[string, string]> = [
    ['查找参数与命令', 'Ctrl / ⌘ + K'],
    ['保存参数草稿', 'Ctrl / ⌘ + S'],
    ['撤销参数修改', 'Ctrl / ⌘ + Z'],
    ['候选表选择上一项 / 下一项', '↑ / ↓'],
    ['文档标签切换', '← / → · Home / End'],
    ['图中观测点选择', 'Tab → Enter'],
    ['关闭对话框', 'Esc'],
  ]
  return (
    <ConfirmDialog
      open={open}
      title="键盘操作"
      confirmLabel="关闭"
      onConfirm={() => {}}
      onClose={onClose}
      body={
        <div>
          {rows.map(([label, keys]) => (
            <div className="shortcut-row" key={label}>
              <span>{label}</span>
              <kbd>{keys}</kbd>
            </div>
          ))}
        </div>
      }
    />
  )
}
