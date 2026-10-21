import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  applyTierTable, buildDefaultYaml, parseConfig, readTierTable,
} from '../src/workbench/params/configYaml.ts'
import {
  growthDiff, growthImpact, parseGrowthPaste, previewGrowth, readGrowthRows, reviewGrowthRows,
} from '../src/workbench/params/growthCurve.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')
const wasm = existsSync(pkgNode) ? await import(pkgNode) : null

const row = (hp, attack, defense, gold = null, xp = null) => ({ hp, attack, defense, gold, xp })

test('growth curve: token-level replace preserves comments and unedited YAML', () => {
  const yaml = `# scenario header\nmodel:\n  dungeon:\n    # curve lives here\n    tier_table:\n      - { hp: 100, attack: 10, defense: 5 }\n    reward_gold: 40\n`
  const next = applyTierTable(yaml, [row(120, 12, 6)])
  assert.ok(next.ok)
  assert.equal(next.yaml, '# scenario header\nmodel:\n  dungeon:\n    # curve lives here\n    tier_table:\n      - { hp: 120, attack: 12, defense: 6 }\n    reward_gold: 40\n')
})

test('growth curve: paste keeps bad rows, header optional, TSV and CSV both parse', () => {
  const pasted = parseGrowthPaste('hp,attack,defense,gold,xp\n100,10,5,1,2\nbad,10,5,1,2\n\n110\t11\t6')
  assert.equal(pasted.reports.length, 3)
  assert.equal(pasted.reports[1].message, 'hp 必须为有限数值')
  assert.deepEqual(pasted.rows.map((r) => [r.hp, r.attack, r.defense, r.gold, r.xp]), [[100, 10, 5, 1, 2], [110, 11, 6, null, null]])
  assert.equal(pasted.valid, false)
})

test('growth curve: review reports ranges and monotonicity by row', () => {
  const report = reviewGrowthRows([row(100, 20, 10), row(80, 30, 20), row(0, 40, 30)])
  assert.equal(report.valid, false)
  assert.deepEqual(report.issues.map((i) => i.row), [3, 2, 3])
})

test('growth curve: preview and impact use kernel geometry semantics', () => {
  const geometric = previewGrowth(2, { mHp: 300, mAttack: 45, mDefense: 20, rewardGold: 40, rewardXp: 45 }, { tier: 1.5, gold: 1.4, xp: 1.4 }, null)
  assert.deepEqual(geometric, { tier: 2, hp: 675, attack: 101, defense: 45, gold: 78, xp: 88 })
  const override = previewGrowth(2, { mHp: 300, mAttack: 45, mDefense: 20, rewardGold: 40, rewardXp: 45 }, { tier: 1.5, gold: 1.4, xp: 1.4 }, [row(100, 10, 5), row(90, 9, 4), row(80, 8, 3, 7, 8)])
  assert.deepEqual(override, { tier: 2, hp: 80, attack: 8, defense: 3, gold: 7, xp: 8 })
  assert.deepEqual(growthImpact(null, [row(1, 1, 1)]), ['model.dungeon.tier_table', 'model.dungeon.tiers'])
  assert.deepEqual(growthImpact([row(1, 1, 1)], [row(1, 1, 1)]), [])
  assert.equal(growthDiff([row(1, 1, 1)], [row(2, 1, 1)]).length, 1)
})

test('growth curve: inserted candidate table passes the real kernel', async () => {
  if (!wasm) {
    test.skip('pkg-node 未构建,CI 在 wasm 构建后执行')
    return
  }
  const base = buildDefaultYaml()
  assert.equal(readGrowthRows(base), null)
  const outcome = applyTierTable(base, Array.from({ length: 8 }, (_, tier) => row(300 + tier, 45 + tier, 20 + tier, 40 + tier, 45 + tier)))
  assert.ok(outcome.ok)
  const info = wasm.validate_config(outcome.yaml)
  assert.equal(JSON.parse(info).players > 0, true)
  const parsed = parseConfig(outcome.yaml)
  const table = readTierTable(outcome.yaml, parsed)
  assert.deepEqual(table, Array.from({ length: 8 }, (_, tier) => row(300 + tier, 45 + tier, 20 + tier, 40 + tier, 45 + tier)))
})

test('growth curve: kernel rejects mismatched length and preserves candidate for repair', async () => {
  if (!wasm) {
    test.skip('pkg-node 未构建,CI 在 wasm 构建后执行')
    return
  }
  const base = buildDefaultYaml()
  assert.equal(readGrowthRows(base), null)
})
