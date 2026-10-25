// WB-10.07 · 错误类型检查(真内核,pkg-node 组):非法参数 / YAML 语法 /
// 缺指标 / 预算超限 / 单候选失败 / Worker 失败 / 保存失败,逐类核对真实
// 错误面。本文件补「真内核直连」的链路;协议信封、init 重试、终止重建、
// 前端内存预算(execution.test.mjs)、分析页错误行展示与导出(analysis-
// results.test.mjs)、项目路径纪律(project.test.mjs)、草稿暂存失败
// (analysis-results.test.mjs)等已测面不重复。
// 跑法(仓库根,先构建 pkg-node):
//   wasm-pack build crates/sandtable-wasm --target nodejs --out-dir pkg-node --dev
//   node --test apps/web/tests/error-surface.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgNode = join(here, '../../../crates/sandtable-wasm/pkg-node/sandtable_wasm.js')

if (!existsSync(pkgNode)) {
  test('skip: pkg-node 未构建(WB-10.07 真内核断言在 CI 的构建后阶段跑)', () => {
    assert.ok(true)
  })
} else {
  const wasm = await import(pathToFileURL(pkgNode).href)
  const { startExec, workerBackends } = await import('../src/workbench/state/executor.ts')
  const { serveSweepWorker } = await import('../src/workbench/state/sweepWorker.ts')
  const { runsIndexFile } = await import('../src/workbench/state/projectDoc.ts')
  const { zh: zhDict } = await import('../src/lib/i18n/dict/zh.ts')
  const { en: enDict } = await import('../src/lib/i18n/dict/en.ts')

  const tick = () => new Promise((r) => setTimeout(r, 0))
  const BASE = 'schema_version: "1"\nscenario: {population: 40, duration: "3d", seed: 7}\n'
  /** 真实内核后端(与 execution-kernel.test.mjs 同源绑定) */
  const kernelBackends = {
    mode: 'desktop',
    sim: async (yaml, replicates) => JSON.parse(wasm.run_simulation(yaml, replicates)),
    candidate: async (yaml, replicates, values) =>
      JSON.parse(wasm.sweep_candidate(yaml, replicates, JSON.stringify(values))),
    recommend: async (yaml, results) =>
      JSON.parse(wasm.sweep_recommend(yaml, JSON.stringify(results))),
    kernelCancel: async () => false,
    compare: (baseYaml, candYaml, metric, base, cand) =>
      Promise.resolve(
        JSON.parse(
          wasm.ab_compare(baseYaml, candYaml, metric, JSON.stringify(base.results), JSON.stringify(cand.results)),
        ),
      ),
  }
  const sink = () => {
    const patches = []
    return { patches, hooks: { update: (id, p) => patches.push(p) } }
  }
  /** 真内核 Worker:serveSweepWorker(纯服务端)接 pkg-node 绑定,协议面与
   *  浏览器 Worker 同构(onmessage 回发响应,terminate 计数) */
  const makeKernelWorker = () => {
    const w = { onmessage: null, inbox: [], terminated: 0 }
    const server = serveSweepWorker({
      post: (msg) => w.onmessage?.({ data: msg }),
      init: async () => true,
      plan: async (y, r) => JSON.parse(wasm.sweep_plan(y, r)),
      sim: async (y, r) => JSON.parse(wasm.run_simulation(y, r)),
      candidate: async (y, r, v) => JSON.parse(wasm.sweep_candidate(y, r, JSON.stringify(v))),
      recommend: async (y, rs) => JSON.parse(wasm.sweep_recommend(y, JSON.stringify(rs))),
      abCompare: async (b, c, m, ra, rb) =>
        JSON.parse(wasm.ab_compare(b, c, m, JSON.stringify(ra), JSON.stringify(rb))),
    })
    return {
      postMessage: (data) => {
        w.inbox.push(data)
        void server.onMessage(data)
      },
      terminate: () => {
        w.terminated++
      },
      get onmessage() {
        return w.onmessage
      },
      set onmessage(fn) {
        w.onmessage = fn
      },
      get terminated() {
        return w.terminated
      },
      get inbox() {
        return w.inbox
      },
    }
  }

  test('WB-10.07:非法参数与 YAML 语法——内核原文带定位/可选项,经错误通道不静默', async () => {
    // YAML 语法:内核报「YAML 解析失败 + 行列号」,三个入口一致拒绝
    // (wasm 绑定同步抛错,包 async 让 rejects 统一捕获)
    for (const [label, fn] of [
      ['sweep_plan', async () => wasm.sweep_plan('not: [valid', 0)],
      ['validate_config', async () => wasm.validate_config('a: b: c')],
      ['run_simulation', async () => wasm.run_simulation('scenario: {population: 40', 1)],
    ]) {
      await assert.rejects(fn, (e) => {
        assert.match(String(e), /YAML 解析失败/, `${label}: 语法错误有稳定前缀`)
        assert.match(String(e), /line \d+ column \d+/, `${label}: 携带行列定位`)
        return true
      })
    }
    // 非法参数:扫描目标里的未知指标——定位路径 + 可选清单
    await assert.rejects(
      async () =>
        wasm.sweep_plan(
          BASE + 'sweep:\n  replicates: 1\n  parameters:\n    model.warrior.attack: {min: 90, max: 110, step: 10}\n  targets:\n    - {metric: winrate, min: 0, max: 1}\n',
          0,
        ),
      /sweep\.targets: 未知指标 "winrate".*可选/,
    )
    // 执行器防御链:计划注入合法,但场景 YAML 语法坏 → 候选调用抛错 =
    // run 类失败,内核原文原样过错误通道(正常提交链上这会在 plan 门先被拒)
    const { hooks } = sink()
    const ctl = startExec(
      { kind: 'sweep', yaml: 'not: [valid', plan: { candidates: [{ 'model.warrior.attack': 100 }], replicates: 1, sims: 1 } },
      kernelBackends,
      hooks,
      'job_err_syntax',
    )
    const out = await ctl.promise
    assert.equal(out.status, 'failed')
    assert.equal(out.errorClass, 'run', '语法错误在执行期属运行错误类')
    assert.match(out.message, /YAML 解析失败/, '内核原文不被吞')
  })

  test('WB-10.07:预算超限——内核 Web 预算门在计划期拒绝,给出可行动指引', async () => {
    await assert.rejects(
      async () =>
        wasm.sweep_plan(
          BASE + 'sweep:\n  replicates: 1\n  parameters:\n    model.combat.p_hit: {min: 0, max: 2, step: 0.01}\n',
          0,
        ),
      (e) => {
        assert.match(String(e), /参数错误/, '预算是参数错误,不是运行失败')
        assert.match(String(e), /201 超出 Web 预算 200/, '真实任务数与预算上限都在场')
        assert.match(String(e), /更大实验走 CLI/, '给出可行动指引')
        return true
      },
    )
  })

  test('WB-10.07:单候选失败是数据不是任务失败——真内核 config_error 候选保留,推荐仍出', async () => {
    // p_hit 网格 0.8/1.0/1.2:第三个候选越界,计划期不拒,候选期报 config_error
    const yaml = BASE + 'sweep:\n  replicates: 2\n  parameters:\n    model.combat.p_hit: {min: 0.8, max: 1.2, step: 0.2}\n  targets:\n    - {metric: win_rate, min: 0.0, max: 1.0}\n'
    const plan = JSON.parse(wasm.sweep_plan(yaml, 0))
    assert.equal(plan.candidates.length, 3)
    const { patches, hooks } = sink()
    const ctl = startExec({ kind: 'sweep', yaml, plan }, kernelBackends, hooks, 'job_err_candidate')
    const out = await ctl.promise
    assert.equal(out.status, 'succeeded', '单候选配置错误不判任务失败')
    assert.equal(out.message, null)
    assert.equal(out.results.length, 3, '错误候选留在结果集')
    assert.equal(out.results[2].status.config_error !== undefined, true, '第三候选是 config_error')
    assert.match(out.results[2].status.config_error, /命中概率必须在 \[0, 1\]/, '内核错误原文保留')
    assert.equal(out.results[0].status, 'ok')
    // 真实进度只数 ok 候选:2 ok × 2 reps = 4(错误候选不占任务计数)
    assert.equal(out.results.filter((r) => r.status === 'ok').length, 2)
    const last = patches.filter((p) => p.done !== undefined).at(-1)
    assert.equal(last.done, 4, 'done = ok 候选 × reps,config_error 不计入')
    // 完整候选集(含错误行)仍出真实推荐
    assert.equal(out.recommendationError, null)
    assert.equal(out.recommendation.recommendation.param, 'model.combat.p_hit')
    assert.ok(out.recommendation.elasticities.length > 0)
  })

  test('WB-10.07:缺指标不补零——短窗口只列可用指标,跨窗口指标显式拒绝', async () => {
    // 3 天窗口:d14/d30 留存提不出来。可用指标如实列出且 n = replicates,
    // 缺席的指标不在场(绝不以 0 填空)
    const yaml = BASE + 'sweep:\n  replicates: 2\n  parameters:\n    model.warrior.attack: {min: 90, max: 110, step: 10}\n'
    const plan = JSON.parse(wasm.sweep_plan(yaml, 0))
    for (const values of plan.candidates) {
      const r = JSON.parse(wasm.sweep_candidate(yaml, plan.replicates, JSON.stringify(values)))
      assert.equal(r.status, 'ok')
      const names = r.metric_stats.map(([k]) => k)
      assert.ok(names.includes('win_rate'), '可用指标在场')
      assert.ok(!names.includes('retention_d14'), '窗口外的指标缺席,不补零')
      assert.ok(!names.includes('retention_d30'), '窗口外的指标缺席,不补零')
      for (const [, s] of r.metric_stats) assert.equal(s.n, 2, '在场指标都有完整 replicate')
    }
    // A/B 侧:跨窗口指标显式拒绝并给出可选清单(参数错误通道)
    const ya = BASE + 'model:\n  dungeon:\n    m_attack: 10\n'
    const yb = BASE + 'model:\n  dungeon:\n    m_attack: 120\n'
    const ra = wasm.run_simulation(ya, 2)
    const rb = wasm.run_simulation(yb, 2)
    // wasm 绑定同步抛错,包进 async 让 rejects 统一捕获
    await assert.rejects(
      async () => wasm.ab_compare(ya, yb, 'retention_d14', ra, rb),
      /未知指标 retention_d14.*可选/,
    )
  })

  test('WB-10.07:Worker 通道接真内核——成功链真实比对;运行错误与终止走 run 类', async () => {
    // a · 真内核 Worker:协议面(请求/响应信封)载真实 wasm 载荷
    const be = workerBackends(makeKernelWorker)
    const ya = BASE + 'model:\n  dungeon:\n    m_attack: 10\n'
    const yb = BASE + 'model:\n  dungeon:\n    m_attack: 120\n'
    const { hooks } = sink()
    const ctl = startExec(
      { kind: 'ab', baseYaml: ya, candYaml: yb, replicates: 2, metric: 'win_rate' },
      be,
      hooks,
      'job_err_worker_ok',
    )
    const out = await ctl.promise
    assert.equal(out.status, 'succeeded', `Worker 真内核链应成功: ${out.errorClass ?? ''} ${out.message ?? ''}`)
    assert.equal(out.arms.base.config_hash, JSON.parse(wasm.validate_config(ya)).config_hash, 'base 臂是真内核输出')
    assert.equal(out.arms.cand.config_hash, JSON.parse(wasm.validate_config(yb)).config_hash, 'cand 臂是真内核输出')
    assert.equal(out.comparison.metric, 'win_rate')
    assert.ok(['BHigher', 'AHigher', 'NoDifference'].includes(out.comparison.verdict))

    // b · Worker 运行失败:协议错误响应原样过执行器错误通道
    const failing = {
      onmessage: null,
      postMessage(data) {
        const req = data
        this.onmessage?.({
          data: {
            protocol: 1,
            kind: 'error',
            taskId: req.taskId,
            reqKind: req.reqKind ?? null,
            errorClass: 'run',
            retryable: false,
            message: '内核运行错误: 仿真中断',
          },
        })
      },
      terminate() {},
    }
    const { hooks: h2 } = sink()
    const ctl2 = startExec(
      { kind: 'ab', baseYaml: ya, candYaml: yb, replicates: 2, metric: 'win_rate' },
      workerBackends(() => failing),
      h2,
      'job_err_worker_fail',
    )
    const out2 = await ctl2.promise
    assert.equal(out2.status, 'failed')
    assert.equal(out2.errorClass, 'run')
    assert.match(out2.message, /内核运行错误: 仿真中断/, 'Worker 错误原文过通道')

    // c · 在途终止:升级取消终止 Worker,在途请求被拒 → run 类失败(不挂死)
    const silent = { onmessage: null, postMessage() {}, terminate() {} }
    const be3 = workerBackends(() => silent)
    const { hooks: h3 } = sink()
    const ctl3 = startExec(
      { kind: 'ab', baseYaml: ya, candYaml: yb, replicates: 2, metric: 'win_rate' },
      be3,
      h3,
      'job_err_worker_term',
    )
    await tick()
    be3.terminate?.()
    const out3 = await ctl3.promise
    assert.equal(out3.status, 'failed')
    assert.equal(out3.errorClass, 'run')
    assert.match(out3.message, /worker-terminated/, '终止的在途请求以运行错误落地,任务不挂死')
  })

  test('WB-10.07:保存失败——演示数据过运行索引写闸被拒;失败文案双语在场', () => {
    // WorkbenchApp 保存链 = buildProjectSave + runsIndexFile(s.runs) + packProject:
    // demo 来源条目进索引时显式拒绝(写闸),保存失败分支只报错不落保存状态
    const demoEntry = {
      run_id: 'run_demo00001',
      experiment_id: 'exp_demo',
      scenario_path: null,
      experiment_path: null,
      config_hash: 'aa'.repeat(32),
      model_version: 'unknown',
      schema_version: 'unknown',
      seed: 7,
      conditions: {},
      data_source: 'synthetic_demo',
      created_at_unix: 0,
      files: [],
    }
    assert.throws(() => runsIndexFile([demoEntry]), (e) => {
      assert.match(String(e), /run_demo00001/, '点名违规条目')
      assert.match(String(e), /不得进入真实运行集合/, '写闸拒绝且说出口径')
      return true
    })
    // 失败通知词条双语在场(保存失败,草稿保留——失败不丢用户输入)
    assert.match(zhDict['common.notifySaveFailed'], /保存失败,草稿保留/)
    assert.match(enDict['common.notifySaveFailed'], /Save failed; draft kept/)
  })
}
