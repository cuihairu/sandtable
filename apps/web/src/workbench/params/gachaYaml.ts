import type { GachaConfig } from '../../lib/types.ts'

// 抽签(gacha)表单草稿:与 model.gacha 一一对应;featured 两键 0 = 无 UP/无定轨
// (内核 serde default 0 且 ==0.0 时 YAML 省略,写回同样省略,不产生幻影 diff)。
export type GachaDraft = {
  readonly baseRate: number
  readonly pityHard: number
  readonly pitySoftStart: number
  readonly pitySoftStep: number
  readonly featuredRate: number
  readonly featuredGuarantee: number
}

export type GachaIssue = { row: number | null; message: string }
export type GachaReport = { issues: readonly GachaIssue[]; valid: boolean }
export type GachaDiffRow = { field: string; from: number | string; to: number | string }

/** 读取候选 model.gacha;缺段返回 null(不伪造默认半配置)。 */
export function readGacha(yaml: string, parse: (source: string) => Record<string, unknown>): GachaConfig | null {
  if (!yaml.includes('gacha:')) return null
  return (parse(yaml).model as Record<string, GachaConfig | undefined>).gacha ?? null
}

/** 内核缺省(未配置 model.gacha 时的生效值,与 registry 一致)。 */
export function defaultGacha(): GachaDraft {
  return { baseRate: 0.02, pityHard: 0, pitySoftStart: 0, pitySoftStep: 0, featuredRate: 0, featuredGuarantee: 0 }
}

export function gachaDraft(config: GachaConfig | null): GachaDraft {
  if (!config) return defaultGacha()
  return {
    baseRate: config.base_rate,
    pityHard: config.pity_hard,
    pitySoftStart: config.pity_soft_start,
    pitySoftStep: config.pity_soft_step,
    featuredRate: config.featured_rate ?? 0,
    featuredGuarantee: config.featured_guarantee ?? 0,
  }
}

export function draftGacha(draft: GachaDraft): GachaConfig {
  // featured 键 0 时省略:与内核 skip_serializing_if 同约定,避免 0 值键污染 YAML。
  const config: GachaConfig = {
    base_rate: draft.baseRate,
    pity_hard: draft.pityHard,
    pity_soft_start: draft.pitySoftStart,
    pity_soft_step: draft.pitySoftStep,
  }
  if (draft.featuredRate > 0) config.featured_rate = draft.featuredRate
  if (draft.featuredGuarantee > 0) config.featured_guarantee = draft.featuredGuarantee
  return config
}

export function gachaToYaml(draft: GachaDraft): string {
  const config = draftGacha(draft)
  const lines = [
    'model:', '  gacha:', `    base_rate: ${config.base_rate}`, `    pity_hard: ${config.pity_hard}`,
    `    pity_soft_start: ${config.pity_soft_start}`, `    pity_soft_step: ${config.pity_soft_step}`,
  ]
  if (config.featured_rate !== undefined) lines.push(`    featured_rate: ${config.featured_rate}`)
  if (config.featured_guarantee !== undefined) lines.push(`    featured_guarantee: ${config.featured_guarantee}`)
  return lines.join('\n')
}

/** 前端预检:与内核单抽公式同口径(base_rate>0;pity 计数非负整数;step 有限非负;
 * featured_rate∈[0,1];定轨需要 UP 配套)。内核精校仍走 kernelCheck。 */
export function reviewGacha(draft: GachaDraft): GachaReport {
  const issues: GachaIssue[] = []
  if (!Number.isFinite(draft.baseRate) || draft.baseRate <= 0) issues.push({ row: 1, message: 'base_rate 必须大于 0 且有限' })
  else if (draft.baseRate > 1) issues.push({ row: 1, message: 'base_rate 不能大于 1(是概率)' })
  const countCheck = (row: number, label: string, value: number): void => {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
      issues.push({ row, message: `${label} 必须为非负整数` })
    }
  }
  countCheck(2, 'pity_hard', draft.pityHard)
  countCheck(3, 'pity_soft_start', draft.pitySoftStart)
  countCheck(4, 'featured_guarantee', draft.featuredGuarantee)
  if (!Number.isFinite(draft.pitySoftStep) || draft.pitySoftStep < 0) {
    issues.push({ row: 3, message: 'pity_soft_step 必须为非负有限数值' })
  }
  if (!Number.isFinite(draft.featuredRate) || draft.featuredRate < 0 || draft.featuredRate > 1) {
    issues.push({ row: 5, message: 'featured_rate 必须在 [0, 1] 内' })
  }
  if (draft.featuredGuarantee > 0 && !(draft.featuredRate > 0)) {
    issues.push({ row: 5, message: '定轨(featured_guarantee)需要配套 featured_rate > 0' })
  }
  return { issues, valid: issues.length === 0 }
}

/** 语义 diff:featured 键 omit-when-0,缺失键当 0 比,不产生幻影 diff。 */
export function gachaDiff(base: GachaConfig | null, next: GachaDraft): GachaDiffRow[] {
  const candidate = draftGacha(next)
  const fields = ['base_rate', 'pity_hard', 'pity_soft_start', 'pity_soft_step', 'featured_rate', 'featured_guarantee'] as const
  const diffs: GachaDiffRow[] = []
  for (const key of fields) {
    // 缺失键当 0 比(featured omit-when-0 与内核缺省一致),不产生幻影 diff
    const from = base?.[key] ?? 0
    const to = candidate[key] ?? 0
    if (from !== to) diffs.push({ field: key, from, to })
  }
  return diffs
}
