import { applyStageRules, readStageRules } from './configYaml.ts'
import type { StageRuleRow } from './configYaml.ts'
export const STAGE_RULES_PATH = 'model.stage_rules'
export type { StageRuleRow }

export type StageRuleIssue = {
  readonly row: number | null
  readonly message: string
}

export type StageRuleReport = {
  readonly issues: readonly StageRuleIssue[]
  readonly valid: boolean
}

export type StageRuleDiff = {
  readonly index: number
  readonly field: 'from' | 'to' | 'effect' | 'chance'
  readonly from: number | string
  readonly to: number | string
}

export function reviewStageRules(rows: readonly StageRuleRow[]): StageRuleReport {
  const issues: StageRuleIssue[] = []
  if (rows.length === 0) issues.push({ row: null, message: '至少需要 1 条阶段规则' })
  const fromValues = new Set<number>()
  rows.forEach((row, index) => {
    const number = index + 1
    if (!Number.isSafeInteger(row.from) || row.from < 1 || row.from > 63) {
      issues.push({ row: number, message: 'from 必须是 1–63 的安全整数' })
    } else if (fromValues.has(row.from)) {
      issues.push({ row: number, message: `from 重复:${row.from}` })
    } else fromValues.add(row.from)
    if (row.to.trim() === '') issues.push({ row: number, message: 'to 不能为空' })
    else if (!/^[A-Za-z0-9_-]+$/.test(row.to)) issues.push({ row: number, message: 'to 含 YAML 保留字符' })
    if (!Number.isSafeInteger(row.chance) || row.chance < 0 || row.chance > 100) {
      issues.push({ row: number, message: 'chance 必须是 0–100 的安全整数百分比' })
    }
    if (row.effect.trim() === '') issues.push({ row: number, message: 'effect 不能为空' })
    else if (!/^[A-Za-z0-9_./:-]+$/.test(row.effect)) issues.push({ row: number, message: 'effect 含引号或 YAML 保留字符' })
  })
  return { issues, valid: issues.length === 0 }
}

export function stageRuleDiff(
  base: readonly StageRuleRow[] | null,
  next: readonly StageRuleRow[],
): StageRuleDiff[] {
  const count = Math.max(base?.length ?? 0, next.length)
  const out: StageRuleDiff[] = []
  for (let index = 0; index < count; index++) {
    const before = base?.[index]
    const after = next[index]
    const fields: Array<['from' | 'to' | 'effect' | 'chance', number | string | undefined]> = [
      ['from', before?.from], ['to', before?.to], ['effect', before?.effect], ['chance', before?.chance],
    ]
    for (const [field, value] of fields) {
      const from = value ?? '缺省'
      const to = after ? after[field] : '删除'
      if (from !== to) out.push({ index, field, from, to })
    }
  }
  return out
}

export function stageRuleSummaries(rows: readonly StageRuleRow[]): Array<{
  readonly from: number
  readonly to: string
  readonly chance: number
}> {
  return rows.map((row) => ({ from: row.from, to: row.to, chance: row.chance }))
}

export function stageRuleImpact(
  base: readonly StageRuleRow[] | null,
  next: readonly StageRuleRow[],
): string[] {
  return base !== null && base.length === next.length && base.every((row, index) => {
    const after = next[index]
    return row.from === after.from && row.to === after.to && row.effect === after.effect
      && row.chance === after.chance
  }) ? [] : [STAGE_RULES_PATH]
}

export function applyStageRuleRows(yaml: string, rows: readonly StageRuleRow[]): ReturnType<typeof applyStageRules> {
  return applyStageRules(yaml, rows)
}

export function readStageRuleRows(yaml: string): readonly StageRuleRow[] | null {
  return readStageRules(yaml)
}
