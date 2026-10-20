// WB-10.03 · A/B 对照验收(节点侧,CI 在 pkg-node 构建后跑):从一份基线只改
// 一个数值派生两个候选,双臂各跑 12 个 replicate(同 seed 同序号 = CRN 配对),
// 内核 ab_compare 直出 Comparison。
// 统计量不是拿两个入口互相印证——那样两边一起错也照绿。这里用测试里独立的
// 参考实现从原始逐 replicate 值重算:配对差值(B_r − A_r)、配对 t 置信区间
// (df = R−1)与效应量 d = Δ / pooled_sd,再逐项对照内核输出。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/ab-parity.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(WB-10.03 真内核断言在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  const wasm = await import(pkgNode)
  const R = 12 // replicate 数;df = R−1 = 11

  // 基线只带 scenario;两个候选只改副本怪物攻击这一处,其余逐字相同。
  // 用同一模板替换数值,「只改一个参数」是构造上成立的,不是断言出来的。
  const BASELINE = ['schema_version: "1"', 'scenario: {population: 400, duration: "14d", seed: 42}', '']
  const armYaml = (mAttack) =>
    BASELINE.join('\n') + `model:\n  dungeon:\n    m_attack: ${mAttack}\n`
  const A = 10
  const B = 120
  const ya = armYaml(A)
  const yb = armYaml(B)
  const METRIC = 'retention_d7'

  // —— 独立参考实现(不引内核代码)——
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length
  const sampleSd = (xs) => {
    const m = mean(xs)
    const ss = xs.reduce((s, v) => s + (v - m) ** 2, 0)
    return Math.sqrt(ss / (xs.length - 1))
  }
  // t(0.975, 11):学生 t 分布表的标准值;正态近似是 1.96,两者差 12%
  const T975_DF11 = 2.201
  const halfWidth = (xs) => (T975_DF11 * sampleSd(xs)) / Math.sqrt(xs.length)
  const verdictFromCi = (lo, hi) => (lo > 0 ? 'BHigher' : hi < 0 ? 'AHigher' : 'NoDifference')
  // 容差按相对量级放宽到 1e-9,挡浮点求和次序噪声;真实偏差远超此量级
  const close = (got, want, what, tol = 1e-9) =>
    assert.ok(
      Math.abs(got - want) <= tol * (1 + Math.max(Math.abs(got), Math.abs(want))),
      `${what}: ${got} != ${want}`,
    )

  test('WB-10.03:同一基线派生两个候选,内核 A/B 的配对差值、CI、效应量与独立重算一致', async () => {
    // 1 · 派生:两候选只差一处参数,基线部分(players/days/schema/seed)逐字相同
    const va = JSON.parse(wasm.validate_config(ya))
    const vb = JSON.parse(wasm.validate_config(yb))
    for (const k of ['players', 'days', 'schema_version', 'model_version']) {
      assert.equal(va[k], vb[k], `基线字段 ${k} 一致`)
    }
    assert.notEqual(va.config_hash, vb.config_hash, '两个候选不是同一个配置')

    const pa = JSON.parse(wasm.param_values(ya))
    const pb = JSON.parse(wasm.param_values(yb))
    const keys = new Set([...Object.keys(pa), ...Object.keys(pb)])
    const differs = [...keys].filter((k) => JSON.stringify(pa[k]) !== JSON.stringify(pb[k]))
    assert.deepEqual(differs, ['model.dungeon.m_attack'], '两候选只差一个数值')
    // param_values 是按路径平铺的 map(键即点号路径),不是嵌套对象
    assert.equal(pb['model.dungeon.m_attack'], B)
    assert.equal(pa['model.dungeon.m_attack'], A)

    // 2 · 双臂真跑:同 seed 同 replicate 序号 = CRN 配对,可复现
    const ra = JSON.parse(wasm.run_simulation(ya, R))
    const rb = JSON.parse(wasm.run_simulation(yb, R))
    const raAgain = JSON.parse(wasm.run_simulation(ya, R))
    assert.deepEqual(raAgain.results, ra.results, '同配置同 seed 可复现(CRN 配对前提)')
    assert.equal(ra.results.length, R)
    assert.equal(rb.results.length, R)

    // 3 · 配对前提:两臂都给了完整指标,不是被 0 填充或跳过
    const xa = ra.results.map((m) => m[METRIC])
    const xb = rb.results.map((m) => m[METRIC])
    for (const [name, xs] of [['arm_a', xa], ['arm_b', xb]]) {
      assert.ok(xs.every((v) => typeof v === 'number' && Number.isFinite(v)), `${name} 逐 replicate 都有 ${METRIC}`)
    }

    // 4 · 内核比较
    const cmp = JSON.parse(wasm.ab_compare(ya, yb, METRIC, JSON.stringify(ra.results), JSON.stringify(rb.results)))
    assert.equal(cmp.metric, METRIC)
    assert.equal(cmp.arm_a.n, R)
    assert.equal(cmp.arm_b.n, R)

    // 5 · 独立重算逐字段对照
    const diffs = xb.map((v, i) => v - xa[i]) // B_r − A_r
    const sda = sampleSd(xa)
    const sdb = sampleSd(xb)
    const sdd = sampleSd(diffs)
    const pooled = Math.sqrt(((R - 1) * sda ** 2 + (R - 1) * sdb ** 2) / (2 * R - 2))

    close(cmp.arm_a.mean, mean(xa), 'arm_a.mean')
    close(cmp.arm_a.sd, sda, 'arm_a.sd')
    close(cmp.arm_a.ci95_lo, mean(xa) - halfWidth(xa), 'arm_a.ci95_lo')
    close(cmp.arm_a.ci95_hi, mean(xa) + halfWidth(xa), 'arm_a.ci95_hi')
    close(cmp.arm_b.mean, mean(xb), 'arm_b.mean')
    close(cmp.arm_b.sd, sdb, 'arm_b.sd')
    close(cmp.diff_mean, mean(diffs), '配对差值均值 = mean(B_r − A_r)')
    close(cmp.diff_mean, mean(xb) - mean(xa), '配对差值均值 = 两臂均值之差')
    close(cmp.diff_ci95_lo, mean(diffs) - halfWidth(diffs), '配对差 CI 下限')
    close(cmp.diff_ci95_hi, mean(diffs) + halfWidth(diffs), '配对差 CI 上限')
    close(cmp.effect_size_d, pooled > 0 ? mean(diffs) / pooled : 0, '效应量 d = Δ / pooled_sd')
    assert.equal(cmp.verdict, verdictFromCi(cmp.diff_ci95_lo, cmp.diff_ci95_hi), '判定由配对 CI 是否含 0 决定')

    // 6 · 走的是配对 t 区间(df = R−1),不是正态近似:用 CI 宽度反推临界值
    const impliedT = (cmp.diff_ci95_hi - cmp.diff_ci95_lo) / 2 / (sdd / Math.sqrt(R))
    close(impliedT, T975_DF11, '配对差 CI 用 t(df=11)=2.201,非正态近似 1.96', 1e-2)
    assert.ok(sdd > 0, '配对差有波动,CI 不是退化点估计')
    assert.ok(cmp.diff_ci95_lo < cmp.diff_mean && cmp.diff_mean < cmp.diff_ci95_hi, '配对差均值落在自身 CI 内')

    // 7 · 方向:怪物攻击更高的一侧留存更低——两臂确实是 A/B 而非同号副本
    assert.ok(cmp.diff_mean < 0, 'B(m_attack=120)留存低于 A(m_attack=10)')

    // 8 · 换臂不变量:差值取反、CI 镜像、判定互翻——配对是按 replicate 序号而非重排
    const swap = JSON.parse(wasm.ab_compare(yb, ya, METRIC, JSON.stringify(rb.results), JSON.stringify(ra.results)))
    close(swap.diff_mean, -cmp.diff_mean, '换臂后配对差取反')
    close(swap.diff_ci95_lo, -cmp.diff_ci95_hi, '换臂后 CI 下限 = 原上限取反')
    close(swap.diff_ci95_hi, -cmp.diff_ci95_lo, '换臂后 CI 上限 = 原下限取反')
    close(swap.effect_size_d, -cmp.effect_size_d, '换臂后效应量取反')
    assert.deepEqual([swap.arm_a, swap.arm_b], [cmp.arm_b, cmp.arm_a], '换臂后逐臂统计互换')
    const mirror = { BHigher: 'AHigher', AHigher: 'BHigher', NoDifference: 'NoDifference' }
    assert.equal(swap.verdict, mirror[cmp.verdict], '换臂后判定互翻')
  })

  test('WB-10.03:成对前提被破坏时内核显式拒绝,不给出统计判定', async () => {
    // replicate 数不一致
    const rb1 = JSON.parse(wasm.run_simulation(yb, R - 1))
    assert.throws(
      () => wasm.ab_compare(ya, yb, METRIC, JSON.stringify(JSON.parse(wasm.run_simulation(ya, R)).results), JSON.stringify(rb1.results)),
      (e) => /replicate 数不一致/.test(String(e)),
      'replicate 数不一致显式拒绝',
    )
    // 种子错位
    const wrongSeed = ya.replace('seed: 42', 'seed: 43')
    const rw = JSON.parse(wasm.run_simulation(wrongSeed, R))
    assert.throws(
      () => wasm.ab_compare(wrongSeed, yb, METRIC, JSON.stringify(rw.results), JSON.stringify(JSON.parse(wasm.run_simulation(yb, R)).results)),
      (e) => /base_seed 不一致/.test(String(e)),
      '种子错位显式拒绝',
    )
    // 指标不可用(运行天数不足以算 D7)
    const short = ya.replace('duration: "14d"', 'duration: "6d"')
    const rs = JSON.parse(wasm.run_simulation(short, R))
    assert.throws(
      () => wasm.ab_compare(short, ya.replace('duration: "14d"', 'duration: "6d"'), METRIC, JSON.stringify(rs.results), JSON.stringify(rs.results)),
      (e) => /retention_d7 需要 days/.test(String(e)),
      '指标不可用显式拒绝',
    )
  })
}
