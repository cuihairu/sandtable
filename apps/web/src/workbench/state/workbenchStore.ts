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
