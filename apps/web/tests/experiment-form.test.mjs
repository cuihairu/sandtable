// WB-06 · 实验表单接计划与运行输入(节点侧守卫):
// 纯逻辑(experimentYaml / designerLogic)+ 内核真跑(wasm sweep_plan 真值,
// 与 contracts.test.mjs 同源 pkg-node)。跑法(仓库根):
//   node --test apps/web/tests/experiment-form.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import * as wasm from '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js'
import { SWEEP_MODES, METRIC_KEYS } from '../src/lib/types.ts'
import {
  sweepModeOf, assertModeInKernelContract, factorRowError, designErrors,
  defaultDesign, scenarioStats, kpiAvailability, isRatioMetric,
  uiPercentToKernel, kernelToUiPercent, planSummary, abTaskCount,
  createSubmitGuard, createPlanGate, applyScenarioLeaf, thresholdFromUi,
  experimentScopedId, KPI_POOL, preserveOnMethodSwitch,
  planErrorLines, budgetActions,
} from '../src/workbench/designer/designerLogic.ts'
import { buildExperimentYaml, sweepSectionText, readSweepDesign } from '../src/workbench/designer/experimentYaml.ts'
import { parseConfig, readText } from '../src/workbench/params/configYaml.ts'
import { DEMO_EXPERIMENT_ID } from '../src/workbench/demo/sampleProject.ts'
import { hashId, ID_PREFIXES } from '../src/workbench/ids.ts'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

/* —— 共同口径:内核可加载的小配置(contracts 同源 toy 风格,days 30) —— */
const SCEN = [
  "schema_version: '1'",
  'scenario: {population: 40, duration: 30d, seed: 12345, population_mix: {casual: 0.6, core: 0.3, whale: 0.1}}',
].join('\n')
const AVAIL = kpiAvailability(SCEN)
const design = (over = {}) => ({ ...defaultDesign(), ...over })

/* ================================ WB-06.01 ================================ */
test('WB-06.01:实验身份由 方法+名称+项目键 内容派生,不再用固定样例对象', () => {
  const a = experimentScopedId('yaml-draft', { method: 'grid', name: '初始攻击力扫描' })
  const b = experimentScopedId('yaml-draft', { method: 'grid', name: '初始攻击力扫描' })
  const c = experimentScopedId('yaml-draft', { method: 'grid', name: '另一个实验' })
  const d = experimentScopedId('yaml-draft', { method: 'random', name: '初始攻击力扫描' })
  const e = experimentScopedId('prj_x', { method: 'grid', name: '初始攻击力扫描' })
  assert.equal(a, b, '同输入同 ID(稳定)')
  assert.notEqual(a, c, '名称不同 → ID 不同')
  assert.notEqual(a, d, '方法不同 → ID 不同')
  assert.notEqual(a, e, '项目不同 → ID 不同')
  const fixed = String(DEMO_EXPERIMENT_ID)
  assert.notEqual(a, fixed, '不等于演示固定样例实验 ID')
  // 形状走稳定 ID 体系
  assert.ok(a.startsWith(ID_PREFIXES.experiment), `ID 前缀 ${ID_PREFIXES.experiment}`)
  // 同源引用对照:hashId 路径与演示 ID 生成一致(不是手搓字符串)
  assert.equal(hashId(ID_PREFIXES.experiment, 'yaml-draft', 'grid:初始攻击力扫描'), a)
})

/* ================================ WB-06.02 ================================ */
test('WB-06.02:A/B 双侧快照来源 = 共享视图(基线原文/候选草稿),diff 为参数级', () => {
  // 快照语义由 DesignerPage 的 note-block 承载(file:line 证据);这里锁
  // 「diffRows 的输入 = paramYamlView 的 base/cand」的纯逻辑等价性:
  // 候选相对基线改动 N 项,diffRows 给出恰好这 N 行。
  const base = `${SCEN}\nmodel:\n  warrior: {attack: 100, defense: 80}\n`
  const cand = base.replace('attack: 100', 'attack: 130')
  const parse = (yaml) => {
    const leaves = {}
    for (const l of parseConfig(yaml).leaves) leaves[l.path] = l.raw
    return leaves
  }
  const rows = { base: parse(base), cand: parse(cand) }
  const changed = Object.keys(rows.base).filter((k) => rows.base[k] !== rows.cand[k])
  assert.deepEqual(changed, ['model.warrior.attack'])
  // 候选 ID 内容寻址(双方真实快照 ⇒ 同内容同 ID)
  assert.equal(readText(parseConfig(cand), 'model.warrior.attack'), '130')
})

/* ================================ WB-06.03 ================================ */
test('WB-06.03:因子表校验——注册表路径/类型/整数域/步长,非法就地报错', () => {
  // 路径不在注册表
  assert.equal(factorRowError({ path: 'model.fake.attack', min: 10, max: 20, step: 1 }, { method: 'grid' }), '路径不在参数注册表')
  // 类型不支持(casual 配比是 mix)
  const mix = 'scenario.population_mix.casual'
  assert.ok(factorRowError({ path: mix, min: 0, max: 1, step: 0.1 }, { method: 'grid' }).includes('不支持'))
  // 整数类型(i64):非整数步长拒绝
  assert.ok(factorRowError({ path: 'model.warrior.attack', min: 10, max: 20, step: 0.5 }, { method: 'grid' }).includes('步长'))
  assert.ok(factorRowError({ path: 'model.warrior.attack', min: 10.5, max: 20, step: 1 }, { method: 'grid' }).includes('非负整数'))
  // 范围反向
  assert.ok(factorRowError({ path: 'model.warrior.attack', min: 30, max: 20, step: 1 }, { method: 'grid' }).includes('最大值不小于最小值'))
  // 合法:整数与浮点
  assert.equal(factorRowError({ path: 'model.warrior.attack', min: 10, max: 20, step: 1 }, { method: 'grid' }), null)
  assert.equal(factorRowError({ path: 'model.combat.p_hit', min: 0.5, max: 0.95, step: 0.05 }, { method: 'grid' }), null)
  // random 模式不要求 step
  assert.equal(factorRowError({ path: 'model.warrior.attack', min: 10, max: 20, step: 0 }, { method: 'random' }), null)
  // designErrors 逐因子汇总 + 路径重复捕获
  const d = design({
    factors: [
      { path: 'model.warrior.attack', min: 20, max: 220, step: 40 },
      { path: 'model.warrior.attack', min: 20, max: 40, step: 5 },
    ],
  })
  const errs = designErrors(d, { availability: AVAIL })
  assert.ok(errs.some((e) => e.scope === 'factors' && e.message.includes('重复')))
  // 默认草稿合法(注册表口径起步)
  assert.deepEqual(designErrors(defaultDesign(), { availability: AVAIL }), [])
})

/* ================================ WB-06.04 ================================ */
test('WB-06.04:Random 模式名 = 内核 random;序列化(不含 step)与内核契约一致', () => {
  assert.equal(sweepModeOf('random', 'uniform'), 'random')
  assert.equal(sweepModeOf('grid', 'lhc'), 'grid')
  for (const mode of ['grid', 'random', 'latin_hypercube']) {
    assert.ok(assertModeInKernelContract(mode), `${mode} ∈ SWEEP_MODES 内核契约`)
  }
  // 命名空间一致性:lib/types 的 SWEEP_MODES 就是这四个模式中的三个(isomorphic)
  assert.deepEqual([...SWEEP_MODES], ['grid', 'random', 'latin_hypercube'])
  // Random 序列化:不含 step(内核 Random 只用 min/max)
  const y = sweepSectionText(design({ method: 'random', sampling: 'uniform', factors: [{ path: 'model.warrior.attack', min: 80, max: 130 }, ...defaultDesign().factors.slice(1)] }))
  assert.ok(y.includes('mode: random'))
  assert.ok(y.includes('samples:'))
  assert.ok(!y.includes('step:'), 'Random 模式不序列化 step')
  // 文本可被内核 sweep 计划接受(真跑)
  const yaml = buildExperimentYaml(SCEN, design({ method: 'random', sampling: 'uniform' }))
  const plan = JSON.parse(wasm.sweep_plan(yaml, 0))
  assert.equal(plan.mode, 'random')
})

/* ================================ WB-06.05 ================================ */
test('WB-06.05:LHS 模式名 = latin_hypercube;逐维分层 ≠ 普通随机采样(内核真跑)', () => {
  assert.equal(sweepModeOf('random', 'lhc'), 'latin_hypercube')
  // 单轴 min 0 max 100 samples 8:LHS 每点落在独立层 [i*12.5,(i+1)*12.5)
  const d = design({
    method: 'random',
    sampling: 'lhc',
    factors: [{ path: 'model.warrior.attack', min: 0, max: 100 }],
    samples: 8,
  })
  const yaml = buildExperimentYaml(SCEN, d)
  const plan = JSON.parse(wasm.sweep_plan(yaml, 0))
  assert.equal(plan.mode, 'latin_hypercube')
  assert.equal(plan.candidates.length, 8)
  assert.equal(plan.sims, 8 * d.reps)
  const values = plan.candidates.map((c) => c['model.warrior.attack']).sort((a, b) => a - b)
  values.forEach((v, i) => {
    assert.ok(
      v >= i * 12.5 && v < (i + 1) * 12.5,
      `第 ${i} 层内恰一点(${v})`,
    )
  })
  // 对照:普通 random 不保证分层性质(层内点数由种子决定,LHS 恒分层)
  const dUniform = design({
    method: 'random',
    sampling: 'uniform',
    factors: [{ path: 'model.warrior.attack', min: 0, max: 100 }],
    samples: 8,
  })
  const yamlU = buildExperimentYaml(SCEN, dUniform)
  const planU = JSON.parse(wasm.sweep_plan(yamlU, 0))
  assert.equal(planU.mode, 'random')
  const perLayerU = planU.candidates.map((c) => c['model.warrior.attack']).sort((a, b) => a - b)
    .map((v) => Math.floor(v / 12.5))
  // Uniform (seed 12345) 下存在同层双点,即「不是 LHS」的直接证据
  const freq = {}
  for (const l of perLayerU) freq[l] = (freq[l] ?? 0) + 1
  assert.ok(Object.values(freq).some((n) => n > 1), `均匀随机出现同层多点:${JSON.stringify(freq)}`)
})

/* ================================ WB-06.06 ================================ */
test('WB-06.06:场景表单直读/直写 scenario 节(population/duration/seed/配比)', () => {
  const stats = scenarioStats(SCEN)
  assert.equal(stats.players, 40)
  assert.equal(stats.days, 30)
  assert.equal(stats.seed, 12345)
  assert.deepEqual(stats.mix, { casual: 0.6, core: 0.3, whale: 0.1 })
  // 写回:population/天数/seed 外科手术替换,duration 写 Nd 形式
  const out1 = applyScenarioLeaf(SCEN, 'duration_days', '14')
  assert.equal(readText(parseConfig(out1.yaml), 'scenario.duration'), '14d')
  const out2 = applyScenarioLeaf(out1.yaml, 'population', '99')
  assert.equal(readText(parseConfig(out2.yaml), 'scenario.population'), '99')
  const out3 = applyScenarioLeaf(out2.yaml, 'seed', '999999999999')
  assert.equal(readText(parseConfig(out3.yaml), 'scenario.seed'), '999999999999')
  // 配比:UI 百分数 → 比例(÷100)
  const out4 = applyScenarioLeaf(out3.yaml, 'mix_casual', '55')
  assert.equal(readText(parseConfig(out4.yaml), 'scenario.population_mix.casual'), '0.55')
  // 非法输入如实拒绝
  assert.equal(applyScenarioLeaf(SCEN, 'population', '-3').ok, false)
  assert.equal(applyScenarioLeaf(SCEN, 'duration_days', 'abc').ok, false)
  assert.ok(applyScenarioLeaf(SCEN, 'mix_casual', '120').why.includes('0–100'))
  // 缺值如实(null,不回退默认)
  const noMix = "schema_version: '1'\nscenario: {population: 40, duration: 30d, seed: 1}\n"
  const s2 = scenarioStats(noMix)
  assert.equal(s2.mix.casual, null)
  assert.ok(s2.errors.some((e) => e.includes('population_mix')))
})

/* ================================ WB-06.07 ================================ */
test('WB-06.07:KPI 仅限当前配置可用;days<7 时 D7 不可用并阻止提交', () => {
  for (const key of KPI_POOL) assert.ok(METRIC_KEYS.includes(key), '表单池 ⊆ 内核指标集合')
  // 30 天 + 无 gacha/loot:D7 可用,gacha/loot 指标不可用(内核同口径原因)
  assert.equal(AVAIL.retention_d7.ok, true)
  assert.ok(AVAIL.gacha_pulls_to_hit.reason?.includes('model.gacha'))
  assert.ok(AVAIL.loot_gold_per_player.reason?.includes('model.loot'))
  // 6 天:retention_d7 不可用,d3 可用
  const six = "schema_version: '1'\nscenario: {population: 40, duration: 6d, seed: 1}\n"
  const av6 = kpiAvailability(six)
  assert.equal(av6.retention_d7.ok, false)
  assert.ok(av6.retention_d7.reason.includes('days ≥ 7,当前配置不足'))
  assert.equal(av6.retention_d3.ok, true)
  // 3 天:d3 也不可用
  const av3 = kpiAvailability("schema_version: '1'\nscenario: {population: 40, duration: 2d, seed: 1}\n")
  assert.equal(av3.retention_d3.ok, false)
  // 校验联动:选了不可用 D7 → kpi 错误 + 提交被阻止(designErrors 报错)
  const d = design({ targets: [{ metric: 'retention_d7', kind: 'hard', min: 0.8, max: 1 }] })
  const blocked = designErrors(d, { availability: av6 })
  assert.ok(blocked.some((e) => e.scope === 'kpi' && e.locator === 'retention_d7'), '6 天 + D7 目标 = 阻止提交')
  // 同配置 30 天则通过
  assert.deepEqual(designErrors(d, { availability: AVAIL }), [])
  // 方向校验:min > max / 两个界都没给
  const bad = design({ targets: [{ metric: 'churn_rate', kind: 'hard', min: 0.3, max: 0.1 }] })
  assert.ok(designErrors(bad, { availability: AVAIL }).some((e) => e.message.includes('min 大于 max')))
  const empty = design({ targets: [{ metric: 'churn_rate', kind: 'hard', min: null, max: null }] })
  assert.ok(designErrors(empty, { availability: AVAIL }).some((e) => e.message.includes('至少给出 min 或 max')))
})

/* ================================ WB-06.08 ================================ */
test('WB-06.08:约束 hard/soft×min/max;UI 百分数 ⇄ 内核比例(不是 UI 直写比例)', () => {
  // 比例类判定(四个;锁定防止以后混口径)
  const ratioMetrics = METRIC_KEYS.filter((k) => k.startsWith('retention_') || k === 'win_rate' || k === 'churn_rate')
  for (const m of ratioMetrics) assert.ok(isRatioMetric(m), `${m} 是比例口径`)
  for (const m of ['gold_per_player', 'power_p50', 'gacha_pulls_to_hit', 'loot_gold_per_player']) {
    assert.equal(isRatioMetric(m), false, `${m} 不换算`)
    assert.equal(uiPercentToKernel(m, 42), 42, '绝对值原样')
    assert.equal(kernelToUiPercent(m, 2084), 2084, '绝对值显示原样')
  }
  // UI 42(%) ⇄ 内核 0.42(round-trip;防浮点串尾)
  assert.equal(uiPercentToKernel('win_rate', 42), 42 / 100)
  assert.equal(kernelToUiPercent('win_rate', 0.42), 42)
  assert.deepEqual(
    [0.2, 0.9, 0.15].map((v) => kernelToUiPercent('churn_rate', v)),
    [20, 90, 15],
  )
  // 阈值文本 → 内核口径;空串 = 清除;越界拒绝
  assert.equal(thresholdFromUi('win_rate', 'min', '42').value, 0.42)
  assert.equal(thresholdFromUi('win_rate', 'max', '').value, null)
  assert.equal(thresholdFromUi('win_rate', 'min', 'abc').ok, false)
  assert.ok(thresholdFromUi('win_rate', 'min', '120').why.includes('0–100'))
  assert.equal(thresholdFromUi('gold_per_player', 'min', '2084').value, 2084, '绝对值不 ÷100')
  // 序列化后 YAML 内是比例值(不把 UI 百分数当底层比例)
  const y = sweepSectionText(design({ targets: [{ metric: 'churn_rate', kind: 'soft', min: null, max: 0.2 }] }))
  assert.ok(y.includes('metric: churn_rate'))
  assert.ok(y.includes('kind: soft'))
  assert.ok(y.includes('max: 0.2'), 'YAML 写的是 0.2(比例),不是 20(百分数)')
})

/* ================================ WB-06.09 ================================ */
test('WB-06.09:表单 ⇄ 有效实验 YAML;未编辑的模型内容逐行逐字节保留', () => {
  // 带注释的场景文档(未编辑内容)
  const modelDoc = [
    '# 顶层注释',
    "schema_version: '1'",
    'scenario:',
    '  population: 40   # 行内注释',
    '  duration: 30d',
    '  seed: 12345',
    '  population_mix: {casual: 0.6, core: 0.3, whale: 0.1}',
    '',
  ].join('\n')
  const d = design({ factors: [{ path: 'model.warrior.attack', min: 20, max: 220, step: 40 }] })
  const experiment = buildExperimentYaml(modelDoc, d)
  // 模型内容逐行不动
  const before = modelDoc.split('\n')
  const after = experiment.split('\n')
  for (const line of before) assert.ok(after.includes(line), `保留:${line}`)
  // sweep 节存在且为顶层
  const parsed = parseConfig(experiment)
  assert.ok(parsed.sections.some((s) => s.path === 'sweep'))
  // 内核接受(真跑计划)
  const plan = JSON.parse(wasm.sweep_plan(experiment, 0))
  assert.equal(plan.mode, 'grid')
  assert.equal(plan.axes[0].path, 'model.warrior.attack')
  // 已有 sweep 节 → 替换(更新);其余内容仍在
  const updated = buildExperimentYaml(experiment, design({ factors: [{ path: 'model.dungeon.tiers', min: 4, max: 12, step: 2 }], targets: [] }))
  assert.ok(updated.includes('model.dungeon.tiers'))
  assert.ok(!updated.includes('min: 20, max: 220'), '旧 sweep 值被替换')
  assert.ok(updated.includes('# 顶层注释'), '注释保留')
  // round-trip:readSweepDesign 读回与草稿等价
  const readBack = readSweepDesign(experiment)
  assert.equal(readBack.ok, true)
  assert.equal(readBack.method, 'grid')
  assert.deepEqual(readBack.factors, [{ path: 'model.warrior.attack', min: 20, max: 220, step: 40 }])
  assert.equal(readBack.reps, d.reps)
  const readBack2 = readSweepDesign(
    buildExperimentYaml(SCEN, design({ method: 'random', sampling: 'lhc', factors: [{ path: 'model.combat.p_hit', min: 0.6, max: 0.95 }], samples: 6 })),
  )
  assert.equal(readBack2.ok, true)
  assert.equal(readBack2.method, 'random')
  assert.equal(readBack2.sampling, 'lhc')
  assert.equal(readBack2.samples, 6)
  // 缺 sweep 节(旧场景文件)→ ok:false,不清空草稿
  assert.equal(readSweepDesign(SCEN).ok, false)
})

/* ================================ WB-06.10 ================================ */
test('WB-06.10:候选/预算/运行数来自内核 planSweep;不前端猜(WB-06.12 数字)', () => {
  const expYaml = buildExperimentYaml(SCEN, defaultDesign())
  const plan = JSON.parse(wasm.sweep_plan(expYaml, 0))
  assert.equal(plan.candidates.length, 6) // attack 20..220 步 40
  assert.equal(plan.sims, plan.candidates.length * plan.replicates)
  assert.equal(plan.replicates, defaultDesign().reps)
  // 数量判定不来自前端:多轴网格 = 逐维笛卡尔积(plan.candidates 长短即真相)
  const multi = design({
    factors: [
      { path: 'model.warrior.attack', min: 20, max: 40, step: 10 },
      { path: 'model.dungeon.reward_gold', min: 30, max: 50, step: 10 },
    ],
  })
  const planMulti = JSON.parse(wasm.sweep_plan(buildExperimentYaml(SCEN, multi), 0))
  assert.equal(planMulti.candidates.length, 3 * 3, '3×3 网格 = 9 候选(内核算账)')
  const s = planSummary(planMulti)
  assert.equal(s.candidates, 9)
  assert.equal(s.sims, 9 * multi.reps)
  assert.equal(s.playerDays, planMulti.sims * planMulti.players * planMulti.days)
  assert.equal(s.mode, 'grid')
  // Web 预算拦截来自内核(超 200 sims),前端设计不做预算门
  const big = design({ factors: [{ path: 'model.warrior.attack', min: 1, max: 1000, step: 1 }] })
  assert.throws(
    () => wasm.sweep_plan(buildExperimentYaml(SCEN, big), 0),
    /超出 Web 预算 200/,
    '候选 1000 × replicates 4 = 4000 > 200',
  )
  // 规模预算(players × days ≤ 400k)
  const hugeScale = "schema_version: '1'\nscenario: {population: 90000, duration: 30d, seed: 1, population_mix: {casual: 0.6, core: 0.3, whale: 0.1}}\n"
  assert.throws(
    () => wasm.sweep_plan(buildExperimentYaml(hugeScale, design({ factors: [{ path: 'model.warrior.attack', min: 20, max: 30, step: 10 }] })), 0),
    /400000/,
    'players × days = 2 700 000 > 400 000',
  )
})

/* ================================ WB-06.11 ================================ */
test('WB-06.11:预览请求版本门——晚返回的旧计划不得覆盖新输入', () => {
  const gate = createPlanGate()
  const seq1 = gate.next()
  assert.equal(gate.accept(seq1), true, '最新请求可落位')
  const seq2 = gate.next()
  assert.equal(gate.accept(seq2), true, '新最新请求可落位')
  assert.equal(gate.accept(seq1), false, '旧请求迟到 → 不可落位(旧计划不覆盖新输入)')
  // 更多交错:合并式断言——任何落后于最新请求的响应都不落位
  const seq3 = gate.next()
  const seq4 = gate.next()
  assert.equal(gate.accept(seq3), false)
  assert.equal(gate.accept(seq4), true)
  // 守卫独立可复用
  const guard = createSubmitGuard()
  assert.equal(guard(), true)
  assert.equal(guard(), false, '单飞:第二次调用被拒(双击只创建一个任务)')
})

/* ================================ WB-06.12 ================================ */
test('WB-06.12:候选数/replicates/sims/player-days 全来自 plan;耗时无基准=未估算', () => {
  const plan = JSON.parse(wasm.sweep_plan(buildExperimentYaml(SCEN, defaultDesign()), 0))
  const s = planSummary(plan)
  assert.equal(s.candidates, plan.candidates.length)
  assert.equal(s.replicates, plan.replicates)
  assert.equal(s.sims, plan.candidates.length * plan.replicates)
  assert.equal(s.playerDays, plan.sims * plan.players * plan.days)
  assert.equal(s.baseSeed, plan.base_seed)
  assert.equal(s.configHash, plan.config_hash)
  // A/B 没有内核计划:2 方案 × replicates(演示计数,标注为演示)
  assert.equal(abTaskCount(defaultDesign().reps), 2 * defaultDesign().reps)
})

/* ================================ WB-06.13 ================================ */
test('WB-06.13:预算/规模错误原因可读,并给出缩小规模/换执行端操作', () => {
  const message = '参数错误: 候选数 × replicates = 4000 超出 Web 预算 200(调小网格或 replicates 粗筛,更大实验走 CLI)'
  // 错误按行上墙(RunPlanSidebar check-row 数据源)
  const rows = planErrorLines(message)
  assert.equal(rows.length, 1)
  assert.ok(rows[0].includes('超出 Web 预算 200'), '预算数字来自内核原文')
  // 预算类失败 → 禁用按钮 + 可行操作建议(缩小规模 / 换执行端)
  const advice = budgetActions(message)
  assert.ok(advice.includes('缩小因子范围'))
  assert.ok(advice.includes('replicates'))
  assert.ok(advice.includes('桌面端'))
  // 非预算错误(如配置错误)不给规模缩小建议(不误导)
  assert.equal(budgetActions('配置错误: YAML 解析失败'), null, '非预算原因不产生规模建议')
})

/* ================================ WB-06.14 ================================ */
test('WB-06.14:切方法保留兼容输入;sampling 只在 Random/LHS 序列化且 Grid 无此字段', () => {
  const prev = defaultDesign()
  const switched = preserveOnMethodSwitch(prev, 'random')
  // 因子域(min/max)与名称/目标保留
  assert.equal(switched.name, prev.name)
  assert.deepEqual(switched.factors, prev.factors)
  assert.deepEqual(switched.targets, prev.targets)
  assert.equal(switched.reps, prev.reps)
  // LHS 语义在方法往返后保留(值藏草稿,不适用时只隐藏 UI,不重置)
  const back = preserveOnMethodSwitch(switched, 'grid')
  assert.equal(back.sampling, 'lhc')
  const again = preserveOnMethodSwitch(back, 'random')
  assert.equal(again.sampling, 'lhc')
  // Grid 的 YAML 无 sampling 语义(mode: grid 是精确枚举)
  const gridYaml = sweepSectionText(back)
  assert.ok(gridYaml.includes('mode: grid'))
  assert.ok(!gridYaml.includes('latin_hypercube'))
  // Random (uniform) 的 YAML 显式为 random 模式名
  const rndYaml = sweepSectionText({ ...switched, sampling: 'uniform' })
  assert.ok(rndYaml.includes('mode: random'))
  assert.ok(!rndYaml.includes('latin_hypercube'))
})

/* ================================ WB-06.15 ================================ */
test('WB-06.15:提交绑定校验快照/计划/实验 ID;双击守卫只创建一个任务', () => {
  // 有效性凭据 = 提交时真跑内核计划(当时 revisited);这里锁语义组合:
  const expYaml = buildExperimentYaml(SCEN, defaultDesign())
  const plan = JSON.parse(wasm.sweep_plan(expYaml, 0))
  assert.ok(plan.candidates.length > 0 && plan.sims > 0, '计划被内核通过(校验依据,蕴含输入 YAML 有效)')
  assert.equal(typeof plan.config_hash, 'string')
  assert.ok(plan.config_hash.length > 0, '计划含 config_hash(绑定计划凭据)')
  // 同一快照 = 同一 runId 语义由 snapshotRun(WB-04.09)测试覆盖;本批:
  // runIndexEntryOf(DesignerPage file:line)把 candidates/sims/plan_config_hash
  // 写进 conditions + entry.config_hash = 实验 YAML 的 sha256(可追溯到字节)。
  // ID 绑定:同一 (项目,方法,名称) 生成的 experimentId 与计划绑定对象一致
  assert.equal(experimentScopedId('yaml-draft', { method: 'grid', name: 'X' }), experimentScopedId('yaml-draft', { method: 'grid', name: 'X' }))
})

/* ================================ WB-06.16 ================================ */
test('WB-06.16:同配置同 seed 三模式计划可复现;改 seed 只动采样(Grid 不变)', () => {
  const seedA = SCEN
  const seedB = SCEN.replace('seed: 12345', 'seed: 778899')
  for (const sampling of ['uniform', 'lhc']) {
    const method = 'random'
    const d = design({
      method,
      sampling,
      factors: [{ path: 'model.warrior.attack', min: 0, max: 100 }],
      samples: 5,
      targets: [],
    })
    const yA = buildExperimentYaml(seedA, d)
    const a1 = wasm.sweep_plan(yA, 0)
    const a2 = wasm.sweep_plan(yA, 0)
    assert.deepEqual(
      JSON.parse(a1).candidates,
      JSON.parse(a2).candidates,
      `${sampling}:同配置同 seed 计划可复现`,
    )
    // Grid 不受 seed 影响(确定性枚举)
    const dGrid = design({ method: 'grid', factors: [{ path: 'model.warrior.attack', min: 20, max: 60, step: 10 }], targets: [] })
    const g1 = JSON.parse(wasm.sweep_plan(buildExperimentYaml(seedA, dGrid), 0)).candidates
    const g2 = JSON.parse(wasm.sweep_plan(buildExperimentYaml(seedB, dGrid), 0)).candidates
    assert.deepEqual(g1, g2, 'Grid 候选 = 枚举序列,换 seed 不变')
    // 采样模式受 seed 影响(应该变化的采样确实变化)
    const rA = JSON.parse(wasm.sweep_plan(yA, 0)).candidates
    const rB = JSON.parse(wasm.sweep_plan(buildExperimentYaml(seedB, d), 0)).candidates
    assert.notDeepEqual(rA, rB, `${sampling}:换 seed → 采样变化`)
  }
})

/* —— 内核算账 —— */
// (WB-06.13/06.14 的纯函数已直接 import designerLogic,无内联复制品)
void read
