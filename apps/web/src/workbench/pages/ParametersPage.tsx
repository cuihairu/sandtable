// WB-02.04 · 参数编辑页容器:组合 WB-02.06 四组件 + 撤销/保存。
// 保存目标 = 浏览器本地草稿(刷新可恢复);真实项目保存是 WB-04 范围,
// 状态栏与标签的未保存标记都从 store 的 draft.saved 读取。
import type { JSX } from 'react'
import { WorkspaceHeading } from '../components/WorkspaceContainer.tsx'
import { WbIcon } from '../components/icons.tsx'
import { ParamFilterBar } from '../params/ParamFilterBar.tsx'
import { ParamTable } from '../params/ParamTable.tsx'
import { ParamDetail } from '../params/ParamDetail.tsx'
import { BulkActionBar } from '../params/BulkActionBar.tsx'
import { dispatch, persistDraft } from '../state/workbenchStore.ts'
import type { WorkbenchState } from '../state/workbenchStore.ts'
import { DEFAULT_VALUES, PARAM_DEFS, PARAM_GROUPS } from '../demo/sampleProject.ts'
import { changedParams, bulkMultiply, validateParam, visibilityFilter } from '../params/paramsLogic.ts'
import { notify } from '../state/notifications.ts'

export type ParametersPageProps = {
  state: WorkbenchState
  onRequestResetAll: () => void
}

export function ParametersPage({ state, onRequestResetAll }: ParametersPageProps): JSX.Element {
  const { draft, paramSearch, paramGroup, changedOnly, paramSelected, paramFocusId } = state
  const visible = visibilityFilter(PARAM_DEFS, draft.values, { search: paramSearch, group: paramGroup, changedOnly })
  const changed = changedParams(PARAM_DEFS, draft.values)
  const focusDef = PARAM_DEFS.find((p) => p.id === paramFocusId) ?? PARAM_DEFS[0]
  const selectedSet = new Set(paramSelected)

  const commit = (def: (typeof PARAM_DEFS)[number], value: number): boolean => {
    const error = validateParam(def, value)
    if (error) {
      notify('error', `${def.name}:${error}`)
      return false
    }
    if (draft.values[def.id] !== value) {
      dispatch({ type: 'draft/set', id: def.id, value })
    }
    return true
  }

  const save = (): void => {
    if (persistDraft(state)) {
      dispatch({ type: 'draft/save' })
      notify('success', '候选方案已保存到当前浏览器')
    } else {
      notify('warning', '浏览器存储不可用,草稿仍保留在当前页面')
    }
  }

  const undo = (): void => {
    if (draft.history.length === 0) {
      notify('info', '当前会话没有可撤销的修改')
      return
    }
    dispatch({ type: 'draft/undo' })
    notify('info', '已撤销上一次参数修改')
  }

  const resetAll = (): void => {
    // 确认框由 WorkbenchApp 顶层统一管理(确认后才应用 reset-all)
    onRequestResetAll()
  }

  return (
    <>
      <WorkspaceHeading
        title="候选方案 A"
        crumb="模型与配置 / 参数表"
        badge={{ text: '本地草稿', tone: 'amber' }}
        actions={
          <>
            <span className="muted" style={{ fontSize: 10 }}>
              {draft.saved ? '浏览器草稿已保存' : '存在未保存修改'}
            </span>
            <button className="btn" onClick={undo}>
              <WbIcon name="undo" />
              撤销
            </button>
            <button className="btn primary" onClick={save}>
              <WbIcon name="save" />
              保存草稿
            </button>
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
        groups={PARAM_GROUPS}
        onGroup={(g) => {
          dispatch({ type: 'param/group', group: g })
          dispatch({ type: 'selection', patch: { group: g } })
        }}
        changedOnly={changedOnly}
        changedCount={changed.length}
        onChangedOnly={(on) => dispatch({ type: 'param/changed-only', on })}
        onResetAll={resetAll}
      />
      {paramSelected.length > 0 && (
        <BulkActionBar
          count={paramSelected.length}
          onApply={(factor) => {
            // 先整批校验(bulkMultiply 纯函数),失败不产生半批修改、给出可读错误
            const result = bulkMultiply(PARAM_DEFS, draft.values, paramSelected, factor)
            if (!result.ok) {
              notify('error', result.error)
              return
            }
            dispatch({ type: 'draft/bulk', factor, ids: paramSelected })
            notify('success', `已批量修改 ${result.applied} 个参数,可撤销`)
          }}
          onClear={() => dispatch({ type: 'param/select', ids: [] })}
        />
      )}
      <div className="parameters-body">
        <div className="parameters-center">
          <ParamTable
            id="parameter-table"
            defs={visible}
            values={draft.values}
            selected={selectedSet}
            focusId={paramFocusId}
            onCommit={commit}
            onSelect={(id, checked) => {
              dispatch({
                type: 'param/select',
                ids: checked ? [...paramSelected, id] : paramSelected.filter((p) => p !== id),
              })
            }}
            onSelectAll={(checked) => {
              dispatch({ type: 'param/select', ids: checked ? visible.map((p) => p.id) : [] })
            }}
            onFocusRow={(id) => dispatch({ type: 'param/focus', id })}
          />
          <div className="table-foot">
            <span>{`${visible.length} / ${PARAM_DEFS.length} 个示例参数`}</span>
            <span>基线只读 · 候选值可编辑 · 完整校验在运行/保存时由内核执行</span>
          </div>
        </div>
        <ParamDetail
          def={focusDef}
          value={draft.values[focusDef.id]}
          baseline={focusDef.base}
          changedCount={changed.length}
          savedLabel={draft.saved ? '当前浏览器(已保存)' : '当前浏览器(未保存)'}
          onResetOne={() => {
            const error = validateParam(focusDef, DEFAULT_VALUES[focusDef.id])
            if (error) {
              notify('error', error)
              return
            }
            dispatch({ type: 'draft/set', id: focusDef.id, value: DEFAULT_VALUES[focusDef.id] })
            notify('info', '已恢复此项基线值,可撤销')
          }}
          onNewExperiment={() => dispatch({ type: 'navigate', page: 'designer' })}
        />
      </div>
    </>
  )
}
