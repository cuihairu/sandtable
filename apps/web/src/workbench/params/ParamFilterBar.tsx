// WB-02.06 · 参数筛选栏:搜索 / 系统分组 / 只看变更 / 只看错误(WB-05.10)。
// 受控组件,状态由页面容器(共享 store)持有;筛选是 UI 状态,不进实验输入。
// 搜索占位与匹配口径:注册路径 + 原始描述 + 当前语言显示名(WB-05.09)。
// WB-11.12 · 文案走词典。
import type { JSX } from 'react'
import { WbIcon } from '../components/icons.tsx'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'
import { paramGroupLabel } from './paramRegistry.ts'

export type ParamFilterBarProps = {
  search: string
  onSearch: (q: string) => void
  group: string
  groups: readonly string[]
  onGroup: (g: string) => void
  changedOnly: boolean
  changedCount: number
  onChangedOnly: (on: boolean) => void
  /** WB-05.10 · 只看错误(编辑缓冲非法 / 内核校验失败) */
  errorsOnly: boolean
  errorCount: number
  onErrorsOnly: (on: boolean) => void
  /** P1 · 参数元信息四件套(收藏/最近修改/缺元信息/元信息校验错误) */
  favoritesOnly: boolean
  favoritesCount: number
  onFavoritesOnly: (on: boolean) => void
  recentOnly: boolean
  recentCount: number
  onRecentOnly: (on: boolean) => void
  missingMetaOnly: boolean
  missingMetaCount: number
  onMissingMetaOnly: (on: boolean) => void
  metaIssuesOnly: boolean
  metaIssuesCount: number
  onMetaIssuesOnly: (on: boolean) => void
  onResetAll?: () => void
}

export function ParamFilterBar({
  search,
  onSearch,
  group,
  groups,
  onGroup,
  changedOnly,
  changedCount,
  onChangedOnly,
  errorsOnly,
  errorCount,
  onErrorsOnly,
  favoritesOnly,
  favoritesCount,
  onFavoritesOnly,
  recentOnly,
  recentCount,
  onRecentOnly,
  missingMetaOnly,
  missingMetaCount,
  onMissingMetaOnly,
  metaIssuesOnly,
  metaIssuesCount,
  onMetaIssuesOnly,
  onResetAll,
}: ParamFilterBarProps): JSX.Element {
  const locale = useLocale()
  return (
    <div className="workspace-toolbar">
      <label className="search-field">
        <WbIcon name="search" />
        <input
          type="search"
          placeholder={t(locale, 'params.searchPlaceholder')}
          aria-label={t(locale, 'params.searchAria')}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      <select
        aria-label={t(locale, 'params.groupAria')}
        value={group}
        onChange={(e) => onGroup(e.target.value)}
      >
        <option value="all">{t(locale, 'params.allSystems')}</option>
        {groups.map((g) => (
          <option key={g} value={g}>
            {paramGroupLabel(g, locale)}
          </option>
        ))}
      </select>
      <label className="checkbox-line" style={{ margin: 0 }}>
        <input
          className="checkbox"
          type="checkbox"
          checked={changedOnly}
          onChange={(e) => onChangedOnly(e.target.checked)}
        />
        {t(locale, 'params.changedOnly')} <span className="mono">{changedCount}</span>
      </label>
      <label className="checkbox-line" style={{ margin: 0 }}>
        <input
          className="checkbox"
          type="checkbox"
          checked={errorsOnly}
          onChange={(e) => onErrorsOnly(e.target.checked)}
        />
        {t(locale, 'params.errorsOnly')} <span className="mono">{errorCount}</span>
      </label>
      {/* P1 · 参数元信息筛选四件套(状态是 UI 态,不进实验输入) */}
      <label className="checkbox-line" style={{ margin: 0 }}>
        <input
          className="checkbox"
          type="checkbox"
          checked={favoritesOnly}
          onChange={(e) => onFavoritesOnly(e.target.checked)}
        />
        {t(locale, 'params.favoritesOnly')} <span className="mono">{favoritesCount}</span>
      </label>
      <label className="checkbox-line" style={{ margin: 0 }}>
        <input
          className="checkbox"
          type="checkbox"
          checked={recentOnly}
          onChange={(e) => onRecentOnly(e.target.checked)}
        />
        {t(locale, 'params.recentOnly')} <span className="mono">{recentCount}</span>
      </label>
      <label className="checkbox-line" style={{ margin: 0 }}>
        <input
          className="checkbox"
          type="checkbox"
          checked={missingMetaOnly}
          onChange={(e) => onMissingMetaOnly(e.target.checked)}
        />
        {t(locale, 'params.missingMetaOnly')} <span className="mono">{missingMetaCount}</span>
      </label>
      <label className="checkbox-line" style={{ margin: 0 }}>
        <input
          className="checkbox"
          type="checkbox"
          checked={metaIssuesOnly}
          onChange={(e) => onMetaIssuesOnly(e.target.checked)}
        />
        {t(locale, 'params.metaIssuesOnly')} <span className="mono">{metaIssuesCount}</span>
      </label>
      <div className="toolbar-end">
        {onResetAll && (
          <button className="btn subtle" onClick={onResetAll}>
            <WbIcon name="reset" />
            {t(locale, 'params.resetAll')}
          </button>
        )}
      </div>
    </div>
  )
}
