// WB-02.02~08 组件层纯逻辑守卫(节点侧):
// 路由深链解析/序列化、候选筛选排序、任务状态机推进、参数校验与批量、
// 实验预算与校验。组件渲染本身由浏览器走查覆盖,这里锁纯逻辑回归。
// 跑法(仓库根):node --test apps/web/tests/workbench-logic.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_PAGE, formatHash, parseHash, PAGES, HASH_BASE } from '../src/workbench/routing.ts'
import { filterAndSort, verdictFor, verdictOf } from '../src/workbench/demo/sampleProject.ts'
import { DEMO_RESULT } from '../src/workbench/demo/sampleProject.ts'
import { isTerminal, requestCancel, runningCount, settleJobs, tickJobs } from '../src/workbench/state/jobLogic.ts'
import { bulkMultiply, relativeChange, validateParam } from '../src/workbench/params/paramsLogic.ts'
import { PARAM_DEFS } from '../src/workbench/demo/sampleProject.ts'
import { designCounts, designErrors, gridFactorValues } from '../src/workbench/designer/designerLogic.ts'
import { matchCommands } from '../src/workbench/overlays/commands.ts'

test('路由:hash 深链解析与序列化 roundtrip + 非法回退', () => {
  const link = { page: 'analysis', selection: { candidate: 'cnd_abc12345', metric: 'win' } }
  const hash = formatHash(link)
  assert.equal(hash, `${HASH_BASE}analysis?candidate=cnd_abc12345&metric=win`)
  assert.deepEqual(parseHash(hash), link)
  assert.equal(parseHash('#/workbench/unknown-page'), null)
  assert.equal(parseHash('#other'), null)
  // 不在白名单的选择键被剥掉(草稿不进 URL)
  const stripped = parseHash(formatHash({ page: 'exchange', selection: { candidate: 'x' } }))
  assert.deepEqual(stripped, { page: 'exchange', selection: {} })
  // 缺省页
  assert.equal(DEFAULT_PAGE, 'analysis')
  assert.ok(PAGES.length === 5)
})

test('候选筛选/排序:verdict 优先序与数值方向', () => {
  const all = DEMO_RESULT.candidates
  const passOnly = filterAndSort(all, { filterVerdict: 'pass', sortKey: 'paramValue', sortDir: 1 })
  assert.ok(passOnly.length > 0 && passOnly.length < all.length)
  assert.ok(passOnly.every((c) => verdictOf(c) === 'pass'))
  const desc = filterAndSort(all, { filterVerdict: 'all', sortKey: 'win', sortDir: -1 })
  assert.ok(desc[0].win >= desc[desc.length - 1].win)
  const verdictAsc = filterAndSort(all, { filterVerdict: 'all', sortKey: 'verdict', sortDir: 1 })
  const rank = { pass: 0, border: 1, fail: 2 }
  for (let i = 1; i < verdictAsc.length; i++) {
    assert.ok(rank[verdictOf(verdictAsc[i - 1])] <= rank[verdictOf(verdictAsc[i])])
  }
})

test('判定边界:CI 区间贴线为临界,不把临界画成通过', () => {
  // win 阈值 65,ci 0.8:64.3 → 区间 [63.5,65.1] 跨线 = 临界;65.9 → [65.1,66.7] 全过
  assert.equal(verdictFor(64.3, 'win'), 'border')
  assert.equal(verdictFor(65.9, 'win'), 'pass')
  assert.equal(verdictFor(60, 'win'), 'fail')
  // gold 上限型:值 + ci 都须 ≤ 阈值
  assert.equal(verdictFor(2400 - 55, 'gold'), 'pass')
  assert.equal(verdictFor(2400, 'gold'), 'border')
})

test('任务状态机:queued→running→succeeded;cancelling 落边界为 cancelled', () => {
  const job = (total, done = 0) => ({
    id: 'job_test0000000001',
    experimentId: 'exp_test00000001',
    name: 't',
    method: 'GRID',
    total,
    done,
    status: 'running',
    demo: true,
    createdAt: 0,
  })
  let jobs = [job(10)]
  jobs = tickJobs(jobs)
  assert.equal(jobs[0].status, 'running') // 输入 running 保持 running(queued 才转)
  assert.ok(jobs[0].done > 0 && jobs[0].done <= 10)
  // 打到顶后 settle
  const finished = settleJobs([{ ...jobs[0], done: 10 }])
  assert.equal(finished[0].status, 'succeeded')
  assert.ok(isTerminal('succeeded') && !isTerminal('running'))
  // 取消:运行中 → cancelling → 边界落 cancelled,保留已完成数
  const cancelFlow = tickJobs(requestCancel([job(10, 4)], 'job_test0000000001').jobs)
  assert.equal(cancelFlow[0].status, 'cancelled')
  assert.equal(cancelFlow[0].done, 4)
  // 已终态再取消不命中
  assert.equal(requestCancel(cancelFlow, 'job_test0000000001').hit, false)
  assert.equal(runningCount([...cancelFlow, { ...job(5), status: 'queued' }]), 1)
})

test('参数校验与批量:整批校验失败不产生半批修改', () => {
  const defs = PARAM_DEFS
  const attack = defs.find((p) => p.id === 'model.warrior.attack')
  const pHit = defs.find((p) => p.id === 'model.combat.p_hit')
  assert.ok(attack && pHit)
  assert.equal(validateParam(attack, 1.5), '需要安全范围内的整数')
  assert.equal(validateParam(pHit, 1.2), '概率范围为 0–1')
  assert.equal(validateParam(attack, 110), '')
  const values = Object.fromEntries(defs.map((p) => [p.id, p.base]))
  // 倍率把 p_hit 推过 1 → 整批拒绝
  const bad = bulkMultiply(defs, values, [attack.id, pHit.id], 1.3)
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.error, /未应用批量修改/)
  // 倍率 0.9:attack 90(整数取整)、p_hit 0.765(合法)→ 全过
  const good = bulkMultiply(defs, values, [attack.id, pHit.id], 0.9)
  assert.equal(good.ok, true)
  if (good.ok) {
    assert.equal(good.next[attack.id], 90)
    assert.equal(good.next[pHit.id], 0.765)
  }
  // 基线为 0 时不给百分比(红线)
  assert.equal(relativeChange({ ...attack, base: 0 }, 5), '+5')
})

test('实验预算与校验:缺名/坏域/超预算给出可读错误', () => {
  const base = {
    name: '初始攻击力扫描',
    method: 'grid',
    min: 80, max: 130, step: 5, samples: 24,
    reps: 20, players: 10000, days: 30, paired: true, sampling: 'lhc',
    thresholds: { win: 65, retention: 42, gold: 2400 },
  }
  assert.deepEqual(designErrors(base), [])
  const counts = designCounts(base)
  assert.equal(counts.candidates, 11)
  assert.equal(counts.tasks, 220)
  assert.deepEqual(gridFactorValues(base), [80, 85, 90, 95, 100, 105, 110, 115, 120, 125, 130])
  assert.ok(designErrors({ ...base, days: 6 }).some((e) => e.includes('至少 7 天')))
  assert.ok(designErrors({ ...base, name: ' ' }).some((e) => e.includes('实验名称')))
  assert.ok(designErrors({ ...base, step: 0.5 }).some((e) => e.includes('步长')))
  // 超演示预算
  const huge = designCounts({ ...base, max: 6000, step: 1 })
  assert.ok(huge.tasks > 100000)
  assert.ok(designErrors({ ...base, max: 6000, step: 1 }).some((e) => e.includes('演示预算上限')))
})

test('命令搜索匹配:空查询给导航面,查询按 label+hint 过滤', () => {
  const entries = [
    { id: 'p1', label: '结果分析', hint: '攻击力扫描结果', icon: 'chart', run: () => {} },
    { id: 'p2', label: '参数编辑', hint: '候选方案 A', icon: 'table', run: () => {} },
    { id: 'm1', label: '初始攻击力', hint: 'model.warrior.attack', icon: 'table', run: () => {} },
  ]
  assert.equal(matchCommands(entries, 'attack')[0].id, 'm1')
  assert.equal(matchCommands(entries, '').length, 3)
  assert.equal(matchCommands(entries, '扫描')[0].id, 'p1')
  assert.equal(matchCommands(entries, '不存在的命令').length, 0)
})
