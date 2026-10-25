// A/B 分析视图(WB-08.12 扩展)守卫:逐 KPI 配对效应分面。
// 数据链路 = 真内核:双臂 run_simulation 真跑 → ab_compare 逐指标(与
// executor 的逐 KPI 扇出同一调用面)→ abFacets 显示派生;独立重算只用于
// 对照内核输出(与 ab-parity.test.mjs 同一纪律),不由前端另算统计。
// 跑法(仓库根):node --test apps/web/tests/ab-effect.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

import { abFacets, abUnavailable, effectDomain, facetsByDimension } from '../src/lib/abEffect.ts'
import { METRIC_KEYS } from '../src/lib/types.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

// —— 与内核 Comparison 同构的测试夹具(纯逻辑分面用) ——
const stat = (mean, sd, n = 6) => ({
  n, mean, sd, ci95_lo: mean - 1.96 * sd / Math.sqrt(n), ci95_hi: mean + 1.96 * sd / Math.sqrt(n),
})
const cmp = (metric, aMean, bMean, lo, hi, d = 0.5) => ({
  metric, arm_a: stat(aMean), arm_b: stat(bMean),
  diff_mean: bMean - aMean, diff_ci95_lo: lo, diff_ci95_hi: hi, effect_size_d: d,
  verdict: lo > 0 ? 'BHigher' : hi < 0 ? 'AHigher' : 'NoDifference',
})

test('abFacets:均值/配对差/绝对变化/相对变化/CI/效应量/判定逐分面透传;显著性是 CI 的直接读数', () => {
  const facets = abFacets([
    cmp('win_rate', 0.5, 0.53, 0.005, 0.055),        // CI 不含 0 → 显著
    cmp('gold_per_player', 100, 100, -2, 2),          // CI 含 0 → 不区分
  ])
  assert.equal(facets.length, 2)
  assert.deepEqual(facets.map((f) => f.metric), ['win_rate', 'gold_per_player'], 'METRIC_KEYS 序')
  const w = facets[0]
  assert.equal(w.dimension, 'percent', 'win_rate = percent 量纲')
  assert.equal(w.armA.mean, 0.5)
  assert.equal(w.armB.mean, 0.53)
  assert.ok(Math.abs(w.diffMean - 0.03) < 1e-9, '配对差 = 内核直出')
  assert.equal(w.significant, true, 'CI 不含 0 → 显著读数')
  assert.ok(Math.abs(w.relativeChangePct - 6) < 1e-9, '相对变化 = diff/基线均值 × 100')
  assert.equal(facets[1].significant, false, 'CI 含 0 → 不显著')
  assert.equal(facets[1].relativeChangePct, 0, '基线非零时相对变化照常算')
})

test('abFacets:基线均值为 0 时相对变化 = null(不编造),未知指标不造分面', () => {
  const facets = abFacets([cmp('gold_per_player', 0, 5, 1, 9)])
  assert.equal(facets[0].relativeChangePct, null, '0 基线不可算相对变化,如实不可用')
  const only = abFacets([cmp('win_rate', 0.4, 0.4, -0.01, 0.01)])
  assert.deepEqual(only.map((f) => f.metric), ['win_rate'], '未比较的 KPI 不造空分面')
})

test('effectDomain:每分面独立轴域(0 + CI 包络 + 余量),退化时扩档——不同单位绝不共用一根轴', () => {
  const percent = effectDomain({ diffCi95Lo: -0.02, diffCi95Hi: 0.04 })
  const amount = effectDomain({ diffCi95Lo: -200, diffCi95Hi: 300 })
  assert.ok(percent.min < 0 && percent.max > 0, '0 在轴内')
  assert.ok(percent.min <= -0.02 && percent.max >= 0.04, 'CI 包络在轴内')
  assert.ok(percent.max - percent.min < 1, 'percent 轴是 0–1 尺度的量级')
  assert.ok(amount.max - amount.min > 100, 'amount 轴是绝对量的量级——两轴量级不同即结构上不共轴')
  assert.ok(amount.min < -200 && amount.max > 300)
  const flat = effectDomain({ diffCi95Lo: 0, diffCi95Hi: 0 })
  assert.ok(flat.max - flat.min >= 2, '退化 CI 扩档,不为画图伪造范围')
})

test('facetsByDimension:percent 与 amount 分组展示,组内不混量纲', () => {
  const groups = facetsByDimension(abFacets([
    cmp('gold_per_player', 100, 101, -1, 3),
    cmp('win_rate', 0.5, 0.52, 0.001, 0.03),
    cmp('churn_rate', 0.2, 0.19, -0.03, 0.01),
  ]))
  assert.deepEqual(groups.percent.map((f) => f.metric), ['win_rate', 'churn_rate'])
  assert.deepEqual(groups.amount.map((f) => f.metric), ['gold_per_player'])
})

test('abUnavailable:被拒 KPI 按 METRIC_KEYS 序记录原文;成功的指标不重复出现', () => {
  const comparisons = [cmp('win_rate', 0.5, 0.5, -0.01, 0.01)]
  const out = abUnavailable(comparisons, [
    { metric: 'retention_d7', message: '配置错误: retention_d7 需要 days ≥ 7' },
    { metric: 'win_rate', message: '不应出现' },
    { metric: 'gold_per_player', message: '配置错误: x' },
    { metric: 'gold_per_player', message: '重复原文也保留' },
  ])
  assert.deepEqual(out.map((e) => e.metric), ['retention_d7', 'gold_per_player', 'gold_per_player'], '序 + 原文逐条')
})

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(真内核走查在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  const wasm = await import(pathToFileURL(pkgNode).href)
  const R = 6
  const BASE = 'schema_version: "1"\nscenario: {population: 200, duration: "14d", seed: 42}\n'
  const armYaml = (m) => `${BASE}model:\n  dungeon:\n    m_attack: ${m}\n`
  const ya = armYaml(10)
  const yb = armYaml(120)

  test('真内核走查:双臂真跑 → 逐 KPI ab_compare → abFacets 全链路(与独立重算对照)', () => {
    const ra = JSON.parse(wasm.run_simulation(ya, R))
    const rb = JSON.parse(wasm.run_simulation(yb, R))
    // 与 executor 相同的逐 KPI 扇出调用面:主指标 win_rate + 其余 METRIC_KEYS
    const comparisons = []
    const errors = []
    for (const metric of METRIC_KEYS) {
      try {
        comparisons.push(JSON.parse(wasm.ab_compare(ya, yb, metric, JSON.stringify(ra.results), JSON.stringify(rb.results))))
      } catch (e) {
        errors.push({ metric, message: String(e) })
      }
    }
    assert.ok(comparisons.length >= 5, `多数 KPI 可比: ${comparisons.length}`)
    assert.ok(errors.length >= 1, '未配置 gacha/loot 的场景必有内核显式拒绝')

    const facets = abFacets(comparisons)
    assert.deepEqual(facets.map((f) => f.metric), comparisons.map((c) => c.metric), '分面序 = 比较集序(METRIC_KEYS 序)')
    const win = facets.find((f) => f.metric === 'win_rate')
    assert.ok(win, 'win_rate 分面存在')
    // 独立重算对照(与 ab-parity 同一纪律:拿原始逐 replicate 值重算,不引内核代码)
    const xa = ra.results.map((m) => m.win_rate)
    const xb = rb.results.map((m) => m.win_rate)
    const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length
    assert.ok(Math.abs(win.diffMean - (mean(xb) - mean(xa))) < 1e-9, '配对差 = B 均值 − A 均值(真内核数据)')
    assert.ok(Math.abs(win.relativeChangePct - (mean(xb) - mean(xa)) / mean(xa) * 100) < 1e-9, '相对变化派生一致')
    assert.equal(win.significant, win.diffCi95Lo > 0 || win.diffCi95Hi < 0, '显著性读数 = 内核 CI 与 0 的关系')

    // 铁则走查:percent 分面轴是 0–1 尺度量级,amount 分面轴是绝对量量级
    const groups = facetsByDimension(facets)
    for (const f of groups.percent) {
      const d = effectDomain(f)
      // percent 差值只能落在 [-1, 1](两臂均值都在 0–1),含余量也不出比例量级
      assert.ok(d.max - d.min < 2.5, `percent 分面 ${f.metric} 轴保持比例量级(不与绝对量共轴)`)
    }
    for (const f of groups.amount) {
      const d = effectDomain(f)
      assert.ok(d.max - d.min > 0.1, `amount 分面 ${f.metric} 轴有真实量程`)
    }

    // 不可用 KPI:原文错误逐条保留,abUnavailable 不丢不编
    const unavailable = abUnavailable(comparisons, errors)
    assert.deepEqual(unavailable.map((e) => e.metric), errors.map((e) => e.metric), '不可用记录与内核拒绝一一对应')
    assert.ok(unavailable.every((e) => e.message.length > 0), '原文错误非空')
    // 口径:比例不 ×100(×100 只在显示层)
    assert.ok(facets.filter((f) => f.dimension === 'percent').every((f) => Math.abs(f.armA.mean) <= 1 && Math.abs(f.armB.mean) <= 1), 'percent 分面保持内核 0–1 原始口径')
  })
}
