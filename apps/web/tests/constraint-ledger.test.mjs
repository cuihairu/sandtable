// 目标/约束管理守卫(todo L381 批五):整批对账只读内核 TargetOutcome 与
// SweepTarget——判定分布、通过占比、最紧余量都由内核逐候选裁决汇总而来,
// 前端不重算统计、不自设判定边界。锁:
// - 账本与内核 verdict 逐条对拍(计数、占比、最紧余量、最紧均值);
// - 未判定候选(未跑 / 配置错误)计 unjudged 不进分母,不静默当通过;
// - 通过占比 judged = 0 时缺席(null),不写 0;无界目标不出余量;
// - 行序 = 已声明目标顺序,内核多返回的目标追加不丢。
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

import { en } from '../src/lib/i18n/dict/en.ts'
import { zh } from '../src/lib/i18n/dict/zh.ts'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

const LEDGER_KEYS = [
  'analysis.ledgerTitle',
  'analysis.ledgerNote',
  'analysis.ledgerEmpty',
  'analysis.ledgerTableAria',
  'analysis.ledgerColTarget',
  'analysis.ledgerColBound',
  'analysis.ledgerColVerdicts',
  'analysis.ledgerColShare',
  'analysis.ledgerColTightest',
  'analysis.ledgerColUnjudged',
  'analysis.ledgerVerdicts',
  'analysis.ledgerTightest',
  'analysis.ledgerNoBound',
  'analysis.ledgerScaleNote',
]

test('P2 目标/约束账本:双语词典键齐全(中英镜像)', () => {
  for (const key of LEDGER_KEYS) {
    assert.ok(key in zh, `zh 缺词条 ${key}`)
    assert.ok(key in en, `en 缺词条 ${key}`)
    assert.ok(zh[key].length > 0, `${key} zh 空串`)
    assert.ok(en[key].length > 0, `${key} en 空串`)
  }
})

test('P2 目标/约束账本:AnalysisPage 按已跑视图与计划目标挂载', () => {
  const src = readFileSync(join(here, '../src/workbench/pages/AnalysisPage.tsx'), 'utf8')
  assert.ok(/<ConstraintLedgerSection views=\{allViews\} targets=\{plan\?\.targets \?\? \[\]\} runId=\{exec\.runId\} \/>/.test(src),
    'AnalysisPage 未按 allViews + plan.targets 挂载账本')
  assert.ok(/import \{ ConstraintLedgerSection \} from '\.\.\/analysis\/ConstraintLedgerSection\.tsx'/.test(src), '组件未导入')
})

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(目标/约束账本走查在 CI 构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  register(new URL('./workspace-dom-loader.mjs', import.meta.url), pathToFileURL('./'))

  const { constraintLedger, targetKey } = await import('../src/lib/constraintLedger.ts')
  const { candidateViews } = await import('../src/lib/sweepView.ts')

  const wasm = await import(pathToFileURL(pkgNode).href)

  // 阈值里含两条必定全 fail / 全 pass 的硬约束,以及一条中间软约束(造判定分布)
  const GOLD_FLOOR = 0.5
  const SWEEP_YAML = [
    'schema_version: "1"',
    'scenario: {population: 40, duration: "5d", seed: 41}',
    '',
    'sweep:',
    '  replicates: 2',
    '  parameters:',
    '    model.warrior.attack: {min: 90, max: 110, step: 10}',
    '  targets:',
    '    - {metric: win_rate, min: 0.0, kind: hard}',
    '    - {metric: win_rate, max: 0.01, kind: hard}',
    `    - {metric: gold_per_player, min: ${GOLD_FLOOR}, kind: soft}`,
    '',
  ].join('\n')

  const plan = JSON.parse(wasm.sweep_plan(SWEEP_YAML, 0))
  const results = plan.candidates.map((values) => JSON.parse(wasm.sweep_candidate(SWEEP_YAML, plan.replicates, JSON.stringify(values))))
  const views = candidateViews(plan, results, (values) => `cand_${JSON.stringify(values)}`)
  const goldMeans = results.map((r) => r.metric_stats.find(([key]) => key === 'gold_per_player')?.[1].mean)

  test('P2 账本与内核 verdict 逐条对拍(计数 / 占比 / 最紧余量)', () => {
    const rows = constraintLedger(views, plan.targets)
    assert.equal(rows.length, plan.targets.length, '行 = 已声明目标数')
    assert.deepEqual(rows.map((row) => targetKey(row)), plan.targets.map(targetKey), '行序 = 声明序')

    for (const target of plan.targets) {
      const row = rows.find((r) => targetKey(r) === targetKey(target))
      assert.ok(row, `缺目标行 ${targetKey(target)}`)
      const hits = views.flatMap((view) => view.outcomes.filter((outcome) => targetKey(outcome) === targetKey(target)))
      const tally = hits.reduce((acc, outcome) => {
        acc[outcome.verdict] = (acc[outcome.verdict] ?? 0) + 1
        return acc
      }, {})
      assert.equal(row.judged, hits.length, `${targetKey(target)} judged = 内核 outcome 条数`)
      assert.equal(row.pass, tally.pass ?? 0, `${targetKey(target)} pass`)
      assert.equal(row.borderline, tally.borderline ?? 0, `${targetKey(target)} borderline`)
      assert.equal(row.fail, tally.fail ?? 0, `${targetKey(target)} fail`)
      assert.equal(row.passShare, (tally.pass ?? 0) / hits.length, `${targetKey(target)} 通过占比 = pass / judged`)

      // 最紧余量:逐候选 mean 到阈值的最小距离,再取最小
      const distances = hits.map((outcome) => {
        const mean = outcome.stats.mean
        const toMin = target.min === null ? Number.POSITIVE_INFINITY : mean - target.min
        const toMax = target.max === null ? Number.POSITIVE_INFINITY : target.max - mean
        const distance = Math.min(toMin, toMax)
        return distance === Number.POSITIVE_INFINITY ? null : { distance, mean }
      }).filter(Boolean)
      const worst = distances.reduce((acc, cur) => (acc === null || cur.distance < acc.distance ? cur : acc), null)
      assert.equal(row.worstDistance, worst?.distance ?? null, `${targetKey(target)} 最紧余量`)
      assert.equal(row.worstMean, worst?.mean ?? null, `${targetKey(target)} 最紧均值`)
    }

    // 分布确实混:两条硬约束一全 pass 一全 fail,软约束由数据决定但计数守恒
    const all = rows[0]
    assert.equal(all.fail, 0, 'win_rate ≥ 0 全 pass')
    assert.equal(rows[1].pass, 0, 'win_rate ≤ 0.01 全 fail')
    assert.equal(rows[2].judged, views.length)
    assert.ok(rows[2].pass + rows[2].borderline + rows[2].fail === rows[2].judged, '计数守恒')
    assert.ok(goldMeans.every((mean) => mean !== undefined), '夹具须产出 gold_per_player')
  })

  test('P2 未判定候选计 unjudged 不进分母(不静默当通过)', () => {
    const broken = { ...views[0], outcomes: [] } // 模拟配置错误 / 未跑候选
    const rows = constraintLedger([broken, ...views.slice(1)], plan.targets)
    assert.equal(rows[0].judged, views.length - 1, 'judged 少一')
    assert.equal(rows[0].unjudged, 1, 'unjudged 计一')
    const judgedRows = constraintLedger(views, plan.targets)
    assert.equal(rows[0].passShare, judgedRows[0].passShare, '占比分母不含未判定候选')
    assert.equal(rows[1].unjudged, 1)
  })

  test('P2 全未判定时占比缺席而非 0,无界目标不出余量', () => {
    const none = views.map((view) => ({ ...view, outcomes: [] }))
    const rows = constraintLedger(none, plan.targets)
    assert.equal(rows[0].judged, 0)
    assert.equal(rows[0].unjudged, views.length)
    assert.equal(rows[0].passShare, null, 'judged = 0 → 占比缺席,不写 0')
    assert.equal(rows[0].worstDistance, null)
    assert.equal(rows[0].worstMean, null)
    assert.equal(rows[0].unjudged, views.length)
  })

  test('P2 未声明目标也入账不丢数据,行序在已声明之后', () => {
    const extra = { metric: 'power_p50', min: null, max: null, kind: 'soft' }
    const viewsWithExtra = views.map((view) => ({
      ...view,
      outcomes: [...view.outcomes, { metric: 'power_p50', kind: 'soft', min: null, max: null, stats: { n: 2, mean: 1, sd: 0, ci95_lo: 1, ci95_hi: 1 }, verdict: 'borderline' }],
    }))
    const rows = constraintLedger(viewsWithExtra, plan.targets)
    assert.equal(rows.length, plan.targets.length + 1, '追加一行不重复')
    const extraRow = rows[rows.length - 1]
    assert.equal(extraRow.metric, extra.metric)
    assert.equal(extraRow.judged, views.length)
    assert.equal(extraRow.borderline, views.length)
    assert.equal(extraRow.passShare, 0, '无 pass → 占比 0(区别于缺席的 null)')
    assert.equal(extraRow.worstDistance, null, '无界 → 不出余量')
  })

  // —— DOM 走查:表格上屏判定分布 / 占比 / 最紧 / 未判定,空目标出 status ——
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'https://sandtable.test/' })
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  Object.defineProperty(dom.window, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => {} },
  })
  Object.defineProperty(dom.window.navigator, 'language', { configurable: true, value: 'zh-CN' })
  Object.defineProperty(dom.window.navigator, 'languages', { configurable: true, value: ['zh-CN'] })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: dom.window.navigator })

  const { createElement, act } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const { setLocale } = await import('../src/workbench/state/localeStore.ts')
  const { ConstraintLedgerSection } = await import('../src/workbench/analysis/ConstraintLedgerSection.tsx')

  await act(async () => setLocale('zh-CN'))

  const render = async (views_, targets) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(ConstraintLedgerSection, { views: views_, targets, runId: 'run_381' })) })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    return host
  }

  test('DOM:账本表格按声明序上屏判定分布 / 通过占比 / 最紧 / 未判定', async () => {
    const host = await render(views, plan.targets)
    const text = host.textContent
    assert.ok(text.includes('目标 / 约束账本'), '标题上屏')
    assert.ok(text.includes('run run_381'), '口径行记录 run')
    assert.ok(text.includes('3 条目标'), '口径行记录目标条数')
    const table = host.querySelector('table')
    assert.equal(table.getAttribute('aria-label'), '目标 / 约束账本')
    assert.equal(table.querySelectorAll('thead th').length, 6)
    const rows = Array.from(table.querySelectorAll('tbody tr'))
    assert.equal(rows.length, plan.targets.length)
    const targetRow = rows[1]
    assert.ok(targetRow.textContent.includes('win_rate'), '目标名上屏')
    assert.ok(targetRow.textContent.includes('hard'))
    assert.ok(targetRow.textContent.includes('pass') && targetRow.textContent.includes('borderline') && targetRow.textContent.includes('fail'))
    assert.ok(targetRow.textContent.includes('判定 3'), '判定数上屏')
    assert.ok(rows.every((row) => /\d+(\.\d+)?%/.test(row.textContent)), '通过占比按百分数上屏')
    assert.ok(rows[2].textContent.includes('余量') && rows[2].textContent.includes('均值'), '最紧候选余量与均值上屏')
    assert.ok(rows.every((row) => /0|1/.test(row.textContent)), '未判定计数在场')
  })

  test('DOM:无目标也无判定结果时出 status 说明,不画空表', async () => {
    const host = await render(views.map((view) => ({ ...view, outcomes: [] })), [])
    assert.ok(host.querySelector('[role="status"]'), '空账本出 status')
    assert.equal(host.querySelector('table'), null, '不渲染空表')
  })

  test('DOM:有判定结果但未声明目标时仍按内核结果入账,不报空', async () => {
    const host = await render(views, [])
    assert.equal(host.querySelector('[role="status"]'), null, '有结果不报空')
    assert.equal(host.querySelectorAll('tbody tr').length, 3, '内核返回的 3 条目标全部入账')
  })
}
