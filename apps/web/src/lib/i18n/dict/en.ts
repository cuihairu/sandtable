// WB-11.03:英文词典。`satisfies Record<keyof typeof zh, string>` 在编译期锁
// 「与中文词典同一 key 集合」——多 key/少 key/类型非 string 都过不了 tsc;
// 运行时侧由 tests/i18n.test.mjs 再锁一遍(双保险,防 satisfies 被绕过)。
// 占位符 {name} 与中文侧同名同数量。词条按九领域前缀组织,分片在 en/ 下按域一文件
// (common / params / nav / experiment / analysis / tasks / data / report / errors)。
import { zh } from './zh.ts'
import { common } from './en/common.ts'
import { params } from './en/params.ts'
import { nav } from './en/nav.ts'
import { experiment } from './en/experiment.ts'
import { analysis } from './en/analysis.ts'
import { tasks } from './en/tasks.ts'
import { data } from './en/data.ts'
import { report } from './en/report.ts'
import { errors } from './en/errors.ts'

export const en = {
  ...common,
  ...params,
  ...nav,
  ...experiment,
  ...analysis,
  ...tasks,
  ...data,
  ...report,
  ...errors,
} satisfies Record<keyof typeof zh, string>
