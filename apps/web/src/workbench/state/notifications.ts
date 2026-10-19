// WB-02.09 · 统一通知:Toast 队列状态的单一来源,接替原型的
// `#toast` DOM 拼接(setTimeout + textContent)。组件 ToastStack 订阅本模块。
// WB-11.15 · 执行域(WB-07.17 守卫文件)不 import i18n,改发结构化词条
// { key, params },本模块(非守卫文件)在入队时经 localeSession 即时解析——
// store 仍存最终字符串,ToastStack 无感;任务对象保持 locale 无关。
import type { JobId } from '../ids.ts'
import { t } from '../../lib/i18n/index.ts'
import type { TranslationKey, InterpolationParams } from '../../lib/i18n/index.ts'
import { localeSession } from './localeStore.ts'

export type NoticeKind = 'info' | 'success' | 'warning' | 'error'

/** toast 文案:直排字符串,或词典词条(执行域发词条,此处解析)。 */
export type ToastMessage = string | { key: TranslationKey; params?: InterpolationParams }

export type Notice = {
  id: number
  kind: NoticeKind
  message: string
  /** 轻量动作:例如"查看任务" */
  action?: { label: string; jobId?: JobId }
  expiresAt: number
}

let notices: Notice[] = []
let autoId = 0
const listeners = new Set<() => void>()
const timers = new Set<ReturnType<typeof setTimeout>>()

const DEFAULT_TTL: Record<NoticeKind, number> = {
  info: 3400,
  success: 2600,
  warning: 4200,
  error: 6000,
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function listNotices(): readonly Notice[] {
  return notices
}

export function notify(kind: NoticeKind, message: ToastMessage, notice?: Partial<Pick<Notice, 'action' | 'expiresAt'>>): number {
  const id = ++autoId
  const ttl = notice?.expiresAt ? 0 : DEFAULT_TTL[kind]
  const text = typeof message === 'string' ? message : t(localeSession.get(), message.key, message.params)
  notices = [
    ...notices.slice(-3),
    {
      id,
      kind,
      message: text,
      action: notice?.action,
      expiresAt: notice?.expiresAt ?? (ttl > 0 ? Date.now() + ttl : Number.POSITIVE_INFINITY),
    },
  ]
  if (ttl > 0) {
    const timer = setTimeout(() => dismiss(id), ttl)
    timers.add(timer)
  }
  emit()
  return id
}

export function dismiss(id: number): void {
  if (!notices.some((n) => n.id === id)) return
  notices = notices.filter((n) => n.id !== id)
  emit()
}

/** 仅供测试:清空队列与定时器。 */
export function resetForTest(): void {
  for (const timer of timers) clearTimeout(timer)
  timers.clear()
  notices = []
}
