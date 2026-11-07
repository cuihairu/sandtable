// ST-WB-011 · 抽签/保底与行为画像表单的 YAML 面(节点侧守卫):
// - gacha 草稿往返 + featured 0 省略(内核 skip_serializing_if 同约定);
// - applyGachaConfig 手术四态:已有节替换 / 缺段插 model 后 / 缺 model 显式错 / malformed 行号错;
// - reviewGacha 前端预检(base_rate、pity 计数、定轨耦合);
// - gachaDiff omit-when-0 无幻影 diff;
// - behavior 三群体部分覆盖回退分群缺省 + p_training 0 省略;
// - applyBehaviorConfig + applyTrainingConfig 两段手术;
// - reviewBehavior(概率范围/每群合计≤1/练级环耦合)。
// 跑法(仓库根):node --test apps/web/tests/gacha-behavior-yaml.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  applyBehaviorConfig, applyGachaConfig, applyTrainingConfig, parseConfig,
} from '../src/workbench/params/configYaml.ts'
import { draftGacha, gachaDiff, gachaDraft, gachaToYaml, reviewGacha } from '../src/workbench/params/gachaYaml.ts'
import {
  behaviorDiff, behaviorDraft, behaviorToYaml, COHORT_DEFAULTS, defaultTraining, draftBehavior,
  hasTrainingSection, readBehavior, readTraining, reviewBehavior,
} from '../src/workbench/params/behaviorYaml.ts'
import { yamlToValue } from '../src/workbench/params/yamlValue.ts'

/* ————— gacha ————— */

test('gacha 草稿往返且 featured 0 省略(内核 skip_serializing_if 同约定)', () => {
  const yaml = 'model:\n  gacha:\n    base_rate: 0.006\n    pity_hard: 90\n    pity_soft_start: 74\n    pity_soft_step: 0.06\n'
  const parsed = parseConfig(yaml)
  assert.deepEqual(parsed.errors, [])
  const config = yamlToValue(yaml).model.gacha
  const draft = gachaDraft(config)
  assert.equal(draft.baseRate, 0.006)
  assert.equal(draft.pityHard, 90)
  assert.equal(draft.pitySoftStart, 74)
  assert.equal(draft.pitySoftStep, 0.06)
  assert.equal(draft.featuredRate, 0)
  assert.equal(draft.featuredGuarantee, 0)
  const rebuilt = draftGacha(draft)
  assert.equal(rebuilt.featured_rate, undefined)
  assert.equal(rebuilt.featured_guarantee, undefined)
  assert.equal(rebuilt.base_rate, 0.006)
  // YAML 往返:编辑面生成文再读回,数值逐字段一致
  const round = yamlToValue(gachaToYaml(draft)).model.gacha
  assert.equal(round.base_rate, 0.006)
  assert.equal(round.pity_hard, 90)
  assert.equal(round.pity_soft_start, 74)
  assert.equal(round.pity_soft_step, 0.06)
  assert.equal(round.featured_rate, undefined)
})

test('draftGacha 非 0 featured 进 YAML,gachaToYaml 带两键', () => {
  const draft = { baseRate: 0.006, pityHard: 90, pitySoftStart: 74, pitySoftStep: 0.06, featuredRate: 0.5, featuredGuarantee: 1 }
  const config = draftGacha(draft)
  assert.equal(config.featured_rate, 0.5)
  assert.equal(config.featured_guarantee, 1)
  const yaml = gachaToYaml(draft)
  assert.match(yaml, /featured_rate: 0\.5/)
  assert.match(yaml, /featured_guarantee: 1/)
})

test('applyGachaConfig 已有节整段替换且保留其它节', () => {
  const yaml = 'model:\n  warrior:\n    attack: 100\n  gacha:\n    base_rate: 0.02\n    pity_hard: 0\n    pity_soft_start: 0\n    pity_soft_step: 0\n'
  const gacha = { base_rate: 0.006, pity_hard: 90, pity_soft_start: 74, pity_soft_step: 0.06 }
  const outcome = applyGachaConfig(yaml, gacha)
  assert.ok(outcome.ok, outcome.ok ? '' : outcome.error)
  const root = yamlToValue(outcome.ok ? outcome.yaml : '')
  assert.equal(root.model.warrior.attack, 100)
  assert.equal(root.model.gacha.base_rate, 0.006)
  assert.equal(root.model.gacha.pity_hard, 90)
  assert.equal(root.model.gacha.pity_soft_start, 74)
  assert.equal(root.model.gacha.pity_soft_step, 0.06)
})

test('applyGachaConfig 缺段插 model 节后', () => {
  const yaml = 'model:\n  warrior:\n    attack: 100\n'
  const gacha = { base_rate: 0.02, pity_hard: 60, pity_soft_start: 50, pity_soft_step: 0.05 }
  const outcome = applyGachaConfig(yaml, gacha)
  assert.ok(outcome.ok, outcome.ok ? '' : outcome.error)
  const root = yamlToValue(outcome.ok ? outcome.yaml : '')
  assert.equal(root.model.warrior.attack, 100)
  assert.equal(root.model.gacha.pity_hard, 60)
  assert.equal(root.model.gacha.pity_soft_start, 50)
})

test('applyGachaConfig 缺 model 节显式错', () => {
  const outcome = applyGachaConfig('scenario:\n  population: 1000\n', { base_rate: 0.02 })
  assert.equal(outcome.ok, false)
  assert.match(outcome.ok ? '' : outcome.error, /model 节不存在/)
})

test('applyGachaConfig malformed YAML 报行号错', () => {
  // 同 key 重复出现是本解析器明确的错误面(params-config 同款)
  const outcome = applyGachaConfig('model:\n  warrior:\n    attack: 100\n  warrior:\n    attack: 200\n', { base_rate: 0.02 })
  assert.equal(outcome.ok, false)
  assert.match(outcome.ok ? '' : outcome.error, /第 \d+ 行:/)
})

test('reviewGacha 预检规则(base_rate/pity 计数/定轨耦合)', () => {
  const good = { baseRate: 0.006, pityHard: 90, pitySoftStart: 74, pitySoftStep: 0.06, featuredRate: 0.5, featuredGuarantee: 1 }
  assert.equal(reviewGacha(good).valid, true)
  assert.equal(reviewGacha({ ...good, baseRate: 0 }).valid, false)
  assert.equal(reviewGacha({ ...good, baseRate: 1.2 }).valid, false)
  assert.equal(reviewGacha({ ...good, pityHard: -1 }).valid, false)
  assert.equal(reviewGacha({ ...good, pityHard: 1.5 }).valid, false)
  assert.equal(reviewGacha({ ...good, pitySoftStep: -0.1 }).valid, false)
  assert.equal(reviewGacha({ ...good, featuredRate: 1.5 }).valid, false)
  // 定轨需要 UP 配套:featured_rate=0 而 featured_guarantee>0 拒
  const orphan = reviewGacha({ ...good, featuredRate: 0, featuredGuarantee: 1 })
  assert.equal(orphan.valid, false)
  assert.match(orphan.issues[0].message, /featured_rate/)
})

test('gachaDiff omit-when-0 无幻影 diff', () => {
  // 基线无 featured 键(= 缺省 0),草稿也 0 → featured 两键不进 diff
  const base = { base_rate: 0.02, pity_hard: 0, pity_soft_start: 0, pity_soft_step: 0 }
  const draft = { baseRate: 0.02, pityHard: 0, pitySoftStart: 0, pitySoftStep: 0, featuredRate: 0, featuredGuarantee: 0 }
  assert.deepEqual(gachaDiff(base, draft), [])
  const changed = gachaDiff(base, { ...draft, baseRate: 0.006, pityHard: 90 })
  assert.equal(changed.length, 2)
  assert.deepEqual(changed.map((row) => row.field).sort(), ['base_rate', 'pity_hard'])
})

/* ————— behavior + training ————— */

test('readBehavior 部分覆盖回退分群缺省(内核 PartialActorBehavior 同语义)', () => {
  const yaml = 'model:\n  behavior:\n    whale:\n      sessions_int: 6\n'
  const behavior = readBehavior(yaml, yamlToValue)
  assert.ok(behavior)
  assert.equal(behavior.whale.sessions_int, 6)
  assert.equal(behavior.whale.p_dungeon, COHORT_DEFAULTS.whale.pDungeon)
  assert.equal(behavior.casual.sessions_int, COHORT_DEFAULTS.casual.sessionsInt)
  assert.equal(behavior.core.p_upgrade, COHORT_DEFAULTS.core.pUpgrade)
  // 缺 behavior 段返回 null(不伪造)
  assert.equal(readBehavior('model:\n  warrior:\n    attack: 100\n', yamlToValue), null)
})

test('readTraining 缺段 null,有段直读', () => {
  assert.equal(readTraining('model:\n  warrior:\n    attack: 100\n', yamlToValue), null)
  const training = readTraining('model:\n  training:\n    xp: 400\n    gold: 150\n', yamlToValue)
  assert.deepEqual(training, { xp: 400, gold: 150 })
  assert.deepEqual(defaultTraining(), { xp: 400, gold: 150 })
})

test('draftBehavior p_training 0 省略,>0 保留', () => {
  const zeroed = draftBehavior({
    groups: {
      casual: { sessionsInt: 1, sessionsFrac: 0.5, pDungeon: 0.7, pUpgrade: 0.2, pTraining: 0 },
      core: { sessionsInt: 2, sessionsFrac: 0.5, pDungeon: 0.6, pUpgrade: 0.3, pTraining: 0.1 },
      whale: { sessionsInt: 5, sessionsFrac: 0, pDungeon: 0.65, pUpgrade: 0.3, pTraining: 0 },
    },
    training: null,
  })
  assert.equal(zeroed.casual.p_training, undefined)
  assert.equal(zeroed.core.p_training, 0.1)
  assert.equal(zeroed.whale.p_training, undefined)
})

test('behaviorToYaml 形状(三群体 + training 条件出现)', () => {
  const draft = {
    groups: {
      casual: { sessionsInt: 1, sessionsFrac: 0.5, pDungeon: 0.7, pUpgrade: 0.2, pTraining: 0.1 },
      core: { sessionsInt: 2, sessionsFrac: 0.5, pDungeon: 0.6, pUpgrade: 0.3, pTraining: 0.1 },
      whale: { sessionsInt: 5, sessionsFrac: 0, pDungeon: 0.65, pUpgrade: 0.3, pTraining: 0.05 },
    },
    training: { xp: 400, gold: 150 },
  }
  const yaml = behaviorToYaml(draft)
  const root = yamlToValue(yaml)
  assert.equal(root.model.behavior.casual.p_dungeon, 0.7)
  assert.equal(root.model.behavior.whale.p_training, 0.05)
  assert.deepEqual(root.model.training, { xp: 400, gold: 150 })
  const without = yamlToValue(behaviorToYaml({ ...draft, training: null }))
  assert.equal(without.model.training, undefined)
})

test('applyBehaviorConfig + applyTrainingConfig 两段手术', () => {
  const yaml = 'model:\n  warrior:\n    attack: 100\n'
  const behavior = draftBehavior({
    groups: {
      casual: { sessionsInt: 1, sessionsFrac: 0.5, pDungeon: 0.7, pUpgrade: 0.2, pTraining: 0.1 },
      core: { sessionsInt: 2, sessionsFrac: 0.5, pDungeon: 0.6, pUpgrade: 0.3, pTraining: 0.1 },
      whale: { sessionsInt: 6, sessionsFrac: 0, pDungeon: 0.65, pUpgrade: 0.3, pTraining: 0.05 },
    },
    training: { xp: 300, gold: 120 },
  })
  const outB = applyBehaviorConfig(yaml, behavior)
  assert.ok(outB.ok, outB.ok ? '' : outB.error)
  const outT = applyTrainingConfig(outB.ok ? outB.yaml : '', { xp: 300, gold: 120 })
  assert.ok(outT.ok, outT.ok ? '' : outT.error)
  const root = yamlToValue(outT.ok ? outT.yaml : '')
  assert.equal(root.model.warrior.attack, 100)
  assert.equal(root.model.behavior.whale.sessions_int, 6)
  assert.equal(root.model.behavior.casual.p_training, 0.1)
  assert.deepEqual(root.model.training, { xp: 300, gold: 120 })
  // 缺 model 显式错(与 loot/gacha 同边界)
  const missing = applyBehaviorConfig('scenario:\n  population: 1000\n', behavior)
  assert.equal(missing.ok, false)
  assert.match(missing.ok ? '' : missing.error, /model 节不存在/)
})

test('hasTrainingSection 只认 model 直下 training 键', () => {
  assert.equal(hasTrainingSection('model:\n  training:\n    xp: 400\n    gold: 150\n'), true)
  assert.equal(hasTrainingSection('model:\n  behavior:\n    casual:\n      p_dungeon: 0.7\n'), false)
  assert.equal(hasTrainingSection('scenario:\n  duration: 30d\n'), false)
})

test('reviewBehavior 概率范围/每群合计≤1/练级环耦合', () => {
  const group = (pDungeon, pUpgrade, pTraining) => ({ sessionsInt: 1, sessionsFrac: 0.5, pDungeon, pUpgrade, pTraining })
  // 缺省行为带(p_training>0)+ 产出面配套 + 候选无 training 节(表单里已启用)→ 有效
  const good = {
    groups: { casual: group(0.7, 0.2, 0.1), core: group(0.6, 0.3, 0.1), whale: group(0.65, 0.3, 0.05) },
    training: { xp: 400, gold: 150 },
  }
  assert.equal(reviewBehavior(good, true).valid, true)
  // 概率出界
  assert.equal(reviewBehavior({ ...good, groups: { ...good.groups, casual: group(1.2, 0.2, 0.1) } }, true).valid, false)
  // 每群合计 > 1(内核 validate 同规则)
  const overflow = reviewBehavior({ ...good, groups: { ...good.groups, casual: group(0.8, 0.3, 0.3) } }, true)
  assert.equal(overflow.valid, false)
  assert.match(overflow.issues[0].message, /不能超过 1/)
  // 产出面有、行为带无(内核 validate 同规则)
  const silent = reviewBehavior({ ...good, groups: { casual: group(0.7, 0.2, 0), core: group(0.6, 0.3, 0), whale: group(0.65, 0.3, 0) } }, true)
  assert.equal(silent.valid, false)
  assert.match(silent.issues[0].message, /p_training 全为 0/)
  // 行为带有、产出面无且候选无 training 节
  const orphan = reviewBehavior({ ...good, training: null }, false)
  assert.equal(orphan.valid, false)
  assert.match(orphan.issues[0].message, /model\.training/)
  // 负产出拒(内核同防线)
  assert.equal(reviewBehavior({ ...good, training: { xp: -1, gold: 0 } }, true).valid, false)
})

test('behaviorDiff 逐字段语义 diff', () => {
  const base = {
    casual: { sessions_int: 1, sessions_frac: 0.5, p_dungeon: 0.7, p_upgrade: 0.2 },
    core: { sessions_int: 2, sessions_frac: 0.5, p_dungeon: 0.6, p_upgrade: 0.3, p_training: 0.1 },
    whale: { sessions_int: 5, sessions_frac: 0, p_dungeon: 0.65, p_upgrade: 0.3, p_training: 0.05 },
  }
  const draft = behaviorDraft(base)
  assert.deepEqual(behaviorDiff(base, draft), [])
  const changed = behaviorDiff(base, { ...draft, groups: { ...draft.groups, whale: { ...draft.groups.whale, sessionsInt: 6 } } })
  assert.equal(changed.length, 1)
  assert.equal(changed[0].field, 'whale.sessions_int')
  assert.equal(changed[0].from, 5)
  assert.equal(changed[0].to, 6)
})
