// 预设守卫(节点侧,CI web job 跑):TS 内置的每一个预设 YAML 必须过真实
// 内核 validate——预设数据漂移曾让「宝可梦案例」一键即报
// 「model.training 产出已配置但各分群 p_training 均为 0」(2026-10-13 无头
// 点击走查抓到;绑定错误走 JS 异常,成功返回 JSON 字符串)。
// 跑法(仓库根):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/presets.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS, SWEEP_PRESETS } from '../src/lib/presets.ts'
import * as wasm from '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js'

test('内置仿真预设全部通过 validate_config', () => {
  assert.ok(PRESETS.length >= 2)
  for (const p of PRESETS) {
    const out = JSON.parse(wasm.validate_config(p.yaml))
    assert.equal(out.players, 3000, `预设「${p.name}」players`)
    assert.ok(String(out.config_hash).length === 64, 'config_hash 为 SHA-256 hex')
  }
})

test('内置扫描预设全部通过 sweep_plan', () => {
  assert.ok(SWEEP_PRESETS.length >= 4)
  for (const p of SWEEP_PRESETS) {
    const plan = JSON.parse(wasm.sweep_plan(p.yaml, 0))
    assert.ok(Array.isArray(plan.candidates) && plan.candidates.length >= 1, `扫描预设「${p.name}」无候选`)
    assert.ok(plan.replicates >= 1, `扫描预设「${p.name}」replicates`)
  }
})
