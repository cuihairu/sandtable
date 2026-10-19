// WB-02.04 · WB-06 批次:实验设计页容器接计划与运行输入。
// - 01 场景/基线/候选引用来自共享草稿(paramYamlView):项目模式用所选
//   场景对象,演示模式用参数草稿;实验身份按 草稿内容+名称 派生(ID 前缀
//   体系),不再用固定演示样例对象(WB-06.01);
// - 02 方法 A/B = 双方真实快照对比(基线=项目场景原文/注册默认基线;候选
//   =当前参数草稿,内容寻址候选 ID),差异表 = 参数级 diff(WB-06.02);
//   WB-07.03:提交即真实执行——双臂逐 replicate 仿真,统计比较走内核
//   Comparison 桥接调用点(桥接由 WB-03.10/11 发布,未发布前任务如实报
//   bridge 错误类,不冒充统计判定);
// - 06.03/04/05 Grid/Random/LHS 因子表走注册表,Kernel 模式名序列化;
// - 06.06 场景表单读写 scenario 节(population/duration/seed/population_mix);
// - 06.07 KPI 限当前配置可用指标(days<7 的 D7 明示不可用并阻止提交);
//   06.08 约束 hard/soft × min/max,UI 百分数 ⇄ 比例口径(÷/×100);
// - 06.09 表单 ⇄ 有效实验 YAML(sweep 节整体替换,其余内容逐行保留);
//   06.10 预算/候选 = 内核 planSweep,不前端猜;
// - 06.11/14 预览请求带版本 stamp:晚返回的旧计划不落位,等待期间旧计划
//   标「已失效」;06.12 计划数字全来自内核;06.13 预算原因接禁用并给
//   可行操作提示;06.15 提交重新走内核校验并绑定输入快照+计划+实验 ID,
//   单飞守卫防双击双建。
// - WB-07.03:提交 = 真实执行任务(绑定 run ID,按已校验计划逐候选调用
//   runSweepCandidate;进度在候选边界更新)——不再是演示队列。
import type { JSX } from 'react'
import { useEffect, useRef, useState } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'
import { MethodSelect } from '../designer/MethodSelect.tsx'
import { FactorTable } from '../designer/FactorTable.tsx'
import type { FactorRowView } from '../designer/FactorTable.tsx'
import { ScenarioForm } from '../designer/ScenarioForm.tsx'
import { KpiConstraintTable } from '../designer/KpiConstraintTable.tsx'
import { RunPlanSidebar } from '../designer/RunPlanSidebar.tsx'
import type { PlanState } from '../designer/RunPlanSidebar.tsx'
import {
  designErrors, factorRowError, sweepModeOf,
  scenarioStats, kpiAvailability, createSubmitGuard, createPlanGate,
  applyScenarioLeaf, thresholdFromUi, experimentScopedId,
} from '../designer/designerLogic.ts'
import type { DesignDraft, DesignerMethod, PlanShape, ScenarioLeaf } from '../designer/designerLogic.ts'
import { buildExperimentYaml, readSweepDesign } from '../designer/experimentYaml.ts'
import { sweepableParams } from '../designer/designerLogic.ts'
import { dispatch } from '../state/workbenchStore.ts'
import { paramYamlView } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import { notify } from '../state/notifications.ts'
import { classifyWasmError } from '../../lib/errors.ts'
import { planSweep } from '../../lib/wasm.ts'
import { parseConfig, numericValuesOf } from '../params/configYaml.ts'
import { kernelCheck, buildRowModels, diffRows } from '../params/paramsLogic.ts'
import { candidateIdFor, hashId, ID_PREFIXES } from '../ids.ts'
import type { BaselineId } from '../ids.ts'
import { DEMO_BASELINE_ID } from '../demo/sampleProject.ts'
// WB-04 · 项目模式:配置草稿编辑器(按对象隔离)+ 提交时登记不可变输入快照
import { ProjectConfigEditors } from '../project/ProjectPanels.tsx'
import { runArtifactPaths, snapshotRun, baseContentOf, draftOf } from '../state/projectDoc.ts'
import type { RunIndexEntry, RunSnapshot } from '../state/projectDoc.ts'
import * as runManager from '../state/runManager.ts'
import type { SweepPlan } from '../../lib/types.ts'
import { baselineOfProject } from '../state/projectDoc.ts'

/* —— 提交登记的运行索引条目(口径同 WB-04.08) —— */

function runIndexEntryOf(snap: RunSnapshot, baseConfigHash: string | undefined): RunIndexEntry {
  return {
    run_id: snap.runId,
    experiment_id: snap.experimentId,
    scenario_path: snap.scenarioPath,
    experiment_path: snap.experimentPath,
    config_hash: snap.configHash,
    model_version: snap.modelVersion,
    schema_version: snap.schemaVersion,
    seed: snap.seed,
    conditions: { ...snap.conditions, base_config_hash: baseConfigHash ?? '' },
    created_at_unix: snap.createdAtUnix,
    // 产物路径按运行索引纪律预留(平铺两段);WB-07 真实执行接入后填实际产物
    files: runArtifactPaths(snap.runId, []),
  }
}

/** Cache for sweepableParams()—imports/exports map */
const SWEEPABLE = sweepableParams()

export function DesignerPage({ state }: { state: WorkbenchState }): JSX.Element {
  const { design } = state
  const view = paramYamlView(state)
  const doc = state.project

  /* —— 计划预览(WB-06.10/11):请求版本 stamp,晚返回的旧计划不落位;ok 结果
   *  以输入 YAML 指纹对齐,WB-06.14 的「失效」在渲染期推导(无需同步 setState) —— */
  const [resolved, setResolved] = useState<{ yaml: string; stamp: number; plan?: PlanShape; error?: string } | null>(null)
  const planGateRef = useRef<ReturnType<typeof createPlanGate> | null>(null)
  planGateRef.current ??= createPlanGate()
  const [submitting, setSubmitting] = useState(false)
  const submitGuardRef = useRef<(() => boolean) | null>(null)
  submitGuardRef.current ??= createSubmitGuard()

  let experimentYaml: string | null = null
  let buildError: string | null = null
  if (design.method !== 'ab') {
    try {
      experimentYaml = buildExperimentYaml(view.cand, design)
    } catch (e) {
      buildError = String(e instanceof Error ? e.message : e)
    }
  }

  useEffect(() => {
    if (experimentYaml === null) return
    const yaml = experimentYaml
    const gate = planGateRef.current!
    const seq = gate.next()
    let cancelled = false
    void (async () => {
      try {
        const plan = (await planSweep(yaml, 0)) as unknown as PlanShape
        // WB-06.11 版本守卫:请求序号落后 = 晚返回的旧计划,不覆盖新输入
        if (!cancelled && gate.accept(seq)) setResolved({ yaml, stamp: seq, plan })
      } catch (e) {
        if (!cancelled && gate.accept(seq)) {
          setResolved({ yaml, stamp: seq, error: classifyWasmError(String(e)).message })
        }
      }
    })()
    return () => {
      cancelled = true
    }
    // experimentYaml 是本次输入的指纹;表单/场景任何改动 → 新版本请求
  }, [experimentYaml])

  const planState: PlanState | null = (() => {
    if (design.method === 'ab') return null
    if (buildError !== null) return { stamp: 0, status: 'error', message: buildError }
    if (resolved && resolved.yaml === experimentYaml) {
      return resolved.plan !== undefined
        ? { stamp: resolved.stamp, status: 'ok', plan: resolved.plan }
        : { stamp: resolved.stamp, status: 'error', message: resolved.error! }
    }
    if (resolved) return { stamp: resolved.stamp, status: 'stale' }
    return { stamp: 0, status: 'pending' }
  })()

  /* —— 选中项目实验对象 → 读共享实验草稿(WB-06.01;lastLoaded 防重复合并) —— */
  const experimentPath = doc && state.selection.experiment ? state.selection.experiment : null
  const lastLoadedExperiment = useRef<string | null>(null)
  useEffect(() => {
    if (!experimentPath || !doc || design.method === 'ab') {
      lastLoadedExperiment.current = experimentPath
      return
    }
    const yaml = draftOf(state.objectDrafts, experimentPath, baseContentOf(doc, experimentPath)).content
    if (!yaml.trim() || lastLoadedExperiment.current === experimentPath) return
    lastLoadedExperiment.current = experimentPath
    const sweep = readSweepDesign(yaml)
    if (!sweep.ok) {
      notify('info', `实验对象 ${experimentPath}:${sweep.reason};保留当前表单草稿`)
      return
    }
    dispatch({
      type: 'design/set',
      patch: {
        method: sweep.method,
        sampling: sweep.sampling,
        factors: sweep.factors,
        samples: sweep.samples,
        reps: sweep.reps,
      },
    })
    // 对象选择切换是本合并的全部触发(草稿编辑/方法切换不重复读入)
  }, [experimentPath, design.method, doc, state.objectDrafts])

  /* —— 校验与派生 —— */
  const stats = scenarioStats(view.cand)
  const availability = kpiAvailability(view.cand)
  const errors = designErrors(design, { availability })

  const setMethod = (method: DesignerMethod): void => {
    // WB-06.14 · 兼容输入由本函数保留:仅改 method,其余字段原样保留
    dispatch({ type: 'design/set', patch: { method } })
    dispatch({ type: 'selection', patch: { method } })
  }

  const factorRows: FactorRowView[] = design.method === 'ab'
    ? []
    : design.factors.map((f) => ({
        draft: f,
        error: factorRowError(f, { method: design.method }) ?? undefined,
      }))

  const onFactorChange = (index: number, next: DesignDraft['factors'][number]): void => {
    dispatch({ type: 'design/set', patch: { factors: design.factors.map((f, i) => (i === index ? next : f)) } })
  }

  const onFactorRemove = (index: number): void => {
    if (design.factors.length <= 1) return
    dispatch({ type: 'design/set', patch: { factors: design.factors.filter((_, i) => i !== index) } })
  }

  const onFactorAdd = (path: string): void => {
    if (design.factors.some((f) => f.path === path)) {
      notify('warning', `因子 ${path} 已存在(路径重复不产生第二个轴)`)
      return
    }
    // 起始域以候选当前值 ±20(整数类)或 ±20%(浮点类)为起点,可自由编辑;
    // 候选缺值时取注册表默认 ±20 并就地标注参考来源(不当作真实候选值)。
    const parsed = parseConfig(view.cand)
    const leaf = parsed.leaves.find((l) => l.path === path)
    const reg = SWEEPABLE.find((p) => p.path === path)
    const cur = leaf ? Number(leaf.raw) : Number.NaN
    const intKind = reg ? (reg.kind === 'u32' || reg.kind === 'u64' || reg.kind === 'i64') : true
    if (Number.isFinite(cur) && (!intKind || Number.isInteger(cur))) {
      const center = intKind ? Math.max(0, Math.round(cur)) : cur
      const half = intKind ? 20 : center * 0.2
      dispatch({
        type: 'design/set',
        patch: { factors: [...design.factors, { path, min: center - half, max: center + half, step: intKind ? 10 : Math.max(half / 10, 0.25) }] },
      })
    } else {
      notify('info', `${path} 候选缺值:起始域取「候选值参考起点 ±20」并就地标注,请手动修正`)
      dispatch({
        type: 'design/set',
        patch: { factors: [...design.factors, { path, min: intKind ? 1 : 0.5, max: intKind ? 21 : 1.5, step: intKind ? 10 : 0.25 }] },
      })
    }
  }

  /* —— 提交(WB-06.15) —— */
  const enqueue = (): void => {
    if (errors.length > 0) {
      notify('warning', errors[0].locator ? `${errors[0].locator}: ${errors[0].message}` : errors[0].message)
      return
    }
    if (!submitGuardRef.current!()) {
      notify('warning', '提交进行中;重复点击已忽略(双击只创建一个任务)')
      return
    }
    setSubmitting(true)
    const experimentId = experimentScopedId(doc ? String(doc.projectId) : 'yaml-draft', design)
    const finish = (): void => setSubmitting(false)

    if (design.method === 'ab') {
      void (async () => {
        try {
          const check = await kernelCheck(view.cand)
          if (!check.ok) {
            dispatch({ type: 'param/kernel-error', error: { path: check.path, message: check.message } })
            notify('error', `A/B 输入被内核校验阻止:${check.message}`)
            finish()
            return
          }
          const info = check.info as { config_hash?: string; model_version?: string; schema_version?: string } | null
          dispatch({ type: 'param/frozen', yaml: view.cand, configHash: String(info?.config_hash ?? '') })
          const snap = await snapshotRun({
            experimentId,
            scenarioPath: view.scenarioPath,
            experimentPath: experimentPath ?? null,
            yaml: view.cand,
            modelVersion: info?.model_version,
            schemaVersion: info?.schema_version,
            conditions: {
              method: 'ab',
              replicates: design.reps,
              ab_candidates: 2,
              crn_paired_seed: true,
              baseline_ref: view.scenarioPath ?? 'registry_default',
              players: stats.players ?? 0,
              days: stats.days ?? 0,
              seed: stats.seed ?? 0,
            },
          })
          dispatch({ type: 'run/register', entry: runIndexEntryOf(snap, info?.config_hash) })
          // WB-07.03 · A/B 真实执行:双臂逐 replicate 仿真 + 内核 Comparison
          // 桥接调用点(桥接由 WB-03.10/11 发布;未发布前如实报 bridge)
          const job = runManager.enqueueRun({
            experimentId,
            runId: snap.runId,
            name: design.name,
            method: 'AB',
            spec: { kind: 'ab', baseYaml: view.base, candYaml: view.cand, replicates: design.reps,
              analysis: { baselineId: doc && view.scenarioPath ? baselineOfProject(doc, view.scenarioPath).baselineId : DEMO_BASELINE_ID,
                baselineYaml: view.base, scenarioYaml: view.cand, modelVersion: info?.model_version, schemaVersion: info?.schema_version } },
          })
          if (job) {
            dispatch({ type: 'toggle-drawer', open: true })
            notify('info', 'A/B 已提交真实执行:双臂逐 replicate 仿真;统计比较走内核 Comparison 桥接(WB-03.10/11 发布前如实报「桥接未接入」,不冒充统计判定)')
          }
        } finally {
          finish()
        }
      })()
      return
    }

    void (async () => {
      try {
        const snapYaml = experimentYaml as string
        // 提交时重新取得内核计划 = 本次送达的输入快照被内核完整校验的凭据
        let plan: SweepPlan
        try {
          plan = await planSweep(snapYaml, 0)
        } catch (e) {
          const msg = classifyWasmError(String(e)).message
          setResolved({ yaml: snapYaml, stamp: 0, error: msg })
          notify('error', `内核计划失败:${msg}`)
          finish()
          return
        }
        const check = await kernelCheck(view.cand)
        if (!check.ok) {
          dispatch({ type: 'param/kernel-error', error: { path: check.path, message: check.message } })
          notify('error', `运行被内核校验阻止:${check.message}`)
          finish()
          return
        }
        const info = check.info as { config_hash?: string; model_version?: string; schema_version?: string } | null
        // WB-05.14 纪律:冻结已通过校验的场景候选版本;本次实验输入快照 =
        // 通过 planSweep 的完整实验 YAML(含 sweep 节)
        dispatch({ type: 'param/frozen', yaml: view.cand, configHash: String(info?.config_hash ?? '') })
        // WB-06.09 更新:项目模式下把有效实验配置写穿到所选实验对象草稿
        if (doc && experimentPath) {
          dispatch({ type: 'object/draft', key: experimentPath, content: snapYaml })
        }
        const sweep = sweepModeOf(design.method, design.sampling)
        const snap = await snapshotRun({
          experimentId,
          scenarioPath: view.scenarioPath,
          experimentPath: experimentPath ?? null,
          yaml: snapYaml,
          modelVersion: info?.model_version,
          schemaVersion: info?.schema_version,
          conditions: {
            method: design.method,
            sweep_mode: String(sweep),
            candidates: plan.candidates.length,
            replicates: plan.replicates,
            samples: design.method === 'random' ? design.samples : 0,
            sims: plan.sims,
            player_days_total: plan.sims * plan.players * plan.days,
            plan_config_hash: plan.config_hash,
            base_seed: plan.base_seed,
            players: plan.players,
            days: plan.days,
          },
        })
        dispatch({ type: 'run/register', entry: runIndexEntryOf(snap, info?.config_hash) })
        // WB-07.03 · 扫描真实执行:按已校验计划逐候选调用 runSweepCandidate
        const job = runManager.enqueueRun({
          experimentId,
          runId: snap.runId,
          name: design.name,
          method: String(sweep).toUpperCase(),
          spec: {
            kind: 'sweep',
            yaml: snapYaml,
            plan: { candidates: plan.candidates, replicates: plan.replicates, sims: plan.sims },
            analysis: {
              baselineId: doc && view.scenarioPath ? baselineOfProject(doc, view.scenarioPath).baselineId : DEMO_BASELINE_ID,
              baselineYaml: view.base, scenarioYaml: view.cand, plan,
              modelVersion: info?.model_version, schemaVersion: info?.schema_version,
            },
          },
        })
        if (job) {
          dispatch({ type: 'toggle-drawer', open: true })
          notify('info', `内核计划绑定:真实执行 ${plan.candidates.length} 候选 × ${plan.replicates} replicates = ${plan.sims} 次运行(逐候选 runSweepCandidate;进度只在候选边界更新)`)
        }
      } finally {
        finish()
      }
    })()
  }

  /* —— A/B 差异表(真实双方快照;WB-06.02) —— */
  const paramRows = buildRowModels(parseConfig(view.base), parseConfig(view.cand))
  const changedDraft = diffRows(paramRows)
  const baselineLabel = doc && view.scenarioPath
    ? `项目场景 ${view.scenarioPath}(打开时原文)`
    : '注册表默认基线(演示基线)'
  const candidateOid = (() => {
    const baseId = doc && view.scenarioPath
      ? candidateIdFor(hashId(ID_PREFIXES.baseline, doc.projectId, view.scenarioPath) as BaselineId, numericValuesOf(parseConfig(view.cand)))
      : candidateIdFor(DEMO_BASELINE_ID, numericValuesOf(parseConfig(view.cand)))
    return String(baseId)
  })()

  /* —— 场景表单(WB-06.06) —— */
  const onScenarioEdit = (leaf: ScenarioLeaf, text: string): void => {
    const outcome = applyScenarioLeaf(view.cand, leaf, text)
    if (!outcome.ok) {
      notify('warning', outcome.why)
      return
    }
    // 场景规模修改与参数编辑共用一条 YAML 历史(演示 paramDraft / 项目 objectDrafts)
    if (state.project && view.scenarioPath) {
      dispatch({ type: 'object/draft', key: view.scenarioPath, content: outcome.yaml })
    } else {
      dispatch({ type: 'param/write', yaml: outcome.yaml })
    }
  }

  /* —— KPI 约束(WB-06.07/08) —— */
  const onToggleKpi = (metric: string, on: boolean): void => {
    const targets = on
      ? [...design.targets, { metric, kind: 'hard' as const, min: null, max: null }]
      : design.targets.filter((t) => t.metric !== metric)
    dispatch({ type: 'design/set', patch: { targets } })
  }
  const onKpiKind = (metric: string, kind: 'hard' | 'soft'): void => {
    dispatch({ type: 'design/set', patch: { targets: design.targets.map((t) => (t.metric === metric ? { ...t, kind } : t)) } })
  }
  const onThreshold = (metric: string, field: 'min' | 'max', text: string): void => {
    const outcome = thresholdFromUi(metric, field, text)
    if (!outcome.ok) {
      notify('warning', outcome.why)
      return
    }
    dispatch({
      type: 'design/set',
      patch: {
        targets: design.targets.map((x) => (x.metric === metric ? { ...x, [field]: outcome.value } : x)),
      },
    })
  }

  const submitBlocked = undefined
  const sweepMode = sweepModeOf(design.method, design.sampling)

  return (
    <>
      <WorkspaceHeading
        title={design.name.trim() === '' ? '未命名实验' : design.name}
        crumb="实验 / 新建运行"
        badge={{ text: state.designDirty ? 'DRAFT · 已修改' : 'DRAFT' }}
        actions={
          <button className="btn" onClick={() => dispatch({ type: 'navigate', page: 'analysis' })}>
            <WbIcon name="chart" />
            查看结果样例
          </button>
        }
      />
      <div className="form-layout">
        <div className="form-main">
          {/* WB-04.06 · 打开的项目:所选场景/实验 YAML 草稿(按对象隔离) */}
          <ProjectConfigEditors state={state} />
          <section className="form-section">
            <div className="form-section-heading">
              <span className="step">01</span>
              <h2>引用、名称与实验方法</h2>
            </div>
            <div className="note-block">
              <strong>引用(WB-06.01,来自共享草稿)</strong>
              <div>场景: {view.scenarioPath ? `项目对象 ${view.scenarioPath}` : '演示候选场景(参数草稿 YAML)'}</div>
              <div>基线: {doc && view.scenarioPath ? `项目场景原文(只读基线) ${view.scenarioPath}` : '注册表默认基线 = 注册表默认 YAML'}</div>
              <div>候选: {view.scenarioPath ? '该场景的编辑草稿' : '参数编辑器草稿'} · 候选 ID {candidateOid.slice(0, 12)}…</div>
              <div>实验: {design.name.trim() || '(未命名)'} · 方法 {design.method} · 实验身份 = 方法+名称+项目派生(非固定样例对象)</div>
            </div>
            <div className="field" style={{ marginBottom: 15 }}>
              <label htmlFor="design-name">实验名称</label>
              <input
                id="design-name"
                value={design.name}
                style={{ width: '100%' }}
                onChange={(e) => dispatch({ type: 'design/set', patch: { name: e.target.value } })}
              />
            </div>
            <MethodSelect value={design.method} onChange={setMethod} />
          </section>

          {design.method === 'ab' ? (
            <section className="form-section">
              <div className="form-section-heading">
                <span className="step">02</span>
                <h2>A/B 双方快照与参数差异(WB-06.02)</h2>
              </div>
              <div className="note-block">
                <strong>双侧快照</strong>
                <div>基线臂快照: {baselineLabel}</div>
                <div>候选臂快照: {view.scenarioPath ? '场景候选草稿(内容寻址)' : '参数编辑器候选草稿(内容寻址)'} · {candidateOid.slice(0, 16)}…</div>
                <div>CRN 配对:两侧共用 scenario.seed = {stats.seed ?? '(缺值)'};replicates = {design.reps}。</div>
                <div style={{ marginTop: 6 }}>本次比较的参数 diff:共 {changedDraft.length} 项变化。</div>
              </div>
              <table style={{ marginTop: 10, width: '100%' }}>
                <thead>
                  <tr>
                    <th>参数路径</th>
                    <th className="numeric">基线值</th>
                    <th className="numeric">候选值</th>
                  </tr>
                </thead>
                <tbody>
                  {changedDraft.length > 0 ? (
                    changedDraft.map((d) => (
                      <tr key={d.path}>
                        <td className="mono" style={{ fontSize: 11 }}>{d.path}</td>
                        <td className="numeric">{d.baseline.present ? d.baseline.text : '缺值'}</td>
                        <td className="numeric">{d.candidate.present ? d.candidate.text : '缺值'}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3}>两臂当前没有参数差异(候选值与基线一致),可先前往参数编辑器修改候选。</td>
                    </tr>
                  )}
                </tbody>
              </table>
              <p className="note">统计判定(配对差 CI / 效应量)调用内核 Comparison 桥接(WB-03.10/11 发布,调用点已接入执行器 WB-07.03);桥接发布前 A/B 任务双臂真跑后如实报「桥接未接入」,不冒充结果。</p>
            </section>
          ) : (
            <section className="form-section">
              <div className="form-section-heading">
                <span className="step">02</span>
                <h2>实验因子与取值域(内核模式 {sweepMode})</h2>
              </div>
              <FactorTable
                method={design.method}
                rows={factorRows}
                samples={design.samples}
                samplesError={errors.find((e) => e.scope === 'sampling')?.message}
                onFactorChange={onFactorChange}
                onFactorAdd={onFactorAdd}
                onFactorRemove={onFactorRemove}
                onSamplesChange={(samples) => dispatch({ type: 'design/set', patch: { samples } })}
              />
            </section>
          )}

          <ScenarioForm
            method={design.method}
            stats={stats}
            reps={design.reps}
            repsError={errors.find((e) => e.scope === 'reps')?.message}
            onScenarioEdit={onScenarioEdit}
            onRepsChange={(reps) => dispatch({ type: 'design/set', patch: { reps } })}
            sampling={design.sampling}
            onSamplingChange={(sampling) => dispatch({ type: 'design/set', patch: { sampling } })}
          />

          <KpiConstraintTable
            targets={design.targets}
            availability={availability}
            onToggle={onToggleKpi}
            onKindChange={onKpiKind}
            onThresholdChange={onThreshold}
          />
        </div>
        <RunPlanSidebar
          design={design}
          errors={errors}
          plan={planState}
          abCandidates={2}
          submitting={submitting}
          submitBlocked={submitBlocked}
          onSubmit={enqueue}
        />
      </div>
    </>
  )
}
