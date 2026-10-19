import type { MetricKey } from '../../lib/types.ts'
import type { ResultOrder } from '../../lib/analysisView.ts'
import type { CandidateDraft } from './resultModel.ts'

export type AnalysisState = {
  jobId: string | null
  byJob: Readonly<Record<string, { selectedId: string | null; metric: MetricKey; axis: string; order: ResultOrder; replicate: number; arm: 'base' | 'cand' }>>
  drafts: readonly CandidateDraft[]
  draftPersistenceError: string | null
}
export const CANDIDATE_DRAFTS_KEY = 'sandtable-wb08-candidate-drafts-v1'
function restoreDrafts(): CandidateDraft[] {
  try {
    if (typeof window === 'undefined') return []
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CANDIDATE_DRAFTS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((d): d is CandidateDraft => d && typeof d.id === 'string' && typeof d.yaml === 'string'
      && typeof d.baselineId === 'string' && typeof d.baselineYaml === 'string'
      && typeof d.sourceRunId === 'string' && typeof d.sourceCandidateId === 'string'
      && typeof d.values === 'object' && d.values !== null)
  } catch { return [] }
}
let state: AnalysisState = { jobId: null, byJob: {}, drafts: restoreDrafts(), draftPersistenceError: null }
const listeners = new Set<() => void>()
export const analysisSnapshot = (): AnalysisState => state
export const subscribeAnalysis = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const defaultResultUI = { selectedId: null, metric: 'win_rate' as MetricKey, axis: '', order: { filter: 'all', by: 'index', dir: 1 } as ResultOrder, replicate: 0, arm: 'base' as const }
export function setAnalysisJob(jobId: string): void { state = { ...state, jobId }; emit() }
export function patchResultUI(jobId: string, patch: Partial<AnalysisState['byJob'][string]>): void {
  state = { ...state, byJob: { ...state.byJob, [jobId]: { ...(state.byJob[jobId] ?? defaultResultUI), ...patch } } }; emit()
}
export function addCandidateDraft(draft: CandidateDraft): void { state = { ...state, drafts: [...state.drafts, draft] }; persistDrafts(); emit() }
export function editCandidateDraft(id: string, yaml: string): void {
  state = { ...state, drafts: state.drafts.map((d) => d.id === id ? { ...d, yaml } : d) }; persistDrafts(); emit()
}
function persistDrafts(): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(CANDIDATE_DRAFTS_KEY, JSON.stringify(state.drafts)); state = { ...state, draftPersistenceError: null } }
  catch { state = { ...state, draftPersistenceError: '草稿暂存失败，当前仅保留在会话中；请下载方案与来源 JSON。' } }
}
function emit(): void { for (const listener of listeners) listener() }
