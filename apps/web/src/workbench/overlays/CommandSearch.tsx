// WB-02.09 · 命令搜索(Ctrl/Cmd+K):页面导航 + 参数定位。
// 命令表由调用方注入(可独立接数据:页面/文档/参数,后续可加动作命令),
// 输入框内不拦截原生编辑键;↑/↓ 选择、Enter 执行、Esc 关闭。
import { useMemo, useState } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { OverlayDialog } from './OverlayDialog.tsx'
import { WbIcon } from '../components/icons.tsx'
import type { IconName } from '../components/icons.tsx'
import { matchCommands } from './commands.ts'
import type { CommandEntry } from './commands.ts'

export type { CommandEntry }

export type CommandSearchProps = {
  open: boolean
  onClose: () => void
  commands: readonly CommandEntry[]
}

export function CommandSearch({ open, onClose, commands }: CommandSearchProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [wasOpen, setWasOpen] = useState(false)
  const results = useMemo(() => matchCommands(commands, query), [commands, query])

  // 打开时重置上次输入(渲染期调整状态模式,避免 effect 级联渲染);
  // 聚焦交给对话框打开后的 autofocus 逻辑(见 OverlayDialog 的 ref 回调)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }

  const runEntry = (entry: CommandEntry | undefined): void => {
    if (!entry) return
    onClose()
    entry.run()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((c) => Math.min(results.length - 1, c + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((c) => Math.max(0, c - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runEntry(results[cursor])
    }
  }

  return (
    <OverlayDialog open={open} onClose={onClose} title="查找参数与命令" dismissable={false}>
      <div onKeyDown={onKeyDown}>
        <label htmlFor="command-input" className="muted" style={{ fontSize: 11 }}>
          输入工作区名称、参数名或参数路径
        </label>
        <input
          id="command-input"
          className="command-input"
          placeholder="例如:攻击力、参数、导出…"
          autoComplete="off"
          autoFocus={open}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(0)
          }}
        />
        <div className="command-list" role="listbox" aria-label="命令结果">
          {results.map((entry, i) => (
            <button
              key={entry.id}
              role="option"
              aria-selected={i === cursor}
              className="command-item"
              onMouseEnter={() => setCursor(i)}
              onClick={() => runEntry(entry)}
            >
              <WbIcon name={entry.icon as IconName} />
              <span>
                {entry.label}
                <small>{entry.hint}</small>
              </span>
            </button>
          ))}
          {results.length === 0 && <div className="empty-state">没有匹配的命令或参数。</div>}
        </div>
      </div>
    </OverlayDialog>
  )
}
