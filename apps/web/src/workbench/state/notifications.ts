// WB-02.09 · 统一通知:Toast 队列状态的单一来源,接替原型的
// `#toast` DOM 拼接(setTimeout + textContent)。组件 ToastStack 订阅本模块。
import type { JobId } from '../ids.ts'

export type NoticeKind = 'info' | 'success' | 'warning' | 'error'

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

export function notify(kind: NoticeKind, message: string, notice?: Partial<Pick<Notice, 'action' | 'expiresAt'>>): number {
  const id = ++autoId
  const ttl = notice?.expiresAt ? 0 : DEFAULT_TTL[kind]
  notices = [
    ...notices.slice(-3),
    {
      id,
      kind,
      message,
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
