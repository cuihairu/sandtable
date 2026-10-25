import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

import { applyLootConfig, applyStageRules, buildDefaultYaml, parseConfig, readStageRules, readText } from '../src/workbench/params/configYaml.ts'
import { parseFormulaPaste, reviewFormula } from '../src/workbench/params/formulaLogic.ts'
import { lootToYaml, parseLootPaste, reviewLoot } from '../src/workbench/params/lootYaml.ts'
import { parseBulkPaste } from '../src/workbench/params/bulkPaste.ts'
import { reviewStageRules, stageRuleDiff, stageRuleImpact } from '../src/workbench/params/stageRules.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')
const wasm = existsSync(pkgNode) ? await import(pathToFileURL(pkgNode).href) : null

const withComments = `schema_version: '1'\nscenario: {population: 40, duration: '3d'} # keep\nmodel:\n  dungeon:\n    tiers: 2 # keep dungeon\n  formulas:\n    xp_needed: 'xp_base * level ^ xp_pow' # keep formula\n`
const rules = [
  { from: 1, to: 'soft', effect: 'unlock:shop', chance: 30 },
  { from: 2, to: 'hard', effect: 'unlock:raid', chance: 70 },
]

test('shared paste keeps every bad row with a line number and reason', () => {
  const mapped = parseBulkPaste('from,to,effect,chance\n1,soft,unlock,30\n1,bad,unlock,30\n2,hard,unlock,70\n2,hard,unlock,120', {
    headers: ['from', 'to', 'effect', 'chance'],
    fields: ['from', 'to', 'effect', 'chance'],
    validate: (row) => (Number(row.chance) > 100 ? 'chance 不能大于 100' : null),
    build: (row) => row,
  })
  assert.deepEqual(mapped.reports.map((row) => row.message), [null, null, null, 'chance 不能大于 100'])
  assert.deepEqual(mapped.reports.map((row) => row.line), [2, 3, 4, 5])
  assert.equal(mapped.rows.length, 3)
  assert.equal(mapped.valid, false)
})

test('stage rules write model.stage_rules surgically and stay kernel-accepted', () => {
  const outcome = applyStageRules(withComments, rules)
  assert.ok(outcome.ok)
  const yaml = outcome.ok ? outcome.yaml : ''
  assert.equal(yaml.includes('    tiers: 2 # keep dungeon'), true)
  assert.equal(yaml.includes('xp_needed: \'xp_base * level ^ xp_pow\' # keep formula'), true)
  const configured = yaml.replace('  stage_rules:', ' stage_rules:')
  assert.equal(readStageRules(outcome.yaml) !== null, true)
  assert.deepEqual(parseConfig(configured).errors, [])
  if (wasm) {
    const info = JSON.parse(wasm.validate_config(outcome.yaml))
    assert.ok(info.players > 0)
  }
})

test('stage rules review, diff and impact gate bad candidate changes', () => {
  assert.equal(reviewStageRules(rules).valid, true)
  const bad = reviewStageRules([...rules, { from: 1, to: 'again', effect: 'unlock', chance: 101 }])
  assert.equal(bad.valid, false)
  assert.ok(bad.issues.some((issue) => issue.row === 3 && issue.message.includes('chance')))
  assert.deepEqual(stageRuleDiff(null, [rules[0]]).map((row) => row.field), ['from', 'to', 'effect', 'chance'])
  assert.deepEqual(stageRuleDiff(rules, rules), [])
  assert.deepEqual(stageRuleImpact(rules, rules), [])
  assert.deepEqual(stageRuleImpact(null, rules), ['model.stage_rules'])
  const removed = applyStageRules(withComments, [rules[0]])
  assert.ok(removed.ok)
  assert.deepEqual(stageRuleImpact(rules, [rules[0]]), ['model.stage_rules'])
  assert.deepEqual(stageRuleDiff(rules, [rules[0]]).find((row) => row.field === 'chance'), { index: 1, field: 'chance', from: 70, to: '删除' })
})

test('formula bulk paste reports invalid column shapes without dropping them', () => {
  const pasted = parseFormulaPaste('formula\nxp_base * level ^ xp_pow\nxp_base,level\n')
  assert.equal(pasted.valid, false)
  assert.deepEqual(pasted.expressions, ['xp_base * level ^ xp_pow'])
  assert.deepEqual(pasted.reports.filter((row) => row.message !== null), [{ line: 3, expression: null, message: '公式应为一列,得到 2 列' }])
  assert.equal(reviewFormula(pasted.expressions[0]).valid, true)
})

test('loot bulk paste merges good rows and keeps invalid rows as a report', () => {
  const pasted = parseLootPaste('table,item,weight,gold,xp\nchest,coin,70,10,0\nchest,gem,25,50,20\nchest,junk,5,bad,2')
  assert.equal(pasted.valid, false)
  assert.deepEqual(pasted.reports.at(-1), { line: 4, row: null, message: 'gold 必须为有限数值' })
  assert.deepEqual(pasted.draft.tables.map((table) => table.items.map((item) => item.weight)), [[70, 25]])
  assert.equal(reviewLoot({
    ...pasted.draft, onVictory: 'chest', rateMult: 1,
  }).issues.some((issue) => issue.message.includes('junk')), false)
  const yaml = lootToYaml({ ...pasted.draft, onVictory: 'chest', rateMult: 1 })
  const outcome = applyLootConfig(buildDefaultYaml(), {
    rate_mult: 1, on_victory: 'chest',
    tables: Object.fromEntries(pasted.draft.tables.map((table) => [table.name, { weights: Object.fromEntries(table.items.map((item) => [item.name, item.weight])) }])),
    rewards: Object.fromEntries(pasted.draft.rewards.map((reward) => [reward.name, { gold: reward.gold, xp: reward.xp }])),
  })
  assert.ok(outcome.ok)
  assert.equal(readText(parseConfig(yaml), 'model.loot.on_victory'), 'chest')
})

test('stage rules reject unsupported YAML token shapes before serialization', () => {
  assert.equal(applyStageRules(withComments, [{ ...rules[0], to: 'bad state' }]).ok, false)
  assert.equal(applyStageRules(withComments, [{ ...rules[0], effect: "unlock 'shop'" }]).ok, false)
  assert.equal(applyStageRules(withComments, []).ok, false)
})
