// P1 · 成长曲线结构化编辑纯逻辑:tier_table 三维序列、粘贴解析、范围/单调
// 检查、与内核 monster_of 同口径的示例求值。基线只读,写回始终是整表候选草稿。
import { readTierTable } from './configYaml.ts'
import type { TierTableRow } from './configYaml.ts'

export const GROWTH_PATH = 'model.dungeon.tier_table'
export type { TierTableRow }

export type GrowthCurveIssue = {
  readonly row: number | null
  readonly message: string
}

export type GrowthCurveReport = {
  readonly rows: readonly TierTableRow[]
  readonly issues: readonly GrowthCurveIssue[]
  readonly valid: boolean
}

export type GrowthPasteRow = {
  readonly line: number | null
  readonly row: TierTableRow | null
  readonly message: string | null
}

export type PastedGrowth = {
  readonly rows: readonly TierTableRow[]
  readonly reports: readonly GrowthPasteRow[]
  readonly valid: boolean
}

const HEADERS = new Set(['hp', 'attack', 'defense', 'gold', 'xp'])

/** TSV 优先、自动识别单字符 CSV;分隔符逐行判定,可混合粘贴。空行跳过,
 * 坏行保留在报告里,绝不静默丢弃。首行若为合法表头则作为字段映射。 */
export function parseGrowthPaste(text: string): PastedGrowth {
  const reports: GrowthPasteRow[] = []
  const rows: TierTableRow[] = []
  let header: readonly string[] | null = null
  let index = 0
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = ++index
    const trimmed = rawLine.trim()
    if (trimmed === '') continue
    const cells = (trimmed.includes('\t')
      ? trimmed.split('\t')
      : trimmed.includes(',') ? trimmed.split(',') : trimmed.split(/\s+/))
      .map((cell) => cell.trim())
      .filter((cell) => cell !== '')
    if (!header) {
      const lowered = cells.map((cell) => cell.toLowerCase())
      if (lowered.length >= 3 && lowered.every((cell) => HEADERS.has(cell))) {
        header = lowered
        continue
      }
    }
    const mapped = header && cells.length === header.length
      ? header.map((field, i) => ({ field, value: cells[i] }))
      : cells.map((value, i) => ({ field: ['hp', 'attack', 'defense', 'gold', 'xp'][i], value }))
    const numeric: Record<string, number> = {}
    for (const { field, value } of mapped) {
      if (!field || !HEADERS.has(field)) continue
      numeric[field] = Number(value)
    }
    const issue = validateRow(
      numeric.hp as number,
      numeric.attack as number,
      numeric.defense as number,
      numeric.gold,
      numeric.xp,
    )
    if (issue !== '') {
      reports.push({ line, row: null, message: issue })
      continue
    }
    const row: TierTableRow = {
      hp: numeric.hp as number,
      attack: numeric.attack as number,
      defense: numeric.defense as number,
      gold: numeric.gold === undefined ? null : numeric.gold,
      xp: numeric.xp === undefined ? null : numeric.xp,
    }
    rows.push(row)
    reports.push({ line, row, message: null })
  }
  if (rows.length === 0 && reports.length === 0) {
    reports.push({ line: null, row: null, message: '粘贴内容为空' })
  }
  return { rows, reports, valid: reports.every((r) => r.message === null) && rows.length > 0 }
}

/** 前端基础检查。hp>0 是内核契约;integer 数值均要求安全整数;产出可选。 */
export function validateRow(
  hp: number,
  attack: number,
  defense: number,
  gold?: number | null,
  xp?: number | null,
): string {
  const fields: Array<[string, number | null | undefined, boolean]> = [
    ['hp', hp, true], ['attack', attack, true], ['defense', defense, true],
    ['gold', gold, false], ['xp', xp, false],
  ]
  for (const [field, value, required] of fields) {
    if (value === undefined || value === null) {
      if (required) return `${field} 缺失`
      continue
    }
    if (!Number.isFinite(value)) return `${field} 必须为有限数值`
    if (!Number.isSafeInteger(value)) return `${field} 必须为安全整数`
    if (value < 0 || (field === 'hp' && value === 0)) return `${field === 'hp' ? 'hp 必须大于 0' : `${field} 不能为负`}`
  }
  return ''
}

/** 当前表格基础检查 + 曲线形状检查。为空/错行给明确定位;非降检查只作为
 * 可见警告级 issue,是否接受仍由预览/内核决定(hp 特殊策略可有意下降)。 */
export function reviewGrowthRows(rows: readonly TierTableRow[]): GrowthCurveReport {
  const issues: GrowthCurveIssue[] = []
  rows.forEach((row, index) => {
    const issue = validateRow(row.hp, row.attack, row.defense, row.gold, row.xp)
    if (issue !== '') issues.push({ row: index + 1, message: issue })
  })
  for (const field of ['hp', 'attack', 'defense'] as const) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][field] < rows[i - 1][field]) {
        issues.push({
          row: i + 1,
          message: `${field} 相对第 ${i} 行下降(${rows[i][field]} < ${rows[i - 1][field]})`,
        })
      }
    }
  }
  return { rows, issues, valid: issues.length === 0 && rows.length > 0 }
}

/** 从候选 YAML 读表;null 表示走几何曲线。 */
export function readGrowthRows(yaml: string): readonly TierTableRow[] | null {
  return readTierTable(yaml)
}

export type GrowthPreview = {
  readonly tier: number
  readonly hp: number
  readonly attack: number
  readonly defense: number
  readonly gold: number
  readonly xp: number
}

/** 与 crates/sandtable-core/src/systems/combat.rs::monster_of 同口径:
 * 表行按位取用,缺产出回退锚点 × 增长率^tier,Rust f64→i64 截断。 */
export function previewGrowth(
  tier: number,
  anchors: { mHp: number; mAttack: number; mDefense: number; rewardGold: number; rewardXp: number },
  growth: { tier: number; gold: number; xp: number },
  rows: readonly TierTableRow[] | null,
): GrowthPreview | null {
  if (!Number.isSafeInteger(tier) || tier < 0 || tier > 63) return null
  const tableRow = rows?.[tier] ?? null
  const monster = <T extends number>(tableValue: number | null, geometric: number): T =>
    (tableValue ?? geometric) as T
  return {
    tier,
    hp: monster<number>(tableRow?.hp ?? null, trunc(anchors.mHp * growth.tier ** tier)),
    attack: monster<number>(tableRow?.attack ?? null, trunc(anchors.mAttack * growth.tier ** tier)),
    defense: monster<number>(tableRow?.defense ?? null, trunc(anchors.mDefense * growth.tier ** tier)),
    gold: monster<number>(tableRow?.gold ?? null, trunc(anchors.rewardGold * growth.gold ** tier)),
    xp: monster<number>(tableRow?.xp ?? null, trunc(anchors.rewardXp * growth.xp ** tier)),
  }
}

function trunc(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : Number.NaN
}

/** 预览影响范围:只报本批会改写的结构键;基线永远只是参照。 */
export function growthImpact(baseTable: readonly TierTableRow[] | null, nextTable: readonly TierTableRow[]): string[] {
  const paths = [GROWTH_PATH]
  if (baseTable === null) paths.push('model.dungeon.tiers')
  const same = baseTable !== null
    && baseTable.length === nextTable.length
    && baseTable.every((row, i) => {
      const next = nextTable[i]
      return row.hp === next.hp && row.attack === next.attack && row.defense === next.defense
        && row.gold === next.gold && row.xp === next.xp
    })
  return same ? [] : paths
}

/** 面向面板的紧凑 diff:行号对齐,缺失显式 `—`,不泛化成 YAML 文本 diff。 */
export function growthDiff(
  base: readonly TierTableRow[] | null,
  next: readonly TierTableRow[],
): Array<{ tier: number; field: string; from: number | string; to: number | string }> {
  const count = Math.max(base?.length ?? 0, next.length)
  const out: Array<{ tier: number; field: string; from: number | string; to: number | string }> = []
  for (let tier = 0; tier < count; tier++) {
    const a = base?.[tier]
    const b = next[tier]
    for (const field of ['hp', 'attack', 'defense', 'gold', 'xp'] as const) {
      const from = a ? a[field] : null
      const to = b ? b[field] : null
      if (from !== to) out.push({ tier, field, from: from ?? '几何', to: to ?? '几何' })
    }
  }
  return out
}
