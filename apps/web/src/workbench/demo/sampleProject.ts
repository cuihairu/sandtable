// WB-02.02~09 组件当前挂接的数据源:内置合成演示项目。
// 红线:这不是真实运行产物——data_source 一律 synthetic_demo,统计区间是
// 演示用对称区间(illustrative_symmetric_interval),组件界面必须保留
// 来源标注(WB-03 接真实内核后替换为真实结果适配器)。
// 参数路径/类型/基线值逐字取自本仓 crates/sandtable-core 参数注册表
// (registry.rs),分组只做 UI 组织。IDs 全部走 WB-02.10 标识体系。
import { candidateIdFor, hashId, ID_PREFIXES, runIdFor } from '../ids.ts'
import type { Baseline, BaselineId, CandidateId, ExperimentId, ProjectId, RunId } from '../ids.ts'

export const DATA_SOURCE = 'synthetic_demo'

/* —— 参数定义(注册表样例) —— */
export type ParamDef = {
  id: string
  type: string
  base: number
  name: string
  group: string
}

const PARAM_ROWS: Array<[string, string, number, string, string]> = [
  ['model.warrior.attack', 'i64', 100, '初始攻击力', '角色'],
  ['model.warrior.defense', 'i64', 80, '初始防御', '角色'],
  ['model.warrior.hp', 'i64', 1000, '初始生命', '角色'],
  ['model.combat.p_hit', 'f64', 0.85, '玩家命中概率', '战斗'],
  ['model.combat.p_hit_monster', 'f64', 0.85, '怪物命中概率', '战斗'],
  ['model.combat.dmg_var', 'i64', 10, '伤害浮动半宽', '战斗'],
  ['model.combat.max_rounds', 'u32', 32, '最大战斗轮数', '战斗'],
  ['model.dungeon.m_hp', 'i64', 300, '第 0 层怪物生命', '副本'],
  ['model.dungeon.m_attack', 'i64', 45, '第 0 层怪物攻击', '副本'],
  ['model.dungeon.m_defense', 'i64', 20, '第 0 层怪物防御', '副本'],
  ['model.dungeon.tier_growth', 'f64', 1.5, '每层怪物数值倍率', '副本'],
  ['model.dungeon.reward_gold', 'i64', 40, '第 0 层金币产出', '副本'],
  ['model.dungeon.reward_xp', 'i64', 45, '第 0 层经验产出', '副本'],
  ['model.progression.xp_base', 'i64', 60, '升级经验基数', '成长'],
  ['model.progression.xp_pow', 'f64', 1.3, '升级经验指数', '成长'],
  ['model.churn.p_base', 'f64', 0.003, '正常日流失概率', '流失'],
  ['model.churn.p_stall', 'f64', 0.05, '停滞日流失概率', '流失'],
  ['model.churn.stall_days', 'u32', 2, '连续无增长天数判停滞', '流失'],
]

export const PARAM_DEFS: readonly ParamDef[] = PARAM_ROWS.map(([id, type, base, name, group]) => ({
  id, type, base, name, group,
}))

export const PARAM_GROUPS = [...new Set(PARAM_DEFS.map((p) => p.group))]
export type ParamValues = Record<string, number>

/* —— 演示项目 / 基线 / 实验(内容派生稳定 ID) —— */
export const DEMO_PROJECT_ID = hashId(ID_PREFIXES.project, 'rpg-balance-lab') as ProjectId
export const DEMO_BASELINE_ID = hashId(ID_PREFIXES.baseline, DEMO_PROJECT_ID, 'registry-default') as BaselineId
export const DEMO_EXPERIMENT_ID = hashId(ID_PREFIXES.experiment, DEMO_PROJECT_ID, 'attack-scan') as ExperimentId
export const DEMO_RUN_ID = runIdFor({
  experimentId: DEMO_EXPERIMENT_ID,
  configHash: 'synthetic-demo-config-hash',
  seed: 42,
  modelVersion: 'demo-model',
  schemaVersion: 'demo-schema',
})
export const DEMO_BASELINE: Baseline = {
  id: DEMO_BASELINE_ID,
  projectId: DEMO_PROJECT_ID,
  name: '注册表默认基线',
  readonly: true,
}
export const DEFAULT_VALUES: ParamValues = Object.fromEntries(
  PARAM_DEFS.map((p) => [p.id, p.base]),
)

/* —— 观察指标与扫描候选(合成) —— */
export type MetricKey = 'win' | 'retention' | 'gold'
export type MetricDef = {
  key: MetricKey
  label: string
  id: string
  unit: string
  min: number
  max: number
  target: number
  op: '≥' | '≤'
  base: number
  ci: number
  decimals: number
}

export const METRICS: Record<MetricKey, MetricDef> = {
  win: { key: 'win', label: '战斗胜率', id: 'win_rate', unit: '%', min: 50, max: 80, target: 65, op: '≥', base: 64.3, ci: 0.8, decimals: 1 },
  retention: { key: 'retention', label: 'D7 留存率', id: 'retention_d7', unit: '%', min: 34, max: 52, target: 42, op: '≥', base: 40.7, ci: 0.6, decimals: 1 },
  gold: { key: 'gold', label: '人均金币产出', id: 'gold_per_player', unit: '', min: 1500, max: 2900, target: 2400, op: '≤', base: 2084, ci: 55, decimals: 0 },
}

export const METRIC_KEYS: readonly MetricKey[] = ['win', 'retention', 'gold']

export type DemoCandidate = {
  id: CandidateId
  paramPath: string
  paramValue: number
  win: number
  retention: number
  gold: number
  replicates: number
}

const CANDIDATE_ROWS: Array<[number, number, number, number]> = [
  [80, 54.2, 36.8, 1680], [85, 56.8, 37.6, 1760], [90, 59.7, 38.9, 1860], [95, 62.1, 39.7, 1970],
  [100, 64.3, 40.7, 2084], [105, 66.1, 42.1, 2180], [110, 68.4, 44.6, 2280], [115, 69.5, 45.2, 2380],
  [120, 70.9, 46.1, 2480], [125, 71.7, 46.7, 2580], [130, 72.3, 47.1, 2690],
]

/** 演示扫描参数域:除 attack 外其余与基线相同(单参数 Grid 观测)。 */
export function demoCandidateValues(attack: number): ParamValues {
  return { ...DEFAULT_VALUES, 'model.warrior.attack': attack }
}

export type ScanResultView = {
  experimentId: ExperimentId
  runId: RunId
  method: 'grid'
  range: { min: number; max: number; step: number }
  candidates: readonly DemoCandidate[]
}

export const DEMO_RESULT: ScanResultView = {
  experimentId: DEMO_EXPERIMENT_ID,
  runId: DEMO_RUN_ID,
  method: 'grid',
  range: { min: 80, max: 130, step: 5 },
  candidates: CANDIDATE_ROWS.map(([attack, win, retention, gold]) => ({
    id: candidateIdFor(DEMO_BASELINE_ID, demoCandidateValues(attack)),
    paramPath: 'model.warrior.attack',
    paramValue: attack,
    win, retention, gold,
    replicates: 20,
  })),
}

/* —— 判定 / 筛选 / 排序(纯函数,组件与测试共用) —— */
export type Verdict = 'pass' | 'border' | 'fail'
export type MetricValues = Record<MetricKey, number>

export function verdictFor(value: number, key: MetricKey): Verdict {
  const m = METRICS[key]
  const spread = m.ci
  if (m.op === '≥') {
    return value - spread >= m.target ? 'pass' : value + spread >= m.target ? 'border' : 'fail'
  }
  return value + spread <= m.target ? 'pass' : value - spread <= m.target ? 'border' : 'fail'
}

export function verdictOf(c: MetricValues): Verdict {
  const vs = METRIC_KEYS.map((k) => verdictFor(c[k], k))
  return vs.includes('fail') ? 'fail' : vs.includes('border') ? 'border' : 'pass'
}

export const VERDICT_LABEL: Record<Verdict, string> = { pass: '通过', border: '临界', fail: '未通过' }

export type CandidateSortKey = 'paramValue' | MetricKey | 'verdict'

export function filterAndSort(
  rows: readonly DemoCandidate[],
  opts: { filterVerdict: 'all' | Verdict; sortKey: CandidateSortKey; sortDir: 1 | -1 },
): DemoCandidate[] {
  const filtered = rows.filter(
    (c) => opts.filterVerdict === 'all' || verdictOf(c) === opts.filterVerdict,
  )
  const rank: Record<Verdict, number> = { pass: 0, border: 1, fail: 2 }
  return [...filtered].sort((a, b) => {
    const av = opts.sortKey === 'verdict' ? rank[verdictOf(a)] : a[opts.sortKey === 'paramValue' ? 'paramValue' : opts.sortKey]
    const bv = opts.sortKey === 'verdict' ? rank[verdictOf(b)] : b[opts.sortKey === 'paramValue' ? 'paramValue' : opts.sortKey]
    return (av > bv ? 1 : av < bv ? -1 : 0) * opts.sortDir
  })
}

export function metricValues(c: DemoCandidate): MetricValues {
  return { win: c.win, retention: c.retention, gold: c.gold }
}

/** 演示候选 ID 列表(测试与审计用;数组只作容器,不作身份)。 */
export const DEMO_CANDIDATE_IDS_UNIQUE: readonly CandidateId[] = DEMO_RESULT.candidates.map((c) => c.id)

export function fmtMetric(value: number, key: MetricKey): string {
  return value.toFixed(METRICS[key].decimals) + METRICS[key].unit
}

export function ciText(c: DemoCandidate, key: MetricKey): string {
  const ci = METRICS[key].ci
  const d = METRICS[key].decimals
  return `[${(c[key] - ci).toFixed(d)}, ${(c[key] + ci).toFixed(d)}]`
}

export function baselineAttack(): number {
  return DEFAULT_VALUES['model.warrior.attack']
}
