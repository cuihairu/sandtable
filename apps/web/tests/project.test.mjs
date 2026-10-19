// 项目打包 / 解包守卫(节点侧,CI web job 跑):packProject 与 unpackProject
// 必须闭环——manifest v1、条目按路径排序、逐条 sha256(WebCrypto)、归档
// 文件集合与清单严格相等,格式与 CLI `project pack / check` 同规,使
// `sandtable project check` 能直接读浏览器打包的 .sandtable。
// 跑法(仓库根):node --test apps/web/tests/project.test.mjs
// (内核校验一条需 pkg-node,未构建时跳过;CI 在 presets 守卫前已构建)
import test from 'node:test'
import assert from 'node:assert/strict'
import { unzipSync, zipSync } from 'fflate'

import { packProject, unpackProject } from '../src/lib/project.ts'

const SCENARIO = `schema_version: '1'
scenario:
  population: 10
  duration: 3d
  seed: 12345
  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }
`
const EXPERIMENT = `schema_version: '1'
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
const RESULTS = {
  'days.csv': 'day,active\n1,9\n2,8\n',
  'report.json': '{"results":[]}',
}

async function roundTrip(input = {}) {
  const bytes = await packProject({ name: 'demo', scenario: SCENARIO, experiment: EXPERIMENT, results: RESULTS, ...input })
  const proj = await unpackProject(bytes)
  return { bytes, proj }
}

test('打包 → 解包闭环:名称、条目、文件字节全还原', async () => {
  const { proj } = await roundTrip()
  assert.equal(proj.name, 'demo')
  assert.equal(proj.entries.length, 4)
  const byKind = Object.fromEntries(proj.entries.map((e) => [e.path, e.kind]))
  assert.deepEqual(byKind, {
    'scenarios/scenario.yaml': 'scenario',
    'experiments/experiment.yaml': 'experiment',
    'results/days.csv': 'result',
    'results/report.json': 'result',
  })
  const dec = (p) => new TextDecoder().decode(proj.files.get(p))
  assert.equal(dec('scenarios/scenario.yaml'), SCENARIO)
  assert.equal(dec('experiments/experiment.yaml'), EXPERIMENT)
  assert.equal(dec('results/days.csv'), RESULTS['days.csv'])
  assert.equal(dec('results/report.json'), RESULTS['report.json'])
  for (const e of proj.entries) {
    assert.equal(e.sha256.length, 64, `${e.path} sha256 为 hex`)
    assert.match(e.sha256, /^[0-9a-f]{64}$/)
  }
})

test('条目按路径排序,同内容两次打包字节一致(固定归档时间戳)', async () => {
  const { bytes, proj } = await roundTrip()
  const paths = proj.entries.map((e) => e.path)
  assert.deepEqual(paths, [...paths].sort())
  const again = await packProject({ name: 'demo', scenario: SCENARIO, experiment: EXPERIMENT, results: RESULTS })
  assert.deepEqual([...again], [...bytes])
})

test('解包校验:条目字节被改即拒(sha256 绑定)', async () => {
  const bytes = await packProject({ name: 'demo', scenario: SCENARIO })
  const files = new Map(Object.entries(unzipSync(bytes)))
  const sc = files.get('scenarios/scenario.yaml')
  sc[0] ^= 0xff
  const tampered = zipSync(
    Object.fromEntries([...files].map(([k, v]) => [k, [v, { mtime: new Date(1980, 0, 1) }]])),
  )
  await assert.rejects(() => unpackProject(tampered), /sha256 不匹配/)
})

test('路径纪律:结果文件名越界即拒(与 CLI check_entry_path 同规)', async () => {
  for (const bad of ['../evil.csv', 'a/b/c.csv', 'back\\slash.csv', '/etc/passwd']) {
    await assert.rejects(
      () => packProject({ name: 'demo', scenario: SCENARIO, results: { [bad]: 'x' } }),
      /路径/,
      `结果名 ${bad} 应被拒`,
    )
  }
})

test('空项目与空名即拒', async () => {
  await assert.rejects(() => packProject({ name: 'demo' }), /至少需要一个/)
  await assert.rejects(() => packProject({ name: '  ', scenario: SCENARIO }), /项目名不能为空/)
})

// pkg-node 由 CI 在 presets 守卫前构建;未构建时跳过内核校验(打包层守卫不依赖它)
async function loadWasm() {
  try {
    return await import('../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')
  } catch {
    return null
  }
}

test('打包产物过真实内核 validate_config(需 pkg-node)', async (t) => {
  const wasm = await loadWasm()
  if (!wasm) return t.skip('pkg-node 未构建')
  const { proj } = await roundTrip()
  const yaml = new TextDecoder().decode(proj.files.get('scenarios/scenario.yaml'))
  const out = JSON.parse(wasm.validate_config(yaml))
  assert.equal(out.players, 10, '打包的 scenario 过内核校验')
  assert.match(String(out.config_hash), /^[0-9a-f]{64}$/)
})

/* —— WB-04 · 多配置保存 / 运行索引 / 损坏与旧版本守卫 —— */
const S_ALT = SCENARIO.replace('seed: 12345', 'seed: 777')
const RUNS_INDEX = JSON.stringify({
  schema_version: '1',
  runs: [{
    run_id: 'run_abc12345', experiment_id: 'exp_x',
    scenario_path: 'scenarios/scenario.yaml', experiment_path: null,
    config_hash: 'a'.repeat(64), model_version: 'unknown', schema_version: 'unknown',
    seed: 12345, conditions: { method: 'grid' }, created_at_unix: 0,
    files: ['results/run_abc12345.report.json'],
  }],
}, null, 2)

test('WB-04.07 多配置保存→再打开:选中与未选中条目全部还原(闭环)', async () => {
  const bytes = await packProject({
    name: 'multi',
    scenario: SCENARIO,
    configs: {
      scenarios: { 'scenarios/alt.yaml': S_ALT },
      experiments: { 'experiments/sweep.yaml': EXPERIMENT },
    },
    results: RESULTS,
  })
  const proj = await unpackProject(bytes)
  const byKind = Object.fromEntries(proj.entries.map((e) => [e.path, e.kind]))
  assert.deepEqual(byKind, {
    'scenarios/scenario.yaml': 'scenario',
    'scenarios/alt.yaml': 'scenario',
    'experiments/sweep.yaml': 'experiment',
    'results/days.csv': 'result',
    'results/report.json': 'result',
  })
  const dec = (p) => new TextDecoder().decode(proj.files.get(p))
  assert.equal(dec('scenarios/scenario.yaml'), SCENARIO)
  assert.equal(dec('scenarios/alt.yaml'), S_ALT, '未选中条目不丢')
  assert.equal(dec('experiments/sweep.yaml'), EXPERIMENT)
})

test('WB-04.07 单配置字段与多配置映射路径冲突即拒(不静默覆盖)', async () => {
  await assert.rejects(
    () => packProject({
      name: 'demo',
      scenario: SCENARIO,
      configs: { scenarios: { 'scenarios/scenario.yaml': SCENARIO } },
    }),
    /配置路径重复/,
  )
})

test('WB-04.08 运行索引随归档保存:result 条目过路径纪律,索引可读回', async () => {
  const bytes = await packProject({
    name: 'multi-run',
    scenario: SCENARIO,
    results: {
      'run_abc12345.report.json': '{"results":[]}',
      'run_abc12345.days.csv': 'day,active\n1,9\n',
      'runs.json': RUNS_INDEX,
    },
  })
  const proj = await unpackProject(bytes)
  const indexEntry = proj.entries.find((e) => e.path === 'results/runs.json')
  assert.equal(indexEntry?.kind, 'result', 'runs.json 按 result 条目携带(旧读取端按不透明产物兼容)')
  const runs = JSON.parse(new TextDecoder().decode(proj.files.get('results/runs.json')))
  assert.equal(runs.schema_version, '1')
  assert.equal(runs.runs[0].run_id, 'run_abc12345')
  assert.deepEqual(runs.runs[0].files, ['results/run_abc12345.report.json'])
})

test('WB-04.14 损坏归档守卫:清单未声明条目 / 旧 schema 版本给可读错误', async () => {
  // 旧版本 manifest:schema_version '2' → 可读错误(不静默猜测)
  const enc = (s) => new TextEncoder().encode(s)
  const mf = JSON.stringify({ schema_version: '2', name: 'old', entries: [] })
  const oldArchive = zipSync({ 'manifest.json': [enc(mf), { mtime: new Date(1980, 0, 1) }] })
  await assert.rejects(() => unpackProject(oldArchive), /schema_version = 2/)
  // 损坏:归档多出清单未声明的条目(严格相等纪律)
  const bytes = await packProject({ name: 'demo', scenario: SCENARIO })
  const files = new Map(Object.entries(unzipSync(bytes)))
  files.set('results/undeclared.csv', enc('smuggled'))
  const smuggled = zipSync(
    Object.fromEntries([...files].map(([k, v]) => [k, [v, { mtime: new Date(1980, 0, 1) }]])),
  )
  await assert.rejects(() => unpackProject(smuggled), /未声明的条目/)
})
