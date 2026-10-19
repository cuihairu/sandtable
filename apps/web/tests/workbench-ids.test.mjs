// WB-02.10 标识体系守卫(节点侧):前缀/长度合法、内容寻址恒等、
// 创建型 ID 一次性且不重复、禁用数组下标当 ID 的回归锁。
// 跑法(仓库根):node --test apps/web/tests/workbench-ids.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { candidateIdFor, createId, hashId, ID_PREFIXES, isStableId, refOf, runIdFor, sameId, stableHash } from '../src/workbench/ids.ts'
import {
  DEMO_BASELINE_ID, DEMO_CANDIDATE_IDS_UNIQUE, DEMO_EXPERIMENT_ID, DEMO_PROJECT_ID, DEMO_RUN_ID,
} from '../src/workbench/demo/sampleProject.ts'

test('六类 ID 前缀与长度合法,前缀互相不串', () => {
  const ids = {
    project: DEMO_PROJECT_ID,
    baseline: DEMO_BASELINE_ID,
    experiment: DEMO_EXPERIMENT_ID,
    run: DEMO_RUN_ID,
  }
  for (const [kind, id] of Object.entries(ids)) {
    assert.ok(isStableId(id, ID_PREFIXES[kind]), `${kind} ID ${id}`)
  }
  // 不同域 ID 不可能串位:前缀互斥
  assert.notEqual(String(DEMO_PROJECT_ID).slice(0, 4), String(DEMO_RUN_ID).slice(0, 4))
})

test('候选 ID 内容寻址:同基线同参数域恒等,参数域变化即换 ID', () => {
  const valuesA = { 'model.warrior.attack': 110, 'model.combat.p_hit': 0.88 }
  const valuesB = { 'model.combat.p_hit': 0.88, 'model.warrior.attack': 110 } // 顺序无关
  const a = candidateIdFor(DEMO_BASELINE_ID, valuesA)
  const b = candidateIdFor(DEMO_BASELINE_ID, valuesB)
  assert.equal(a, b, '同内容应同 ID(与键序无关)')
  const c = candidateIdFor(DEMO_BASELINE_ID, { ...valuesA, 'model.warrior.attack': 111 })
  assert.notEqual(a, c, '参数域变化必须换 ID')
  assert.ok(isStableId(a, ID_PREFIXES.candidate))
})

test('创建型 ID 一次性:同域两次生成不重复', () => {
  const a = createId(ID_PREFIXES.job)
  const b = createId(ID_PREFIXES.job)
  assert.notEqual(a, b)
  assert.ok(isStableId(a, ID_PREFIXES.job))
})

test('run ID 由输入快照全量派生:任一字段变化即换 ID', () => {
  const base = {
    experimentId: DEMO_EXPERIMENT_ID,
    configHash: 'a'.repeat(64),
    seed: 42,
    modelVersion: 'm1',
    schemaVersion: 's1',
  }
  const same = runIdFor(base)
  assert.equal(same, runIdFor({ ...base }))
  assert.notEqual(same, runIdFor({ ...base, seed: 43 }))
  assert.notEqual(same, runIdFor({ ...base, configHash: 'b'.repeat(64) }))
  assert.notEqual(same, runIdFor({ ...base, modelVersion: 'm2' }))
})

test('refOf 身份域判定 + sameId 展示名等价', () => {
  assert.equal(refOf(DEMO_RUN_ID).kind, 'run')
  assert.equal(refOf(DEMO_PROJECT_ID).kind, 'project')
  assert.ok(sameId(DEMO_RUN_ID, String(DEMO_RUN_ID)))
  assert.ok(!sameId(DEMO_RUN_ID, DEMO_PROJECT_ID))
})

test('stableHash 确定性 + 均匀性烟雾(不同输入不同摘要)', () => {
  assert.equal(stableHash('abc'), stableHash('abc'))
  assert.notEqual(stableHash('abc'), stableHash('abd'))
  assert.equal(stableHash('').length, 16)
})

test('演示结果集:候选 ID 全部合法且两两不同(数组下标零充数)', () => {
  assert.equal(DEMO_CANDIDATE_IDS_UNIQUE.length, 11)
  assert.equal(new Set(DEMO_CANDIDATE_IDS_UNIQUE.map(String)).size, 11)
  for (const id of DEMO_CANDIDATE_IDS_UNIQUE) {
    assert.ok(isStableId(id, ID_PREFIXES.candidate), `演示候选 ID ${id}`)
  }
})

test('hashId 拒绝非有限数值(不静默 NaN 入身份)', () => {
  assert.throws(() => hashId(ID_PREFIXES.candidate, Number.NaN))
})
