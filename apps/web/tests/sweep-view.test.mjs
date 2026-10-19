// 扫描结果适配器守卫(WB-08.01,节点侧,CI web job 无 wasm 行):
// 内核 SweepPlan/CandidateResult(lib/types.ts,contracts.test.mjs 对真 wasm
// 锁形)→ 分析视图模型。锁四条红线:
// ① 忠实透传 values/status/metric_stats/target_outcomes,失败候选不静默丢弃;
// ② 缺失指标 = 不可用(null),禁止 0 填空(验收纪律);
// ③ 口径原样:比例不乘 100、不舍入(×100 唯一点在 i18n fmtPercent);
// ④ 候选 ID 用 workbench/ids.candidateIdFor 同规则派生,同参数域恒同 ID,
//    部分返回(未返回候选 = null)不产生错位。
// 跑法(仓库根):node --test apps/web/tests/sweep-view.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { candidateViews, metricStat } from '../src/lib/sweepView.ts'
import { METRIC_KEYS } from '../src/lib/types.ts'
// 与应用同一条 ID 规则(workbench/ids.candidateIdFor):适配器注入派生函数,
// lib 不反向依赖 workbench;测试里直接用真实现锁端到端一致性
import { candidateIdFor } from '../src/workbench/ids.ts'

const BASELINE = 'bls_demo0000001'

const stat = (mean) => ({ n: 20, mean, sd: 0.02, ci95_lo: mean - 0.01, ci95_hi: mean + 0.01 })

const plan = {
  config_hash: 'abc123def456',
  players: 10000,
  days: 30,
  base_seed: 42,
  replicates: 20,
  mode: 'grid',
  axes: [{ path: 'model.warrior.attack', min: 80, max: 90, step: 5 }],
  candidates: [
    { 'model.warrior.attack': 80 },
    { 'model.warrior.attack': 85 },
    { 'model.warrior.attack': 90 },
  ],
  targets: [{ metric: 'win_rate', kind: 'hard', min: 0.5, max: null }],
  sims: 3,
}

const okResult = (attack, winMean) => ({
  values: { 'model.warrior.attack': attack },
  status: 'ok',
  metric_stats: [
    ['win_rate', stat(winMean)],
    ['gold_per_player', stat(120)],
  ],
  target_outcomes: [
    {
      metric: 'win_rate',
      kind: 'hard',
      min: 0.5,
      max: null,
      stats: stat(winMean),
      verdict: winMean >= 0.5 ? 'pass' : 'fail',
    },
  ],
})

const views = (results) => candidateViews(plan, results, (values) => candidateIdFor(BASELINE, values))

test('WB-08.01:忠实映射——values/status/metric_stats/target_outcomes 原样进视图', () => {
  const [v80] = views([okResult(80, 0.534), null, null])
  assert.equal(v80.values['model.warrior.attack'], 80, '参数值原样,不改写不补路径')
  assert.equal(v80.status, 'ok')
  assert.equal(v80.stats.get('win_rate').mean, 0.534, '统计原样进视图')
  assert.equal(v80.outcomes[0].verdict, 'pass', '内核判定透传,前端不覆写')
  assert.equal(v80.outcomes[0].kind, 'hard', 'hard/soft 区分保留')
  // 计划内序位保留:第三个候选即使前面有 null 也按计划下标定位
  const [v90] = views([null, null, okResult(90, 0.51)])
  assert.equal(v90.index, 2)
  assert.equal(v90.values['model.warrior.attack'], 90)
})

test('WB-08.01:失败候选(config_error)保留在结果集中,不静默丢弃', () => {
  const failed = {
    values: { 'model.warrior.attack': 85 },
    status: { config_error: '配置错误: 表 damage_model 不存在' },
    metric_stats: [],
    target_outcomes: [],
  }
  const [v] = views([failed, null, null])
  assert.deepEqual(v.status, { config_error: '配置错误: 表 damage_model 不存在' }, '错误消息逐字保留')
  assert.equal(v.stats.size, 0, '失败候选无统计')
  assert.equal(metricStat(v, 'win_rate'), null, '不可用是 null,不是 0')
})

test('WB-08.01:缺失指标 = 不可用(null),不 0 填空', () => {
  const partial = {
    values: { 'model.warrior.attack': 80 },
    status: 'ok',
    metric_stats: [['win_rate', stat(0.53)]], // 内核本次只产出 win_rate
    target_outcomes: [],
  }
  const [v] = views([partial, null, null])
  assert.equal(metricStat(v, 'win_rate').mean, 0.53)
  for (const m of METRIC_KEYS) {
    if (m === 'win_rate') continue
    assert.equal(metricStat(v, m), null, `${m} 未产出 → null`)
  }
})

test('WB-08.01:口径原样——比例不乘 100,数值不舍入', () => {
  const [v] = views([okResult(80, 0.0034), null, null])
  assert.equal(v.stats.get('win_rate').mean, 0.0034, '内核比例口径原样;×100 只允许发生在 fmtPercent')
  assert.equal(v.stats.get('win_rate').ci95_lo, 0.0034 - 0.01)
})

test('WB-08.01:候选 ID 内容寻址——同参数域恒同 ID,与结果顺序无关', () => {
  const a = views([okResult(80, 0.534), okResult(85, 0.55), null])
  const b = views([null, okResult(85, 0.55), okResult(80, 0.534)])
  const idOf = (list, attack) => list.find((v) => v.values['model.warrior.attack'] === attack)?.id
  assert.equal(idOf(a, 80), idOf(b, 80), '同参数值跨调用同 ID(排序/筛选/部分返回后选择仍对应同一候选)')
  assert.notEqual(idOf(a, 80), idOf(a, 85), '不同参数域不同 ID')
  assert.match(idOf(a, 80), /^cnd_[0-9a-f]{24}$/, 'ID 形状与 workbench/ids 同规则(基线摘要 8 + 参数域摘要 16)')
})

test('WB-08.01:部分返回如实表达;结果数超过计划数 = 明确错误', () => {
  const two = views([okResult(80, 0.534), okResult(85, 0.55), null])
  assert.equal(two.length, 2, '未返回的候选不进视图,已返回的保留')
  assert.throws(() => views([okResult(80, 0.5), okResult(85, 0.5), okResult(90, 0.5), okResult(95, 0.5)]), /超过计划/, '多出来的结果 = 调用方对位错误,明确报错不静默截断')
})
