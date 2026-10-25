// WB-10.09 · 中文与英文分别完成主流程(真内核,pkg-node 组):同一份实验输入
// 在 zh-CN / en-US 两个会话里各自跑通「设计 → 真实扫描 → 登记落档 → 分析」,
// 逐步核对用户可见文案按当前语言落位(状态徽标/进度读屏/抽屉/判定摘要/统计
// 行),内核错误经词典模板本地化但内核明细(行列号)原样保留;机器面(候选
// 统计数字、CSV 表头)跨语言一致——语言只进显示层。另锁无障碍文字面:工作台
// 源内不出现硬编码 aria-label/title 文案,读屏词条双语齐全非混同,长标签(长
// 内核错误、长任务名)经词典插值全量透传不被截断。词条 key 集合对齐(WB-11.03)、
// 会话引导/刷新恢复原语(WB-11.06/.07)、切页面板复数格式(WB-11.11~.18)已测。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/flow-bilingual.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(WB-10.09 真内核断言在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  // workbenchStore / runManager 在模块加载期读 window(同款桩)
  const backing = new Map()
  const storage = {
    getItem: (k) => (backing.has(k) ? backing.get(k) : null),
    setItem: (k, v) => {
      backing.set(k, String(v))
    },
    removeItem: (k) => {
      backing.delete(k)
    },
  }
  globalThis.window = { location: { hash: '' }, history: { replaceState() {} }, localStorage: storage }

  const wasm = await import(pathToFileURL(pkgNode).href)
  const runManager = await import('../src/workbench/state/runManager.ts')
  const { dispatch, getState } = await import('../src/workbench/state/workbenchStore.ts')
  const { snapshotRun, runIndexEntryOf } = await import('../src/workbench/state/projectDoc.ts')
  const { buildExperimentYaml } = await import('../src/workbench/designer/experimentYaml.ts')
  const { resultRows } = await import('../src/workbench/analysis/resultModel.ts')
  const { scopedRunCsv } = await import('../src/workbench/analysis/exportScope.ts')
  const { statusLabel, errorClassLabel, recoveryText, execErrorText } = await import(
    '../src/workbench/tasks/taskText.ts'
  )
  const { overallOutcome } = await import('../src/lib/analysisView.ts')
  const { openLocaleSession, t } = await import('../src/lib/i18n/index.ts')
  const { zh: zhDict } = await import('../src/lib/i18n/dict/zh.ts')
  const { en: enDict } = await import('../src/lib/i18n/dict/en.ts')

  const tick = () => new Promise((r) => setTimeout(r, 0))
  const DICTS = { 'zh-CN': zhDict, 'en-US': enDict }
  const SCENARIO = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\nmodel:\n  warrior:\n    attack: 100\n'
  const DESIGN = {
    name: 'bilingual flow',
    method: 'grid',
    sampling: 'lhc',
    factors: [{ path: 'model.warrior.attack', min: 90, max: 110, step: 10 }],
    samples: 0,
    reps: 2,
    targets: [{ metric: 'win_rate', kind: 'hard', min: 0, max: 1 }],
  }
  /** 真实内核后端(与 execution-kernel.test.mjs 同源绑定) */
  const kernelBackends = {
    mode: 'desktop',
    sim: async (yaml, replicates) => JSON.parse(wasm.run_simulation(yaml, replicates)),
    candidate: async (yaml, replicates, values) =>
      JSON.parse(wasm.sweep_candidate(yaml, replicates, JSON.stringify(values))),
    recommend: async (yaml, results) =>
      JSON.parse(wasm.sweep_recommend(yaml, JSON.stringify(results))),
    kernelCancel: async () => false,
    compare: null,
  }
  const waitTerminal = async () => {
    for (let i = 0; i < 500; i++) {
      const j = runManager.listJobs().at(-1)
      if (j && ['succeeded', 'failed', 'cancelled'].includes(j.status)) return j
      await tick()
    }
    throw new Error('任务未在预算内终态')
  }

  test('WB-10.09:中文与英文分别完成主流程——文案按语言落位,机器数字跨语言一致', async () => {
    runManager.resetForTest()
    const runs = {}
    for (const locale of ['zh-CN', 'en-US']) {
      // —— 会话:系统语言是「另一种」,用户显式选择本语言(手动选择压过系统) ——
      const other = locale === 'zh-CN' ? 'en-US' : 'zh-CN'
      const session = openLocaleSession({ storage, languages: [other], doc: null })
      assert.equal(session.get(), other, '无存值时跟随系统语言')
      session.set(locale)
      assert.equal(session.get(), locale, '用户选择即时生效')
      const dict = DICTS[locale]

      // —— 主流程:设计 → 真实扫描 → 登记落档(DesignerPage/WorkbenchApp 同款链) ——
      const expId = locale === 'zh-CN' ? 'exp_bi_zh' : 'exp_bi_en'
      const expYaml = buildExperimentYaml(SCENARIO, DESIGN)
      const plan = JSON.parse(wasm.sweep_plan(expYaml, 0))
      const check = JSON.parse(wasm.validate_config(SCENARIO))
      const snap = await snapshotRun({
        experimentId: expId,
        scenarioPath: 'scenarios/base.yaml',
        yaml: expYaml,
        modelVersion: check.model_version,
        schemaVersion: check.schema_version,
        conditions: { method: 'grid', replicates: plan.replicates, candidates: plan.candidates.length, sims: plan.sims },
      })
      const job = runManager.enqueueRun({
        experimentId: expId,
        runId: snap.runId,
        name: DESIGN.name,
        method: 'GRID',
        spec: {
          kind: 'sweep',
          yaml: expYaml,
          plan: { candidates: plan.candidates, replicates: plan.replicates, sims: plan.sims },
          analysis: {
            baselineId: 'bl_demo0001',
            baselineYaml: SCENARIO,
            scenarioYaml: SCENARIO,
            plan,
            modelVersion: check.model_version,
            schemaVersion: check.schema_version,
          },
        },
        backends: kernelBackends,
      })
      assert.ok(job, `${locale}: 任务应能入队`)
      // 排队/运行中的读屏与徽标在当前语言(不混另一语言的词)
      assert.equal(job.status, 'queued')
      assert.equal(statusLabel(job.status, locale), dict['tasks.queued'])
      const done = await waitTerminal()
      assert.equal(done.status, 'succeeded', `${locale}: 真实扫描应成功`)
      assert.equal(statusLabel('running', locale), dict['tasks.running'], '运行中文案按当前语言')
      assert.equal(statusLabel('succeeded', locale), dict['tasks.succeeded'])
      assert.equal(statusLabel('running', other), DICTS[other]['tasks.running'])
      assert.notEqual(dict['tasks.running'], DICTS[other]['tasks.running'], '两语言状态词确乎不同,不是混同串')
      // 错误分类与恢复提示双语可解
      assert.equal(errorClassLabel('run', locale), dict['tasks.error.run'])
      assert.equal(recoveryText(null, 'sweep', locale), dict['tasks.recovery.none'])
      // 任务抽屉读屏词条:长任务名经插值全量透传
      const longName = `${DESIGN.name} — 演示长任务名 · long task name for screen reader passthrough`
      assert.ok(t(locale, 'tasks.progressAria', { name: longName }).startsWith(longName), '进度读屏含完整任务名')
      assert.equal(t(locale, 'tasks.drawerAria'), dict['tasks.drawerAria'])
      assert.equal(t(locale, 'tasks.drawerRealLine'), dict['tasks.drawerRealLine'])

      // 登记与终局落档
      dispatch({ type: 'run/register', entry: runIndexEntryOf(snap, check.config_hash) })
      dispatch({ type: 'run/artifacts', runId: snap.runId, artifacts: { [`results/${snap.runId}.report.json`]: '{"kind":"sweep"}' } })
      assert.ok(getState().runs.some((r) => r.run_id === snap.runId), `${locale}: 登记在场`)

      // —— 分析面:判定摘要/统计行按当前语言,内核判定机器口径原样 ——
      const rows = resultRows(runManager.listJobs().at(-1))
      assert.equal(rows.length, 3)
      assert.ok(rows.every((r) => r.result?.status === 'ok'), '三候选全 ok')
      const outcome = overallOutcome(rows[0].result)
      assert.equal(outcome.overall, 'pass', '内核判定机器口径 pass(枚举值不翻译)')
      // 判定摘要:词典模板按语言落位,hard/overall 槽位是机器判定,soft 缺席走本语言「无软约束」
      const expectSummary = dict['analysis.feasibilitySummary']
        .replace('{hard}', 'pass')
        .replace('{soft}', dict['analysis.noSoftConstraint'])
        .replace('{overall}', 'pass')
      const { feasibility, statText } = await import('../src/workbench/analysis/resultModel.ts')
      assert.equal(feasibility(rows[0], locale), expectSummary)
      assert.ok(expectSummary.includes('pass'), '摘要携带真实内核判定')
      // 统计行:百分比口径 + CI + n,不出现「不可用」
      const stat = rows[0].result.stats.get('win_rate')
      const statLine = statText(stat, 'win_rate', locale)
      assert.ok(statLine.includes('95% CI') && statLine.endsWith(`n=${stat.n}`), '统计行结构完整')
      assert.match(statLine, /\d+(\.\d+)?%/u, '比例指标以百分数口径展示(唯一换算点在显示层)')
      assert.ok(!statLine.includes(dict['analysis.unavailable']), '有统计就不出不可用')

      runs[locale] = { snap, job: runManager.listJobs().at(-1), expYaml }
    }

    // —— 机器面跨语言一致:同 YAML 同 seed,两种语言跑出的数字逐值相同 ——
    const zhRun = runs['zh-CN']
    const enRun = runs['en-US']
    assert.notEqual(zhRun.snap.runId, enRun.snap.runId, 'run_id 含 experimentId,两次是不同运行')
    assert.deepEqual(
      zhRun.job.exec.results.map((r) => r.metric_stats),
      enRun.job.exec.results.map((r) => r.metric_stats),
      '候选指标统计跨语言逐值一致(语言不进机器面)',
    )
    const ui = { selectedId: null, order: { filter: 'all', by: 'index', dir: 1 } }
    const csvHeader = (run) =>
      scopedRunCsv(run.job, ui, 'all', {
        run_id: run.snap.runId,
        experiment_id: 'x',
        scenario_path: null,
        experiment_path: null,
        config_hash: 'ab'.repeat(32),
        model_version: 'unknown',
        schema_version: 'unknown',
        seed: 7,
        conditions: {},
        data_source: 'kernel',
        created_at_unix: 0,
        files: [],
      }).split('\r\n')[0]
    assert.equal(csvHeader(zhRun), csvHeader(enRun), 'CSV 机器表头跨语言逐字节一致')

    // —— 内核错误:词典模板本地化,内核明细(行列号)原样保留 ——
    const kernelMsg = (() => {
      try {
        wasm.sweep_plan('not: [valid', 0)
      } catch (e) {
        return String(e)
      }
    })()
    const zhErr = execErrorText(kernelMsg, 'zh-CN')
    const enErr = execErrorText(kernelMsg, 'en-US')
    assert.match(zhErr, /^解析失败：/, 'zh 模板在场')
    assert.match(enErr, /^Parse failure: /, 'en 模板在场')
    assert.match(zhErr, /line \d+ column \d+/)
    assert.match(enErr, /line \d+ column \d+/)
    assert.notEqual(zhErr, enErr, '模板本地化,非同一串')

    runManager.resetForTest()
  })

  test('WB-10.09:无障碍文字双语齐全且不混同;工作台源内无硬编码可见文案;长明细全量透传', () => {
    // 读屏词条(aria-label/title 槽位)双语在场、非空、两语言不同(不是混同串)
    const ariaKeys = [
      'tasks.drawerAria', 'tasks.drawerCollapse', 'tasks.progressAria',
      'common.closeDialog', 'common.language',
      'analysis.inspectorTitle', 'analysis.inspectorCollapse',
      'analysis.table.aria', 'analysis.table.selectAria', 'analysis.chart.aria',
    ]
    for (const key of ariaKeys) {
      const zhV = zhDict[key]
      const enV = enDict[key]
      assert.ok(zhV && zhV.length > 0, `${key}: zh 非空`)
      assert.ok(enV && enV.length > 0, `${key}: en 非空`)
      assert.notEqual(zhV, enV, `${key}: 双语词条确乎两语`)
    }
    // 选择候选读屏:候选 id 经插值进读屏文案
    assert.ok(t('zh-CN', 'analysis.table.selectAria', { id: 'cnd_01' }).includes('cnd_01'))
    assert.ok(t('en-US', 'analysis.table.selectAria', { id: 'cnd_01' }).includes('cnd_01'))

    // 源级守卫:工作台组件的 aria-label/title 一律走 t(),不留硬编码可见文案
    // (V1 查询页 src/App.tsx 等旧面不在工作台范围,不受此守卫约束)
    const scan = (dir) => {
      let hits = 0
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name)
        if (name.isDirectory()) hits += scan(p)
        else if (name.name.endsWith('.tsx')) {
          hits += (readFileSync(p, 'utf8').match(/aria-label="|title="/g) ?? []).length
        }
      }
      return hits
    }
    assert.equal(scan(join(here, '../src/workbench')), 0, '工作台源内无硬编码 aria-label/title 文案')

    // 长标签:保存失败通知携带长内核明细,插值全量透传不截断(双语)
    const LONG = 'YAML 解析失败: mapping values are not allowed here (line 12, column 7) — ' +
      'kernel detail repeated for length: ' + 'x'.repeat(200)
    assert.ok(t('zh-CN', 'common.notifySaveFailed', { detail: LONG }).endsWith(LONG), 'zh 长明细全量透传')
    assert.ok(t('en-US', 'common.notifySaveFailed', { detail: LONG }).endsWith(LONG), 'en 长明细全量透传')
    // 长编辑说明(词典内最长一档)双语非空,不因长度被丢
    assert.ok(zhDict['params.yamlNote'].length > 40 && enDict['params.yamlNote'].length > 40)
  })
}
