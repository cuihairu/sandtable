// WB-04.09/08 · 不可变实验历史收尾:历史搜索、复制、复跑、继续编辑。
// 这些守卫锁住红线:runs.json 只追加;旧运行条目与产物字节不变;
// 草稿恢复只写浏览器对象草稿分区,不写回归档。
import test from 'node:test'
import assert from 'node:assert/strict'

const backing = new Map()
globalThis.window = {
  location: { hash: '' },
  history: { replaceState() {} },
  localStorage: {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => { backing.set(key, String(value)) },
    removeItem: (key) => { backing.delete(key) },
  },
}

const { dispatch, getState, reduce } = await import('../src/workbench/state/workbenchStore.ts')
const {
  filterRunHistory,
  restoreRunsFromArchive,
  runIndexEntryOf,
  runInputSnapshotOf,
  snapshotRun,
} = await import('../src/workbench/state/projectDoc.ts')
const { addCandidateDraft, analysisSnapshot, resetForTest } = await import('../src/workbench/analysis/analysisStore.ts')

const SCENARIO = `# restored: run_old\nseed: 42\n`
const EXPERIMENT = `# restored: run_old\nseed: 42\nsweep: {}\n`
const OLD_ENTRY = {
  run_id: 'run_oldhistory',
  experiment_id: 'exp_history01',
  scenario_path: 'scenarios/base.yaml',
  experiment_path: 'experiments/base.yaml',
  config_hash: 'aa'.repeat(32),
  model_version: 'test-model',
  schema_version: '1',
  seed: 42,
  conditions: { method: 'grid', candidates: 2 },
  data_source: 'kernel',
  created_at_unix: 1761000000,
  files: ['results/run_oldhistory.report.json'],
}
const REPORT = JSON.stringify({
  schema_version: '1',
  spec: {
    kind: 'sweep',
    yaml: EXPERIMENT,
    plan: { candidates: [{ model: { attack: 1 } }], replicates: 2, sims: 4 },
    analysis: { baselineYaml: SCENARIO, scenarioYaml: SCENARIO },
  },
})

async function openProject() {
  const fileByPath = new Map([
    ['scenarios/base.yaml', new TextEncoder().encode(SCENARIO)],
    ['experiments/base.yaml', new TextEncoder().encode('seed: 42\nsweep: {}\n')],
    [OLD_ENTRY.files[0], new TextEncoder().encode(REPORT)],
  ])
  const doc = {
    projectId: 'prj_history001',
    name: 'History',
    sourceName: 'history.sandtable',
    objects: [
      { path: 'experiments/base.yaml', kind: 'experiment', name: 'base.yaml' },
      { path: 'scenarios/base.yaml', kind: 'scenario', name: 'base.yaml' },
      { path: OLD_ENTRY.files[0], kind: 'result', name: 'run_oldhistory.report.json' },
    ],
    files: fileByPath,
    resultStatus: {},
    openedAtUnix: 0,
  }
  dispatch({ type: 'project/open', doc })
  dispatch({ type: 'run/register', entry: OLD_ENTRY, artifacts: { [OLD_ENTRY.files[0]]: REPORT } })
}

test('run history filters by id/hash/seed/condition text and explicit local date bounds', () => {
    const runs = [
    OLD_ENTRY,
    { ...OLD_ENTRY, run_id: 'run_newhistory', config_hash: 'bb'.repeat(32), seed: 77, created_at_unix: 1761062400 },
  ]
  assert.deepEqual(filterRunHistory(runs, { query: 'run_old' }).map((r) => r.run_id), ['run_oldhistory'])
  assert.deepEqual(filterRunHistory(runs, { query: 'bb'.repeat(32) }).map((r) => r.run_id), ['run_newhistory'])
  assert.deepEqual(filterRunHistory(runs, { query: 'seed=77' }).map((r) => r.run_id), ['run_newhistory'])
  assert.deepEqual(filterRunHistory(runs, { query: 'grid' }).map((r) => r.run_id), ['run_oldhistory', 'run_newhistory'])
  assert.deepEqual(
    filterRunHistory(runs, { fromDay: '2025-10-22', toDay: '2025-10-22' }).map((r) => r.run_id),
    ['run_newhistory'],
  )
  assert.deepEqual(
    filterRunHistory(runs, { fromDay: '2025-10-22', toDay: '2025-10-22' }).map((r) => r.run_id),
    ['run_newhistory'],
  )
  assert.deepEqual(filterRunHistory(runs, { query: 'absent' }), [])
})

test('copy and restore use terminal snapshots and never mutate old entry/artifact bytes', async () => {
  resetForTest()
  backing.clear()
  await openProject()
  const state = getState()
  const snapshot = runInputSnapshotOf(OLD_ENTRY, state.runArtifacts)
  assert.equal(snapshot.scenarioYaml, EXPERIMENT)
  assert.equal(snapshot.experimentYaml, EXPERIMENT)
  const oldEntry = JSON.parse(JSON.stringify(state.runs.find((r) => r.run_id === OLD_ENTRY.run_id)))
  const oldReport = state.runArtifacts[OLD_ENTRY.files[0]]
  const draftsBefore = analysisSnapshot().drafts.length

  addCandidateDraft({
    id: 'cnd_copytest01',
    sourceRunId: OLD_ENTRY.run_id,
    sourceCandidateId: '',
    baselineId: 'bls_history01',
    baselineYaml: snapshot.scenarioYaml,
    values: {},
    yaml: snapshot.experimentYaml,
  })
  restoreRunDrafts(OLD_ENTRY)
  const restored = getState()
  assert.equal(analysisSnapshot().drafts.length, draftsBefore + 1)
  assert.equal(analysisSnapshot().drafts.at(-1).sourceRunId, OLD_ENTRY.run_id)
  assert.equal(restored.objectDrafts['scenarios/base.yaml'].content, EXPERIMENT)
  assert.equal(restored.objectDrafts['experiments/base.yaml'].content, EXPERIMENT)
  assert.equal(restored.runs.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(restored.runs[0])), oldEntry)
  assert.equal(restored.runArtifacts[OLD_ENTRY.files[0]], oldReport)
})

test('rerun appends a new entry, reuses the exact historical spec, and preserves old bytes', async () => {
  resetForTest()
  backing.clear()
  await openProject()
  const before = getState()
  const oldEntry = JSON.parse(JSON.stringify(before.runs[0]))
  const oldReport = before.runArtifacts[OLD_ENTRY.files[0]]
  const rerun = await snapshotRun({
    experimentId: OLD_ENTRY.experiment_id,
    scenarioPath: OLD_ENTRY.scenario_path,
    experimentPath: OLD_ENTRY.experiment_path,
    yaml: EXPERIMENT,
    modelVersion: OLD_ENTRY.model_version,
    schemaVersion: OLD_ENTRY.schema_version,
    seed: OLD_ENTRY.seed,
    conditions: { ...OLD_ENTRY.conditions, rerun_of: OLD_ENTRY.run_id },
    dataSource: OLD_ENTRY.data_source,
  })
  assert.notEqual(rerun.runId, OLD_ENTRY.run_id)
  const after = reduce(before, {
    type: 'run/register',
    entry: runIndexEntryOf(rerun, undefined),
  })
  assert.equal(after.runs.length, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(after.runs[0])), oldEntry)
  assert.equal(after.runs.some((r) => r.run_id === rerun.runId && r.conditions.rerun_of === OLD_ENTRY.run_id), true)
  assert.equal(after.runArtifacts[OLD_ENTRY.files[0]], oldReport)
})

test('archive reopen keeps runs.json append-only and surfaces missing artifacts', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ schema_version: '1', runs: [OLD_ENTRY] }, null, 2))
  const files = new Map([
    ['results/runs.json', bytes],
    [OLD_ENTRY.files[0], new TextEncoder().encode(REPORT)],
  ])
  const restored = restoreRunsFromArchive(files)
  assert.equal(restored.error, null)
  assert.deepEqual(restored.runs, [OLD_ENTRY])
  assert.equal(new TextDecoder().decode(restored.artifacts[OLD_ENTRY.files[0]]), REPORT)
})

function restoreRunDrafts(entry) {
  const snapshot = runInputSnapshotOf(entry, getState().runArtifacts)
  dispatch({ type: 'object/draft', key: entry.scenario_path, content: snapshot.scenarioYaml })
  dispatch({ type: 'object/draft', key: entry.experiment_path, content: snapshot.experimentYaml })
}
