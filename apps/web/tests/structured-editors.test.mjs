import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { applyLootConfig, buildDefaultYaml, parseConfig, readText } from '../src/workbench/params/configYaml.ts'
import { evalFormula, reviewFormula } from '../src/workbench/params/formulaLogic.ts'
import {
  draftLoot, lootDraft, lootDiff, lootRewardExpectation, lootToYaml, lootTotalWeight,
  removeLootTable, reviewLoot, setLootWeight,
} from '../src/workbench/params/lootYaml.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')
const wasm = existsSync(pkgNode) ? await import(pkgNode) : null

const lootYaml = `model:
  loot:
    rate_mult: 1.2
    on_victory: chest
    tables:
      chest:
        coin: 70
        gem: 25
        junk: 5
    rewards:
      coin: { gold: 10, xp: 0 }
      gem: { gold: 50, xp: 20 }
      junk: { gold: 0, xp: 2 }
`

test('formula syntax, references and preview match kernel semantics', () => {
  const report = reviewFormula('xp_base * level ^ xp_pow')
  assert.equal(report.valid, true)
  assert.deepEqual(report.references, ['xp_base', 'level', 'xp_pow'])
  assert.equal(evalFormula('xp_base * level ^ xp_pow', { level: 3, xp_base: 60, xp_pow: 1.3 }), 60 * 3 ** 1.3)
  assert.equal(evalFormula('1 ? 7 : 1/0', { level: 1, xp_base: 1, xp_pow: 1 }), 7)
  assert.equal(evalFormula('min(3,4)+clamp(5,1,3)', { level: 1, xp_base: 1, xp_pow: 1 }), 6)
  assert.equal(reviewFormula('xp_base * atk').valid, false)
  assert.equal(reviewFormula('0 * xp_base').valid, false)
})

test('loot paste keeps structure, reports totals and期望, and previews field diff', () => {
  const draft = lootDraft({ rate_mult: 1.2, on_victory: 'chest', tables: { chest: { weights: { coin: 70, gem: 25, junk: 5 } } }, rewards: { coin: { gold: 10, xp: 0 }, gem: { gold: 50, xp: 20 }, junk: { gold: 0, xp: 2 } } })
  assert.deepEqual(lootTotalWeight(draft), [{ table: 'chest', total: 100 }])
  assert.deepEqual(lootRewardExpectation(draft).find((row) => row.reward === 'coin'), { reward: 'coin', weight: 0.7, gold: 8.4, xp: 0 })
  assert.equal(lootDiff(null, draft).length, 9)
  const reviewed = reviewLoot(setLootWeight(draft, 'coin', Number.NaN))
  assert.equal(reviewed.valid, false)
  assert.ok(reviewed.issues.some((issue) => issue.message.includes('coin.weight')))
})

test('loot removal keeps referential closure before kernel validation', () => {
  const draft = lootDraft({ rate_mult: 1, on_victory: 'chest', tables: { chest: { weights: { coin: 1 } }, spare: { weights: { gem: 1 } } }, rewards: { coin: { gold: 1, xp: 0 }, gem: { gold: 2, xp: 0 } } })
  const next = removeLootTable(draft, 'spare')
  assert.equal(next.rewards.some((reward) => reward.name === 'gem'), false)
  assert.equal(reviewLoot(next).valid, true)
})

test('structured loot YAML round-trips through the bridge parser', () => {
  const yaml = lootToYaml({ rateMult: 1.2, onVictory: 'chest', tables: [{ name: 'chest', items: [{ name: 'coin', weight: 70 }, { name: 'gem', weight: 25 }] }], rewards: [{ name: 'coin', gold: 10, xp: 0 }, { name: 'gem', gold: 50, xp: 20 }] })
  const parsed = parseConfig(yaml)
  assert.deepEqual(parsed.errors, [])
  assert.equal(readText(parsed, 'model.loot.on_victory'), 'chest')
  const outcome = applyLootConfig(buildDefaultYaml(), { rate_mult: 1.2, on_victory: 'chest', tables: { chest: { weights: { coin: 70, gem: 25 } } }, rewards: { coin: { gold: 10, xp: 0 }, gem: { gold: 50, xp: 20 } } })
  assert.ok(outcome.ok)
  assert.ok(outcome.yaml.includes('on_victory: chest'))
})

test('kernel accepts the structured loot candidate and rejects a broken reward', async () => {
  if (!wasm) {
    test.skip('pkg-node 未构建,CI 在 wasm 构建后执行')
    return
  }
  const config = { rate_mult: 1.2, on_victory: 'chest', tables: { chest: { weights: { coin: 70, gem: 25, junk: 5 } } }, rewards: { coin: { gold: 10, xp: 0 }, gem: { gold: 50, xp: 20 }, junk: { gold: 0, xp: 2 } } }
  const good = applyLootConfig(buildDefaultYaml(), config)
  assert.ok(good.ok)
  const info = JSON.parse(wasm.validate_config(good.yaml))
  assert.ok(info.players > 0)
  const bad = applyLootConfig(buildDefaultYaml(), { ...config, rewards: { ...config.rewards, coin: { gold: -1, xp: 0 } } })
  assert.ok(bad.ok)
  assert.throws(() => wasm.validate_config(bad.yaml))
})
