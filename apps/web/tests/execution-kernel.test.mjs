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

  test('WB-10.04:Grid/Random/LHS 三模式走同一执行器——计划、组合、实际任务数与复现', async () => {
    // 两维参数:sweep.parameters 是按路径字母序寻址的 map(Grid 3×3=9 候选,
    // Random/LHS 按 samples 采样);40 玩家 × 3 天,34 个仿真内跑完
    const expYaml = (mode, samples) =>
      [
        'schema_version: "1"',
        'scenario: {population: 40, duration: "3d", seed: 7}',
        'sweep:',
        `  mode: ${mode}`,
        ...(samples ? [`  samples: ${samples}`] : []),
        '  replicates: 2',
        '  parameters:',
        '    model.warrior.attack: {min: 90, max: 110, step: 10}',
        '    model.dungeon.m_attack: {min: 10, max: 30, step: 10}',
        '',
      ].join('\n')

    for (const [mode, samples, expected] of [['grid', 0, 9], ['random', 4, 4], ['latin_hypercube', 4, 4]]) {
      const yaml = expYaml(mode, samples)
      // 计划:模式回显;实际任务数在计划期就锁定(sims = 候选数 × replicates)
      const plan = JSON.parse(wasm.sweep_plan(yaml, 0))
      assert.equal(plan.mode, mode, `${mode}: 模式回显`)
      assert.equal(plan.candidates.length, expected, `${mode}: 候选数`)
      assert.equal(plan.sims, expected * plan.replicates, `${mode}: sims = 候选数 × replicates`)

      // 复现:同 YAML 再计划一次,候选逐值一致(Random/LHS 采样流绑定 base_seed)
      assert.deepEqual(JSON.parse(wasm.sweep_plan(yaml, 0)).candidates, plan.candidates, `${mode}: 计划可复现`)

      // 参数组合形态
      if (mode === 'grid') {
        // 组合全集 = 两维等步长点的笛卡尔积,无重复(候选键是点号路径,平铺 map)
        const key = (c) => `${c['model.warrior.attack']},${c['model.dungeon.m_attack']}`
        const got = plan.candidates.map(key).sort()
        const want = []
        for (const a of [90, 100, 110]) for (const m of [10, 20, 30]) want.push(`${a},${m}`)
        assert.deepEqual(got, want.sort(), 'Grid 组合全集 = 笛卡尔积')
        // 展开序跟随 parameters 的 BTreeMap 序(路径字母序):m_attack 为外层
        const wantOrder = []
        for (const m of [10, 20, 30]) for (const a of [90, 100, 110]) wantOrder.push(`${a},${m}`)
        assert.deepEqual(plan.candidates.map(key), wantOrder, 'Grid 候选展开序')
      } else {
        for (const c of plan.candidates) {
          for (const [path, lo, hi] of [['model.warrior.attack', 90, 110], ['model.dungeon.m_attack', 10, 30]]) {
            assert.ok(c[path] >= lo && c[path] < hi, `${mode}: ${path}=${c[path]} 落在 [${lo},${hi})`)
          }
        }
      }
      if (mode === 'latin_hypercube') {
        // 每维排序后第 i 个值落在第 i 层 [min+i·w, min+(i+1)·w)
        for (const [path, lo, hi] of [['model.warrior.attack', 90, 110], ['model.dungeon.m_attack', 10, 30]]) {
          const col = plan.candidates.map((c) => c[path]).sort((x, y) => x - y)
          const w = (hi - lo) / samples
          col.forEach((v, i) => {
            assert.ok(v >= lo + i * w && v < lo + (i + 1) * w, `LHS ${path} 第 ${i} 层应落在 [${lo + i * w},${lo + (i + 1) * w}),实际 ${v}`)
          })
        }
      }

      // 执行:逐候选真跑,实际任务数与计划一致,实际参数组合与计划逐值一致
      const { hooks } = sink()
      const ctl = startExec({ kind: 'sweep', yaml, plan }, kernelBackends, hooks, `job_wb1004_${mode}`)
      const out = await ctl.promise
      assert.equal(out.status, 'succeeded', `${mode}: 执行成功`)
      assert.equal(out.results.length, expected, `${mode}: 每个候选都有结果`)
      assert.ok(out.results.every((r) => r.status === 'ok'), `${mode}: 全部候选真跑成功`)
      assert.deepEqual(out.results.map((r) => r.values), plan.candidates, `${mode}: 实际参数组合与计划逐值一致`)
      const tasks = out.results.reduce((s, r) => s + r.metric_stats[0][1].n, 0)
      assert.equal(tasks, plan.sims, `${mode}: 实际任务数 = 计划 sims`)
    }
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
