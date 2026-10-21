// WB-02.04 · 参数编辑页容器(WB-05 重写):数据源 = 注册表 × 基线/候选 YAML。
// - 全量注册项入表(64 项),不再使用原型 18 项硬编码(WB-05.01);
// - 基线列读基线 YAML、候选列读候选 YAML,缺值不回退默认值(WB-05.03);
// - 单元格提交 → 结构化编辑同步候选 YAML → 内核完整校验定位失败(WB-05.06/07);
// - 高级 YAML 编辑:成功解析更新参数表,语法错误保留原文(WB-05.02/05.13);
// - 批量倍率:先预览/校验整批,再一次写入(WB-05.11);撤销/重做统一历史
//   (WB-05.12);保存/运行使用冻结的已校验版本(WB-05.14,冻结动作在
//   WorkbenchApp/DesignerPage 提交时发生)。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'
import { OverlayDialog } from '../overlays/OverlayDialog.tsx'
import { ParamFilterBar } from '../params/ParamFilterBar.tsx'
import { ParamTable } from '../params/ParamTable.tsx'
import { ParamDetail } from '../params/ParamDetail.tsx'
import { BulkActionBar } from '../params/BulkActionBar.tsx'
import { dispatch, paramYamlView, persistDraft } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import { applyParamEdits, parseConfig } from '../params/configYaml.ts'
import { readGrowthRows } from '../params/growthCurve.ts'
import type { ParamRowModel } from '../params/paramsLogic.ts'
import {
  buildRowModels, bulkPreview, kernelCheck, parseCellInput, visibilityFilter,
} from '../params/paramsLogic.ts'
import { paramGroups, registryParam } from '../params/paramRegistry.ts'
import {
  isMissingMeta, metaFilter, metaIssuePaths, recentMetaPathsNow,
  paramMetaSnapshot, subscribeParamMeta,
} from '../project/paramMeta.ts'
import { versionsSaveVersion } from '../project/scenarioVersions.ts'
import { ParamMetaPanel } from '../project/ParamMetaPanel.tsx'
import { GrowthCurveEditor } from '../params/GrowthCurveEditor.tsx'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import { notify } from '../state/notifications.ts'

export type ParametersPageProps = {
  state: WorkbenchState
  onRequestResetAll: () => void
}

export function ParametersPage({ state, onRequestResetAll }: ParametersPageProps): JSX.Element {
  const { paramSearch, paramGroup, changedOnly, errorsOnly, paramSelected, paramFocusId } = state
  // WB-11.12 · 页面文案走词典;locale 订阅会话(语言切换即时生效)
  const locale = useLocale()
  const [growthOpen, setGrowthOpen] = useState(false)
  const view = paramYamlView(state)
  const baseParsed = parseConfig(view.base)
  const candParsed = parseConfig(view.cand)
  const rows = buildRowModels(baseParsed, candParsed)
  const invalidPaths = new Set<string>(
    state.paramKernelError?.path !== null && state.paramKernelError !== null
      ? [state.paramKernelError.path as string]
      : [],
  )
  const visible0 = visibilityFilter(rows, {
    search: paramSearch, group: paramGroup, changedOnly, errorsOnly, invalidPaths, locale,
  })
  // P1 · 参数元信息四件套(收藏/最近修改/缺元信息/校验错误):与文本搜索、
  // 分组、变更/内核错误筛选 AND 组合;计数按全量行,不随其它开关缩放。
  const metaStore = useSyncExternalStore(subscribeParamMeta, paramMetaSnapshot)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [recentOnly, setRecentOnly] = useState(false)
  const [missingMetaOnly, setMissingMetaOnly] = useState(false)
  const [metaIssuesOnly, setMetaIssuesOnly] = useState(false)
  const favoritePaths = new Set(Object.keys(metaStore.favorites))
  const recentPaths = recentMetaPathsNow(metaStore)
  const missingPaths = new Set(rows.filter((r) => isMissingMeta(metaStore, r.def.path)).map((r) => r.def.path))
  const metaInvalidPaths = metaIssuePaths(metaStore, (p) => registryParam(p)?.kind ?? null)
  const visible = metaFilter(visible0, {
    favoritesOnly, recentOnly, missingOnly: missingMetaOnly, invalidOnly: metaIssuesOnly,
    favorites: favoritePaths, recent: recentPaths, missing: missingPaths, invalid: metaInvalidPaths,
  }, (r) => r.def.path)
  const favoritesCount = rows.filter((r) => favoritePaths.has(r.def.path)).length
  const recentCount = rows.filter((r) => recentPaths.has(r.def.path)).length
  const missingMetaCount = missingPaths.size
  const metaIssuesCount = rows.filter((r) => metaInvalidPaths.has(r.def.path)).length
  const changedCount = rows.filter((r) => r.modified).length
  const focusRow = rows.find((r) => r.def.path === paramFocusId) ?? rows[0]
  const selectedSet = new Set(paramSelected)
  const groups = paramGroups().filter((g) => rows.some((r) => r.group === g))

  // 批量预览状态(页面持有;整批一次性应用,WB-05.11)
  const [bulk, setBulk] = useState<{ preview: ReturnType<typeof bulkPreview> | null; checking: boolean }>({
    preview: null, checking: false,
  })
  // 高级 YAML 编辑状态(WB-05.13):语法错误时保留原文,不写候选
  const [yamlEdit, setYamlEdit] = useState<{ open: boolean; text: string; error: string | null; focusPath: string | null }>({
    open: false, text: '', error: null, focusPath: null,
  })

  // —— 内核完整校验(WB-05.06/07):候选变化后异步校验,失败定位参数 ——
  const checkSeq = useRef(0)
  const lastChecked = useRef<string | null>(null)
  useEffect(() => {
    if (lastChecked.current === view.cand) return
    lastChecked.current = view.cand
    const seq = ++checkSeq.current
    void kernelCheck(view.cand).then((result) => {
      if (seq !== checkSeq.current) return // 过期结果丢弃(快速连续编辑)
      if (result.ok) {
        dispatch({ type: 'param/kernel-error', error: null })
      } else {
        dispatch({ type: 'param/kernel-error', error: { path: result.path, message: result.message } })
      }
    })
  }, [view.cand])

  const commit = (row: ParamRowModel, input: string): string => {
    const parsed = parseCellInput(input, row.def)
    if (parsed.state !== 'ok') return parsed.error
    const outcome = applyParamEdits(view.cand, [{ path: row.def.path, text: parsed.text }])
    if (!outcome.ok) return outcome.error
    dispatch({ type: 'param/write', yaml: outcome.yaml })
    return ''
  }

  const openAdvancedEdit = (row?: ParamRowModel): void => {
    setYamlEdit({ open: true, text: view.cand, error: null, focusPath: row?.def.path ?? null })
  }

  const applyAdvancedEdit = (): void => {
    // 语法错误:保留原文(编辑框内容不动),给出定位;成功才更新参数表
    const parsed = parseConfig(yamlEdit.text)
    if (parsed.errors.length > 0) {
      setYamlEdit((s) => ({
        ...s,
        error: t(locale, 'params.yamlErrorLine', {
          line: parsed.errors[0].line, message: parsed.errors[0].message,
        }),
      }))
      return
    }
    dispatch({ type: 'param/write', yaml: yamlEdit.text })
    notify('success', t(locale, 'params.yamlApplied'))
    setYamlEdit({ open: false, text: '', error: null, focusPath: null })
  }

  const previewBulk = (factor: number): void => {
    // 第一步:前端逐项预演
    const preview = bulkPreview(rows, paramSelected, factor)
    setBulk({ preview, checking: !preview.ok ? false : true })
    if (!preview.ok) return
    // 第二步:整批草稿交内核完整校验(任一失败 → 应用按钮保持禁用)
    const scratch = applyParamEdits(view.cand, preview.edits)
    if (!scratch.ok) {
      setBulk({ preview: { ...preview, ok: false, error: scratch.error }, checking: false })
      return
    }
    void kernelCheck(scratch.yaml).then((result) => {
      setBulk((s) => {
        if (!s.preview) return s
        if (result.ok) return { ...s, checking: false, preview: { ...s.preview, ok: true } }
        const where = result.path ? `${result.path}: ` : ''
        return {
          ...s,
          checking: false,
          preview: {
            ...s.preview,
            ok: false,
            error: t(locale, 'params.bulkKernelError', { detail: `${where}${result.message}` }),
          },
        }
      })
    })
  }

  const applyBulk = (): void => {
    if (!bulk.preview?.ok) return
    const outcome = applyParamEdits(view.cand, bulk.preview.edits)
    if (!outcome.ok) {
      notify('error', outcome.error)
      return
    }
    dispatch({ type: 'param/write', yaml: outcome.yaml })
    notify('success', t(locale, 'params.bulkApplied', { n: bulk.preview.edits.length }))
    setBulk({ preview: null, checking: false })
    dispatch({ type: 'param/select', ids: [] })
  }

  const applyGrowthCurve = (yaml: string): void => {
    dispatch({ type: 'param/write', yaml })
    notify('success', t(locale, 'params.growth.applied'))
  }

  const saveGrowthVersion = (yaml: string): void => {
    if (!view.scenarioPath) return
    const saved = versionsSaveVersion(view.scenarioPath, yaml, { label: 'growth curve' })
    notify(
      saved.ok ? 'success' : 'error',
      saved.ok ? t(locale, 'params.growth.versionSaved') : saved.error ?? t(locale, 'params.growth.versionSaved'),
    )
  }

  const save = (): void => {
    if (persistDraft(state)) {
      dispatch({ type: 'param/save' })
      notify('success', t(locale, 'params.savedToBrowser'))
    } else {
      notify('warning', t(locale, 'params.storageUnavailable'))
    }
  }

  const canUndo = state.project
    ? view.scenarioPath !== null
      ? (state.objectDrafts[view.scenarioPath]?.history.length ?? 0) > 0
      : false
    : state.paramDraft.history.length > 0
  const canRedo = state.project
    ? view.scenarioPath !== null
      ? (state.objectDrafts[view.scenarioPath]?.future.length ?? 0) > 0
      : false
    : state.paramDraft.future.length > 0

  return (
    <>
      <WorkspaceHeading
        title={state.project ? t(locale, 'params.titleProject') : t(locale, 'params.titleLocal')}
        crumb={t(locale, 'params.crumb')}
        badge={{ text: state.project ? t(locale, 'params.badgeProject') : t(locale, 'params.badgeLocal'), tone: 'amber' }}
        actions={
          <>
            <span className="muted" style={{ fontSize: 10 }}>
              {state.project
                ? (view.scenarioPath ?? t(locale, 'params.noScenario'))
                : state.paramDraft.saved ? t(locale, 'params.draftSaved') : t(locale, 'params.draftUnsaved')}
            </span>
            <button className="btn" disabled={!canUndo} onClick={() => dispatch({ type: 'param/undo' })} title={t(locale, 'params.undoTitle')}>
              <WbIcon name="undo" />
              {t(locale, 'params.undo')}
            </button>
            <button className="btn" disabled={!canRedo} onClick={() => dispatch({ type: 'param/redo' })} title={t(locale, 'params.redoTitle')}>
              <WbIcon name="redo" />
              {t(locale, 'params.redo')}
            </button>
            {!state.project && (
              <button className="btn primary" onClick={save}>
                <WbIcon name="save" />
                {t(locale, 'params.saveDraft')}
              </button>
            )}
          </>
        }
      />
      <ParamFilterBar
        search={paramSearch}
        onSearch={(q) => {
          dispatch({ type: 'param/search', search: q })
          dispatch({ type: 'selection', patch: { search: q } })
        }}
        group={paramGroup}
        groups={groups}
        onGroup={(g) => {
          dispatch({ type: 'param/group', group: g })
          dispatch({ type: 'selection', patch: { group: g } })
        }}
        changedOnly={changedOnly}
        changedCount={changedCount}
        onChangedOnly={(on) => dispatch({ type: 'param/changed-only', on })}
        errorsOnly={errorsOnly}
        errorCount={invalidPaths.size}
        onErrorsOnly={(on) => dispatch({ type: 'param/errors-only', on })}
        favoritesOnly={favoritesOnly}
        favoritesCount={favoritesCount}
        onFavoritesOnly={setFavoritesOnly}
        recentOnly={recentOnly}
        recentCount={recentCount}
        onRecentOnly={setRecentOnly}
        missingMetaOnly={missingMetaOnly}
        missingMetaCount={missingMetaCount}
        onMissingMetaOnly={setMissingMetaOnly}
        metaIssuesOnly={metaIssuesOnly}
        metaIssuesCount={metaIssuesCount}
        onMetaIssuesOnly={setMetaIssuesOnly}
        onResetAll={onRequestResetAll}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '0 16px 8px' }}>
        <button
          className="btn"
          onClick={() => setGrowthOpen(true)}
        >
          {t(locale, 'params.growth.open')}
        </button>
      </div>
      {paramSelected.length > 0 && (
        <BulkActionBar
          count={paramSelected.length}
          preview={bulk.preview}
          checking={bulk.checking}
          onPreview={previewBulk}
          onApply={applyBulk}
          onClear={() => {
            dispatch({ type: 'param/select', ids: [] })
            setBulk({ preview: null, checking: false })
          }}
        />
      )}
      <div className="parameters-body">
        <div className="parameters-center">
          <ParamTable
            id="parameter-table"
            rows={visible}
            selected={selectedSet}
            focusId={paramFocusId}
            kernelErrorPath={state.paramKernelError?.path ?? null}
            onCommit={commit}
            onSelect={(path, checked) => {
              dispatch({
                type: 'param/select',
                ids: checked ? [...paramSelected, path] : paramSelected.filter((p) => p !== path),
              })
            }}
            onSelectAll={(checked) => {
              // 全选只作用于当前可见项(WB-05.10)
              dispatch({ type: 'param/select', ids: checked ? visible.map((p) => p.def.path) : [] })
            }}
            onFocusRow={(path) => dispatch({ type: 'param/focus', id: path })}
            onAdvancedEdit={(row) => openAdvancedEdit(row)}
            locale={locale}
          />
          <div className="table-foot">
            <span>{t(locale, 'params.registryCount', { visible: visible.length, total: rows.length })}</span>
            <span>
              {state.project ? t(locale, 'params.footProject') : t(locale, 'params.footLocal')}
            </span>
          </div>
        </div>
        <ParamDetail
          row={focusRow}
          changedCount={changedCount}
          savedLabel={state.project
            ? t(locale, 'params.savedLabelProject')
            : state.paramDraft.saved ? t(locale, 'params.savedLabelBrowser') : t(locale, 'params.savedLabelBrowserUnsaved')}
          kernelError={state.paramKernelError}
          metaSection={
            <ParamMetaPanel key={focusRow.def.path} path={focusRow.def.path} projectOpen={state.project !== null} />
          }
          onResetOne={() => dispatch({ type: 'param/reset-one', path: focusRow.def.path })}
          onAdvancedEdit={() => openAdvancedEdit(focusRow)}
          onNewExperiment={() => dispatch({ type: 'navigate', page: 'designer' })}
          locale={locale}
        />
      </div>
      <GrowthCurveEditor
        key={`${view.cand}`}
        open={growthOpen}
        onClose={() => setGrowthOpen(false)}
        baseYaml={view.base}
        candidateYaml={view.cand}
        initialRows={readGrowthRows(view.cand) ?? []}
        onApply={applyGrowthCurve}
        onSaveVersion={saveGrowthVersion}
      />
      <OverlayDialog
        open={yamlEdit.open}
        onClose={() => setYamlEdit({ open: false, text: '', error: null, focusPath: null })}
        title={yamlEdit.focusPath
          ? t(locale, 'params.yamlTitlePath', { path: yamlEdit.focusPath })
          : t(locale, 'params.yamlTitle')}
        footer={
          <>
            <button className="btn" onClick={() => setYamlEdit({ open: false, text: '', error: null, focusPath: null })}>
              {t(locale, 'common.cancel')}
            </button>
            <button className="btn primary" onClick={applyAdvancedEdit}>
              {t(locale, 'params.yamlApply')}
            </button>
          </>
        }
      >
        <p className="note" style={{ marginBottom: 8 }}>
          {t(locale, 'params.yamlNote')}
        </p>
        <textarea
          aria-label={t(locale, 'params.yamlAria')}
          value={yamlEdit.text}
          onChange={(e) => setYamlEdit((s) => ({ ...s, text: e.target.value }))}
          spellCheck={false}
          style={{ width: '100%', minHeight: 320, fontFamily: 'var(--wb-mono)', fontSize: 12 }}
        />
        {yamlEdit.error && (
          <p className="parameter-error" role="alert">{yamlEdit.error}</p>
        )}
      </OverlayDialog>
    </>
  )
}
