// WB-02.04 · 实验设计页容器:组合 WB-02.07 五组件。
// 表单草稿在共享 store(切页保留);入队走运行管理器(演示任务)。
// A/B 差异表来自参数草稿与基线的真实对比(组件可独立接数据)。
import type { JSX } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'
import { MethodSelect } from '../designer/MethodSelect.tsx'
import { FactorTable } from '../designer/FactorTable.tsx'
import type { FactorRow } from '../designer/FactorTable.tsx'
import { ScenarioForm } from '../designer/ScenarioForm.tsx'
import { KpiConstraintTable } from '../designer/KpiConstraintTable.tsx'
import { RunPlanSidebar } from '../designer/RunPlanSidebar.tsx'
import { dispatch } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import { designErrors, designCounts } from '../designer/designerLogic.ts'
import type { DesignDraft, ExperimentMethod } from '../designer/designerLogic.ts'
import { DEMO_EXPERIMENT_ID } from '../demo/sampleProject.ts'
// WB-05 · A/B 差异表数据源:注册表 × 基线/候选 YAML(不再用 18 项原型)
import { paramYamlView } from '../state/workbenchStore.ts'
import { parseConfig } from '../params/configYaml.ts'
import { buildRowModels, diffRows, kernelCheck } from '../params/paramsLogic.ts'
import * as runManager from '../state/runManager.ts'
import { notify } from '../state/notifications.ts'
// WB-04 · 项目模式:配置草稿编辑器(按对象隔离)+ 提交时登记不可变输入快照
import { ProjectConfigEditors } from '../project/ProjectPanels.tsx'
import { runArtifactPaths, snapshotRun } from '../state/projectDoc.ts'
import type { RunIndexEntry } from '../state/projectDoc.ts'
import { hashId, ID_PREFIXES } from '../ids.ts'
import type { ProjectId } from '../ids.ts'

export function DesignerPage({ state }: { state: WorkbenchState }): JSX.Element {
  const { design } = state
  const errors = designErrors(design)

  const setMethod = (method: ExperimentMethod): void => {
    dispatch({ type: 'design/set', patch: { method } })
    dispatch({ type: 'selection', patch: { method } })
  }

  const factorRows: FactorRow[] = design.method === 'ab'
    ? []
    : [{
        path: 'model.warrior.attack',
        type: 'i64',
        min: design.min,
        max: design.max,
        step: design.step,
        samples: design.samples,
        error: design.min > 0 && design.max >= design.min ? undefined : '范围需要正整数且 max ≥ min',
      }]

  const enqueue = (): void => {
    if (errors.length > 0) {
      notify('warning', errors[0])
      return
    }
    const counts = designCounts(design)
    // WB-05.14 · 运行提交:先内核完整校验,冻结已通过校验的配置版本——
    // 运行输入用冻结版本,不从仍在变化的单元格即时读取。校验失败 → 定位
    // 参数并阻止提交(WB-05.07)。演示模式(无项目)不登记真实快照。
    if (state.project) {
      const doc = state.project
      void (async () => {
        const view = paramYamlView(state)
        if (!view.scenarioPath) {
          notify('warning', '未选择项目场景,无法提交运行')
          return
        }
        const check = await kernelCheck(view.cand)
        if (!check.ok) {
          dispatch({ type: 'param/kernel-error', error: { path: check.path, message: check.message } })
          notify('error', `运行被内核校验阻止:${check.message}`)
          return
        }
        const info = check.info as { config_hash?: string; model_version?: string; schema_version?: string } | null
        dispatch({ type: 'param/frozen', yaml: view.cand, configHash: String(info?.config_hash ?? '') })
        // WB-04.09/05.14 · 不可变输入快照使用冻结版本(YAML 字节)
        const snap = await snapshotRun({
          experimentId: String(hashId(ID_PREFIXES.experiment, doc.projectId, design.name) as ProjectId),
          scenarioPath: view.scenarioPath,
          experimentPath: state.selection.experiment || null,
          yaml: view.cand,
          modelVersion: info?.model_version,
          schemaVersion: info?.schema_version,
          conditions: {
            method: design.method,
            replicates: design.reps,
            players: design.players,
            days: design.days,
            tasks: counts.tasks,
            paired: design.paired,
            sampling: design.sampling,
          },
        })
        const entry: RunIndexEntry = {
          run_id: snap.runId,
          experiment_id: snap.experimentId,
          scenario_path: snap.scenarioPath,
          experiment_path: snap.experimentPath,
          config_hash: snap.configHash,
          model_version: snap.modelVersion,
          schema_version: snap.schemaVersion,
          seed: snap.seed,
          conditions: { ...snap.conditions },
          created_at_unix: snap.createdAtUnix,
          // 产物路径按运行索引纪律预留(平铺两段);执行接入后填实际产物
          files: runArtifactPaths(snap.runId, []),
        }
        dispatch({ type: 'run/register', entry })
        const job = runManager.enqueueDemo({
          experimentId: String(hashId(ID_PREFIXES.experiment, doc.projectId, design.name) as ProjectId),
          name: design.name,
          method: design.method.toUpperCase(),
          total: counts.tasks,
        })
        if (job) {
          dispatch({ type: 'toggle-drawer', open: true })
          notify('info', '配置已通过内核校验并冻结为运行输入;已登记快照并加入演示队列(WB-07 前不产真实产物)')
        }
      })()
      return
    }
    const job = runManager.enqueueDemo({
      experimentId: DEMO_EXPERIMENT_ID,
      name: design.name,
      method: design.method.toUpperCase(),
      total: counts.tasks,
    })
    if (job) {
      dispatch({ type: 'toggle-drawer', open: true })
      notify('info', '已加入演示队列;不会执行真实仿真')
    }
  }

  // WB-05 · A/B 差异 = 基线 YAML vs 候选 YAML 的参数级对比(注册表全量口径)
  const paramView = paramYamlView(state)
  const paramRows = buildRowModels(parseConfig(paramView.base), parseConfig(paramView.cand))
  const changedDraft = diffRows(paramRows)

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
              <h2>比较对象与实验方法</h2>
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

          <section className="form-section">
            <div className="form-section-heading">
              <span className="step">02</span>
              <h2>{design.method === 'ab' ? '方案参数差异' : '实验因子与取值域'}</h2>
            </div>
            {design.method === 'ab' ? (
              <div className="note-block">
                对照:{state.project ? '项目场景基线' : '注册表默认基线'} → 候选:方案 A。{changedDraft.length} 项变更。
                <table style={{ marginTop: 10, width: '100%' }}>
                  <thead>
                    <tr>
                      <th>参数路径</th>
                      <th className="numeric">基线</th>
                      <th className="numeric">候选 A</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changedDraft.length > 0 ? (
                      changedDraft.map((d) => (
                        <tr key={d.path}>
                          <td className="mono" style={{ fontSize: 11 }}>{d.path}</td>
                          <td className="numeric">{d.baseline.present ? d.baseline.text : '缺值'}</td>
                          <td className="numeric positive">{d.candidate.present ? d.candidate.text : '缺值'}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3}>当前候选没有参数差异,可先前往参数编辑器修改。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <FactorTable
                method={design.method === 'grid' ? 'grid' : 'random'}
                rows={factorRows}
                onChange={(_, patch) => dispatch({ type: 'design/set', patch })}
              />
            )}
          </section>

          <ScenarioForm
            fields={[
              { key: 'reps', label: 'replicates(统计样本量)', value: design.reps, helper: '每个候选的独立重复运行次数' },
              { key: 'players', label: '玩家数(规模)', value: design.players, helper: '单次运行的场景规模' },
              { key: 'days', label: '仿真天数(规模)', value: design.days, helper: '不足 7 天时 D7 指标不可用' },
            ]}
            paired={design.paired}
            sampling={design.sampling}
            onChange={(key, value) => dispatch({ type: 'design/set', patch: { [key]: value } as Partial<DesignDraft> })}
            onPairedChange={(paired) => dispatch({ type: 'design/set', patch: { paired } })}
            onSamplingChange={(sampling) => dispatch({ type: 'design/set', patch: { sampling } })}
            crnNote="配对比较时,两侧使用相同 seed 以降低方差。"
          />

          <KpiConstraintTable
            thresholds={design.thresholds}
            onChange={(key, value) => {
              const next = { ...design.thresholds, [key]: value }
              dispatch({ type: 'design/set', patch: { thresholds: next } })
            }}
          />
        </div>
        <RunPlanSidebar design={design} onEnqueue={enqueue} />
      </div>
    </>
  )
}
