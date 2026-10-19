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
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import './workbench.css'
import { AppBar } from './components/AppBar.tsx'
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
import { deriveDocuments, getState, persistDraft, subscribe, dispatch } from './state/workbenchStore.ts'
import type { WorkbenchState } from './state/workbenchStore.ts'
import { parseHash, pageDef } from './routing.ts'
import type { PageId } from './routing.ts'
import {
  DEMO_PROJECT_ID, DEMO_RESULT,
  METRICS, PARAM_DEFS, filterAndSort,
} from './demo/sampleProject.ts'
import { svgFromElement, demoCsv, demoSnapshot, download } from './demo/export.ts'
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
}

const INITIAL_OVERLAYS: OverlayState = {
  commandSearch: false,
  exportDialog: { open: false, scope: 'all' },
  confirmResetAll: false,
  about: false,
  projectInfo: false,
  shortcuts: false,
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

  /* 全局快捷键(基础集):Ctrl/Cmd+K 命令搜索、Ctrl/Cmd+S 保存草稿、Ctrl/Cmd+Z 撤销 */
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
        if (persistDraft(s)) {
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

  return (
    <div className="wb-app" data-wb-root>
      <a className="skip-link" href="#workspace">跳到工作区</a>
      <AppBar
        projectName="RPG 平衡实验室"
        projectId={DEMO_PROJECT_ID}
        demoMode
        onCommandSearch={() => patchOverlays({ commandSearch: true })}
        onAbout={() => patchOverlays({ about: true })}
        onProjectInfo={() => patchOverlays({ projectInfo: true })}
      />
      <ActivityRail
        page={state.page}
        onNavigate={(page) => dispatch({ type: 'navigate', page })}
        onShortcuts={() => patchOverlays({ shortcuts: true })}
      />
      <ProjectExplorer
        projectName="RPG 平衡实验室"
        collapsed={state.explorerCollapsed}
        onToggle={() => dispatch({ type: 'toggle-explorer' })}
        activeId={activeDoc?.id ?? null}
        onOpen={(r) => dispatch({ type: 'navigate', page: r.page })}
        footerNote={<>候选编辑保存在当前浏览器。<br />样例结果与编辑草稿独立。</>}
        groups={[
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
        ]}
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
          {state.page === 'runs' && <RunsPage key="runs" />}
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
        draftSaved={state.draft.saved}
        draftSavedLabel={state.draft.saved ? '浏览器本地草稿已保存' : '存在未保存修改'}
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
      <AboutDialog
        open={overlays.about}
        onClose={() => patchOverlays({ about: false })}
      />
      <ProjectInfoDialog
        open={overlays.projectInfo}
        onClose={() => patchOverlays({ projectInfo: false })}
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

function ProjectInfoDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  return (
    <ConfirmDialog
      open={open}
      title="RPG 平衡实验室"
      confirmLabel="打开参数表"
      onConfirm={() => dispatch({ type: 'navigate', page: 'parameters' })}
      onClose={onClose}
      body={
        <>
          <p>
            当前打开的是内置样例项目(项目 ID {String(DEMO_PROJECT_ID)})。
            默认基线来自 Sandtable 参数注册表;候选方案 A 的修改保存在此浏览器。
          </p>
          <p>
            真正的项目文件打开、项目版本管理与内核运行仍需要后续接入(WB-04)。本工作台不显示伪造的配置哈希或文件保存状态。
          </p>
        </>
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
