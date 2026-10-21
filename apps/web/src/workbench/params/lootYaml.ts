import type { LootConfig, LootReward, LootTableConfig } from '../../lib/types.ts'
import { parseBulkPaste } from './bulkPaste.ts'
import type { LootDiff, LootIssue, LootReport } from './lootTable.ts'

export type LootDraft = {
  readonly rateMult: number
  readonly onVictory: string
  readonly tables: readonly LootTableDraft[]
  readonly rewards: readonly LootRewardDraft[]
}

export type LootTableDraft = {
  readonly name: string
  readonly items: readonly { readonly name: string; readonly weight: number }[]
}

export type LootRewardDraft = {
  readonly name: string
  readonly gold: number
  readonly xp: number
}

export type PastedLoot = {
  readonly draft: LootDraft
  readonly reports: readonly import('./bulkPaste.ts').BulkPasteRow[]
  readonly valid: boolean
}

const EMPTY_REWARD: LootReward = { gold: 0, xp: 0 }

/** 读取候选 model.loot;缺段返回 null(不伪造默认半配置)。 */
export function readLoot(yaml: string, parse: (source: string) => Record<string, unknown>): LootConfig | null {
  if (!yaml.includes('loot:')) return null
  return (parse(yaml).model as Record<string, LootConfig | undefined>).loot ?? null
}

export function lootDraft(config: LootConfig | null): LootDraft {
  if (!config) return { rateMult: Number.NaN, onVictory: '', tables: [], rewards: [] }
  return {
    rateMult: config.rate_mult,
    onVictory: config.on_victory,
    tables: Object.entries(config.tables ?? {}).map(([name, table]) => ({
      name,
      items: Object.entries(table.weights).map(([itemName, weight]) => ({ name: itemName, weight })),
    })),
    rewards: Object.entries(config.rewards ?? {}).map(([name, reward]) => ({
      name, gold: reward.gold, xp: reward.xp,
    })),
  }
}

export function draftLoot(draft: LootDraft): LootConfig {
  const tables: Record<string, LootTableConfig> = {}
  for (const table of draft.tables) {
    tables[table.name] = { weights: Object.fromEntries(table.items.map((item) => [item.name, item.weight])) }
  }
  const rewards: Record<string, LootReward> = {}
  for (const reward of draft.rewards) {
    rewards[reward.name] = { gold: reward.gold, xp: reward.xp }
  }
  return { rate_mult: draft.rateMult, on_victory: draft.onVictory, tables, rewards }
}

export function lootToYaml(draft: LootDraft): string {
  const config = draftLoot(draft)
  const tableLines = Object.entries(config.tables).map(([name, table]) => [
    `  ${name}:`,
    ...Object.entries(table.weights).map(([item, weight]) => `    ${item}: ${weight}`),
  ].join('\n'))
  const rewardLines = Object.entries(config.rewards).map(([name, reward]) =>
    `  ${name}: { gold: ${reward.gold}, xp: ${reward.xp} }`)
  return [
    'model:', '  loot:', `    rate_mult: ${config.rate_mult}`, `    on_victory: '${config.on_victory}'`,
    '    tables:', ...tableLines, '    rewards:', ...rewardLines,
  ].join('\n')
}

export function setLootWeight(draft: LootDraft, itemName: string, weight: number): LootDraft {
  return {
    ...draft,
    rewards: ensureRewards(draft, [itemName]),
    tables: draft.tables.map((table) => ({
      ...table, items: table.items.map((item) => item.name === itemName ? { ...item, weight } : item),
    })),
  }
}

export function setLootReward(draft: LootDraft, itemName: string, gold: number, xp: number): LootDraft {
  const reward = { name: itemName, gold, xp }
  const existing = draft.rewards.some((row) => row.name === itemName)
  return { ...draft, rewards: existing ? draft.rewards.map((row) => row.name === itemName ? reward : row) : [...draft.rewards, reward] }
}

export function renameLootItem(draft: LootDraft, oldName: string, newName: string): LootDraft {
  return {
    ...draft,
    tables: draft.tables.map((table) => ({
      ...table, items: table.items.map((item) => item.name === oldName ? { ...item, name: newName } : item),
    })),
    rewards: draft.rewards.map((reward) => reward.name === oldName ? { ...reward, name: newName } : reward),
  }
}

export function removeLootTable(draft: LootDraft, name: string): LootDraft {
  const table = draft.tables.find((row) => row.name === name)
  const removed = new Set(table?.items.map((item) => item.name) ?? [])
  const kept = draft.tables.filter((row) => row.name !== name)
  const referenced = new Set(kept.flatMap((row) => row.items.map((item) => item.name)))
  return {
    ...draft, onVictory: draft.onVictory === name ? '' : draft.onVictory, tables: kept,
    rewards: draft.rewards.filter((reward) => !removed.has(reward.name) || referenced.has(reward.name)),
  }
}

function ensureRewards(draft: LootDraft, names: readonly string[]): LootRewardDraft[] {
  const next = [...draft.rewards]
  for (const name of names) if (!next.some((reward) => reward.name === name)) next.push({ name, gold: 0, xp: 0 })
  return next
}

/** 前端预检:非负有限权重、至少一项为正、条目/表名闭合、奖励非负。 */
export function reviewLoot(draft: LootDraft): LootReport {
  const issues: LootIssue[] = []
  const checkNumber = (row: number, label: string, value: number, min = 0): void => {
    if (!Number.isFinite(value)) issues.push({ row, message: `${label} 必须为有限数值` })
    else if (value < min) issues.push({ row, message: `${label} 不能小于 ${min}` })
    else if (!Number.isSafeInteger(value) && label !== 'rate_mult') {
      issues.push({ row, message: `${label} 必须为安全数值` })
    }
  }
  const tableNames = new Set<string>()
  const itemNames = new Set<string>()
  draft.tables.forEach((table, tableIndex) => {
    const row = tableIndex + 1
    if (table.name.trim() === '') issues.push({ row, message: '表名不能为空' })
    else if (tableNames.has(table.name)) issues.push({ row, message: `表名重复:${table.name}` })
    tableNames.add(table.name)
    if (table.items.length === 0) issues.push({ row, message: `表 ${table.name || row}: 权重不能为空` })
    let positive = false
    table.items.forEach((item, itemIndex) => {
      const itemLabel = `${table.name || row}.${item.name || itemIndex + 1}`
      if (item.name.trim() === '') issues.push({ row, message: `${itemLabel}: 条目名不能为空` })
      else if (itemNames.has(item.name)) issues.push({ row, message: `条目重复:${item.name}` })
      itemNames.add(item.name)
      checkNumber(row, `${itemLabel}.weight`, item.weight)
      if (item.weight > 0) positive = true
    })
    if (table.items.length > 0 && !positive) issues.push({ row, message: `表 ${table.name}: 至少一项权重为正` })
  })
  draft.rewards.forEach((reward, index) => {
    const row = draft.tables.length + index + 1
    if (reward.name.trim() === '') issues.push({ row, message: '奖励条目名不能为空' })
    checkNumber(row, `${reward.name}.gold`, reward.gold)
    checkNumber(row, `${reward.name}.xp`, reward.xp)
    if (reward.gold === 0 && reward.xp === 0) issues.push({ row, message: `奖励 ${reward.name}: 至少一项数额大于 0` })
  })
  if (draft.onVictory !== '' && !tableNames.has(draft.onVictory)) {
    issues.push({ row: null, message: `on_victory 表不存在:${draft.onVictory}` })
  }
  for (const rewardName of itemNames) {
    if (!draft.rewards.some((reward) => reward.name === rewardName)) {
      issues.push({ row: null, message: `条目缺少奖励定义:${rewardName}` })
    }
  }
  for (const reward of draft.rewards) {
    if (!itemNames.has(reward.name)) issues.push({ row: null, message: `奖励无表引用:${reward.name}` })
  }
  return { issues, valid: issues.length === 0 }
}

export function lootTotalWeight(draft: LootDraft): Array<{ table: string; total: number }> {
  return draft.tables.map((table) => ({
    table: table.name,
    total: table.items.reduce((sum, item) => sum + (Number.isFinite(item.weight) ? item.weight : Number.NaN), 0),
  }))
}

export function lootRewardExpectation(
  draft: LootDraft,
): Array<{ reward: string; gold: number; xp: number; weight: number }> {
  const weights = new Map<string, number>()
  for (const table of draft.tables) {
    const total = table.items.reduce((sum, item) => sum + item.weight, 0)
    for (const item of table.items) {
      weights.set(item.name, (weights.get(item.name) ?? 0) + (total === 0 ? 0 : item.weight / total))
    }
  }
  return draft.rewards.map((reward) => {
    const probability = weights.get(reward.name) ?? 0
    return {
      reward: reward.name,
      weight: probability,
      gold: probability * reward.gold * draft.rateMult,
      xp: probability * reward.xp * draft.rateMult,
    }
  })
}

export function lootDiff(base: LootConfig | null, next: LootDraft): LootDiff[] {
  const candidate = draftLoot(next)
  const diffs: LootDiff[] = []
  if (base?.rate_mult !== candidate.rate_mult) {
    diffs.push({ kind: 'rateMult', key: 'rate_mult', field: 'rate_mult', from: base?.rate_mult ?? '缺省', to: candidate.rate_mult })
  }
  if (base?.on_victory !== candidate.on_victory) {
    diffs.push({ kind: 'onVictory', key: 'on_victory', field: 'on_victory', from: base?.on_victory ?? '缺省', to: candidate.on_victory })
  }
  const tableKeys = new Set([...Object.keys(base?.tables ?? {}), ...Object.keys(candidate.tables)])
  for (const tableKey of tableKeys) {
    const from = base?.tables[tableKey]?.weights ?? {}
    const to = candidate.tables[tableKey]?.weights ?? {}
    for (const itemKey of new Set([...Object.keys(from), ...Object.keys(to)])) {
      if (from[itemKey] !== to[itemKey]) {
        diffs.push({ kind: 'table', key: tableKey, field: itemKey, from: from[itemKey] ?? '删除', to: to[itemKey] ?? '删除' })
      }
    }
  }
  const rewardKeys = new Set([...Object.keys(base?.rewards ?? {}), ...Object.keys(candidate.rewards)])
  for (const rewardKey of rewardKeys) {
    const from = base?.rewards[rewardKey] ?? EMPTY_REWARD
    const to = candidate.rewards[rewardKey] ?? EMPTY_REWARD
    for (const field of ['gold', 'xp'] as const) {
      if (from[field] !== to[field]) {
        diffs.push({ kind: 'reward', key: rewardKey, field, from: from[field], to: to[field] })
      }
    }
  }
  return diffs
}

const lootMapper = {
  headers: ['table', 'item', 'weight', 'gold', 'xp'],
  fields: ['table', 'item', 'weight', 'gold', 'xp'],
  validate: (row: Record<string, string | undefined>): string | null => {
    if (row.table === undefined || row.table === '') return 'table 必须为文本'
    if (row.item === undefined || row.item === '') return 'item 必须为文本'
    for (const field of ['weight', 'gold', 'xp'] as const) {
      if (!Number.isFinite(Number(row[field]))) return `${field} 必须为有限数值`
    }
    return null
  },
  build: (row: Record<string, string | undefined>) => ({
    table: String(row.table ?? ''),
    item: String(row.item ?? ''),
    weight: Number(row.weight),
    gold: Number(row.gold),
    xp: Number(row.xp),
  }),
}

/** 掉落 TSV/CSV 批量粘贴:坏行逐行保留,同表同名条目保留最后一个权重。 */
export function parseLootPaste(text: string): PastedLoot {
  const parsed = parseBulkPaste(text, lootMapper)
  const tables = new Map<string, LootTableDraft>()
  const rewards = new Map<string, LootRewardDraft>()
  for (const row of parsed.rows) {
    const table = tables.get(row.table) ?? { name: row.table, items: [] }
    const items = table.items.filter((item) => item.name !== row.item)
    items.push({ name: row.item, weight: row.weight })
    tables.set(row.table, { ...table, items })
    rewards.set(row.item, { name: row.item, gold: row.gold, xp: row.xp })
  }
  return {
    draft: { rateMult: Number.NaN, onVictory: '', tables: [...tables.values()], rewards: [...rewards.values()] },
    reports: parsed.reports,
    valid: parsed.valid,
  }
}
