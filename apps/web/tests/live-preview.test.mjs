// ST-WB-011 · 实时预览显示层纯函数(节点侧守卫):
// - PREVIEW_METRICS 与内核 MetricKey::ALL 同集(8 指标锁漂移);
// - histogramBins 等宽分箱:空/单点/全等/正常/最大值右闭归最后一箱;
// - pairedDiff 逐点配对差:任一臂 null 跳过(缺席不填 0)、长度取公共前缀。
// 跑法(仓库根):node --test apps/web/tests/live-preview.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { histogramBins, pairedDiff, PREVIEW_METRICS } from '../src/workbench/params/livePreview.ts'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

test('PREVIEW_METRICS 与内核 MetricKey::ALL 同集锁漂移', () => {
  const src = readFileSync(`${REPO_ROOT}crates/sandtable-core/src/experiment/metric.rs`, 'utf8')
  const block = /pub const ALL: \[MetricKey; \d+\] = \[([\s\S]*?)\];/.exec(src)?.[1] ?? ''
  const kernelKeys = [...block.matchAll(/MetricKey::(\w+),/g)].map((m) => m[1])
  assert.equal(kernelKeys.length, 8, `内核应有 8 个指标,实际 ${kernelKeys.length}`)
  // MetricKey::name 口径:PowerP50Final 的 name 是 power_p50(types.ts METRIC_KEYS
  // 与内核真跑锁漂移,contracts.test.mjs),不是变体名的机械 snake_case
  const snake = (name) => name === 'PowerP50Final' ? 'power_p50' : name.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`).replace(/^_/, '')
  assert.deepEqual(
    PREVIEW_METRICS.map((row) => row.key),
    kernelKeys.map((name) => snake(name)),
    '预览指标清单与内核 MetricKey::ALL 逐条一致(声明序)',
  )
})

test('histogramBins 空值/单点/全等 → 单箱或空', () => {
  assert.deepEqual(histogramBins([], 12), [])
  const single = histogramBins([3.5], 12)
  assert.equal(single.length, 1)
  assert.equal(single[0].count, 1)
  assert.equal(single[0].lo, 3.5)
  assert.equal(single[0].hi, 3.5)
  const same = histogramBins([2, 2, 2], 12)
  assert.equal(same.length, 1)
  assert.equal(same[0].count, 3)
})

test('histogramBins 正常等宽分箱(计数守恒、最大值右闭归最后一箱)', () => {
  const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  const bins = histogramBins(values, 5)
  assert.equal(bins.length, 5)
  assert.equal(bins[0].lo, 0)
  assert.equal(bins[bins.length - 1].hi, 10)
  assert.equal(bins.reduce((sum, bin) => sum + bin.count, 0), values.length)
  // 最大值 10 落最后一箱(右闭),不丢点
  assert.equal(bins[4].count, 3) // 8,9,10
  // 非法 bins 收成单箱
  assert.equal(histogramBins(values, 0).length, 1)
  assert.equal(histogramBins(values, -3).length, 1)
})

test('pairedDiff 逐点配对差与 null 跳过(缺席不填 0)', () => {
  assert.deepEqual(pairedDiff([1, 2, 3], [2, 4, 6]), [1, 2, 3])
  // 任一臂 null 的 replicate 跳过
  assert.deepEqual(pairedDiff([1, null, 3], [2, 4, 6]), [1, 3])
  assert.deepEqual(pairedDiff([1, 2, 3], [null, 4, 6]), [2, 3])
  // 长度不齐截到公共前缀
  assert.deepEqual(pairedDiff([1, 2], [10, 20, 30]), [9, 18])
  assert.deepEqual(pairedDiff([], [1, 2]), [])
})
