export type LootIssue = {
  readonly row: number | null
  readonly message: string
}

export type LootReport = {
  readonly issues: readonly LootIssue[]
  readonly valid: boolean
}

export type LootDiff = {
  readonly kind: 'table' | 'reward' | 'onVictory' | 'rateMult'
  readonly key: string
  readonly field: string
  readonly from: number | string
  readonly to: number | string
}
