// WB-02.09 · 统一通知(Toast):订阅 state/notifications,不再用
// setTimeout + textContent 直接改 DOM。错误类通知停留更久并可带动作。
import { useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import * as notifications from '../state/notifications.ts'
import { t } from '../../lib/i18n/index.ts'
import { useLocale } from '../state/localeStore.ts'

export function ToastStack(): JSX.Element {
  const notices = useSyncExternalStore(notifications.subscribe, notifications.listNotices)
  const locale = useLocale()
  return (
    <div className="toast-region" role="region" aria-label={t(locale, 'common.notifications')}>
      {notices.map((n) => (
        <div key={n.id} role="status" aria-live="polite" className="toast show">
          <span>{n.message}</span>
          {n.action && (
            <button
              className="btn"
              style={{ minHeight: 22, fontSize: 10, marginLeft: 9, color: '#cfe7ea' }}
              onClick={() => {
                if (n.action?.jobId) notifications.dismiss(n.id)
              }}
            >
              {n.action.label}
            </button>
          )}
          <button
            className="icon-button"
            style={{ color: '#cfe7ea' }}
            aria-label={t(locale, 'common.closeNotification')}
            onClick={() => notifications.dismiss(n.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
