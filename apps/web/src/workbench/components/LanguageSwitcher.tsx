// WB-11.05 · 应用栏语言切换入口:可见入口 + 键盘操作 + 当前语言标记。
// 键盘:按钮点击/Enter/空格开菜单(↑ 也可直接打开);菜单内 ↑/↓ 移焦点,
// Home/End 到头尾,Enter/空格选中,Esc/Tab 关闭并把焦点还给按钮。
// 语义:listbox/option + aria-selected,当前语言带勾选标记。
// 选项标签用 LOCALES 固定显示名(「简体中文」在英文界面下仍显示「简体中文」)。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { JSX, KeyboardEvent } from 'react'
import { LOCALES, t } from '../../lib/i18n/index.ts'
import { localeSession, setLocale } from '../state/localeStore.ts'
import { WbIcon } from './icons.tsx'

export function LanguageSwitcher(): JSX.Element {
  const locale = useSyncExternalStore(localeSession.subscribe, localeSession.get)
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 打开时焦点落在当前语言选项上(键盘操作的起点);点击菜单外关闭
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-locale="${locale}"]`)
      ?.focus()
    const onOutside = (e: MouseEvent): void => {
      if (e.target instanceof Node && !rootRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open, locale])

  const close = (refocus: boolean): void => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }

  const onMenuKey = (e: KeyboardEvent): void => {
    const options = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [],
    )
    const index = options.findIndex((o) => o === document.activeElement)
    if (e.key === 'Escape' || e.key === 'Tab') {
      close(true)
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      const next = options.length > 0 ? (index + step + options.length) % options.length : 0
      options[Math.max(0, next)]?.focus()
    } else if (e.key === 'Home' && options.length > 0) {
      e.preventDefault()
      options[0].focus()
    } else if (e.key === 'End' && options.length > 0) {
      e.preventDefault()
      options[options.length - 1].focus()
    }
  }

  const current = LOCALES.find((l) => l.code === locale)
  return (
    <div className="lang-switch" ref={rootRef}>
      <button
        ref={buttonRef}
        className="command-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t(locale, 'common.language')}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <WbIcon name="languages" />
        <span>{t(locale, 'common.language')}</span>
        <span className="key-label">{current?.label ?? locale}</span>
      </button>
      {open && (
        <div className="lang-menu" role="listbox" aria-label={t(locale, 'common.language')} ref={listRef} onKeyDown={onMenuKey}>
          {LOCALES.map((l) => (
            <button
              key={l.code}
              role="option"
              data-locale={l.code}
              aria-selected={l.code === locale}
              className="lang-option"
              onClick={() => {
                setLocale(l.code)
                close(true)
              }}
            >
              <span>{l.label}</span>
              {l.code === locale && <WbIcon name="check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
