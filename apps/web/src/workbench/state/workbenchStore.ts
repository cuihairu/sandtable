// WB-02.11 · 工作台共享状态(单 reducer + 订阅),按四类分区:
// - 输入草稿:paramDraft(演示候选)/ objectDrafts(项目对象)/ design+designDirty;
// - 运行快照:runs(提交时不可变输入快照,WB-04.09);
// - 已完成结果:runArtifacts(键 = 归档内产物路径,WB-04.08);
// - 当前选择与页内 UI 状态:page/selection/metric/filter/sort/inspector…
//   (WB-02.12:筛选/排序/激活 KPI/候选选择/检查器开关不进实验输入)。
// 全部变更走 WorkbenchAction 显式动作;分区不污染由
// tests/workbench-store.test.mjs 锁定。运行管理器在 state/runManager.ts
// (独立于本 store,切页不卸载)。
import {
  DEMO_RESULT,
  DEMO_BASELINE_ID,
} from '../demo/sampleProject.ts'
import type { CandidateSortKey, MetricKey } from '../demo/sampleProject.ts'
import { candidateIdFor } from '../ids.ts'
import type { CandidateId } from '../ids.ts'
import { DEFAULT_PAGE, pageDef, formatHash, parseHash } from '../routing.ts'
import type { PageId } from '../routing.ts'
import type { DesignDraft } from '../designer/designerLogic.ts'
import { defaultDesign } from '../designer/designerLogic.ts'
// WB-05 · 参数表数据源:注册表 × 配置 YAML(纯逻辑,见 params/)
import { applyParamEdit, applyParamEdits, buildDefaultYaml, numericValuesOf, parseConfig, readText, removeParam } from '../params/configYaml.ts'
import { formatScalar, modifiedPaths } from '../params/paramsLogic.ts'
// WB-04 · 项目文档层:打开/保存/草稿/运行快照(纯逻辑,见 projectDoc.ts)
import {
  baseContentOf, baselineOfProject, draftOf, markSaved, persistObjectDrafts, restoreObjectDrafts, resetDraft, undoDraft, redoDraft, unsavedKeys, writeDraft,
} from './projectDoc.ts'
import type { DraftMap, ProjectDoc, RunIndexEntry } from './projectDoc.ts'

export const DRAFT_STORAGE_KEY = 'sandtable-workbench-v2-react'

export type WorkbenchState = {
  page: PageId
  /** 深链恢复的各页选择(render 从这里读,组件不各自持有全局状态) */
  selection: Record<string, string>
  explorerCollapsed: boolean
  inspectorOpen: boolean
  /** 任务抽屉(状态栏/独立于页面) */
  drawerOpen: boolean
  /** WB-05 · 参数候选文档(演示模式的候选 YAML + 撤销/重做历史;
   * 项目模式候选 = objectDrafts[scenario],见 paramYamlView) */
  paramDraft: {
    yaml: string
    saved: boolean
    history: readonly string[]
    future: readonly string[]
  }
  /** WB-05.14 · 保存/运行时冻结的已校验配置版本(单元格后续编辑不影响它) */
  paramFrozen: { yaml: string; configHash: string; at: number } | null
  /** WB-05.07 · 最近一次内核完整校验失败(定位路径 + 原始错误详情) */
  paramKernelError: { path: string | null; message: string } | null
  /** WB-04 · 打开的项目文档(null = 内置演示项目) */
  project: ProjectDoc | null
  /** WB-04.06 · 按对象(归档路径)隔离的项目配置草稿,切换对象互不覆盖 */
  objectDrafts: DraftMap
  /** WB-04.08/09 · 已登记的运行快照(提交时不可变快照 + 产物路径) */
  runs: readonly RunIndexEntry[]
  /** 运行产物(键 = 归档内路径 results/<run_id>.<名>) */
  runArtifacts: Readonly<Record<string, string | Uint8Array>>
  /** WB-04.02 · 最近一次打开失败的提示(当前项目未被替换) */
  projectNotice: string | null
  /** 页内选择(筛选/排序/激活 KPI 是 UI 状态,不进实验输入) */
  selectedCandidateId: CandidateId | null
  metric: MetricKey
  resultView: 'chart' | 'table'
  resultFilter: 'all' | 'pass' | 'border' | 'fail'
  sortKey: CandidateSortKey
  sortDir: 1 | -1
  paramSearch: string
  paramGroup: string
  changedOnly: boolean
  /** WB-05.10 · 只看错误(编辑缓冲非法 / 内核校验失败的参数) */
  errorsOnly: boolean
  paramFocusId: string | null
  paramSelected: readonly string[]
  /** 实验设计草稿(切页保留) */
  design: DesignDraft
  designDirty: boolean
}

function initialDesign(): DesignDraft {
  // WB-06 · 默认草稿由 designerLogic 统一定义(注册表默认口径 + 内核模式名)
  return defaultDesign()
}

function initialState(): WorkbenchState {
  // 深链优先:带 #/workbench/... 打开时恢复页面与选择
  const deepLink = parseHash(window.location.hash)
  const page = deepLink?.page ?? DEFAULT_PAGE
  const restored = loadPersistedParamDraft()
  return {
    page,
    selection: deepLink?.selection ?? {},
    explorerCollapsed: false,
    inspectorOpen: true,
    drawerOpen: false,
    paramDraft: restored,
    paramFrozen: null,
    paramKernelError: null,
    selectedCandidateId: null,
    metric: 'win',
    resultView: 'chart',
    resultFilter: 'all',
    sortKey: 'paramValue',
    sortDir: 1,
    paramSearch: '',
    paramGroup: 'all',
    changedOnly: false,
    errorsOnly: false,
    paramFocusId: null,
    paramSelected: [],
    design: initialDesign(),
    designDirty: false,
    project: null,
    objectDrafts: {},
    runs: [],
    runArtifacts: {},
    projectNotice: null,
  }
}

/** 演示模式基线:注册表默认配置(WB-05.01;非运行产物) */
export const DEMO_BASE_YAML: string = buildDefaultYaml()

/** 演示模式初始候选:注册默认 + 原演示草稿的两处偏移(可撤销可恢复)。 */
function initialDemoYaml(): string {
  const applied = applyParamEdits(DEMO_BASE_YAML, [
    { path: 'model.warrior.attack', text: '110' },
    { path: 'model.combat.p_hit', text: '0.88' },
  ])
  return applied.ok ? applied.yaml : DEMO_BASE_YAML
}

function loadPersistedParamDraft(): WorkbenchState['paramDraft'] {
  const empty = { yaml: initialDemoYaml(), saved: true, history: [] as readonly string[], future: [] as readonly string[] }
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as { yaml?: string; values?: Record<string, number> }
    if (typeof parsed.yaml === 'string' && parseConfig(parsed.yaml).errors.length === 0) {
      // 新载荷:候选 YAML 原文
      return { yaml: parsed.yaml, saved: true, history: [], future: [] }
    }
    if (parsed.values) {
      // 旧载荷迁移(WB-02 数值草稿):逐项写到注册默认 YAML 上
      const base = DEMO_BASE_YAML
      const edits = Object.entries(parsed.values)
        .filter(([path, v]) => typeof v === 'number' && Number.isFinite(v) && readText(parseConfig(base), path) !== null)
        .map(([path, v]) => ({ path, text: formatScalar(v) }))
      const applied = applyParamEdits(base, edits)
      if (applied.ok) return { yaml: applied.yaml, saved: true, history: [], future: [] }
    }
    return empty
  } catch {
    // 损坏的本地草稿不能阻止打开工作台
    return empty
  }
}

export function persistDraft(state: WorkbenchState): boolean {
  try {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ yaml: state.paramDraft.yaml, savedAt: Date.now() }),
    )
    return true
  } catch {
    return false
  }
}

/* —— actions —— */
export type WorkbenchAction =
  | { type: 'navigate'; page: PageId; selection?: Record<string, string> }
  | { type: 'selection'; patch: Record<string, string> }
  | { type: 'toggle-explorer' }
  | { type: 'toggle-inspector' }
  | { type: 'toggle-drawer'; open?: boolean }
  // —— WB-05 · 参数表(候选 = YAML 文档;演示/项目两模式统一入口) ——
  /** 写候选 YAML(页面侧用纯函数算好新文档;每次写入 = 一条历史) */
  | { type: 'param/write'; yaml: string }
  | { type: 'param/undo' }
  | { type: 'param/redo' }
  | { type: 'param/save' }
  /** 恢复全部:候选回到基线 YAML(可撤销) */
  | { type: 'param/reset-all' }
  /** 单项恢复基线(基线缺值时删除候选键;可撤销) */
  | { type: 'param/reset-one'; path: string }
  /** 结果页采纳参数值(WB-02.08 adopt;走同一条历史) */
  | { type: 'param/adopt'; path: string; value: number }
  /** WB-05.14 · 冻结已过内核校验的配置版本(保存/运行提交时) */
  | { type: 'param/frozen'; yaml: string; configHash: string }
  /** WB-05.07 · 内核校验失败(定位路径 + 原始详情);null = 清除 */
  | { type: 'param/kernel-error'; error: { path: string | null; message: string } | null }
  | { type: 'param/errors-only'; on: boolean }
  | { type: 'candidate/select'; id: CandidateId | null }
  | { type: 'candidate/metric'; metric: MetricKey }
  | { type: 'candidate/view'; view: 'chart' | 'table' }
  | { type: 'candidate/filter'; filter: WorkbenchState['resultFilter'] }
  | { type: 'candidate/sort'; key: CandidateSortKey }
  | { type: 'param/focus'; id: string | null }
  | { type: 'param/select'; ids: readonly string[] }
  | { type: 'param/search'; search: string }
  | { type: 'param/group'; group: string }
  | { type: 'param/changed-only'; on: boolean }
  | { type: 'design/set'; patch: Partial<DesignDraft> }
  | { type: 'design/reset' }
  // —— WB-04 · 项目打开 / 保存 / 草稿 / 运行快照 ——
  /** 打开成功:替换项目文档并按项目恢复浏览器草稿(WB-04.02/11) */
  | { type: 'project/open'; doc: ProjectDoc; initialDrafts?: DraftMap }
  /** 打开失败:当前项目与草稿原样保留,只记录提示(WB-04.02) */
  | { type: 'project/open-failed'; error: string }
  /** 关闭项目回到演示项目(未保存守卫由 UI 层确认后触发,WB-04.12) */
  | { type: 'project/close' }
  /** 选中项目内对象(场景/实验用归档路径当 ID,不用下标,WB-04.03) */
  | { type: 'object/select'; kind: 'scenario' | 'experiment'; path: string }
  /** 写某对象的配置草稿:只动该键,切换对象不覆盖另一对象(WB-04.06) */
  | { type: 'object/draft'; key: string; content: string }
  | { type: 'object/undo'; key: string }
  /** 关闭文档 / 放弃修改:该对象草稿回到项目文件原文 */
  | { type: 'object/reset'; key: string }
  /** WB-04.10 · 写盘成功后标记保存状态(失败路径绝不触发) */
  | { type: 'project/mark-saved' }
  /** WB-04.09/08 · 登记运行提交时的不可变输入快照与产物路径 */
  | { type: 'run/register'; entry: RunIndexEntry; artifacts?: Record<string, string | Uint8Array> }

/* —— WB-05 · 参数候选 YAML 的统一写入/撤销/重做(演示与项目两模式) —— */

/** 当前参数文档的 YAML 视图:基线 + 候选 + 场景路径(项目模式)。 */
export function paramYamlView(state: WorkbenchState): {
  base: string
  cand: string
  scenarioPath: string | null
} {
  const doc = state.project
  if (doc) {
    const scenarioPath = state.selection.scenario
    if (scenarioPath && doc.objects.some((o) => o.path === scenarioPath && o.kind === 'scenario')) {
      const base = baseContentOf(doc, scenarioPath)
      return { base, cand: draftOf(state.objectDrafts, scenarioPath, base).content, scenarioPath }
    }
  }
  return { base: DEMO_BASE_YAML, cand: state.paramDraft.yaml, scenarioPath: null }
}

/** 写候选 YAML:演示模式走 paramDraft;项目模式写穿到对象草稿(同一历史)。
 * WB-05.14:冻结版本是提交时刻的独立拷贝,后续单元格编辑不影响它
 * (只有下一次保存/运行重新冻结,或换场景/关项目时失效)。 */
function writeParamYaml(state: WorkbenchState, nextYaml: string): WorkbenchState {
  const view = paramYamlView(state)
  if (nextYaml === view.cand) return state
  if (state.project && view.scenarioPath) {
    return {
      ...state,
      objectDrafts: writeDraft(state.objectDrafts, view.scenarioPath, view.base, nextYaml),
    }
  }
  return {
    ...state,
    paramDraft: {
      yaml: nextYaml,
      saved: false,
      history: [...state.paramDraft.history, state.paramDraft.yaml].slice(-50),
      future: [],
    },
  }
}

function paramUndo(state: WorkbenchState): WorkbenchState {
  if (state.project) {
    const view = paramYamlView(state)
    if (!view.scenarioPath) return state
    return { ...state, objectDrafts: undoDraft(state.objectDrafts, view.scenarioPath, view.base) }
  }
  if (state.paramDraft.history.length === 0) return state
  const history = [...state.paramDraft.history]
  const yaml = history.pop() as string
  return {
    ...state,
    paramDraft: {
      yaml,
      saved: false,
      history,
      future: [state.paramDraft.yaml, ...state.paramDraft.future].slice(0, 50),
    },
  }
}

function paramRedo(state: WorkbenchState): WorkbenchState {
  if (state.project) {
    const view = paramYamlView(state)
    if (!view.scenarioPath) return state
    return { ...state, objectDrafts: redoDraft(state.objectDrafts, view.scenarioPath, view.base) }
  }
  if (state.paramDraft.future.length === 0) return state
  const future = [...state.paramDraft.future]
  const yaml = future.shift() as string
  return {
    ...state,
    paramDraft: {
      yaml,
      saved: false,
      history: [...state.paramDraft.history, state.paramDraft.yaml].slice(-50),
      future,
    },
  }
}

export function reduce(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'navigate': {
      const selection = { ...state.selection, ...action.selection }
      // 切页丢弃已失效选择键?保留各页键——切回来时位置仍在(WB-02.04)
      if (window.location.hash !== formatHash({ page: action.page, selection })) {
        window.history.replaceState(null, '', formatHash({ page: action.page, selection }))
      }
      return { ...state, page: action.page, selection }
    }
    case 'selection':
      return { ...state, selection: { ...state.selection, ...action.patch } }
    case 'toggle-explorer':
      return { ...state, explorerCollapsed: !state.explorerCollapsed }
    case 'toggle-inspector':
      return { ...state, inspectorOpen: !state.inspectorOpen }
    case 'toggle-drawer':
      return { ...state, drawerOpen: action.open ?? !state.drawerOpen }
    // —— WB-05 · 参数表(候选 YAML 统一历史:单项/批量/恢复/采纳) ——
    case 'param/write':
      return writeParamYaml(state, action.yaml)
    case 'param/undo':
      return paramUndo(state)
    case 'param/redo':
      return paramRedo(state)
    case 'param/save':
      if (state.project) return state // 项目模式保存状态由 project/mark-saved 承载
      return { ...state, paramDraft: { ...state.paramDraft, saved: true } }
    case 'param/reset-all':
      return { ...writeParamYaml(state, paramYamlView(state).base), paramSelected: [] }
    case 'param/reset-one': {
      const view = paramYamlView(state)
      const parsed = parseConfig(view.cand)
      // 基线有值 → 写回基线文本;基线无值 → 删除候选键(不回退默认值)
      const baselineText = readText(parseConfig(view.base), action.path)
      const outcome = baselineText !== null
        ? applyParamEdit(view.cand, parsed, action.path, baselineText)
        : removeParam(view.cand, parsed, action.path)
      if (!outcome.ok) return state
      return writeParamYaml(state, outcome.yaml)
    }
    case 'param/adopt': {
      const view = paramYamlView(state)
      const outcome = applyParamEdit(view.cand, parseConfig(view.cand), action.path, formatScalar(action.value))
      if (!outcome.ok) return state
      return {
        ...writeParamYaml(state, outcome.yaml),
        paramGroup: 'all',
        paramSearch: '',
        changedOnly: false,
        errorsOnly: false,
        paramFocusId: action.path,
      }
    }
    case 'param/frozen':
      return { ...state, paramFrozen: { yaml: action.yaml, configHash: action.configHash, at: Date.now() } }
    case 'param/kernel-error':
      return { ...state, paramKernelError: action.error }
    case 'param/errors-only':
      return { ...state, errorsOnly: action.on }
    case 'candidate/select':
      return { ...state, selectedCandidateId: action.id }
    case 'candidate/metric':
      return { ...state, metric: action.metric }
    case 'candidate/view':
      return { ...state, resultView: action.view }
    case 'candidate/filter':
      return { ...state, resultFilter: action.filter }
    case 'candidate/sort': {
      if (state.sortKey === action.key) {
        return { ...state, sortDir: state.sortDir === 1 ? -1 : 1 }
      }
      return { ...state, sortKey: action.key, sortDir: 1 }
    }
    case 'param/focus':
      return { ...state, paramFocusId: action.id }
    case 'param/select':
      return { ...state, paramSelected: action.ids }
    case 'param/search':
      return { ...state, paramSearch: action.search }
    case 'param/group':
      return { ...state, paramGroup: action.group }
    case 'param/changed-only':
      return { ...state, changedOnly: action.on }
    case 'design/set':
      return { ...state, design: { ...state.design, ...action.patch }, designDirty: true }
    case 'design/reset':
      return { ...state, design: initialDesign(), designDirty: false }
    case 'project/open': {
      // 换项目:草稿按新项目恢复(projectId 不一致一律丢弃,防串数据 WB-04.11);
      // 选区回到路径序首个场景/实验(稳定路径当 ID,不用下标)。
      // 上一项目的浏览器草稿记录保留——重开同一项目时仍可恢复(WB-04.12 恢复动作)。
      const first = (kind: 'scenario' | 'experiment') =>
        action.doc.objects.find((o) => o.kind === kind)?.path ?? null
      const selection = {
        ...state.selection,
        scenario: first('scenario') ?? '',
        experiment: first('experiment') ?? '',
      }
      return {
        ...state,
        project: action.doc,
        // 持久草稿优先(重开同一项目);无记录时用调用方给的起始草稿
        // (如 YAML 新建草稿 = 未保存起笔),都没有则空
        objectDrafts: ((): DraftMap => {
          const restored = restoreObjectDrafts(window.localStorage, action.doc)
          return Object.keys(restored).length > 0 ? restored : action.initialDrafts ?? {}
        })(),
        runs: [],
        runArtifacts: {},
        projectNotice: null,
        selection,
      }
    }
    case 'project/open-failed':
      return { ...state, projectNotice: action.error }
    case 'project/close':
      return {
        ...state,
        project: null, objectDrafts: {}, runs: [], runArtifacts: {}, projectNotice: null,
        // 冻结版本属于已关闭项目(WB-05.14)
        paramFrozen: null, paramKernelError: null,
      }
    case 'object/select':
      return {
        ...state,
        selection: { ...state.selection, [action.kind]: action.path },
        // 换对象:参数冻结版本属于前一场景的提交时刻,不再适用(WB-05.14)
        paramFrozen: null,
        paramKernelError: null,
      }
    case 'object/draft':
      if (!state.project) return state
      return {
        ...state,
        objectDrafts: writeDraft(state.objectDrafts, action.key, baseContentOf(state.project, action.key), action.content),
      }
    case 'object/undo':
      if (!state.project) return state
      return {
        ...state,
        objectDrafts: undoDraft(state.objectDrafts, action.key, baseContentOf(state.project, action.key)),
      }
    case 'object/reset':
      return {
        ...state,
        objectDrafts: resetDraft(state.objectDrafts, action.key),
      }
    case 'project/mark-saved':
      return { ...state, objectDrafts: markSaved(state.objectDrafts, Object.keys(state.objectDrafts)) }
    case 'run/register':
      return {
        ...state,
        runs: state.runs.some((r) => r.run_id === action.entry.run_id)
          ? state.runs
          : [...state.runs, action.entry],
        runArtifacts: { ...state.runArtifacts, ...action.artifacts },
      }
    default:
      return state
  }
}

/* —— 响应式 store(useSyncExternalStore 适配) —— */
let state = initialState()
const listeners = new Set<() => void>()

export function getState(): WorkbenchState {
  return state
}

export function dispatch(action: WorkbenchAction): void {
  state = reduce(state, action)
  // WB-04.11 · 浏览器草稿层与项目文件保存层分开记录:项目配置草稿每次
  // 变更即落本地(按项目隔离);「已保存到项目文件」由 ObjectDraft.saved
  // 单独承载,写盘成功才置位。恢复/清理由 project/open、close 等动作处理。
  if (
    state.project &&
    (action.type === 'project/open' || action.type === 'object/draft' ||
      action.type === 'object/undo' || action.type === 'object/reset' ||
      action.type === 'project/mark-saved')
  ) {
    persistObjectDrafts(window.localStorage, state.project, state.objectDrafts)
  }
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/* —— 文档标签(WB-02.03):打开文档列表由状态派生 —— */
export type OpenDocument = {
  /** 稳定对象 ID(候选/结果集/实验/页面固有文档),不用下标 */
  id: string
  page: PageId
  title: string
  icon: string
  unsaved: boolean
  meta: string
}

export function deriveDocuments(state: WorkbenchState): OpenDocument[] {
  // WB-05 · 候选文档身份 = 基线引用 + 候选 YAML 的参数域(内容寻址不变)
  const view = paramYamlView(state)
  const candValues = numericValuesOf(parseConfig(view.cand))
  const baselineId = state.project && view.scenarioPath
    ? baselineOfProject(state.project, view.scenarioPath).baselineId
    : DEMO_BASELINE_ID
  const changes = modifiedPaths(parseConfig(view.base), parseConfig(view.cand)).length
  return [
    {
      // 候选草稿文档:内容寻址 ID(参数域变 → 文档身份变)
      id: candidateIdFor(baselineId, candValues),
      page: 'parameters',
      title: pageDef('parameters').tab,
      icon: 'file-code',
      unsaved: !state.paramDraft.saved,
      meta: changes > 0 ? `${changes} 项参数变更` : '与基线一致',
    },
    {
      id: String(DEMO_RESULT.runId),
      page: 'analysis',
      title: pageDef('analysis').tab,
      icon: 'chart',
      unsaved: false,
      meta: `${DEMO_RESULT.candidates.length} 候选 · 20 replicates`,
    },
    {
      id: 'designer:design-draft',
      page: 'designer',
      title: pageDef('designer').tab,
      icon: 'flask',
      unsaved: state.designDirty,
      meta: '实验草稿',
    },
    {
      id: 'page:runs',
      page: 'runs',
      title: pageDef('runs').tab,
      icon: 'terminal',
      unsaved: false,
      meta: '任务队列',
    },
    {
      id: 'page:exchange',
      page: 'exchange',
      title: pageDef('exchange').tab,
      icon: 'exchange',
      unsaved: false,
      meta: '数据交换',
    },
  ]
}

/* —— WB-04 · 项目打开状态的派生(纯函数,WorkbenchApp 与测试共用) —— */

/** 是否存在任何未保存工作(项目草稿 / 参数草稿 / 实验草稿;WB-04.12 守卫依据)。 */
export function hasUnsavedWork(state: WorkbenchState): boolean {
  return unsavedKeys(state.objectDrafts).length > 0 || !state.paramDraft.saved || state.designDirty
}

export type ExplorerGroupView = {
  id: string
  title: string
  resources: Array<{
    id: string
    page: PageId
    icon: string
    title: string
    meta?: string
    dirty?: boolean
    /** 选中对象路径(scenario/experiment;选择用路径不用下标,WB-04.03) */
    objectKind?: 'scenario' | 'experiment' | 'result'
  }>
  open?: boolean
}

/** 打开的项目 → 项目浏览器分组:scenario/experiment/result 全量映射(WB-04.03/04)。 */
export function explorerGroupsFor(state: WorkbenchState): ExplorerGroupView[] | null {
  const doc = state.project
  if (!doc) return null
  const dirtyMeta = (path: string): { meta: string; dirty?: boolean } => {
    const d = state.objectDrafts[path]
    const base = baseContentOf(doc, path)
    if (d && d.content !== base) {
      return { meta: d.saved ? '已修改 · 已保存' : '已修改 · 未保存', dirty: !d.saved }
    }
    return { meta: '与项目文件一致' }
  }
  const groups: ExplorerGroupView[] = []
  const scenarios = doc.objects.filter((o) => o.kind === 'scenario')
  const experiments = doc.objects.filter((o) => o.kind === 'experiment')
  const results = doc.objects.filter((o) => o.kind === 'result')
  groups.push({
    id: 'config',
    title: '模型与配置(场景)',
    open: true,
    resources: scenarios.map((o) => ({
      id: o.path,
      page: 'designer' as PageId,
      icon: 'sliders',
      title: o.name,
      objectKind: 'scenario' as const,
      ...dirtyMeta(o.path),
    })),
  })
  groups.push({
    id: 'experiments',
    title: '实验配置',
    open: true,
    resources: experiments.map((o) => ({
      id: o.path,
      page: 'designer' as PageId,
      icon: 'flask',
      title: o.name,
      objectKind: 'experiment' as const,
      ...dirtyMeta(o.path),
    })),
  })
  groups.push({
    id: 'results',
    title: '已保存结果',
    open: true,
    resources: results.map((o) => {
      const st = doc.resultStatus[o.path]
      const meta = st?.state === 'unknown-version'
        ? `未知版本 ${st.version}`
        : st?.state === 'known' ? `report schema ${st.version}` : '产物'
      return {
        id: o.path,
        page: 'analysis' as PageId,
        icon: 'chart',
        title: o.name,
        meta,
        objectKind: 'result' as const,
      }
    }),
  })
  return groups
}
