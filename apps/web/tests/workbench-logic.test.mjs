// WB-02.02~08 组件层纯逻辑守卫(节点侧):
// 路由深链解析/序列化、候选筛选排序、任务状态机推进、参数校验与批量、
// 实验预算与校验。组件渲染本身由浏览器走查覆盖,这里锁纯逻辑回归。
// 跑法(仓库根):node --test apps/web/tests/workbench-logic.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_PAGE, formatHash, parseHash, PAGES, HASH_BASE } from '../src/workbench/routing.ts'
import { entryRoute, legacyHash, LEGACY_HASH_BASE } from '../src/entryRoute.ts'
import { filterAndSort, verdictFor, verdictOf } from '../src/workbench/demo/sampleProject.ts'
import { DEMO_RESULT } from '../src/workbench/demo/sampleProject.ts'
import { isTerminal, requestCancel, runningCount, settleJobs, tickJobs } from '../src/workbench/state/jobLogic.ts'
import { bulkPreview, validateParam } from '../src/workbench/params/paramsLogic.ts'
import { buildRowModels } from '../src/workbench/params/paramsLogic.ts'
import { paramDelta } from '../src/workbench/params/configYaml.ts'
import { registryParam } from '../src/workbench/params/paramRegistry.ts'
import { buildDefaultYaml, parseConfig } from '../src/workbench/params/configYaml.ts'
import { designErrors, sweepModeOf, defaultDesign, kpiAvailability, abTaskCount } from '../src/workbench/designer/designerLogic.ts'
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

test('入口路由:默认进 V2 工作台,legacy 深链保留旧界面', () => {
  assert.equal(entryRoute(''), 'workbench')
  assert.equal(entryRoute('#/workbench/parameters?param=model.warrior.attack'), 'workbench')
  assert.equal(entryRoute('#arbitrary'), 'workbench')
  assert.equal(entryRoute('#/workbench/parameters'), 'workbench')
  assert.equal(entryRoute(LEGACY_HASH_BASE), 'legacy')
  assert.equal(entryRoute('#/legacy/experiment'), 'legacy')
  assert.equal(LEGACY_HASH_BASE, '#/legacy')

  assert.equal(legacyHash(''), LEGACY_HASH_BASE)
  assert.equal(legacyHash('#arbitrary'), LEGACY_HASH_BASE)
  assert.equal(legacyHash('#/legacy'), LEGACY_HASH_BASE)
  assert.equal(legacyHash('#/legacy/experiment'), '#/legacy/experiment')
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

test('参数校验与批量:整批校验失败不产生半批修改(WB-05.06/05.11/05.08)', () => {
  const attack = registryParam('model.warrior.attack')
  const pHit = registryParam('model.combat.p_hit')
  assert.ok(attack && pHit)
  assert.equal(validateParam(attack, 1.5), '需要安全范围内的整数')
  assert.equal(validateParam(pHit, 1.2), '概率范围为 0–1')
  assert.equal(validateParam(attack, 110), '')
  // 行模型:注册默认 YAML 作两侧,基线/候选数值视图可用
  const baseYaml = buildDefaultYaml()
  const parsed = parseConfig(baseYaml)
  const rows = buildRowModels(parsed, parsed)
  // 倍率把 p_hit 推过 1 → 整批拒绝
  const bad = bulkPreview(rows, [attack.path, pHit.path], 1.3)
  assert.equal(bad.ok, false)
  assert.ok(bad.rows.some((r) => r.error !== ''))
  // 倍率 0.9:attack 90(整数取整)、p_hit 0.765(合法)→ 全过
  const good = bulkPreview(rows, [attack.path, pHit.path], 0.9)
  assert.equal(good.ok, true)
  assert.deepEqual(
    Object.fromEntries(good.edits.map((e) => [e.path, e.text])),
    { 'model.warrior.attack': '90', 'model.combat.p_hit': '0.765' },
  )
  // 基线为 0 时不给百分比(红线)
  assert.equal(paramDelta(0, 5).rel, null)
  assert.equal(paramDelta(0, 5).text, '+5')
})

test('实验表单校验(WB-06 口径):缺名/坏域/不可用 KPI 给出可读错误;A/B 数量 = 2×reps', () => {
  // 场景 YAML(30 天,demo 口径):D7 可用;population_mix 齐全
  const SCEN = [
    "schema_version: '1'",
    'scenario: {population: 10000, duration: 30d, seed: 12345, population_mix: {casual: 0.6, core: 0.3, whale: 0.1}}',
  ].join('\n')
  const availability = kpiAvailability(SCEN)
  const base = defaultDesign()
  assert.deepEqual(designErrors(base, { availability }), [])
  // 表单字段随草稿:方法↔内核模式名映射(06.04/05)
  assert.equal(sweepModeOf('grid', 'lhc'), 'grid')
  assert.equal(sweepModeOf('random', 'lhc'), 'latin_hypercube')
  assert.equal(sweepModeOf('random', 'uniform'), 'random')
  assert.equal(sweepModeOf('ab', 'lhc'), null)
  // A/B 演示队列数量 = 2 方案 × replicates
  assert.equal(abTaskCount(8), 16)
  // 缺名
  assert.ok(designErrors({ ...base, name: ' ' }, { availability }).some((e) => e.message.includes('实验名称')))
  // Grid 步长错(整数参数步长 0.5)
  assert.ok(
    designErrors({ ...base, factors: [{ path: 'model.warrior.attack', min: 20, max: 220, step: 0.5 }] }, { availability })
      .some((e) => e.scope === 'factors' && e.message.includes('步长')),
  )
  // 采样数错(Random 模式 samples < 1)
  assert.ok(
    designErrors({ ...base, method: 'random', samples: 0 }, { availability }).some((e) => e.scope === 'sampling'),
  )
  // KPI 不可用(缺配比 → days 读到,retention_d7 可用;gacha 指标不可用)
  const noMix = "schema_version: '1'\nscenario: {population: 10000, duration: 30d, seed: 1}\n"
  const av2 = kpiAvailability(noMix)
  assert.equal(av2.gacha_pulls_to_hit.ok, false)
  const withD7 = { ...base, targets: [{ metric: 'gacha_pulls_to_hit', kind: 'hard', min: 0, max: 50 }] }
  assert.ok(designErrors(withD7, { availability: av2 }).some((e) => e.scope === 'kpi'))
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

/* —— WB-04 · 项目打开、保存、草稿与运行快照 —— */
import { openProject, projectFromYaml, baselineOfProject, deriveCandidate } from '../src/workbench/state/projectDoc.ts'
import {
  draftOf, writeDraft, undoDraft, resetDraft, markSaved, unsavedKeys,
} from '../src/workbench/state/projectDoc.ts'
import {
  snapshotRun, seedOfYaml, runArtifactPaths, runsIndexFile, readRunsIndex, restoreRunsFromArchive,
  auditRunArtifacts,
  RUNS_INDEX_PATH, RUNS_INDEX_SCHEMA,
} from '../src/workbench/state/projectDoc.ts'
import { buildProjectSave, persistObjectDrafts, restoreObjectDrafts, clearObjectDrafts } from '../src/workbench/state/projectDoc.ts'
import { readPickedFile, describeFileError } from '../src/workbench/state/projectDoc.ts'
import { packProject, unpackProject } from '../src/lib/project.ts'
import { unzipSync, zipSync } from 'fflate'
import { ID_PREFIXES } from '../src/workbench/ids.ts'

const S1 = `schema_version: '1'
scenario:
  population: 10
  duration: 3d
  seed: 12345
  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }
`
const S2 = S1.replace('seed: 12345', 'seed: 777')
const E1 = `schema_version: '1'
scenario:
  population: 10
  duration: 3d
  seed: 12345
  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }
sweep:
  replicates: 2
  parameters:
    scenario.population: { min: 10, max: 20, step: 10 }
`
const REPORT_V1 = JSON.stringify({ meta: { schema_version: '1', git_sha: 't' }, results: [] })
const REPORT_V9 = JSON.stringify({ meta: { schema_version: '9' }, results: [] })

async function multiArchive() {
  return packProject({
    name: 'multi',
    configs: {
      scenarios: { 'scenarios/base.yaml': S1, 'scenarios/alt.yaml': S2 },
      experiments: { 'experiments/sweep.yaml': E1 },
    },
    results: { 'report.json': REPORT_V1, 'report-v9.json': REPORT_V9, 'days.csv': 'day,active\n1,9\n' },
  })
}

test('WB-04.02/03/04 打开项目:校验复用,三目录全量映射,结果版本状态可读', async () => {
  const outcome = await openProject(await multiArchive(), 'multi.sandtable')
  assert.equal(outcome.ok, true)
  if (!outcome.ok) return
  const doc = outcome.doc
  // WB-04.03:归档内列表逐条映射(路径当 ID,不用下标)
  const kinds = Object.fromEntries(doc.objects.map((o) => [o.path, o.kind]))
  assert.deepEqual(kinds, {
    'scenarios/alt.yaml': 'scenario',
    'scenarios/base.yaml': 'scenario',
    'experiments/sweep.yaml': 'experiment',
    'results/days.csv': 'result',
    'results/report-v9.json': 'result',
    'results/report.json': 'result',
  })
  assert.ok(String(doc.projectId).startsWith(ID_PREFIXES.project))
  // WB-04.04:已保存结果的状态——已知版本 / 未知版本可读提示 / 不解析产物
  assert.deepEqual(doc.resultStatus['results/report.json'], { state: 'known', version: '1' })
  assert.deepEqual(doc.resultStatus['results/days.csv'], { state: 'opaque' })
  const unknown = doc.resultStatus['results/report-v9.json']
  assert.equal(unknown.state, 'unknown-version')
  if (unknown.state === 'unknown-version') {
    assert.match(unknown.message, /schema_version 为 "9"/)
    assert.match(unknown.message, /支持 1/)
    assert.match(unknown.message, /按字节保留/)
  }
})

test('WB-04.02 打开失败:坏档返回 ok=false 且明示保留当前项目;空配置归档同', async () => {
  const bytes = await multiArchive()
  const files = new Map(Object.entries(unzipSync(bytes)))
  const sc = files.get('scenarios/base.yaml')
  sc[0] ^= 0xff
  const tampered = zipSync(Object.fromEntries([...files].map(([k, v]) => [k, [v, { mtime: new Date(1980, 0, 1) }]])))
  const bad = await openProject(tampered, 'multi.sandtable')
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.error, /已保留当前项目/)
  // 没有 scenario/experiment 的归档同样拒绝(不替换当前项目)——
  // packProject 拒绝纯结果项目,手工构造只有 results/ 的合法 manifest
  const enc = (s) => new TextEncoder().encode(s)
  const resOnly = zipSync({
    'manifest.json': [enc(JSON.stringify({
      schema_version: '1', name: 'res-only',
      entries: [{ path: 'results/days.csv', kind: 'result', sha256: await shaHex(enc('x')) }],
    })), { mtime: new Date(1980, 0, 1) }],
    'results/days.csv': [enc('x'), { mtime: new Date(1980, 0, 1) }],
  })
  const emptyOutcome = await openProject(resOnly, 'r.sandtable')
  assert.equal(emptyOutcome.ok, false)
  if (!emptyOutcome.ok) assert.match(emptyOutcome.error, /没有 scenario/)
})

test('WB-04.05 只读基线与候选派生:基线冻结,候选存基线引用/当前值/修改状态', async () => {
  const outcome = await openProject(await multiArchive(), 'multi.sandtable')
  if (!outcome.ok) return assert.fail('archive should open')
  const baseline = baselineOfProject(outcome.doc, 'scenarios/base.yaml')
  assert.equal(baseline.readonly, true)
  assert.ok(Object.isFrozen(baseline), '基线对象冻结(只读,无修改入口)')
  assert.ok(String(baseline.baselineId).startsWith(ID_PREFIXES.baseline))
  const baseValues = { 'model.warrior.attack': 100, 'model.combat.p_hit': 0.85 }
  const candidate = deriveCandidate(baseline, baseValues, { ...baseValues, 'model.warrior.attack': 110 })
  assert.ok(String(candidate.candidateId).startsWith(ID_PREFIXES.candidate))
  assert.equal(candidate.baselineId, baseline.baselineId, '候选保存基线引用')
  assert.equal(candidate.values['model.warrior.attack'], 110, '候选保存当前值')
  assert.deepEqual(candidate.modified, ['model.warrior.attack'], '修改状态=相对基线差异')
  assert.equal(candidate.saved, false)
  // 同参数域恒得同候选 ID(内容寻址),改值即换
  const again = deriveCandidate(baseline, baseValues, { ...baseValues, 'model.warrior.attack': 110 })
  assert.equal(again.candidateId, candidate.candidateId)
  assert.notEqual(deriveCandidate(baseline, baseValues, { ...baseValues, 'model.warrior.attack': 111 }).candidateId, candidate.candidateId)
})

test('WB-04.06 草稿按对象隔离:切换对象不覆盖另一对象内容;undo/reset 各自生效', () => {
  let drafts = {}
  drafts = writeDraft(drafts, 'scenarios/base.yaml', S1, S1 + '# tweaked\n')
  drafts = writeDraft(drafts, 'experiments/sweep.yaml', E1, E1 + '# swept\n')
  assert.equal(draftOf(drafts, 'scenarios/base.yaml', S1).content, S1 + '# tweaked\n')
  assert.equal(draftOf(drafts, 'experiments/sweep.yaml', E1).content, E1 + '# swept\n')
  assert.deepEqual(unsavedKeys(drafts).sort(), ['experiments/sweep.yaml', 'scenarios/base.yaml'])
  // 未编辑对象回落项目文件原文且视为已保存
  assert.equal(draftOf(drafts, 'scenarios/alt.yaml', S2).content, S2)
  assert.equal(draftOf(drafts, 'scenarios/alt.yaml', S2).saved, true)
  // undo:回到上一版;history 空 → no-op
  drafts = undoDraft(drafts, 'scenarios/base.yaml', S1)
  assert.equal(draftOf(drafts, 'scenarios/base.yaml', S1).content, S1)
  assert.equal(undoDraft(drafts, 'scenarios/alt.yaml', S2), drafts)
  // reset(关闭文档/放弃):该对象草稿消失,其他对象不受影响
  drafts = resetDraft(drafts, 'scenarios/base.yaml')
  assert.equal(draftOf(drafts, 'scenarios/base.yaml', S1).saved, true)
  assert.equal(draftOf(drafts, 'experiments/sweep.yaml', E1).content, E1 + '# swept\n')
})

test('WB-04.10 markSaved 只更新指定对象:失败路径绝不会全量置已保存', () => {
  let drafts = {}
  drafts = writeDraft(drafts, 'a', 'x', 'x2')
  drafts = writeDraft(drafts, 'b', 'y', 'y2')
  drafts = markSaved(drafts, ['a'])
  assert.equal(draftOf(drafts, 'a', 'x').saved, true)
  assert.equal(draftOf(drafts, 'b', 'y').saved, false, '未写盘成功的对象保持未保存')
})

test('WB-04.09 运行快照:不可变、配置哈希=输入 sha256、seed 与条件入册、同输入同 runId', async () => {
  assert.equal(seedOfYaml(S1), 12345)
  assert.equal(seedOfYaml('scenario:\n  population: 10\n'), null)
  const conditions = { method: 'grid', replicates: 20, players: 10000, days: 30 }
  const snap = await snapshotRun({ experimentId: 'exp_x', scenarioPath: 'scenarios/base.yaml', yaml: S1, conditions })
  assert.ok(Object.isFrozen(snap), '快照 deep freeze')
  assert.ok(Object.isFrozen(snap.conditions))
  assert.match(snap.configHash, /^[0-9a-f]{64}$/)
  assert.equal(snap.configHash, await shaHex(new TextEncoder().encode(S1)), '配置哈希=输入 YAML 字节 sha256')
  assert.equal(snap.seed, 12345, 'seed 从输入 YAML 读取')
  assert.deepEqual(snap.conditions, conditions)
  assert.equal(snap.modelVersion, 'unknown', '内核执行接入前如实 unknown,不冒充已知版本')
  const snap2 = await snapshotRun({ experimentId: 'exp_x', scenarioPath: 'scenarios/base.yaml', yaml: S1, conditions })
  assert.equal(snap.runId, snap2.runId, '同输入恒同 runId(快照可追溯)')
  const different = await snapshotRun({ experimentId: 'exp_x', yaml: S2, conditions })
  assert.notEqual(different.runId, snap.runId)
})

async function shaHex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

test('WB-04.08 运行索引与产物路径:平铺两段、索引 roundtrip、未知 schema 可读错误', async () => {
  const paths = runArtifactPaths('run_abc12345', ['report.json', 'days.csv'])
  assert.deepEqual(paths, ['results/run_abc12345.report.json', 'results/run_abc12345.days.csv'])
  for (const p of paths) {
    assert.match(p, /^[^/]+\/[^/]+$/, `产物路径保持 <目录>/<文件> 两段: ${p}`)
  }
  const entry = {
    run_id: 'run_abc12345', experiment_id: 'exp_x', scenario_path: 'scenarios/base.yaml',
    experiment_path: null, config_hash: 'a'.repeat(64), model_version: 'unknown',
    schema_version: 'unknown', seed: 42, conditions: { method: 'grid' },
    data_source: 'kernel', created_at_unix: 0, files: paths,
  }
  const text = runsIndexFile([entry])
  const parsed = readRunsIndex(text)
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.deepEqual(parsed.runs, [entry])
  const unknown = readRunsIndex(text.replace('"1"', '"2"'))
  assert.equal(unknown.ok, false)
  if (!unknown.ok) assert.match(unknown.error, /schema_version 为 "2".*支持 1/)
  assert.equal(RUNS_INDEX_SCHEMA, '1')
  assert.equal(RUNS_INDEX_PATH, 'results/runs.json')
})

test('WB-03.16 数据来源与版本标记:演示数据不进真实运行集合(快照入口 + 索引写闸 + 读闸),v1 条目按 kernel 推断', async () => {
  const base = {
    run_id: 'run_abc12345', experiment_id: 'exp_x', scenario_path: 'scenarios/base.yaml',
    experiment_path: null, config_hash: 'a'.repeat(64), model_version: 'unknown',
    schema_version: 'unknown', seed: 42, conditions: { method: 'grid' },
    data_source: 'kernel', created_at_unix: 0, files: [],
  }
  // 快照入口闸:演示数据不得登记为运行快照;缺省 kernel
  await assert.rejects(
    () => snapshotRun({ experimentId: 'exp_x', yaml: S1, dataSource: 'synthetic_demo' }),
    /不得登记为运行快照/,
  )
  const snap = await snapshotRun({ experimentId: 'exp_x', yaml: S1 })
  assert.equal(snap.dataSource, 'kernel', '快照来源标记缺省 kernel')
  // 索引写闸:demo 来源 / 来源缺失 / 非法来源 都显式拒绝,不静默修正
  await assert.rejects(async () => runsIndexFile([{ ...base, data_source: 'synthetic_demo' }]), /不得进入真实运行集合/)
  await assert.rejects(async () => runsIndexFile([{ ...base, data_source: undefined }]), /只收 kernel/)
  await assert.rejects(async () => runsIndexFile([{ ...base, data_source: 'cli' }]), /只收 kernel/)
  const back = readRunsIndex(runsIndexFile([base]))
  assert.equal(back.ok, true)
  if (back.ok) assert.deepEqual(back.runs, [base])
  // 读闸:demo 条目可读错误(归档内结果文件仍按字节保留)
  const refused = readRunsIndex(JSON.stringify({ schema_version: '1', runs: [{ ...base, data_source: 'synthetic_demo' }] }))
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.error, /synthetic_demo.*不得混入真实运行集合/)
  // v1 时代条目缺席 data_source:按 kernel 推断(演示数据自始没有进入索引的通道)
  const legacy = readRunsIndex(JSON.stringify({ schema_version: '1', runs: [{ ...base, data_source: undefined }] }))
  assert.equal(legacy.ok, true)
  if (legacy.ok) assert.equal(legacy.runs[0].data_source, 'kernel')
  // 其他非法来源值:可读错误,不静默降级
  const bad = readRunsIndex(JSON.stringify({ schema_version: '1', runs: [{ ...base, data_source: 'cli' }] }))
  assert.equal(bad.ok, false)
  if (!bad.ok) assert.match(bad.error, /不是合法来源/)
})

test('WB-03.02 缺失产物审计:索引声称的 files 逐条点名,不静默跳过不用 0 填空', async () => {
  const { auditRunArtifacts } = await import('../src/workbench/state/projectDoc.ts')
  const entry = (run, files) => ({
    run_id: run, experiment_id: 'exp_x', scenario_path: null, experiment_path: null,
    config_hash: 'a'.repeat(64), model_version: 'unknown', schema_version: 'unknown',
    seed: 1, conditions: { method: 'grid' }, created_at_unix: 0, files,
  })
  const runs = [
    entry('run_a0000001', ['results/run_a0000001.analysis.json']),
    entry('run_b0000002', ['results/run_b0000002.analysis.json', 'results/run_b0000002.days.csv']),
  ]
  // 只有 run_a 的产物在场:run_b 两条逐条点名(run_id + 文件),不静默略过
  const missing = auditRunArtifacts(runs, new Set(['results/run_a0000001.analysis.json']))
  assert.deepEqual(missing, [
    { runId: 'run_b0000002', file: 'results/run_b0000002.analysis.json' },
    { runId: 'run_b0000002', file: 'results/run_b0000002.days.csv' },
  ])
  // 全在场 → 空数组(显式空,不是 undefined/null)
  assert.deepEqual(auditRunArtifacts([runs[0]], new Set(['results/run_a0000001.analysis.json'])), [])
  // 数组入参同口径(调用方给 Object.keys() 也行)
  assert.equal(auditRunArtifacts([runs[1]], ['results/run_b0000002.analysis.json']).length, 1)
  // 空索引零产物:无缺失可报,不给任何虚构条目
  assert.deepEqual(auditRunArtifacts([], new Set()), [])
})

test('WB-09.07 归档重开:运行索引与在场产物回读为登记簿形态,重开可再导出', () => {
  const enc = (s) => new TextEncoder().encode(s)
  const entry = {
    run_id: 'run_abc12345', experiment_id: 'exp_x', scenario_path: null, experiment_path: null,
    config_hash: 'a'.repeat(64), model_version: 'm1', schema_version: '1',
    seed: 12345, conditions: { method: 'grid' }, data_source: 'kernel', created_at_unix: 0,
    files: ['results/run_abc12345.report.json', 'results/run_abc12345.days.csv'],
  }
  const files = new Map([
    [RUNS_INDEX_PATH, enc(runsIndexFile([entry]))],
    ['results/run_abc12345.report.json', enc('{"data_source":"kernel"}')],
    // days.csv 缺席:恢复不报错,缺失交给 auditRunArtifacts 点名
  ])
  const restored = restoreRunsFromArchive(files)
  assert.equal(restored.error, null)
  assert.equal(restored.runs.length, 1)
  assert.deepEqual(restored.runs[0].files, entry.files, '登记条目原样回读(files 不重排)')
  // 在场产物回读;不在场的不虚构空串占位
  assert.deepEqual(restored.artifacts['results/run_abc12345.report.json'], enc('{"data_source":"kernel"}'))
  assert.equal(restored.artifacts['results/run_abc12345.days.csv'], undefined)
  assert.deepEqual(
    auditRunArtifacts(restored.runs, new Set([...files.keys(), ...Object.keys(restored.artifacts)])),
    [{ runId: 'run_abc12345', file: 'results/run_abc12345.days.csv' }],
    '重开后 audit 仍逐条点名缺失',
  )
})

test('WB-09.07 归档重开:零运行不报错,索引损坏给可读错误不静默丢产物', () => {
  const enc = (s) => new TextEncoder().encode(s)
  // 没有 runs.json(零运行项目):空恢复、无错误
  const quiet = restoreRunsFromArchive(new Map([['results/days.csv', enc('day,active\n1,9\n')]]))
  assert.deepEqual(quiet, { runs: [], artifacts: {}, error: null })
  // 索引存在但不可读(坏 schema):可读错误,产物文件仍按字节保留在 doc.files
  const broken = restoreRunsFromArchive(new Map([
    [RUNS_INDEX_PATH, enc(JSON.stringify({ schema_version: '9', runs: [] }))],
    ['results/run_x.report.json', enc('{}')],
  ]))
  assert.equal(broken.runs.length, 0)
  assert.match(broken.error, /schema_version/, '错误点名 schema 版本,不静默吞掉')
})

test('WB-04.07/08 保存多配置:未选中条目与既有结果不丢,运行索引入归档', async () => {
  const outcome = await openProject(await multiArchive(), 'multi.sandtable')
  if (!outcome.ok) return assert.fail('archive should open')
  const doc = outcome.doc
  // 只编辑一个场景(alt.yaml 未选中、未编辑)
  const drafts = writeDraft({}, 'scenarios/base.yaml', S1, S1 + '# edited\n')
  const runsIndex = runsIndexFile([{
    run_id: 'run_abc12345', experiment_id: 'exp_x', scenario_path: 'scenarios/base.yaml',
    experiment_path: 'experiments/sweep.yaml', config_hash: 'a'.repeat(64),
    model_version: 'unknown', schema_version: 'unknown', seed: 12345,
    conditions: { method: 'grid' }, data_source: 'kernel', created_at_unix: 0,
    files: ['results/run_abc12345.report.json'],
  }])
  const build = await buildProjectSave(doc, drafts, {
    runsIndex,
    runArtifacts: { 'results/run_abc12345.report.json': REPORT_V1 },
  })
  assert.equal(build.name, 'multi')
  const proj = await unpackProject(await packProject(build))
  const byPath = Object.fromEntries(proj.entries.map((e) => [e.path, e.kind]))
  // 全部条目仍在:选中的(base.yaml 编辑版)+ 未选中的(alt.yaml 原文)+ 实验 + 结果
  assert.deepEqual(byPath, {
    'scenarios/base.yaml': 'scenario',
    'scenarios/alt.yaml': 'scenario',
    'experiments/sweep.yaml': 'experiment',
    'results/days.csv': 'result',
    'results/report-v9.json': 'result',
    'results/report.json': 'result',
    'results/runs.json': 'result',
    'results/run_abc12345.report.json': 'result',
  })
  const dec = (p) => new TextDecoder().decode(proj.files.get(p))
  assert.match(dec('scenarios/base.yaml'), /# edited/)
  assert.equal(dec('scenarios/alt.yaml'), S2, '未编辑条目字节保真')
  assert.equal(dec('results/days.csv'), 'day,active\n1,9\n', '既有结果保留')
  const index = readRunsIndex(dec('results/runs.json'))
  assert.equal(index.ok, true, '归档内运行索引可读')
  // 零运行时不塞空索引(打开→保存字节不添噪)
  const quiet = await buildProjectSave(doc, {})
  assert.equal(quiet.results['runs.json'], undefined)
  // 运行产物路径越界(嵌套三段)在构建期即拒:不制造非法路径
  await assert.rejects(
    () => buildProjectSave(doc, {}, { runArtifacts: { 'results/run_x/sub/a.csv': 'x' } }),
    /路径越界/,
  )
})

test('WB-04.11 草稿持久化按项目隔离:跨项目不恢复,损坏载荷丢弃', async () => {
  const outcome = await openProject(await multiArchive(), 'multi.sandtable')
  if (!outcome.ok) return assert.fail('archive should open')
  const doc = outcome.doc
  const mem = new Map()
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  }
  const drafts = writeDraft({}, 'scenarios/base.yaml', S1, S1 + '# local\n')
  assert.equal(persistObjectDrafts(storage, doc, drafts), true)
  // 同项目恢复:内容与文件保存状态分条还原
  const restored = restoreObjectDrafts(storage, doc)
  assert.equal(restored['scenarios/base.yaml'].content, S1 + '# local\n')
  assert.equal(restored['scenarios/base.yaml'].saved, false)
  // 跨项目(不同 projectId)一律丢弃 → 防串数据
  const other = await projectFromYaml('other.yaml', S2)
  assert.deepEqual(restoreObjectDrafts(storage, other), {})
  // 损坏载荷丢弃,不阻塞打开
  mem.set(`sandtable-wb2-project-${String(doc.projectId)}`, '{broken')
  assert.deepEqual(restoreObjectDrafts(storage, doc), {})
  // 载荷声明别的项目 → 丢弃
  mem.set(`sandtable-wb2-project-${String(doc.projectId)}`, JSON.stringify({ version: '1', projectId: 'prj_someoneelse0', savedAt: 0, drafts }))
  assert.deepEqual(restoreObjectDrafts(storage, doc), {})
  clearObjectDrafts(storage, doc)
  assert.equal(mem.size, 0)
})

test('WB-04.13 文件选择:取消不是错误;权限/不可读失败给可读原因', async () => {
  assert.deepEqual(await readPickedFile(null), { ok: 'cancel' })
  assert.deepEqual(await readPickedFile(undefined), { ok: 'cancel' })
  const pick = await readPickedFile(new File([S1], 'base.yaml'))
  assert.equal(pick.ok, true)
  if (pick.ok) {
    assert.equal(pick.name, 'base.yaml')
    assert.deepEqual([...pick.bytes], [...new TextEncoder().encode(S1)])
  }
  assert.match(describeFileError('p.yaml', 'EPERM: operation not permitted'), /权限不足/)
  assert.match(describeFileError('p.yaml', 'NotReadableError'), /不可读/)
  assert.match(describeFileError('p.yaml', 'The user aborted a request'), /取消/)
  assert.match(describeFileError('p.yaml', 'weird failure'), /weird failure/)
})
