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
import { ProjectsPanel } from './project/ProjectsPanel.tsx'
import { registryRegister } from './project/projectRegistry.ts'
import { loadScenarioVersions, unloadScenarioVersions } from './project/scenarioVersions.ts'
import { loadParamMeta, unloadParamMeta } from './project/paramMeta.ts'
import { AnalysisPage } from './pages/AnalysisPage.tsx'
import { ParametersPage } from './pages/ParametersPage.tsx'
import { DesignerPage } from './pages/DesignerPage.tsx'
import { RunsPage } from './pages/RunsPage.tsx'
import { ExchangePage } from './pages/ExchangePage.tsx'
import {
  deriveDocuments, explorerGroupsFor, getState, hasUnsavedWork, paramYamlView, persistDraft, subscribe, dispatch,
} from './state/workbenchStore.ts'
import type { WorkbenchState } from './state/workbenchStore.ts'
import { parseHash } from './routing.ts'
import type { PageId } from './routing.ts'
import { globalShortcutFor } from './keyboard.ts'
import {
  DEMO_PROJECT_ID, DEMO_RESULT,
  METRICS, filterAndSort,
} from './demo/sampleProject.ts'
// WB-05 · 参数表数据源(注册表 × 配置 YAML)
import { PARAM_REGISTRY, displayParamName } from './params/paramRegistry.ts'
import { numericValuesOf, parseConfig } from './params/configYaml.ts'
import { kernelCheck, modifiedPaths } from './params/paramsLogic.ts'
import { svgFromElement, demoCsv, demoSnapshot, download } from './demo/export.ts'
import { metricLabel } from '../lib/metricMeta.ts'
import type { MetricKey as KernelMetricKey } from '../lib/types.ts'
import { packProject } from '../lib/project.ts'
// WB-04 · 项目打开/保存/草稿/快照(纯逻辑见 state/projectDoc.ts)
import {
  baseContentOf, buildProjectSave, openProject, projectFromYaml, readPickedFile, runsIndexFile, unsavedKeys,
  restoreRunsFromArchive,
} from './state/projectDoc.ts'
import * as runManager from './state/runManager.ts'
import type { Job } from './state/jobLogic.ts'
import { notify } from './state/notifications.ts'
import { candidateIdFor } from './ids.ts'
import { t, tPlural } from '../lib/i18n/index.ts'
import { currentRealJob, scopeCounts, scopeRows, scopedRunCsv, scopedRunJson } from './analysis/exportScope.ts'
import { svgRunFromElement } from './analysis/svgExport.ts'
import { analysisSnapshot, defaultResultUI, subscribeAnalysis } from './analysis/analysisStore.ts'
import { fmtNumber } from '../lib/i18n/format.ts'
import { localeSession, useLocale } from './state/localeStore.ts'
import { DEMO_BASELINE_ID, DEMO_EXPERIMENT_ID } from './demo/sampleProject.ts'

// WB-11.11 · 命令面板页面行的词典键(label=功能轨名,hint=文档标签名)
const NAV_PAGE_LABEL: Record<PageId, 'nav.analysis' | 'nav.parameters' | 'nav.designer' | 'nav.runs' | 'nav.exchange'> = {
  analysis: 'nav.analysis',
  parameters: 'nav.parameters',
  designer: 'nav.designer',
  runs: 'nav.runs',
  exchange: 'nav.exchange',
}
const NAV_TAB_LABEL: Record<PageId, 'nav.tab.analysis' | 'nav.tab.parameters' | 'nav.tab.designer' | 'nav.tab.runs' | 'nav.tab.exchange'> = {
  analysis: 'nav.tab.analysis',
  parameters: 'nav.tab.parameters',
  designer: 'nav.tab.designer',
  runs: 'nav.tab.runs',
  exchange: 'nav.tab.exchange',
}

type OverlayState = {
  commandSearch: boolean
  exportDialog: { open: boolean; scope: 'all' | 'filtered' | 'selected' }
  confirmResetAll: boolean
  about: boolean
  projectInfo: boolean
  shortcuts: boolean
  /** P1-01 · 项目库(创建/复制/归档/恢复/重命名/备注) */
  projects: boolean
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
  projects: false,
  confirmOpen: { open: false, pending: null },
  confirmClose: false,
}

export default function WorkbenchApp(): JSX.Element {
  const state: WorkbenchState = useSyncExternalStore(subscribe, getState)
  const locale = useLocale()
  const jobs: readonly Job[] = useSyncExternalStore(runManager.subscribe, runManager.listJobs)
  const analysis = useSyncExternalStore(subscribeAnalysis, analysisSnapshot)
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

  /* WB-09.07 · 真实 run 终局落档:机器快照(含 spec = 关联配置)写进运行
   * 产物,索引 files 同步登记——重开归档后可再次导出。每个 run 只落一次。 */
  const archivedRuns = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const j of jobs) {
      const exec = j.exec
      if (j.demo || exec === undefined) continue
      if (j.status !== 'succeeded' && j.status !== 'cancelled' && j.status !== 'failed') continue
      if (archivedRuns.current.has(j.id)) continue
      archivedRuns.current.add(j.id)
      const runEntry = getState().runs.find((r) => r.run_id === exec.runId) ?? null
      dispatch({
        type: 'run/artifacts',
        runId: exec.runId,
        artifacts: {
          [`results/${exec.runId}.report.json`]: scopedRunJson(
            j, { selectedId: null, order: defaultResultUI.order }, 'all', runEntry,
          ),
        },
      })
    }
  }, [jobs])

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
    // P1-01/02 · 项目库登记 + 按项目恢复配置版本/基线/备注(内容仍在归档层)
    registryRegister(doc.projectId, doc.name)
    loadScenarioVersions(doc.projectId)
    loadParamMeta(doc.projectId)
    // WB-09.07 · 重开恢复运行登记簿与在场产物:登记簿回显、产物可再次导出;
    // 索引不可读给可读错误(结果文件仍按字节保留,不静默丢)
    const restored = restoreRunsFromArchive(doc.files)
    if (restored.error !== null) {
      notify('error', restored.error)
    }
    for (const entry of restored.runs) {
      const own: Record<string, string | Uint8Array> = {}
      for (const f of entry.files) {
        const bytes = restored.artifacts[f]
        if (bytes !== undefined) own[f] = bytes
      }
      dispatch({ type: 'run/register', entry, artifacts: own })
    }
    notify('success', t(locale, 'common.notifyProjectOpened', { name: doc.name, scenarios: ns, experiments: ne, results: nr }))
    dispatch({ type: 'navigate', page: 'designer' })
  }

  const openYamlDraft = async (name: string, yaml: string): Promise<void> => {
    const doc = await projectFromYaml(name, yaml)
    dispatch({
      type: 'project/open',
      doc,
      // YAML 是新草稿:尚未存在对应的项目文件 → 未保存状态起笔(WB-04.11)
      initialDrafts: {
        [doc.objects[0].path]: { content: yaml, saved: false, history: [], future: [] },
      },
    })
    notify('info', t(locale, 'common.notifyYamlImported', { name: doc.name }))
    registryRegister(doc.projectId, doc.name)
    loadScenarioVersions(doc.projectId)
    loadParamMeta(doc.projectId)
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

  /** WB-04.10 · 保存项目:所选对象 + 完整产物一次打包;下载成功才置已保存。
   * WB-05.14 · 保存前对全部场景候选做内核完整校验,冻结所选场景的已校验
   * 版本(config_hash);任一校验失败 → 不打包,草稿保留,错误定位到参数。 */
  const saveProject = async (): Promise<void> => {
    const s = getState()
    const doc = s.project
    if (!doc) {
      notify('warning', t(localeSession.get(), 'common.notifyNoProjectFile'))
      return
    }
    const failures: string[] = []
    for (const o of doc.objects) {
      if (o.kind !== 'scenario') continue
      const d = s.objectDrafts[o.path]
      const content = d ? d.content : baseContentOf(doc, o.path)
      const check = await kernelCheck(content)
      if (!check.ok) {
        failures.push(`${o.path}${check.path ? `(${check.path})` : ''}: ${check.message}`)
        if (o.path === s.selection.scenario) {
          dispatch({ type: 'param/kernel-error', error: { path: check.path, message: check.message } })
        }
      } else if (o.path === s.selection.scenario) {
        // 冻结已通过校验的配置版本(后续单元格编辑不影响该版本)
        const info = check.info as { config_hash?: string } | null
        if (info?.config_hash) {
          dispatch({ type: 'param/frozen', yaml: content, configHash: String(info.config_hash) })
        }
      }
    }
    if (failures.length > 0) {
      notify('error', t(localeSession.get(), 'common.notifySaveBlocked', { detail: failures.join('\n') }))
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
      notify('success', t(localeSession.get(), 'common.notifySaved', { name: doc.name, file: fileName }))
    } catch (e) {
      // 失败保留草稿:保存状态不更新(WB-04.10)
      notify('error', t(localeSession.get(), 'common.notifySaveFailed', { detail: String(e) }))
    }
  }

  const confirmOpenPending = (): void => {
    const pending = overlays.confirmOpen.pending
    if (!pending) return
    if (pending.kind === 'archive') void openArchive(pending.name, pending.bytes)
    else void openYamlDraft(pending.name, pending.yaml)
  }

  /* 全局快捷键(WB-02.14):Ctrl/Cmd+K 命令搜索、Ctrl/Cmd+S 保存、
   * Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z / Ctrl/Cmd+Y 重做。
   * 输入框/文本区内撤销与重做交还浏览器原生行为(裁决见 keyboard.ts)。
   * effect 保持 [] 依赖不重挂监听:提示文案的 locale 经 localeSession.get()
   * 即时读取(WB-11.08),不引入组件级依赖。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const shortcut = globalShortcutFor(e)
      if (shortcut === null) return
      e.preventDefault()
      if (shortcut === 'command-search') {
        patchOverlays({ commandSearch: true })
        return
      }
      if (shortcut === 'save') {
        const s = getState()
        // WB-04.10:项目模式 Ctrl+S = 保存项目文件;演示模式 = 浏览器草稿
        if (s.project) {
          void saveProject()
        } else if (persistDraft(s)) {
          dispatch({ type: 'param/save' })
          notify('success', t(localeSession.get(), 'common.notifyDraftSaved'))
        } else {
          notify('warning', t(localeSession.get(), 'common.notifyStorageUnavailable'))
        }
        return
      }
      // WB-05.12:参数候选统一撤销/重做(单项/批量/恢复共用一条历史)
      const before = getState()
      dispatch({ type: shortcut === 'undo' ? 'param/undo' : 'param/redo' })
      // 历史为空时是空操作,不报「已撤销/已重做」(无动作不给提示)
      if (getState() !== before) {
        notify('info', shortcut === 'undo' ? t(localeSession.get(), 'common.notifyUndone') : t(localeSession.get(), 'common.notifyRedone'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* 恢复全部默认值(确认后)——WB-05.12:恢复也走同一条撤销/重做历史 */
  const confirmResetAll = (): void => {
    dispatch({ type: 'param/reset-all' })
    notify('info', t(locale, 'common.notifyRestored'))
  }

  const documents = deriveDocuments(state)
  const activeDoc = documents.find((d) => d.page === state.page) ?? documents[0]
  // WB-05 · 候选相对基线的参数变更数(注册表 × YAML,不再依赖 18 项原型)
  const paramView = paramYamlView(state)
  const draftChanges = modifiedPaths(parseConfig(paramView.base), parseConfig(paramView.cand)).length
  const candValues = numericValuesOf(parseConfig(paramView.cand))

  /* 命令表:页面 + 文档 + 参数(可独立接数据——后续加动作命令)。
     WB-11.11:页面行 label/hint 与参数名随 locale 走词典(菜单面),
     locale 进依赖,切语言后命令表即刻换文案。 */
  const commands: CommandEntry[] = useMemo(() => {
    const entries: CommandEntry[] = []
    for (const p of ['analysis', 'parameters', 'designer', 'runs', 'exchange'] as PageId[]) {
      entries.push({
        id: `page:${p}`,
        label: t(locale, NAV_PAGE_LABEL[p]),
        hint: t(locale, NAV_TAB_LABEL[p]),
        icon: p === 'analysis' ? 'chart' : p === 'parameters' ? 'table' : p === 'designer' ? 'flask' : p === 'runs' ? 'terminal' : 'exchange',
        run: () => dispatch({ type: 'navigate', page: p }),
      })
    }
    for (const param of PARAM_REGISTRY) {
      entries.push({
        id: `param:${param.path}`,
        label: displayParamName(param.path, locale),
        hint: param.path,
        icon: 'table',
        run: () => {
          dispatch({ type: 'navigate', page: 'parameters', selection: { param: param.path } })
          dispatch({ type: 'param/focus', id: param.path })
        },
      })
    }
    // P1-01 · 项目库命令入口
    entries.push({
      id: 'project:library',
      label: t(locale, 'common.projects'),
      hint: t(locale, 'common.projectsHint'),
      icon: 'folder-open',
      run: () => patchOverlays({ projects: true }),
    })
    return entries
  }, [locale])

  /* —— WB-09.01 · 导出绑定当前真实 run —— */
  // 真实分析视图打开导出对话框时:范围计数与产物一律派生自当前 run
  // (currentRealJob 与分析页同一口径);演示/数据交换页仍是演示导出。
  // 真实上下文先只放 JSON(CSV/SVG 属 WB-09.02/.05,落地后放开)。
  const exportCtx = state.page === 'analysis' && state.selection.source !== 'synthetic_demo'
    ? (() => {
        const job = currentRealJob(jobs, analysis.jobId, state.selection.run)
        if (!job) return null
        return { job, ui: analysis.byJob[job.id] ?? defaultResultUI }
      })()
    : null

  /* 导出(演示数据,明确来源标注;真实 run 走 WB-09.01 绑定导出) */
  const doExport = (scope: ExportScope, format: ExportFormat): void => {
    if (exportCtx) {
      const exec = exportCtx.job.exec!
      const kept = scopeRows(exportCtx.job, exportCtx.ui, scope).length
      // 计划内槽位总数与导出信封同一口径(ExecSpec 是 kind 判别联合,plan 只在扫描规格上)
      const total = scopeRows(exportCtx.job, exportCtx.ui, 'all').length
      // 运行索引条目单点取值:CSV 的 experiment_id/配置版本列与 JSON 信封同源
      const runEntry = state.runs.find((r) => r.run_id === exec.runId) ?? null
      if (format === 'csv') {
        download(`${exec.runId}-candidates.csv`, scopedRunCsv(exportCtx.job, exportCtx.ui, scope, runEntry), 'text/csv;charset=utf-8')
        notify('success', t(locale, 'common.notifyCsvDownloaded', { count: kept, source: 'kernel' }))
        patchOverlays({ exportDialog: { open: false, scope: 'all' } })
        return
      }
      if (format === 'svg') {
        // WB-09.05:序列化分析页当前指标主图(所选候选高亮随图带出),kernel 来源标注
        const mainChart = document.querySelector<SVGSVGElement>('#workspace svg.main-chart')
        if (mainChart !== null) {
          const metric = exportCtx.ui.metric
          download(`${exec.runId}-${metric}.svg`, svgRunFromElement(mainChart, locale, metricLabel(metric, locale), metric, exec.runId, exportCtx.job.status), 'image/svg+xml')
          notify('success', t(locale, 'analysis.exportRunSvgDone', { run: exec.runId, metric }))
          patchOverlays({ exportDialog: { open: false, scope: 'all' } })
        }
        return
      }
      download(`${exec.runId}.json`, scopedRunJson(exportCtx.job, exportCtx.ui, scope, runEntry), 'application/json')
      notify('success', t(locale, 'analysis.exportRunJsonDone', { run: exec.runId, kept, total }))
      patchOverlays({ exportDialog: { open: false, scope: 'all' } })
      return
    }
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
      notify('success', t(locale, 'common.notifyCsvDownloaded', { count: rows.length, source: 'synthetic_demo' }))
    } else if (format === 'json') {
      download(
        'sandtable-demo-snapshot.json',
        demoSnapshot(rows, { values: candValues, design: state.design }),
        'application/json',
      )
      notify('success', t(locale, 'common.notifyJsonDownloaded'))
    } else if (mainChart !== null) {
      const metric = METRICS[state.metric]
      // WB-11.23:标题用导出语言的指标显示名,并把导出 locale 记进产物根节点
      download(
        `sandtable-demo-${metric.id}.svg`,
        svgFromElement(mainChart, metricLabel(metric.id as KernelMetricKey, locale), metric.id, locale),
        'image/svg+xml',
      )
      notify('success', t(locale, 'common.notifySvgDownloaded', { id: metric.id }))
    } else {
      notify('warning', t(locale, 'common.notifyNoMainChart'))
    }
    patchOverlays({ exportDialog: { open: false, scope: 'all' } })
  }

  const cancelJob = (id: Job['id']): void => {
    void runManager.cancelJob(id) // WB-07 · 真实任务取消 = 异步语义(边界落地)
  }

  /* —— WB-04 · 项目模式派生:应用栏/浏览器挂接真实项目文档 —— */
  // 演示数据标注保持显示(分析页图表仍来自内置演示结果集,WB-08 才替换)
  const demoMode = true
  const projectName = state.project?.name ?? 'RPG 平衡实验室'
  const projectId = state.project?.projectId ?? DEMO_PROJECT_ID
  const unsavedCount = unsavedKeys(state.objectDrafts).length + (state.paramDraft.saved ? 0 : 1) + (state.designDirty ? 1 : 0)
  const saveLabel = state.project
    ? unsavedCount > 0 ? t(locale, 'common.saveChangesCount', { count: unsavedCount }) : t(locale, 'common.savedWithFile')
    : t(locale, 'common.demoNoSaveFile')
  // WB-11.11 · 资源树演示数据侧文案:分组名/演示文档名/描述行随 locale 走词典
  // (文档名与文档标签同源 nav.tab.*);文件名候选汇总.csv/实验快照.json 与
  // registry / defaults 是数据本体,保持原文(与项目名同一口径,WB-11.20)。
  const demoGroups: ExplorerGroup[] = [
    {
      id: 'config',
      title: t(locale, 'nav.explorer.config'),
      open: true,
      resources: [
        {
          id: 'resource:baseline',
          page: 'parameters',
          icon: 'file-code',
          title: t(locale, 'nav.explorer.baseline'),
          meta: 'registry / defaults',
        },
        {
          // 候选草稿文档:内容寻址 ID(与文档标签同源;WB-05 注册表×YAML 域)
          id: candidateIdFor(DEMO_BASELINE_ID, candValues),
          page: 'parameters',
          icon: 'git-branch',
          title: t(locale, 'nav.tab.parameters'),
          meta: draftChanges > 0
            ? tPlural(locale, 'nav.explorer.metaChanges', draftChanges)
            : t(locale, 'nav.explorer.metaSameAsBaseline'),
          dirty: !state.paramDraft.saved,
        },
        {
          id: 'resource:scenario',
          page: 'designer',
          icon: 'sliders',
          title: t(locale, 'nav.explorer.scenario'),
          meta: t(locale, 'nav.explorer.metaScenario', {
            days: fmtNumber(locale, 30),
            players: fmtNumber(locale, 10000),
          }),
        },
      ],
    },
    {
      id: 'experiments',
      title: t(locale, 'nav.explorer.experiments'),
      open: true,
      resources: [
        {
          id: `${DEMO_EXPERIMENT_ID}:design-draft`,
          page: 'designer',
          icon: 'flask',
          title: t(locale, 'nav.tab.designer'),
          meta: t(locale, 'nav.explorer.metaSweepMode'),
        },
      ],
    },
    {
      id: 'results',
      title: t(locale, 'nav.explorer.results'),
      open: true,
      resources: [
        {
          id: String(DEMO_RESULT.runId),
          page: 'analysis',
          icon: 'chart',
          title: t(locale, 'nav.tab.analysis'),
          meta: t(locale, 'nav.explorer.metaResults', {
            candidates: fmtNumber(locale, DEMO_RESULT.candidates.length),
            replicates: fmtNumber(locale, 20),
          }),
          demoSource: true,
        },
      ],
    },
    {
      id: 'exchange',
      title: t(locale, 'nav.explorer.exchange'),
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
      <a className="skip-link" href="#workspace">{t(locale, 'common.skipToWorkspace')}</a>
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
        onProjects={() => patchOverlays({ projects: true })}
        saveLabel={saveLabel}
        sourceLabel={state.project ? t(locale, 'common.projectFile') : undefined}
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
            ? <>{t(locale, 'common.explorerFooterProject')}</>
            : <>{t(locale, 'common.explorerFooterDemoSaved')}<br />{t(locale, 'common.explorerFooterDemoDraft')}</>
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
        draftSaved={state.project ? unsavedKeys(state.objectDrafts).length === 0 : state.paramDraft.saved}
        draftSavedLabel={
          state.project
            ? unsavedKeys(state.objectDrafts).length === 0
              ? t(locale, 'common.draftSyncProject')
              : t(locale, 'common.draftUnsavedObjects', { count: unsavedKeys(state.objectDrafts).length })
            : state.paramDraft.saved ? t(locale, 'common.draftSavedLocal') : t(locale, 'common.draftUnsaved')
        }
      />

      {/* 弹层与通知(WB-02.09) */}
      <CommandSearch open={overlays.commandSearch} onClose={() => patchOverlays({ commandSearch: false })} commands={commands} />
      <ExportDialog
        open={overlays.exportDialog.open}
        onClose={() => patchOverlays({ exportDialog: { open: false, scope: 'all' } })}
        onConfirm={doExport}
        counts={exportCtx
          ? scopeCounts(exportCtx.job, exportCtx.ui)
          : {
            all: DEMO_RESULT.candidates.length,
            filtered: filterAndSort(DEMO_RESULT.candidates, {
              filterVerdict: state.resultFilter,
              sortKey: state.sortKey,
              sortDir: state.sortDir,
            }).length,
            selected: 1,
          }}
        formats={exportCtx ? ['json', 'csv', 'svg'] : undefined}
        sourceNote={exportCtx
          ? t(locale, 'data.exportDialog.runLine', { run: exportCtx.job.exec!.runId, status: exportCtx.job.status })
          : undefined}
        selectedLabel={exportCtx
          ? (exportCtx.ui.selectedId ?? t(locale, 'common.notSelected'))
          : (state.selectedCandidateId?.slice(0, 11) ?? t(locale, 'common.notSelected'))}
      />
      <ConfirmDialog
        open={overlays.confirmResetAll}
        title={t(locale, 'common.confirmResetTitle')}
        confirmLabel={t(locale, 'common.confirmResetConfirm')}
        onConfirm={confirmResetAll}
        onClose={() => patchOverlays({ confirmResetAll: false })}
        body={
          <p>{t(locale, 'common.confirmResetBody', { count: draftChanges })}</p>
        }
      />
      {/* WB-04.12 · 打开其他项目前:未保存修改守卫(取消 = 保留当前项目) */}
      <ConfirmDialog
        open={overlays.confirmOpen.open}
        title={t(locale, 'common.confirmOpenTitle', { name: overlays.confirmOpen.pending?.name ?? '' })}
        confirmLabel={t(locale, 'common.confirmOpenConfirm')}
        tone="danger"
        onConfirm={confirmOpenPending}
        onClose={() => patchOverlays({ confirmOpen: { open: false, pending: null } })}
        body={
          <p>{t(locale, 'common.confirmOpenBody')}</p>
        }
      />
      {/* WB-04.12 · 关闭项目(回到演示项目)前:未保存修改守卫 */}
      <ConfirmDialog
        open={overlays.confirmClose}
        title={t(locale, 'common.confirmCloseTitle', { name: state.project?.name ?? '' })}
        confirmLabel={t(locale, 'common.confirmCloseConfirm')}
        tone="danger"
        onConfirm={() => {
          dispatch({ type: 'project/close' })
          unloadScenarioVersions()
          unloadParamMeta()
          notify('info', t(locale, 'common.notifyProjectClosed'))
        }}
        onClose={() => patchOverlays({ confirmClose: false })}
        body={
          <p>{t(locale, 'common.confirmCloseBody', { name: state.project?.name ?? '' })}</p>
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
      {/* P1-01/05 · 项目库:创建/复制/归档(软态)/恢复/重命名/改动备注 */}
      <ProjectsPanel
        open={overlays.projects}
        onClose={() => patchOverlays({ projects: false })}
        doc={state.project}
        onAdoptDoc={(doc) => {
          // 未保存修改守卫(与打开文件同口径):不丢用户草稿
          if (hasUnsavedWork(getState())) {
            notify('warning', t(localeSession.get(), 'common.confirmOpenBody'))
            return
          }
          dispatch({ type: 'project/open', doc })
          registryRegister(doc.projectId, doc.name)
          loadScenarioVersions(doc.projectId)
          loadParamMeta(doc.projectId)
          patchOverlays({ projects: false })
          notify('success', t(localeSession.get(), 'common.notifyProjectSwitched', { name: doc.name }))
          dispatch({ type: 'navigate', page: 'designer' })
        }}
        onRenameDoc={(name) => dispatch({ type: 'project/rename', name })}
      />
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
  const locale = useLocale()
  return (
    <ConfirmDialog
      open={open}
      title={t(locale, 'common.aboutTitle')}
      confirmLabel={t(locale, 'common.aboutGetStarted')}
      onConfirm={() => {}}
      onClose={onClose}
      body={
        <>
          <p>{t(locale, 'common.aboutBody1')}</p>
          <p>{t(locale, 'common.aboutBody2')}</p>
          <p>{t(locale, 'common.aboutBody3')}</p>
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
  const locale = useLocale()
  return (
    <ConfirmDialog
      open={open}
      title={doc ? doc.name : 'RPG 平衡实验室'}
      confirmLabel={doc ? t(locale, 'common.openConfigEditor') : t(locale, 'common.openParamTable')}
      onConfirm={() => dispatch({ type: 'navigate', page: doc ? 'designer' : 'parameters' })}
      onClose={onClose}
      body={
        doc ? (
          <>
            <p>{t(locale, 'common.projectInfoFromFile', { name: doc.sourceName ?? '', id: String(doc.projectId) })}</p>
            <p>{t(locale, 'common.projectInfoSaveAll')}</p>
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
                    unloadScenarioVersions()
                    unloadParamMeta()
                  }
                }}
              >
{t(locale, 'common.projectInfoCloseButton')}
              </button>
            </p>
          </>
        ) : (
          <>
            <p>{t(locale, 'common.projectInfoDemoBody', { id: String(DEMO_PROJECT_ID) })}</p>
          </>
        )
      }
    />
  )
}

function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const locale = useLocale()
  const rows: Array<[string, string]> = [
    [t(locale, 'common.commandSearchTitle'), 'Ctrl / ⌘ + K'],
    [t(locale, 'common.shortcutSaveDraft'), 'Ctrl / ⌘ + S'],
    [t(locale, 'common.shortcutUndo'), 'Ctrl / ⌘ + Z'],
    [t(locale, 'common.shortcutRedo'), 'Ctrl / ⌘ + Shift + Z · Ctrl / ⌘ + Y'],
    [t(locale, 'common.shortcutNativeUndo'), t(locale, 'common.shortcutNativeUndoHint')],
    [t(locale, 'common.shortcutSelectNext'), '↑ / ↓'],
    [t(locale, 'common.shortcutTabSwitch'), '← / → · Home / End'],
    [t(locale, 'common.shortcutChartPoint'), 'Tab → Enter'],
    [t(locale, 'common.closeDialog'), 'Esc'],
  ]
  return (
    <ConfirmDialog
      open={open}
      title={t(locale, 'common.shortcutsTitle')}
      confirmLabel={t(locale, 'common.close')}
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
