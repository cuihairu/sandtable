// 类型契约守卫(节点侧,CI web job 跑):src/lib/types.ts 的类型族与 Rust
// serde 实际序列化逐键对齐(WB-03.01)。真值源是 pkg-node 真跑内核——
// validate / run_simulation / sweep_plan / sweep_candidate / sweep_recommend
// / ab_compare 的实际 JSON 键与 TS interface 声明键双向对齐,漂移即红;
// 错误类型锁绑定层字符串前缀契约(配置错误 / 参数错误)与候选
// config_error 形状。参数定义 / 配置读写 / KPI 可用性 / A/B 比较
// (WB-03.04~.11)已全部升级为运行时锁。
// 跑法(仓库根):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/contracts.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

import * as wasm from '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js'
import { METRIC_KEYS, SWEEP_MODES } from '../src/lib/types.ts'
import { METRIC_META, metricLabel } from '../src/lib/metricMeta.ts'
import { PARAM_REGISTRY } from '../src/workbench/params/paramRegistry.ts'
import { applyParamEdits } from '../src/workbench/params/configYaml.ts'
import { classifyWasmError } from '../src/lib/errors.ts'
import { localizeWasmError } from '../src/lib/i18n/index.ts'
import { statusLabel, errorClassLabel, recoveryText, execErrorText } from '../src/workbench/tasks/taskText.ts'
import { KERNEL_SOURCE, DEMO_SOURCE, isDataSource } from '../src/lib/dataSource.ts'
import { DATA_SOURCE } from '../src/workbench/demo/sampleProject.ts'

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
    // 内核通道前缀仍是 配置错误(契约不变);解析失败在展示层是独立类
    // parse(WB-03.15:通道语义与失败阶段分开)
    assert.match(String(e), /^配置错误:/)
    const err = classifyWasmError(String(e))
    assert.equal(err.kind, 'parse')
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

test('无运行时出口的族已声明(配置/A/B 比较,桥接落地后升级运行时锁)', () => {
  for (const name of ['SimConfig', 'Comparison']) {
    assert.ok(TYPES.has(name), `types.ts 缺 ${name}(WB-03.01 六族之一)`)
  }
})

test('WB-03.04 参数定义桥接:内核注册表原样入界,恰四字段,无内核外元信息', () => {
  const defs = JSON.parse(wasm.param_registry())
  const kinds = new Set(PARAM_REGISTRY.map((p) => p.kind))
  assert.equal(defs.length, PARAM_REGISTRY.length, `条数 = 注册表全量(${PARAM_REGISTRY.length})`)
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i]
    // 恰四字段:内核未提供的可选元信息一概不出场(缺席保持缺席,不造默认值)
    assert.deepEqual(Object.keys(d).sort(), ['default', 'desc', 'kind', 'path'])
    for (const f of ['path', 'kind', 'default', 'desc']) {
      assert.equal(typeof d[f], 'string', `${d.path ?? i}.${f} 应为字符串`)
    }
    // 逐字段 = 注册表原文(声明序也锁);TS 镜像与内核任一侧漂移即红
    assert.equal(d.path, PARAM_REGISTRY[i].path, `第 ${i} 项 path`)
    assert.equal(d.kind, PARAM_REGISTRY[i].kind, `${d.path} kind`)
    assert.ok(kinds.has(d.kind), `kind "${d.kind}" 越界 ParamKind`)
    assert.equal(d.default, PARAM_REGISTRY[i].default, `${d.path} default`)
    assert.equal(d.desc, PARAM_REGISTRY[i].desc, `${d.path} desc`)
  }
  // TS 服务层两路径同源:桌面 invoke 与浏览器 wasm 绑定形状一致(WB-03.12 前置)
  const svc = read('src/lib/wasm.ts')
  assert.match(svc, /invoke\('param_registry'\)/, '桌面路径走 param_registry 命令')
  assert.match(svc, /paramRegistryBinding\(\)/, '浏览器路径走 wasm 绑定')
  assert.match(svc, /as ParamDefinition\[\]/, '返回形状声明为 ParamDefinition[]')
})

test('WB-03.05 当前配置读取:生效值来自配置,不拿注册表 default 冒充', () => {
  const yaml = `${YAML.replace('seed: 7', 'seed: 99')}model:\n  warrior: {attack: 250}\n`
  const vals = JSON.parse(wasm.param_values(yaml))
  assert.equal(vals['scenario.seed'], 99, '改过的值按当前值读出')
  assert.equal(vals['model.warrior.attack'], 250)
  // 未配置 loot → 内核真实生效缺省 1.0(read_numeric),不是前端补值
  assert.equal(vals['model.loot.rate_mult'], 1.0)
  // 非数值槽缺键 ≠ 0:时长/公式/结构表不进数值通道
  assert.ok(!('scenario.duration' in vals))
  assert.ok(!('model.loot.tables' in vals))
  assert.ok(!('model.formulas.xp_needed' in vals))
  // 数值注册路径全覆盖:64 − 7 非数值 = 57
  const nonNumeric = new Set(['dur', 'expr', 'table'])
  const numericCount = PARAM_REGISTRY.filter((p) => !nonNumeric.has(p.kind)).length
  assert.equal(Object.keys(vals).length, numericCount, '全部数值注册路径在返回里')
  // 非法配置报配置错误(与 validate_config 同前缀契约)
  assert.throws(() => wasm.param_values('schema_version: "1"\nscenario: {population: -5}\n'), (e) => {
    assert.match(String(e), /^配置错误:/)
    assert.equal(classifyWasmError(String(e)).kind, 'config')
    return true
  })
  // TS 服务层双路径接线
  const svc = read('src/lib/wasm.ts')
  assert.match(svc, /invoke\('param_values', \{ yaml \}\)/, '桌面路径走 param_values 命令')
  assert.match(svc, /paramValuesBinding\(yaml\)/, '浏览器路径走 wasm 绑定')
})

test('WB-03.06 数值应用桥接:内核寻址,错误逐类明确,应用后重验', () => {
  // 正常应用:回读值 = 应用值,hash 64 位
  const ok = JSON.parse(wasm.param_apply(YAML, 'model.warrior.attack', 250))
  assert.equal(ok.value, 250)
  assert.equal(ok.path, 'model.warrior.attack')
  assert.equal(ok.config_hash.length, 64)
  // 改值 → hash 变
  const base = JSON.parse(wasm.param_apply(YAML, 'model.warrior.attack', 100))
  assert.notEqual(base.config_hash, ok.config_hash)
  // 未知路径:带相近路径建议
  assert.throws(() => wasm.param_apply(YAML, 'model.warrior.atk', 1), (e) => {
    assert.match(String(e), /^配置错误:/)
    assert.match(String(e), /未知参数/)
    assert.equal(classifyWasmError(String(e)).kind, 'config')
    return true
  })
  // 非数值槽
  assert.throws(() => wasm.param_apply(YAML, 'scenario.duration', 30), /该参数不是数值/)
  // 非法范围:u32 为负
  assert.throws(() => wasm.param_apply(YAML, 'scenario.population', -1), /不能为负/)
  // 显式性契约:未配置 loot 应用 rate_mult → 编辑期重验即报 on_victory 缺失
  assert.throws(() => wasm.param_apply(YAML, 'model.loot.rate_mult', 2), /on_victory/)
  // TS 服务层双路径接线
  const svc = read('src/lib/wasm.ts')
  assert.match(svc, /invoke\('param_apply', \{ yaml, path, value \}\)/, '桌面路径走 param_apply 命令')
  assert.match(svc, /paramApplyBinding\(yaml, path, value\)/, '浏览器路径走 wasm 绑定')
})

test('WB-03.07 回写契约:内核通道只出 hash/回读值不出 YAML;文本层保留全部结构段', () => {
  // 内核对象通道:param_apply 返回恰三字段,永不回 YAML(serde 重序列化丢注释、
  // 重排键,禁止作为人工写回;docs/guide/22-web.md 绑定纪律节)
  const ok = JSON.parse(wasm.param_apply(YAML, 'model.warrior.attack', 250))
  assert.deepEqual(Object.keys(ok).sort(), ['config_hash', 'path', 'value'], 'param_apply 不回 YAML')
  // 文本层:全部结构性配置(枚举/公式/逐层表/loot/gacha/training)在无关数值编辑后逐字节保留
  const composed = [
    "schema_version: '1'",
    'scenario: {population: 40, duration: "3d", seed: 7}',
    'model:',
    '  warrior: {attack: 100}',
    '  training: {xp: 5, gold: 3}',
    '  formulas:',
    "    xp_needed: 'xp_base * level ^ xp_pow'",
    '  combat: {damage_model: ratio, ratio_k: 2.5}',
    '  gacha:',
    '    base_rate: 0.02',
    '    pity_hard: 90',
    '  loot:',
    '    on_victory: chest',
    '    tables:',
    '      chest:',
    '        weights: { gold_small: 70, gem: 30 }',
    '    rewards:',
    '      gold_small: { gold: 10, xp: 0 }',
    '  dungeon:',
    '    tier_table:',
    '      - { hp: 165, attack: 85, defense: 245 }',
    '',
  ].join('\n')
  const applied = applyParamEdits(composed, [{ path: 'model.warrior.attack', text: '250' }])
  assert.equal(applied.ok, true)
  assert.ok(applied.yaml.includes('warrior: {attack: 250}'), '只动了目标 token')
  for (const frag of [
    'training: {xp: 5, gold: 3}',
    "xp_needed: 'xp_base * level ^ xp_pow'",
    'damage_model: ratio',
    'pity_hard: 90',
    'weights: { gold_small: 70, gem: 30 }',
    'gold_small: { gold: 10, xp: 0 }',
    '- { hp: 165, attack: 85, defense: 245 }',
  ]) {
    assert.ok(applied.yaml.includes(frag), `结构段应逐字节保留: ${frag}`)
  }
})

test('WB-03.08 u64 安全整数边界:越界读无损表达、写明确拒绝,不静默舍入', () => {
  // 读:2^53+1 的 seed → 十进制字符串(JSON 数字会被 JS parse 成 2^53,静默丢精度)
  // BigInt 字面量保证 YAML 文本精确,BigInt 本身证明 JS number 表达不了它
  const BIG = 9007199254740993n
  assert.notEqual(`${BIG}`, `${Number(BIG)}`, '前提:2^53+1 在 JS number 下必舍入')
  const bigYaml = `schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: ${BIG}}\n`
  const vals = JSON.parse(wasm.param_values(bigYaml))
  assert.equal(vals['scenario.seed'], `${BIG}`, '越界 u64 读 = 字符串无损')
  assert.equal(typeof vals['scenario.seed'], 'string')
  // 读:安全范围内仍是数字;gacha 未配置时 pity 缺省 0 是数字
  const small = JSON.parse(wasm.param_values(YAML))
  assert.equal(small['scenario.seed'], 7)
  assert.equal(small['model.gacha.pity_hard'], 0)
  // 写:越界明确拒绝(2^53−1 上限,不静默舍入)
  assert.throws(() => wasm.param_apply(YAML, 'scenario.seed', Number(BIG)), (e) => {
    assert.match(String(e), /2\^53−1/)
    assert.equal(classifyWasmError(String(e)).kind, 'config')
    return true
  })
  // 写:边界内正常应用且回读数字
  const ok = JSON.parse(wasm.param_apply(bigYaml, 'scenario.seed', 42))
  assert.equal(ok.value, 42)
  // TS 类型面:值字段与读取表允许 string 分支
  const src = read('src/lib/wasm.ts')
  assert.match(src, /Record<string, number \| string>/, 'paramValues 类型含无损字符串分支')
  assert.match(src, /value: number \| string/, 'ParamApplyResult.value 含无损字符串分支')
})

test('WB-03.09 KPI 入口:可用性来自内核规则,可空位与内核 extract 对齐,ID 与显示名分面', () => {
  // 可用性 = 内核 unavailable_reason(天数/配置门槛),不是前端猜测
  const short = JSON.parse(wasm.kpi_availability(YAML))
  const ids = short.map((x) => x.metric).sort()
  assert.deepEqual(ids, ['gacha_pulls_to_hit', 'loot_gold_per_player', 'retention_d7'], '3d 无 gacha/loot:d7/gacha/loot 不可用')
  assert.ok(short.every((x) => typeof x.reason === 'string' && x.reason.length > 0), 'reason = 内核原文')
  // 配齐(days ≥7 + gacha + loot)→ 空 = 全部可用
  const full = 'schema_version: "1"\nscenario: {population: 40, duration: "7d", seed: 7}\nmodel:\n  gacha: {base_rate: 0.05}\n  loot:\n    on_victory: chest\n    tables:\n      chest:\n        weights: { gold_small: 100 }\n    rewards:\n      gold_small: { gold: 5, xp: 0 }\n'
  assert.deepEqual(JSON.parse(wasm.kpi_availability(full)), [], '配齐后全部可用')
  // 非法配置 → 配置错误通道
  assert.throws(() => wasm.kpi_availability('scenario: {population: -5}\n'), /^配置错误:/)
  // 可空位运行时锁:2 天跑真内核 → 可空指标如实缺席(WB-03.01 口径:
  // retention 系 = null;gacha/loot = 键省略型 skip_serializing_if),不是 0
  const run = JSON.parse(wasm.run_simulation('schema_version: "1"\nscenario: {population: 40, duration: "2d", seed: 7}\n', 1))
  const m = run.results[0]
  assert.equal(m.retention_d7, null, 'd7 可空位 = null')
  assert.equal(m.retention_d3, null, 'd3 可空位 = null')
  assert.ok(!('gacha_pulls_to_hit' in m), 'gacha 未配置 = 键省略')
  assert.ok(!('loot_gold_per_player' in m), 'loot 未配置 = 键省略')
  assert.ok(m.win_rate !== null && typeof m.win_rate === 'number', '非空位有值')
  // metricMeta nullable 表与内核逐项对齐(与上面 null 集合一致)
  const meta = METRIC_META
  for (const key of METRIC_KEYS) {
    const nullAtRun = ['retention_d7', 'retention_d3', 'gacha_pulls_to_hit', 'loot_gold_per_player'].includes(key)
    assert.equal(meta[key].nullable, nullAtRun, `${key} nullable 应与内核 extract Option 对齐`)
  }
  // ID 与显示名分面:显示名 ≠ 内核 ID(两语言),ID 是机器列名
  assert.notEqual(metricLabel('win_rate', 'zh-CN'), 'win_rate')
  assert.notEqual(metricLabel('win_rate', 'en-US'), 'win_rate')
  // TS 桥接接线
  const svc = read('src/lib/wasm.ts')
  assert.match(svc, /invoke\('kpi_availability', \{ yaml \}\)/, '桌面路径走 kpi_availability 命令')
  assert.match(svc, /kpiAvailabilityBinding\(yaml\)/, '浏览器路径走 wasm 绑定')
})

test('WB-03.10/11 A/B 桥:compare_arms 内核直出 Comparison,成对前提/可用性/未知指标显式拒绝', () => {
  // 真跑双臂(同 seed,attack 不同)→ 内核 CRN 配对结论
  const baseYaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\n'
  const candYaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nmodel:\n  warrior:\n    attack: 110\n'
  const a = JSON.parse(wasm.run_simulation(baseYaml, 3))
  const b = JSON.parse(wasm.run_simulation(candYaml, 3))
  const cmp = JSON.parse(wasm.ab_compare(baseYaml, candYaml, 'win_rate', JSON.stringify(a.results), JSON.stringify(b.results)))
  // 键集与 TS Comparison 同构(WB-03.01 口径):恰 8 键,verdict 是内核三值
  assert.deepEqual(Object.keys(cmp).sort(), ['arm_a', 'arm_b', 'diff_ci95_hi', 'diff_ci95_lo', 'diff_mean', 'effect_size_d', 'metric', 'verdict'])
  assert.ok(['BHigher', 'AHigher', 'NoDifference'].includes(cmp.verdict), `${cmp.verdict}`)
  assert.ok(['BHigher', 'AHigher', 'NoDifference'].includes(cmp.arm_a.verdict ?? cmp.arm_b.verdict) === false, 'SampleStats 无 verdict')
  assert.equal(cmp.metric, 'win_rate')
  assert.equal(cmp.arm_a.n, 3)
  assert.equal(cmp.arm_b.n, 3)
  // CRN 配对口径:diff_mean = cand 均值 − base 均值(内核算,前端不重算)
  const mean = (arm) => arm.results.reduce((s, m) => s + m.win_rate, 0) / arm.results.length
  assert.ok(Math.abs(cmp.diff_mean - (mean(b) - mean(a))) < 1e-9)
  // 桥接签名带双臂 YAML(内核校验同种子)与 metric
  const wrongSeed = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 9}\n'
  const c = JSON.parse(wasm.run_simulation(wrongSeed, 3))
  assert.throws(
    () => wasm.ab_compare(baseYaml, wrongSeed, 'win_rate', JSON.stringify(a.results), JSON.stringify(c.results)),
    (e) => String(e).includes('base_seed 不一致') && classifyWasmError(String(e)).kind === 'config',
    'CRN 成对前提破坏 = 配置错误',
  )
  // 指标在某臂不可用 → 配置错误,不静默跳过
  assert.throws(
    () => wasm.ab_compare(baseYaml, candYaml, 'retention_d7', JSON.stringify(a.results), JSON.stringify(b.results)),
    (e) => String(e).includes('retention_d7') && String(e).includes('不可用') && classifyWasmError(String(e)).kind === 'config',
  )
  // 未知指标 → 参数错误 + 内核可选清单
  assert.throws(
    () => wasm.ab_compare(baseYaml, candYaml, 'winrate', JSON.stringify(a.results), JSON.stringify(b.results)),
    (e) => String(e).includes('参数错误: 未知指标 winrate') && String(e).includes('win_rate'),
  )
  // results 不是合法结果数组 → 参数错误
  assert.throws(
    () => wasm.ab_compare(baseYaml, candYaml, 'win_rate', '[{"win_rate":', JSON.stringify(b.results)),
    (e) => String(e).includes('参数错误') && String(e).includes('base 臂结果解析失败'),
  )
  // replicate 不等长 → 配置错误
  const one = JSON.parse(wasm.run_simulation(baseYaml, 1))
  assert.throws(
    () => wasm.ab_compare(baseYaml, candYaml, 'win_rate', JSON.stringify(one.results), JSON.stringify(b.results)),
    (e) => String(e).includes('replicate 数不一致或为 0'),
  )
  // TS 桥接接线(双通道):桌面 invoke + 浏览器绑定,双端同构
  const svc = read('src/lib/wasm.ts')
  assert.match(svc, /invoke\('ab_compare', \{/, '桌面路径走 ab_compare 命令')
  assert.match(svc, /abCompareBinding\(/, '浏览器路径走 wasm 绑定')
  // 执行器接线:唯一调用点带双臂 YAML + metric;worker 协议含 ab_compare 面。
  // ExecSpec 是 kind 判别联合(baseYaml/candYaml/metric 只在 ab 变体),
  // 先按 kind 收窄再取字段——直接 spec.baseYaml 会不编译。
  const exec = read('src/workbench/state/executor.ts')
  assert.match(exec, /const ab = spec\.kind === 'ab' \? spec : null/, '比较调用前先按 kind 收窄到 ab 变体')
  assert.match(exec, /be\.compare\(ab\.baseYaml, ab\.candYaml, ab\.metric, outputs\.base!, outputs\.cand!\)/)
  assert.match(exec, /kind: 'ab_compare'/)
  assert.match(exec, /wasm\.abCompare\(baseYaml, candYaml, metric, base\.results, cand\.results\)/)
  // 设计页入队:比较指标 = 首个设计目标(缺省 win_rate,内核判定合法性)
  const page = read('src/workbench/pages/DesignerPage.tsx')
  assert.match(page, /metric: design\.targets\[0\]\?\.metric \?\? 'win_rate'/)
})

test('WB-03.13 绑定生成守卫:TS 包装的命名导入必在 pkg 双面生成(node 运行时 + web pkg JS + .d.ts)', () => {
  // 收集 src 里全部 from 'sandtable-wasm' 的命名导入(服务层 + Worker 入口;
  // `import init` 默认导出由初始化路径覆盖,不在本守卫)
  const files = ['src/lib/wasm.ts', 'src/workbench/state/sweepWorker.entry.ts']
  const exports = new Map() // 内核导出名 → 使用处别名
  for (const f of files) {
    const src = read(f)
    const m = src.match(/import\s+(?:init\s*,\s*)?\{([\s\S]*?)\}\s*from\s*['"]sandtable-wasm['"]/)
    assert.ok(m, `${f} 应从 'sandtable-wasm' 命名导入绑定`)
    for (const raw of m[1].split(',')) {
      const entry = raw.trim()
      if (!entry) continue
      const [orig, alias] = entry.split(/\s+as\s+/).map((s) => s.trim())
      exports.set(orig, alias ?? orig)
    }
  }
  assert.ok(exports.size >= 10, `应覆盖全部桥接导出(得到 ${exports.size})`)
  // 面 1:pkg-node 运行时真值(本文件已 import * as wasm 真加载)
  for (const [orig] of exports) {
    assert.equal(typeof wasm[orig], 'function', `pkg-node 未生成导出 ${orig}:wasm 导出变更后须重建 pkg-node(--target nodejs --out-dir pkg-node --dev)`)
  }
  // 面 2/3:web pkg(浏览器面 + 类型声明)——存在即校验,不存在如实跳过
  // (CI 先建 pkg 再跑测试;本地未建不红,但建了就必须双面齐)
  const pkgJs = join(here, '../../../crates/sandtable-wasm/pkg/sandtable_wasm.js')
  const pkgDts = join(here, '../../../crates/sandtable-wasm/pkg/sandtable_wasm.d.ts')
  if (existsSync(pkgJs) && existsSync(pkgDts)) {
    const js = readFileSync(pkgJs, 'utf8')
    const dts = readFileSync(pkgDts, 'utf8')
    for (const [orig] of exports) {
      assert.match(js, new RegExp(`export function ${orig}\\b`), `pkg(web)JS 未生成 ${orig}:须重建 pkg(--target web --release)`)
      assert.match(dts, new RegExp(`export function ${orig}\\b`), `pkg(web).d.ts 未声明 ${orig}:须重建 pkg(--target web --release)`)
    }
  }
})

test('WB-03.14 服务层唯一面:内核数据通道只经 lib/wasm.ts(+ Worker 入口),组件不散落 invoke / wasm 直连', () => {
  // 允许直连的两个面:统一服务层(桌面 invoke / 浏览器 init 的分流都在这里)
  // 与 Worker 入口(Worker 线程内独立 init 是其本职)
  const allowed = ['src/lib/wasm.ts', 'src/workbench/state/sweepWorker.entry.ts']
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : [],
    )
  const srcRoot = join(here, '..', 'src')
  const offenders = []
  for (const abs of walk(srcRoot)) {
    const rel = relative(srcRoot, abs).split(sep).join('/')
    if (allowed.includes(`src/${rel}`)) continue
    const src = readFileSync(abs, 'utf8')
    if (/from\s+['"]sandtable-wasm['"]/.test(src)) offenders.push(`${rel}: 直连 sandtable-wasm 绑定`)
    if (/@tauri-apps\/api\/core/.test(src)) offenders.push(`${rel}: 直连 tauri invoke/Channel`)
    if (/'__TAURI_INTERNALS__'/.test(src)) offenders.push(`${rel}: 重复嗅探桌面环境(isDesktop 走服务层)`)
  }
  assert.deepEqual(offenders, [], '内核数据通道必须经 lib/wasm.ts 服务层双路径分流(桌面 invoke / 浏览器 wasm init),组件不得散落直连')
})

test('WB-03.15 统一错误分类:解析/配置/参数/序列化四码 + locale 展示;初始化与取消走任务状态面', () => {
  // 分类表:解析失败是独立类——内核把 YAML 解析并进 配置错误 通道(前缀契约
  // 不变),展示层按「解析失败」事实升级为 parse 码;候选结果解析失败带
  // 参数错误 前缀,同为 parse
  const table = [
    ['配置错误: YAML 解析失败: while parsing a block', 'parse'],
    ['参数错误: base 臂结果解析失败: expected value', 'parse'],
    ['配置错误: 双臂 base_seed 不一致(base=7 cand=9)', 'config'],
    ['参数错误: replicates 至少为 1', 'param'],
    ['候选结果序列化失败: boom', 'serialize'],
    ['totally unknown', 'other'],
  ]
  for (const [message, kind] of table) {
    assert.equal(classifyWasmError(message).kind, kind, message)
  }
  // locale 展示:稳定错误码不随语言变,词典模板不同,内核原文逐字进 detail
  for (const [message] of table) {
    const zh = localizeWasmError('zh-CN', message)
    const en = localizeWasmError('en-US', message)
    assert.equal(zh.code, en.code, message)
    assert.ok(zh.text.includes(message) && en.text.includes(message), `detail 逐字保留: ${message}`)
    assert.notEqual(zh.text, en.text, `两语言模板不同: ${message}`)
  }
  // 界面正文(execErrorText):内核通道类套 locale 模板且剥通道前缀
  // (不得出现「配置错误：配置错误: …」重复);不可识别消息原样返回
  const cfgMsg = '配置错误: 双臂 base_seed 不一致(base=7 cand=9)'
  assert.match(execErrorText(cfgMsg, 'en-US'), /^Configuration error: 双臂 base_seed 不一致/)
  assert.match(execErrorText(cfgMsg, 'zh-CN'), /^配置错误：双臂 base_seed 不一致/)
  assert.ok(!execErrorText(cfgMsg, 'zh-CN').includes('配置错误：配置错误'), '不得重复通道前缀')
  assert.equal(execErrorText('内核桥接未接入(WB-03.10/11)', 'en-US'), '内核桥接未接入(WB-03.10/11)', '不可识别消息原样返回')
  // 初始化失败/运行/预算/桥接 = ExecErrorClass 面,locale 显示与恢复动作;
  // 取消不是错误(状态机 cancelled/cancelling,不是 errorClass)
  assert.match(errorClassLabel('init', 'zh-CN'), /初始化失败/)
  assert.equal(errorClassLabel('init', 'en-US'), 'Initialization failed')
  assert.match(recoveryText('init', 'ab', 'zh-CN'), /重试初始化/)
  // 初始化中:首个请求内完成 init,以 running 展示(不伪造进度,WB-07.05)
  assert.match(statusLabel('running', 'zh-CN'), /运行中/)
  assert.match(statusLabel('cancelled', 'zh-CN'), /已取消/)
  assert.equal(statusLabel('cancelled', 'en-US'), 'Cancelled')
})

test('WB-03.16 数据来源标记:kernel/synthetic_demo 单一出处,运行集合代码面不依赖演示模块', () => {
  // 标记定义:两个值,别处不另立来源口径
  assert.equal(KERNEL_SOURCE, 'kernel')
  assert.equal(DEMO_SOURCE, 'synthetic_demo')
  assert.ok(isDataSource('kernel') && isDataSource('synthetic_demo'))
  for (const bad of [undefined, null, '', 'Kernel', 'cli', 'demo', 7]) {
    assert.ok(!isDataSource(bad), `非法来源值: ${JSON.stringify(bad)}`)
  }
  // 演示项目的来源标记从单一出处取,不写死字符串
  assert.equal(DATA_SOURCE, DEMO_SOURCE)
  // 代码面边界:运行集合/执行引擎/文档层不 import 演示数据模块
  for (const face of ['src/workbench/state/projectDoc.ts', 'src/workbench/state/runManager.ts']) {
    assert.ok(!/from\s+['"][^'"]*demo\//.test(read(face)), `${face} 不得 import 演示模块`)
  }
  // 登记链:快照来源字段落到运行索引条目,报告导出带 data_source 标记。
  // WB-09.04 起真实 run 的 JSON 信封从 exportScope 单点取(kernel 声明在那里),
  // 页面不再内联拼信封——页面改挂 scopedRunJson,字面量守卫移到 exportScope。
  // WB-10.01 起登记条目映射提到 projectDoc 单点(闭环测试复用同一映射),
  // 页面只挂 runIndexEntryOf,不再内联拼条目、不写死来源标记。
  assert.match(read('src/workbench/state/projectDoc.ts'), /data_source: snap\.dataSource/)
  assert.match(read('src/workbench/pages/DesignerPage.tsx'), /runIndexEntryOf\(snap/)
  assert.ok(!/data_source:\s*['"]/.test(read('src/workbench/pages/DesignerPage.tsx')), '页面不写死来源标记')
  assert.match(read('src/workbench/analysis/exportScope.ts'), /data_source: 'kernel'/)
  assert.match(read('src/workbench/pages/AnalysisPage.tsx'), /scopedRunJson\(job, ui, 'all', runEntry\)/)
  // 真实运行集合的三道闸都在索引代码面(写闸/入口闸/读闸)
  assert.match(read('src/workbench/state/projectDoc.ts'), /真实运行集合只收 kernel/)
  assert.match(read('src/workbench/state/projectDoc.ts'), /不得登记为运行快照/)
  assert.match(read('src/workbench/state/projectDoc.ts'), /不得混入真实运行集合/)
})

test('WB-02.18 桌面本地查询迁入交换页:纯逻辑出壳,服务层唯一面与插件动态导入守卫', () => {
  // 纯逻辑面节点可测且不依赖绑定/native(import 仅类型)
  const logic = read('src/lib/localQuery.ts')
  assert.ok(!/sandtable-wasm|@tauri-apps/.test(logic), 'localQuery.ts 保持纯逻辑,不得依赖绑定/native')
  // 交换页:本地查询走服务层 queryLocal + isDesktop 门;插件对话框动态导入
  const page = read('src/workbench/pages/ExchangePage.tsx')
  assert.match(page, /import \{ isDesktop, queryLocal \} from '\.\.\/\.\.\/lib\/wasm\.ts'/)
  assert.match(page, /await import\('@tauri-apps\/plugin-dialog'\)/)
  assert.ok(!/from '@tauri-apps\/plugin-dialog'/.test(page), 'plugin-dialog 只能动态导入(不进浏览器包)')
  assert.match(page, /columnsFromLocal\(await queryLocal\(/, '面板 run 必须经纯逻辑整形再渲染')
  assert.match(page, /\{isDesktop && \(/, '本地查询段仅桌面渲染')
})

test('WB-11.11 资源树演示数据侧接词典:分组/文档名走 t(),数据本体保持原文', () => {
  const app = read('src/workbench/WorkbenchApp.tsx')
  // 分组名与演示文档名随 locale;文档标签同源键复用(nav.tab.*)
  assert.match(app, /title: t\(locale, 'nav\.explorer\.config'\)/)
  assert.match(app, /title: t\(locale, 'nav\.tab\.parameters'\)/)
  assert.match(app, /title: t\(locale, 'nav\.tab\.designer'\)/)
  assert.match(app, /title: t\(locale, 'nav\.tab\.analysis'\)/)
  assert.match(app, /tPlural\(locale, 'nav\.explorer\.metaChanges'/, '变更数描述行走复数词条')
  // 命令面板页面行 label/hint 与参数名随 locale,不再写死 zh-CN
  assert.match(app, /label: t\(locale, NAV_PAGE_LABEL\[p\]\)/)
  assert.match(app, /hint: t\(locale, NAV_TAB_LABEL\[p\]\)/)
  assert.ok(!/displayParamName\(param\.path, 'zh-CN'\)/.test(app), '命令面板参数名必须随 locale')
  // 数据本体保持原文:导出文件名不进词典(与项目名同一口径)
  assert.match(app, /title: '候选汇总\.csv'/)
  assert.match(app, /title: '实验快照\.json'/)
})

test('WB-09.07 真实 run 终局落档与归档重开:登记簿回显、产物可再导出、失败不显示成功', () => {
  // App:终局落档接线 —— 机器快照走 scopedRunJson(spec = 关联配置),run 只落一次
  const app = read('src/workbench/WorkbenchApp.tsx')
  assert.match(
    app,
    /results\/\$\{exec\.runId\}\.report\.json.*scopedRunJson\(/s,
    '终局快照 = 运行 JSON 单点口径,spec 关联配置随档案走',
  )
  assert.match(app, /type: 'run\/artifacts'/)
  assert.match(app, /restoreRunsFromArchive\(doc\.files\)/, '重开归档恢复登记簿')
  // 恢复失败给可读错误;在场产物逐 run 挂回登记簿
  assert.match(app, /if \(restored\.error !== null\)/)
  assert.match(app, /type: 'run\/register', entry, artifacts: own \}/)
  // 纯逻辑:恢复只收在场条目,缺失不虚构占位
  const doc = read('src/workbench/state/projectDoc.ts')
  assert.match(doc, /export function restoreRunsFromArchive\(/)
  assert.match(doc, /if \(bytes !== undefined\) artifacts\[f\] = bytes/, '不在场不占位')
  // 状态机:产物合并 + 索引 files 去重登记
  const store = read('src/workbench/state/workbenchStore.ts')
  assert.match(store, /case 'run\/artifacts':/)
  assert.match(store, /paths\.filter\(\(p\) => !r\.files\.includes\(p\)\)/)
  // 登记簿:在场产物给下载再导出;内容不在场不下载不提示成功
  const panels = read('src/workbench/project/ProjectPanels.tsx')
  assert.match(panels, /artifactOf\(f\)/)
  assert.match(panels, /if \(data !== undefined\) download\(/, '竞态缺内容不下载不显示成功')
  assert.match(panels, /t\(locale, 'data\.project\.downloadArtifact'\)/)
})

test('WB-09.08 下载成功口径:真实产物名可追溯(run id),失败/取消不显示成功', () => {
  const app = read('src/workbench/WorkbenchApp.tsx')
  const page = read('src/workbench/pages/AnalysisPage.tsx')
  // 真实上下文导出名全部带 run id(可追溯;不用虚构时间戳,溯源键是 run)
  assert.ok(app.includes('`${exec.runId}-candidates.csv`'), 'CSV 名带 run id')
  assert.ok(app.includes('`${exec.runId}-${metric}.svg`'), 'SVG 名带 run id 与指标')
  assert.ok(app.includes('`${exec.runId}.json`'), 'JSON 名带 run id')
  assert.ok(page.includes('`${exec.runId}-drafts.json`'), '草稿批量名带 run id')
  // 成功提示只在真实下载之后:csv/svg/json 分支 notify 都紧跟 download 落行
  assert.match(
    app,
    /download\(`\$\{exec\.runId\}-candidates\.csv`[\s\S]{0,120}notify\('success', t\(locale, 'common\.notifyCsvDownloaded'/,
    'CSV 成功提示在下载之后',
  )
  assert.match(
    app,
    /download\(`\$\{exec\.runId\}-\$\{metric\}\.svg`[\s\S]{0,200}notify\('success', t\(locale, 'analysis\.exportRunSvgDone'/,
    'SVG 成功提示在下载之后',
  )
  assert.match(
    app,
    /download\(`\$\{exec\.runId\}\.json`[\s\S]{0,200}notify\('success'/,
    'JSON 成功提示在下载之后',
  )
  // SVG 无主图分支:不下载也不提示成功(notify 在 mainChart 非空守卫内)
  assert.match(
    app,
    /if \(mainChart !== null\) \{\s*const metric[\s\S]*download\(`\$\{exec\.runId\}-\$\{metric\}\.svg`[\s\S]*?exportRunSvgDone[\s\S]*?\}\s*return\s*\}/,
    '无主图时整段跳过(无下载无成功提示)',
  )
  // 桌面壳:下载落 ~/Downloads 重名加序号(不覆盖),落盘结果显式上报(不静默)
  const desktop = read('../../apps/desktop/src-tauri/src/lib.rs')
  assert.match(desktop, /DownloadEvent::Finished \{ success/, '下载完成态显式上报(无头走查凭据)')
  assert.match(desktop, /download_destination/, '重名加序号落点')
  assert.match(desktop, /fn download_destination_uniquifies/, '桌面落点有独立测试(web 侧不重复验)')
})
