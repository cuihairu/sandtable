// 类型契约守卫(节点侧,CI web job 跑):src/lib/types.ts 的类型族与 Rust
// serde 实际序列化逐键对齐(WB-03.01)。真值源是 pkg-node 真跑内核——
// validate / run_simulation / sweep_plan / sweep_candidate / sweep_recommend
// 的实际 JSON 键与 TS interface 声明键双向对齐,漂移即红;错误类型锁
// 绑定层字符串前缀契约(配置错误 / 参数错误)与候选 config_error 形状。
// 运行时还没有出口的族(参数定义 / 配置 / A/B 比较结果)由存在性断言
// 兜底,待 WB-03.04/05/10/11 桥接落地后升级为运行时锁。
// 跑法(仓库根):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/contracts.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import * as wasm from '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js'
import { METRIC_KEYS, SWEEP_MODES } from '../src/lib/types.ts'
import { classifyWasmError } from '../src/lib/errors.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')
const typesSrc = read('src/lib/types.ts')

const YAML = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\n'
const EXP_YAML = [
  'schema_version: "1"',
  'scenario: {population: 40, duration: "3d", seed: 7}',
  'sweep:',
  '  replicates: 2',
  '  parameters:',
  '    model.warrior.attack: {min: 90, max: 110, step: 10}',
  '  targets:',
  '    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}',
  '',
].join('\n')

/** 解析 types.ts 的 export interface(花括号计数,容忍行内嵌套类型)
 *  → {必填字段表, 可选字段表}。可选(`?`)= skip_serializing_if 型省略。 */
function interfaces(src) {
  const clear = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
  const out = new Map()
  for (const m of clear.matchAll(/export interface ([A-Za-z0-9_]+) \{/g)) {
    const name = m[1]
    const start = m.index + m[0].length
    let depth = 1
    let end = start
    while (end < clear.length && depth > 0) {
      if (clear[end] === '{') depth++
      else if (clear[end] === '}') depth--
      end++
    }
    const body = clear.slice(start, end - 1)
    const fields = []
    const optional = []
    for (const line of body.split('\n')) {
      const f = line.match(/^\s*([a-z_][a-z0-9_]*)\??\s*:/)
      if (f) {
        fields.push(f[1])
        if (line.includes(`${f[1]}?:`)) optional.push(f[1])
      }
    }
    out.set(name, { fields, optional: new Set(optional) })
  }
  return out
}

const TYPES = interfaces(typesSrc)
const sorted = (a) => [...a].sort()

/**
 * 实际 JSON 对象的键与 TS interface 声明键一致:
 * - 内核多出的键(新增字段未声明)→ 红;
 * - 必填声明缺失(内核删了字段)→ 红;
 * - 可选声明(`?`)允许缺席(= 键省略语义),但出现时键名必须已声明。
 */
function assertKeys(iface, obj) {
  const entry = TYPES.get(iface)
  assert.ok(entry, `types.ts 缺 export interface ${iface}`)
  const actual = Object.keys(obj)
  const unknown = actual.filter((k) => !entry.fields.includes(k))
  assert.deepEqual(unknown, [], `${iface}:内核出现未声明键 ${JSON.stringify(unknown)}`)
  const missing = entry.fields.filter(
    (k) => !entry.optional.has(k) && !actual.includes(k),
  )
  assert.deepEqual(missing, [], `${iface}:必填键缺失 ${JSON.stringify(missing)}`)
}

test('validate_config → ValidateInfo 逐键一致', () => {
  const v = JSON.parse(wasm.validate_config(YAML))
  assertKeys('ValidateInfo', v)
})

const GACHA_LOOT_YAML = [
  'schema_version: "1"',
  'scenario: {population: 40, duration: "3d", seed: 7}',
  'model:',
  '  gacha: {base_rate: 0.02, pity_hard: 90, pity_soft_start: 74, pity_soft_step: 0.06}',
  '  loot:',
  '    rate_mult: 1.0',
  '    on_victory: common',
  '    tables: {common: {weights: {potion: 1.0}}}',
  '    rewards: {potion: {gold: 10, xp: 5}}',
  '',
].join('\n')

test('run_simulation → SimOutput/RunMetrics/DayStat/CohortStat/PowerSnapshot 逐键一致', () => {
  const out = JSON.parse(wasm.run_simulation(YAML, 2))
  assertKeys('SimOutput', out)
  assertKeys('SimMeta', out.meta)
  assert.equal(out.results.length, 2)
  assertKeys('RunMetrics', out.results[1])
  assertKeys('DayStat', out.results[0].day_stats[0])
  assertKeys('CohortStat', out.results[0].cohort_stats[0])
  assert.ok(out.results[0].power_snapshots.length >= 1, '3 天 toy 配置也有功率快照')
  assertKeys('PowerSnapshot', out.results[0].power_snapshots[0])
  // 不可用指标内核用 null 表达(禁止 0 填空是 WB-03.02,这里先锁形状)
  assert.equal(out.results[0].retention_d30, null, '3 天窗口 retention_d30 应为 null')
})

test('启用 gacha/loot 时键省略型字段出现,未启用时整键省略', () => {
  const on = JSON.parse(wasm.run_simulation(GACHA_LOOT_YAML, 1)).results[0]
  assertKeys('RunMetrics', on)
  assert.equal(typeof on.gacha_pulls_to_hit, 'number', 'gacha 配置下 pull 统计在')
  assert.equal(typeof on.loot_gold_per_player, 'number', 'loot 配置下产出统计在')
  const off = JSON.parse(wasm.run_simulation(YAML, 1)).results[0]
  assert.equal('gacha_pulls_to_hit' in off, false, '未配置 gacha 时键省略(≠ null)')
  assert.equal('loot_gold_per_player' in off, false, '未配置 loot 时键省略(≠ null)')
})

test('sweep_plan → SweepPlan/SweepAxis/SweepTarget 逐键一致', () => {
  const plan = JSON.parse(wasm.sweep_plan(EXP_YAML, 0))
  assertKeys('SweepPlan', plan)
  assertKeys('SweepAxis', plan.axes[0])
  assertKeys('SweepTarget', plan.targets[0])
  assert.ok(SWEEP_MODES.includes(plan.mode), `mode「${plan.mode}」未在 SWEEP_MODES 声明`)
  assert.deepEqual(
    sorted(Object.keys(plan.candidates[0])),
    sorted(plan.axes.map((a) => a.path)),
    '候选 values 的键 = 扫描轴 path',
  )
})

test('sweep_candidate → CandidateResult/SampleStats/TargetOutcome 逐键一致', () => {
  const cand = JSON.parse(
    wasm.sweep_candidate(EXP_YAML, 2, JSON.stringify({ 'model.warrior.attack': 100 })),
  )
  assert.equal(cand.status, 'ok')
  assertKeys('CandidateResult', cand)
  assert.equal(cand.metric_stats[0].length, 2, 'metric_stats 为 [id, stats] 二元组')
  assertKeys('SampleStats', cand.metric_stats[0][1])
  assertKeys('TargetOutcome', cand.target_outcomes[0])
})

test('sweep_recommend → SweepRecOutput/Elasticity/Recommendation 逐键一致', () => {
  const plan = JSON.parse(wasm.sweep_plan(EXP_YAML, 0))
  const results = plan.candidates.map((values) =>
    JSON.parse(wasm.sweep_candidate(EXP_YAML, plan.replicates, JSON.stringify(values))),
  )
  const rec = JSON.parse(wasm.sweep_recommend(EXP_YAML, JSON.stringify(results)))
  assertKeys('SweepRecOutput', rec)
  assertKeys('Elasticity', rec.elasticities[0])
  assertKeys('Recommendation', rec.recommendation)
  // 窗口外指标(retention_d7)在 3 天 toy 配置下 e 系列为 null,不是 0
  const d7 = rec.elasticities.find((e) => e.metric === 'retention_d7')
  assert.equal(d7.e, null, '不可用指标 e=null(禁止 0 填空)')
  assert.equal(d7.note, 'missing_metric')
})

test('METRIC_KEYS = 内核 MetricKey::ALL(elasticities 全覆盖)', () => {
  const plan = JSON.parse(wasm.sweep_plan(EXP_YAML, 0))
  const results = plan.candidates.map((values) =>
    JSON.parse(wasm.sweep_candidate(EXP_YAML, plan.replicates, JSON.stringify(values))),
  )
  const rec = JSON.parse(wasm.sweep_recommend(EXP_YAML, JSON.stringify(results)))
  // 绑定层测试锁死 elasticities 恰好覆盖 MetricKey::ALL
  assert.deepEqual(
    sorted(METRIC_KEYS),
    sorted(rec.elasticities.map((e) => e.metric)),
    'METRIC_KEYS 与内核 ALL 指标集漂移',
  )
  // 单候选统计里出现的 id 必在 ALL 内
  const seen = results.flatMap((c) => c.metric_stats.map((s) => s[0]))
  for (const id of seen) assert.ok(METRIC_KEYS.includes(id), `未知指标 id「${id}」`)
})

test('错误类型:绑定层前缀可分类,候选 config_error 照常上报', () => {
  assert.throws(() => wasm.validate_config('garbage: ['), (e) => {
    assert.match(String(e), /^配置错误:/)
    const err = classifyWasmError(String(e))
    assert.equal(err.kind, 'config')
    return true
  })
  assert.throws(() => wasm.run_simulation(YAML, 0), (e) => {
    assert.match(String(e), /^参数错误:/)
    assert.equal(classifyWasmError(String(e)).kind, 'param')
    return true
  })
  const bad = JSON.parse(
    wasm.sweep_candidate(EXP_YAML, 2, JSON.stringify({ 'no.such.path': 1 })),
  )
  assert.equal(bad.status.ok, undefined, '失败候选 status 为 {config_error}')
  assert.match(bad.status.config_error, /未知参数/, '注册表拒绝消息')
  assert.equal(bad.target_outcomes.length, 0)
})

test('无运行时出口的族已声明(参数定义/配置/A/B 比较,桥接落地后升级运行时锁)', () => {
  for (const name of ['ParamDefinition', 'SimConfig', 'Comparison']) {
    assert.ok(TYPES.has(name), `types.ts 缺 ${name}(WB-03.01 六族之一)`)
  }
})
