// WB-07 真内核执行守卫(节点侧,CI 在 pkg-node 构建后跑):
// 执行引擎注入 pkg-node 真实绑定——planSweep 的已校验计划逐候选真跑
// runSweepCandidate、进度只在候选边界、完整候选集出真实推荐、A/B 双臂
// 真跑后桥接未发布时如实报 bridge(不冒充统计判定)。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/execution-kernel.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(WB-07 真内核断言在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  const { startExec } = await import('../src/workbench/state/executor.ts')
  const wasm = await import(pkgNode)

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

  // 真实内核绑定(与桌面/浏览器同源 core 纯函数):runSweepCandidate 等价面 +
  // A/B 统计比较桥(WB-03.10/11/12,ab_compare 双端同构)
  const kernelBackends = {
    mode: 'desktop',
    sim: async (yaml, replicates) => JSON.parse(wasm.run_simulation(yaml, replicates)),
    candidate: async (yaml, replicates, values) =>
      JSON.parse(wasm.sweep_candidate(yaml, replicates, JSON.stringify(values))),
    recommend: async (yaml, results) =>
      JSON.parse(wasm.sweep_recommend(yaml, JSON.stringify(results))),
    kernelCancel: async () => false,
    compare: (baseYaml, candYaml, metric, base, cand) =>
      JSON.parse(wasm.ab_compare(baseYaml, candYaml, metric, JSON.stringify(base.results), JSON.stringify(cand.results))),
  }

  const sink = () => {
    const patches = []
    return { patches, hooks: { update: (id, p) => patches.push(p) } }
  }

  test('WB-07.03:执行引擎按真实内核逐候选 runSweepCandidate(3 候选全 ok + 真实推荐)', async () => {
    const plan = JSON.parse(wasm.sweep_plan(EXP_YAML, 0))
    assert.equal(plan.candidates.length, 3)
    assert.equal(plan.sims, 6)

    const { hooks, patches } = sink()
    const ctl = startExec({ kind: 'sweep', yaml: EXP_YAML, plan }, kernelBackends, hooks, 'job_kernel01')
    const out = await ctl.promise

    assert.equal(out.status, 'succeeded')
    assert.equal(out.results.length, 3)
    assert.ok(out.results.every((r) => r.status === 'ok'), '三个候选全部真跑成功')
    // 候选参数来自真实计划(Grid 步长 10)
    assert.deepEqual(
      out.results.map((r) => r.values['model.warrior.attack']),
      [90, 100, 110],
    )
    // metric_stats 是内核真实统计(非前端合成)
    assert.ok(out.results[0].metric_stats.length > 0)
    // 进度只在候选边界:2 → 4 → 6(reps=2)
    const dones = [...new Set(patches.filter((p) => p.done !== undefined).map((p) => p.done))]
    assert.deepEqual(dones, [2, 4, 6])
    // 完整候选集 → 真实 recommendSweep
    assert.equal(out.recommendationError, null)
    assert.equal(out.recommendation.recommendation.param, 'model.warrior.attack')
    assert.ok(out.recommendation.elasticities.length > 0)
  })

  test('WB-07.03:同配置同 seed 可复现——执行器产物与直接 runSweepCandidate 逐值一致', async () => {
    const plan = JSON.parse(wasm.sweep_plan(EXP_YAML, 0))
    const { hooks } = sink()
    const ctl = startExec({ kind: 'sweep', yaml: EXP_YAML, plan }, kernelBackends, hooks, 'job_kernel02')
    const out = await ctl.promise
    const direct = []
    for (const values of plan.candidates) {
      direct.push(JSON.parse(wasm.sweep_candidate(EXP_YAML, plan.replicates, JSON.stringify(values))))
    }
    assert.deepEqual(JSON.parse(JSON.stringify(out.results)), direct, '数据可追溯:与内核直调逐值一致')
  })

  test('WB-07.03/03.10:A/B 双臂真跑 + 内核 ab_compare 桥接 → 真实 Comparison(CRN 配对,统计不由前端另算)', async () => {
    const baseYaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\n'
    const candYaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nmodel:\n  warrior:\n    attack: 110\n'
    const { hooks } = sink()
    const ctl = startExec(
      { kind: 'ab', baseYaml, candYaml, replicates: 2, metric: 'win_rate' },
      kernelBackends,
      hooks,
      'job_kernel03',
    )
    const out = await ctl.promise
    assert.equal(out.status, 'succeeded', `双臂 + 桥接应成功: ${out.errorClass ?? ''} ${out.message ?? ''}`)
    // 双臂是真实内核输出(带 config_hash 与真实 schema 版本)
    assert.equal(out.arms.base.config_hash, JSON.parse(wasm.validate_config(baseYaml)).config_hash)
    assert.equal(out.arms.cand.config_hash, JSON.parse(wasm.validate_config(candYaml)).config_hash)
    assert.equal(out.arms.base.meta.schema_version, out.arms.cand.meta.schema_version)
    // Comparison 是内核直出(WB-03.01 同构形状):指标/逐臂 n/verdict 三值之一
    assert.equal(out.comparison.metric, 'win_rate')
    assert.equal(out.comparison.arm_a.n, 2)
    assert.equal(out.comparison.arm_b.n, 2)
    assert.ok(['BHigher', 'AHigher', 'NoDifference'].includes(out.comparison.verdict))
    // CRN 配对口径:diff_mean = cand 臂均值 − base 臂均值(内核 compare)
    const mean = (arm) => arm.results.reduce((s, m) => s + m.win_rate, 0) / arm.results.length
    const expected = mean(out.arms.cand) - mean(out.arms.base)
    assert.ok(Math.abs(out.comparison.diff_mean - expected) < 1e-9)
  })

  test('WB-03.10:内核显式拒绝经执行器如实报 run(种子错位),双臂输出保留', async () => {
    const baseYaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\n'
    const candYaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 9}\n'
    const { hooks } = sink()
    const ctl = startExec(
      { kind: 'ab', baseYaml, candYaml, replicates: 2, metric: 'win_rate' },
      kernelBackends,
      hooks,
      'job_kernel04',
    )
    const out = await ctl.promise
    assert.equal(out.status, 'failed')
    assert.equal(out.errorClass, 'run')
    assert.match(out.message, /base_seed 不一致/, '内核 CRN 前提校验原样过错误通道')
    assert.notEqual(out.arms.base, null)
    assert.notEqual(out.arms.cand, null)
    assert.equal(out.comparison, null, '拒绝时不冒充统计判定')
  })

  test('WB-03.10:未知指标 = 参数错误通道(可选清单来自内核)', async () => {
    const baseYaml = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\n'
    const { hooks } = sink()
    const ctl = startExec(
      { kind: 'ab', baseYaml, candYaml: baseYaml, replicates: 1, metric: 'winrate' },
      kernelBackends,
      hooks,
      'job_kernel05',
    )
    const out = await ctl.promise
    assert.equal(out.status, 'failed')
    assert.equal(out.errorClass, 'run')
    assert.match(out.message, /参数错误: 未知指标 winrate/)
  })
}
