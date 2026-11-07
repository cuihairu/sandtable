import type { ActorBehaviorConfig, BehaviorConfig, TrainingConfig } from '../../lib/types.ts'

// 行为画像表单草稿:三群体 × 会话/动作概率 + 练级产出面。字段缺省回退内核
// 分群默认(内核 PartialActorBehavior 同语义);p_training 0 = 省略(内核
// skip_serializing_if 同约定);training null = 不写产出面(内核缺省 Some{400,150})。

export type BehaviorCohort = 'casual' | 'core' | 'whale'
export type BehaviorGroupDraft = {
  readonly sessionsInt: number
  readonly sessionsFrac: number
  readonly pDungeon: number
  readonly pUpgrade: number
  readonly pTraining: number
}
export type BehaviorDraft = {
  readonly groups: Readonly<Record<BehaviorCohort, BehaviorGroupDraft>>
  readonly training: { readonly xp: number; readonly gold: number } | null
}

export type BehaviorIssue = { row: number | null; message: string }
export type BehaviorReport = { issues: readonly BehaviorIssue[]; valid: boolean }
export type BehaviorDiffRow = { field: string; from: number | string; to: number | string }

export const COHORTS: readonly BehaviorCohort[] = ['casual', 'core', 'whale']

/** 内核分群缺省(config.rs BehaviorConfig::default,部分覆盖时逐字段回退)。 */
export const COHORT_DEFAULTS: Readonly<Record<BehaviorCohort, BehaviorGroupDraft>> = {
  casual: { sessionsInt: 1, sessionsFrac: 0.5, pDungeon: 0.7, pUpgrade: 0.2, pTraining: 0.1 },
  core: { sessionsInt: 2, sessionsFrac: 0.5, pDungeon: 0.6, pUpgrade: 0.3, pTraining: 0.1 },
  whale: { sessionsInt: 5, sessionsFrac: 0.0, pDungeon: 0.65, pUpgrade: 0.3, pTraining: 0.05 },
}

/** 内核缺省产出面(SimConfig::default:Some{xp:400,gold:150})。 */
export function defaultTraining(): { xp: number; gold: number } {
  return { xp: 400, gold: 150 }
}

/** 读取候选 model.behavior;缺段返回 null。部分字段按内核分群缺省回填。 */
export function readBehavior(yaml: string, parse: (source: string) => Record<string, unknown>): BehaviorConfig | null {
  if (!yaml.includes('behavior:')) return null
  const model = (parse(yaml).model ?? {}) as Record<string, BehaviorConfig | undefined>
  if (!model.behavior) return null
  return {
    casual: mergeCohort(model.behavior.casual, 'casual'),
    core: mergeCohort(model.behavior.core, 'core'),
    whale: mergeCohort(model.behavior.whale, 'whale'),
  }
}

/** 读取候选 model.training;缺段返回 null(内核生效值是缺省产出面,不在此伪造)。 */
export function readTraining(yaml: string, parse: (source: string) => Record<string, unknown>): TrainingConfig | null {
  if (!yaml.includes('training:')) return null
  return (parse(yaml).model as Record<string, TrainingConfig | undefined>).training ?? null
}

function mergeCohort(partial: ActorBehaviorConfig | undefined, cohort: BehaviorCohort): ActorBehaviorConfig {
  const base = COHORT_DEFAULTS[cohort]
  const raw: Partial<ActorBehaviorConfig> = partial ?? {}
  return {
    sessions_int: raw.sessions_int ?? base.sessionsInt,
    sessions_frac: raw.sessions_frac ?? base.sessionsFrac,
    p_dungeon: raw.p_dungeon ?? base.pDungeon,
    p_upgrade: raw.p_upgrade ?? base.pUpgrade,
    p_training: raw.p_training ?? base.pTraining,
  }
}

export function behaviorDraft(config: BehaviorConfig | null): BehaviorDraft {
  const toGroup = (cohort: BehaviorCohort): BehaviorGroupDraft => {
    const raw = config?.[cohort] ?? mergeCohort(undefined, cohort)
    return {
      sessionsInt: raw.sessions_int, sessionsFrac: raw.sessions_frac,
      pDungeon: raw.p_dungeon, pUpgrade: raw.p_upgrade, pTraining: raw.p_training ?? 0,
    }
  }
  return {
    groups: { casual: toGroup('casual'), core: toGroup('core'), whale: toGroup('whale') },
    training: null,
  }
}

export function draftBehavior(draft: BehaviorDraft): BehaviorConfig {
  const toConfig = (group: BehaviorGroupDraft): ActorBehaviorConfig => {
    const config: ActorBehaviorConfig = {
      sessions_int: group.sessionsInt,
      sessions_frac: group.sessionsFrac,
      p_dungeon: group.pDungeon,
      p_upgrade: group.pUpgrade,
    }
    if (group.pTraining > 0) config.p_training = group.pTraining
    return config
  }
  return {
    casual: toConfig(draft.groups.casual),
    core: toConfig(draft.groups.core),
    whale: toConfig(draft.groups.whale),
  }
}

/** 候选 YAML 是否已有 model.training 节(行为带 p_training>0 需要产出面配套)。 */
export function hasTrainingSection(yaml: string): boolean {
  return /(^|\n)\s{2}training:/.test(yaml)
}

export function behaviorToYaml(draft: BehaviorDraft): string {
  const config = draftBehavior(draft)
  const groupLines = (cohort: BehaviorCohort): string[] => {
    const group = config[cohort]
    const lines = [
      `    ${cohort}:`,
      `      sessions_int: ${group.sessions_int}`, `      sessions_frac: ${group.sessions_frac}`,
      `      p_dungeon: ${group.p_dungeon}`, `      p_upgrade: ${group.p_upgrade}`,
    ]
    if (group.p_training !== undefined && group.p_training > 0) lines.push(`      p_training: ${group.p_training}`)
    return lines
  }
  const training = draft.training
  const trainingLines = training === null ? [] : [
    '  training:', `    xp: ${training.xp}`, `    gold: ${training.gold}`,
  ]
  return [
    'model:', '  behavior:', ...groupLines('casual'), ...groupLines('core'), ...groupLines('whale'),
    ...trainingLines,
  ].join('\n')
}

/** 前端预检:字段范围(概率∈[0,1]、sessions 合法)、每群动作合计≤1、
 * 练级环耦合(产出面有需行为带用;行为带用需产出面有)。内核精校仍走 kernelCheck。 */
export function reviewBehavior(
  draft: BehaviorDraft,
  candidateHasTraining: boolean,
): BehaviorReport {
  const issues: BehaviorIssue[] = []
  const ratio = (label: string, value: number, row: number): boolean => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      issues.push({ row, message: `${label} 必须在 [0, 1] 内` })
      return false
    }
    return true
  }
  let anyTraining = false
  COHORTS.forEach((cohort, index) => {
    const row = index + 1
    const group = draft.groups[cohort]
    if (!Number.isFinite(group.sessionsInt) || !Number.isSafeInteger(group.sessionsInt) || group.sessionsInt < 0) {
      issues.push({ row, message: `${cohort}.sessions_int 必须为非负整数` })
    }
    ratio(`${cohort}.sessions_frac`, group.sessionsFrac, row)
    if (ratio(`${cohort}.p_dungeon`, group.pDungeon, row)
      && ratio(`${cohort}.p_upgrade`, group.pUpgrade, row)
      && ratio(`${cohort}.p_training`, group.pTraining, row)
      && group.pDungeon + group.pUpgrade + group.pTraining > 1) {
      issues.push({ row, message: `${cohort}: p_dungeon + p_upgrade + p_training 不能超过 1` })
    }
    if (group.pTraining > 0) anyTraining = true
  })
  if (draft.training !== null) {
    for (const field of ['xp', 'gold'] as const) {
      const value = draft.training[field]
      if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
        issues.push({ row: 4, message: `training.${field} 必须为非负整数` })
      }
    }
    if (!anyTraining) issues.push({ row: 4, message: '训练产出面已配置,但三群体 p_training 全为 0(内核会拒绝)' })
  } else if (anyTraining && !candidateHasTraining) {
    issues.push({ row: null, message: '行为带使用 p_training 但候选没有 model.training 节;请在表单里启用训练产出面' })
  }
  return { issues, valid: issues.length === 0 }
}

/** 语义 diff:p_training omit-when-0(缺失当 0 比),不产生幻影 diff。 */
export function behaviorDiff(base: BehaviorConfig | null, next: BehaviorDraft): BehaviorDiffRow[] {
  const candidate = draftBehavior(next)
  const diffs: BehaviorDiffRow[] = []
  const fieldPairs = [
    ['sessions_int', 'sessionsInt'],
    ['sessions_frac', 'sessionsFrac'],
    ['p_dungeon', 'pDungeon'],
    ['p_upgrade', 'pUpgrade'],
    ['p_training', 'pTraining'],
  ] as const
  for (const cohort of COHORTS) {
    for (const [yamlKey] of fieldPairs) {
      const from = base?.[cohort]?.[yamlKey] ?? 0
      const to = candidate[cohort][yamlKey] ?? 0
      if (from !== to) diffs.push({ field: `${cohort}.${yamlKey}`, from, to })
    }
  }
  return diffs
}
