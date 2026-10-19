// WB-11.15 · 队列显示文案(词典侧)。
// 架构约束(WB-07.17 守卫):state/ 执行域文件不 import i18n——任务对象与
// 执行引用不随 locale 重建;jobLogic.STATUS_LABEL / execFsm.recoveryFor
// 保留为逻辑侧 zh 简表(节点测试口径)。本模块是纯 .ts 显示层(无 JSX,
// 可被 node --test 直测),组件与终态/错误展示从这里取词典文案。
import { t } from '../../lib/i18n/index.ts'
import type { Locale, TranslationKey, InterpolationParams } from '../../lib/i18n/index.ts'
import type { ExecErrorClass, ExecKind, JobStatus } from '../state/jobLogic.ts'

// 缺省 zh:与 resultModel/designerLogic 同一纪律(测试锁中文子串)
const LOGIC_FALLBACK: Locale = 'zh-CN'

function msg(locale: Locale | undefined, key: TranslationKey, params?: InterpolationParams): string {
  return t(locale ?? LOGIC_FALLBACK, key, params)
}

const STATUS_KEYS: Readonly<Record<JobStatus, TranslationKey>> = {
  queued: 'tasks.queued',
  running: 'tasks.running',
  cancelling: 'tasks.cancelling',
  cancelled: 'tasks.cancelled',
  succeeded: 'tasks.succeeded',
  failed: 'tasks.failed',
}

/** 状态徽标显示名(词典版;逻辑侧 zh 简表在 jobLogic.STATUS_LABEL)。 */
export function statusLabel(status: JobStatus, locale?: Locale): string {
  return msg(locale, STATUS_KEYS[status])
}

const ERROR_CLASS_KEYS: Readonly<Record<ExecErrorClass, TranslationKey>> = {
  init: 'tasks.error.init',
  run: 'tasks.error.run',
  budget: 'tasks.error.budget',
  bridge: 'tasks.error.bridge',
}

/** 错误分类显示名(词典版;逻辑侧 zh 简表在 execFsm.ERROR_CLASS_LABEL)。 */
export function errorClassLabel(cls: ExecErrorClass, locale?: Locale): string {
  return msg(locale, ERROR_CLASS_KEYS[cls])
}

/** 恢复动作提示(词典版;execFsm.recoveryFor 保持纯 zh 供逻辑测试)。 */
export function recoveryText(errorClass: ExecErrorClass | null, kind: ExecKind, locale?: Locale): string {
  switch (errorClass) {
    case 'init':
      return msg(locale, 'tasks.recovery.init')
    case 'run':
      return msg(locale, 'tasks.recovery.run')
    case 'budget':
      return msg(locale, 'tasks.recovery.budget')
    case 'bridge':
      return kind === 'ab' ? msg(locale, 'tasks.recovery.bridgeAb') : msg(locale, 'tasks.recovery.bridge')
    case null:
      return msg(locale, 'tasks.recovery.none')
  }
}
