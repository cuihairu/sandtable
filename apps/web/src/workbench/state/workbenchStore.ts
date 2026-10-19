// WB-02.03/02.11 前 · 工作台共享状态(单 reducer + 订阅)。
// 职责范围(本批):
// - 各页面当前位置(WB-02.04 深链恢复的来源);
// - 候选参数草稿与撤销历史(WB-02.06 编辑安全:基线只读、可撤销、
//   未保存状态可被文档标签显示);
// - 文档标签的打开文档列表与未保存状态(WB-02.03);
// - 运行管理器在 state/RunManager.ts(独立于本 store,切页不卸载)。
// WB-02.11 将把这里明确细化为"输入草稿 / 运行快照 / 已完成结果 / 当前选择",
// 本批先保证组件有单一可信来源可用。
import {
  DEMO_RESULT, DEFAULT_VALUES, PARAM_DEFS,
  DEMO_BASELINE_ID, DEMO_EXPERIMENT_ID,
} from '../demo/sampleProject.ts'
import type { MetricKey, MetricValues, ParamValues } from '../demo/sampleProject.ts'
import { candidateIdFor } from '../ids.ts'
import type { CandidateId } from '../ids.ts'
import { DEFAULT_PAGE, pageDef, formatHash, parseHash } from '../routing.ts'
import type { PageId } from '../routing.ts'
import type { DesignDraft } from '../designer/designerLogic.ts'
import { bulkMultiply } from '../params/paramsLogic.ts'
import type { CandidateSortKey } from '../demo/sampleProject.ts'
// WB-04 · 项目文档层:打开/保存/草稿/运行快照(纯逻辑,见 projectDoc.ts)
import {
  baseContentOf, markSaved, persistObjectDrafts, restoreObjectDrafts, resetDraft, undoDraft, unsavedKeys, writeDraft,
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
  /** 参数草稿(候选方案 A) */
  draft: {
    values: ParamValues
    saved: boolean
    history: ParamValues[]
  }
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
  paramFocusId: string | null
  paramSelected: readonly string[]
  /** 实验设计草稿(切页保留) */
  design: DesignDraft
  designDirty: boolean
}

function initialDesign(): DesignDraft {
  return {
    name: '初始攻击力扫描',
    method: 'grid',
    min: 80,
    max: 130,
    step: 5,
    samples: 24,
    reps: 20,
    players: 10000,
    days: 30,
    paired: true,
    sampling: 'lhc',
    thresholds: { win: 65, retention: 42, gold: 2400 } satisfies MetricValues,
  }
}

function initialState(): WorkbenchState {
  // 深链优先:带 #/workbench/... 打开时恢复页面与选择
  const deepLink = parseHash(window.location.hash)
  const page = deepLink?.page ?? DEFAULT_PAGE
  const restored = loadPersistedDraft()
  return {
    page,
    selection: deepLink?.selection ?? {},
    explorerCollapsed: false,
    inspectorOpen: true,
    drawerOpen: false,
    draft: restored,
    selectedCandidateId: null,
    metric: 'win',
    resultView: 'chart',
    resultFilter: 'all',
    sortKey: 'paramValue',
    sortDir: 1,
    paramSearch: '',
    paramGroup: 'all',
    changedOnly: false,
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

function loadPersistedDraft(): WorkbenchState['draft'] {
  const empty = { values: { ...DEFAULT_VALUES, 'model.warrior.attack': 110, 'model.combat.p_hit': 0.88 }, saved: true, history: [] as ParamValues[] }
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return empty
    const parsed = JSON.parse(raw) as { values?: ParamValues }
    const values: ParamValues = { ...empty.values }
    if (parsed.values) {
      for (const def of PARAM_DEFS) {
        const v = parsed.values[def.id]
        if (typeof v === 'number' && Number.isFinite(v)) values[def.id] = v
      }
    }
    return { values, saved: true, history: [] }
  } catch {
    // 损坏的本地草稿不能阻止打开工作台
    return empty
  }
}

export function persistDraft(state: WorkbenchState): boolean {
  try {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ values: state.draft.values, savedAt: Date.now() }),
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
  | { type: 'draft/set'; id: string; value: number }
  | { type: 'draft/undo' }
  | { type: 'draft/save' }
  | { type: 'draft/reset-all' }
  | { type: 'draft/bulk'; factor: number; ids: readonly string[] }
  | { type: 'draft/adopt'; attack: number }
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

function withHistory(state: WorkbenchState, next: ParamValues): WorkbenchState {
  return {
    ...state,
    draft: {
      values: next,
      saved: false,
      history: [...state.draft.history, state.draft.values].slice(-50),
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
    case 'draft/set': {
      const next = { ...state.draft.values, [action.id]: action.value }
      const contaminated = state.paramSelected.includes(action.id)
        ? state.paramSelected.filter((pid) => pid !== action.id)
        : state.paramSelected
      return { ...withHistory(state, next), paramSelected: contaminated, paramFocusId: action.id }
    }
    case 'draft/undo': {
      if (state.draft.history.length === 0) return state
      const history = [...state.draft.history]
      const values = history.pop() as ParamValues
      return { ...state, draft: { values, saved: false, history } }
    }
    case 'draft/save':
      return { ...state, draft: { ...state.draft, saved: true } }
    case 'draft/reset-all':
      return { ...withHistory(state, { ...DEFAULT_VALUES }), paramSelected: [] }
    case 'draft/bulk': {
      const result = bulkMultiply(PARAM_DEFS, state.draft.values, action.ids, action.factor)
      if (!result.ok) return state
      return { ...withHistory(state, result.next), paramSelected: [] }
    }
    case 'draft/adopt': {
      const id = 'model.warrior.attack'
      return {
        ...withHistory(state, { ...state.draft.values, [id]: action.attack }),
        paramGroup: 'all',
        paramSearch: '',
        changedOnly: false,
        paramFocusId: id,
      }
    }
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
      return { ...state, project: null, objectDrafts: {}, runs: [], runArtifacts: {}, projectNotice: null }
    case 'object/select':
      return { ...state, selection: { ...state.selection, [action.kind]: action.path } }
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
  const draftChanges = PARAM_DEFS.filter((p) => state.draft.values[p.id] !== p.base).length
  return [
    {
      // 候选草稿文档:内容寻址 ID(参数域变 → 文档身份变)
      id: candidateIdFor(DEMO_BASELINE_ID, state.draft.values),
      page: 'parameters',
      title: pageDef('parameters').tab,
      icon: 'file-code',
      unsaved: !state.draft.saved,
      meta: draftChanges > 0 ? `${draftChanges} 项参数变更` : '与基线一致',
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
      id: DEMO_EXPERIMENT_ID + ':design-draft',
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
  return unsavedKeys(state.objectDrafts).length > 0 || !state.draft.saved || state.designDirty
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
