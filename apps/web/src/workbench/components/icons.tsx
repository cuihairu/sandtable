// 图标:取自原型 workbench.js 的单线 icon 路径表(设计与对齐基准一致),
// React 化为受控组件——不使用 innerHTML 注入(WB-02.09 纪律)。
import type { JSX } from 'react'

const PATHS: Record<string, string> = {
  chart: 'M3 3v18h18M6 14l4-5 4 3 6-8',
  table: 'M3 4h18v16H3zM3 9h18M9 4v16M15 4v16',
  flask: 'M9 3h6M10 3v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3M7 15h10',
  terminal: 'M3 4h18v16H3zM7 9l3 3-3 3M13 15h4',
  exchange: 'M4 7h14l-3-3M20 17H6l3 3M20 4v6M4 14v6',
  search: 'm20 20-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  'panel-left': 'M3 4h18v16H3zM9 4v16M6 8v8',
  'panel-right': 'M3 4h18v16H3zM15 4v16M18 8v8',
  'folder-open': 'M3 8V5h6l2 3h10v12H3zM3 11h18',
  'file-code': 'M14 3H5v18h14V8l-5-5v5h5M10 12l-3 3 3 3M14 12l3 3-3 3',
  'git-branch': 'M6 6v12M6 9c10 0 12 0 12-4M8 4a2 2 0 1 1-4 0 2 2 0 0 1 4 0M8 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0M20 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  sliders: 'M4 5h16M4 12h16M4 19h16M8 2v6M16 9v6M10 16v6',
  info: 'M12 11v6M12 7v1M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  check: 'm5 12 4 4L19 6',
  circlecheck: 'm8 12 3 3 5-6M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  warning: 'm12 3 10 18H2L12 3Zm0 6v5m0 3v1',
  cross: 'm6 6 12 12M6 18 18 6',
  chevron: 'm8 5 7 7-7 7',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  play: 'm8 4 13 8-13 8V4Z',
  copy: 'M8 8h13v13H8zM16 8V3H3v13h5',
  save: 'M4 3h13l4 4v14H3V3h1Zm3 0v7h10V3M7 21v-7h10v7',
  undo: 'm8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12',
  redo: 'm16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12',
  reset: 'M3 11a9 9 0 1 1 2 7M3 3v8h8',
  plus: 'M12 4v16M4 12h16',
  settings: 'M4 5h16M4 12h16M4 19h16M8 2v6M16 9v6M10 16v6',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  clock: 'M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  filter: 'M3 5h18M6 12h12M9 19h6',
  // WB-11.05 · 语言切换入口(双环语言标记,单线风格与表内其余图标一致)
  languages: 'M2 5h9M7 3v2M4 5c0 3 3 6 7 7M10 5c-1 3-4 6-8 7M14 20l3-8 3 8M14.8 17h4.4',
  // P1 · 参数元信息收藏(单线五角星,风格同表内)
  star: 'M12 3l2.7 5.6 6.3.9-4.5 4.4 1 6.1-5.5-2.9-5.5 2.9 1-6.1L3 9.5l6.3-.9L12 3Z',
}

export type IconName = keyof typeof PATHS & string

export function WbIcon({ name, className }: { name: IconName; className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  )
}

/** 判定图标(候选表/检查器共用)。 */
export function WbVerdictIcon({ verdict }: { verdict: 'pass' | 'border' | 'fail' }): JSX.Element {
  return <WbIcon name={verdict === 'pass' ? 'circlecheck' : verdict === 'border' ? 'warning' : 'cross'} />
}
