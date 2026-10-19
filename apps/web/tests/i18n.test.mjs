// i18n 基础守卫(节点侧,CI web job 跑;不依赖 pkg-node,放无 wasm 的 node --test 行):
// WB-11.01-.04 锁三件事——①locale 定义:zh-CN/en-US、显示名固定、en-US 兜底;
// ②中英文词典 key 集合完全一致(WB-11.03 类型约束的运行时侧;TS 侧 en 字典
// 用 satisfies Record<keyof typeof zh, string> 在编译期锁同集合);③t() 解析、
// 命名参数插值与未知 locale/key 的兜底行为。词典按 WB-11.04 八领域前缀组织,
// 前缀集合由本守卫锁死(公共控件/导航/参数/实验/分析/任务/数据导出/错误)。
// 跑法(仓库根):node --test apps/web/tests/i18n.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { LOCALES, DEFAULT_LOCALE, isLocale } from '../src/lib/i18n/locales.ts'
import { zh } from '../src/lib/i18n/dict/zh.ts'
import { en } from '../src/lib/i18n/dict/en.ts'
import { t, createLocaleStore } from '../src/lib/i18n/index.ts'
import {
  detectFromLanguages,
  resolveInitialLocale,
  persistLocale,
  LOCALE_STORAGE_KEY,
} from '../src/lib/i18n/detect.ts'
import { fmtNumber, fmtPercent, fmtDate } from '../src/lib/i18n/format.ts'
import { pluralCategory } from '../src/lib/i18n/plural.ts'
import { tPlural } from '../src/lib/i18n/index.ts'

test('WB-11.01:locale 定义——zh-CN/en-US、固定显示名、en-US 兜底', () => {
  assert.deepEqual(
    LOCALES.map((l) => [l.code, l.label]),
    [
      ['zh-CN', '简体中文'],
      ['en-US', 'English'],
    ],
    '显示名固定,不得随界面其他措辞漂移',
  )
  assert.equal(DEFAULT_LOCALE, 'en-US', '无匹配 locale 时兜底 en-US(WB-11.06 语义)')
  assert.ok(isLocale('zh-CN') && isLocale('en-US'))
  assert.equal(isLocale('fr-FR'), false)
})

test('WB-11.03:中英文词典 key 集合完全一致,无空值无空串', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(enKeys, zhKeys, 'en 缺/多 key → 翻译层漂移')
  assert.ok(zhKeys.length >= 20, `首批词条至少覆盖常用面,实测 ${zhKeys.length}`)
  for (const k of zhKeys) {
    assert.ok(zh[k].trim().length > 0, `zh[${k}] 为空`)
    assert.ok(en[k].trim().length > 0, `en[${k}] 为空`)
  }
})

test('WB-11.04:词条按八领域前缀组织', () => {
  const DOMAINS = ['common.', 'nav.', 'params.', 'experiment.', 'analysis.', 'tasks.', 'data.', 'errors.']
  for (const k of Object.keys(zh)) {
    assert.ok(
      DOMAINS.some((d) => k.startsWith(d)),
      `key「${k}」不在八领域前缀内`,
    )
  }
  for (const d of DOMAINS) {
    assert.ok(Object.keys(zh).some((k) => k.startsWith(d)), `领域「${d}」无词条`)
  }
})

test('WB-11.02:t() 解析、未知 key/locale 兜底、命名参数插值', () => {
  assert.equal(t('zh-CN', 'common.language'), zh['common.language'])
  assert.equal(t('en-US', 'common.language'), en['common.language'])
  // 未知 locale → en-US 兜底(不抛错)
  assert.equal(t('fr-FR', 'common.language'), en['common.language'])
  // 未知 key → 原样返回 key(不抛错,缺失报告是 WB-11.25 的事)
  assert.equal(t('zh-CN', 'no.such.key'), 'no.such.key')
  // 命名参数插值 {name},不靠字符串拼接(计数/复数规则是 WB-11.17)
  assert.equal(
    t('zh-CN', 'params.changed', { n: '3' }),
    zh['params.changed'].replace('{n}', '3'),
  )
})

test('WB-11.02:语言状态存储——set 换值并通知,同值不通知,退订生效', () => {
  const store = createLocaleStore('zh-CN')
  assert.equal(store.get(), 'zh-CN', '初值即当前值')
  let fired = 0
  const off = store.subscribe(() => fired++)
  store.set('en-US')
  assert.equal(fired, 1)
  assert.equal(store.get(), 'en-US')
  store.set('en-US') // 同值写不触发通知
  assert.equal(fired, 1)
  off()
  store.set('zh-CN')
  assert.equal(fired, 1, '退订后不再通知')
})

test('WB-11.06:系统语言探测——zh/en 前缀按序取首个,无命中兜底 en-US', () => {
  assert.equal(detectFromLanguages(['zh-CN', 'en-US']), 'zh-CN')
  assert.equal(detectFromLanguages(['en-US', 'zh-CN']), 'en-US', '按偏好顺序取首个命中')
  assert.equal(detectFromLanguages(['ZH-TW', 'fr']), 'zh-CN', '大小写不敏感,zh 系归 zh-CN')
  assert.equal(detectFromLanguages(['fr-FR', 'de-DE']), 'en-US', '无命中兜底 en-US')
  assert.equal(detectFromLanguages([]), 'en-US', '空偏好列表兜底 en-US')
})

test('WB-11.07:持久化优先于系统语言;坏存值视同未选择', () => {
  const mem = (saved) => ({
    getItem: (k) => (k === LOCALE_STORAGE_KEY ? saved : null),
    setItem: () => {},
  })
  assert.equal(resolveInitialLocale(mem('zh-CN'), ['en-US']), 'zh-CN', '手动选择压过系统语言')
  assert.equal(resolveInitialLocale(mem('garbage'), ['en-US']), 'en-US', '非法存值视同未选择,落系统语言')
  assert.equal(resolveInitialLocale(null, ['zh-CN']), 'zh-CN', '无存储(隐私模式)直接探测')
  const writes = []
  const sink = { getItem: () => null, setItem: (k, v) => writes.push([k, v]) }
  persistLocale(sink, 'en-US')
  assert.deepEqual(writes, [[LOCALE_STORAGE_KEY, 'en-US']], '持久化键固定')
})

test('WB-11.18:数字按 locale 走 Intl,语言切换不改底层数值', () => {
  assert.equal(fmtNumber('en-US', 1234.5), '1,234.5')
  assert.equal(fmtNumber('zh-CN', 1234.5), '1,234.5', '中文与英文同用千分位,显示不同不改值')
  assert.equal(fmtNumber('en-US', 0.53), '0.53', '比例值原样显示,不乘 100')
  assert.equal(fmtNumber('en-US', 3, { fractionDigits: 2 }), '3.00')
  assert.doesNotThrow(() => fmtNumber('xx-XX', 1.5), '非法 locale 由 Intl 回退,不抛错')
})

test('WB-11.18:百分比是唯一的比例→百分数转换点,百分点不标成百分比', () => {
  assert.equal(fmtPercent('en-US', 0.534), '53.4%')
  assert.equal(fmtPercent('zh-CN', 0.534), '53.4%')
  assert.equal(fmtPercent('en-US', 0), '0%')
  assert.notEqual(fmtPercent('en-US', 0.534), fmtNumber('en-US', 0.534), '百分比必然乘 100')
  // 绝对差是百分点:走数字格式,不加 %
  assert.equal(fmtNumber('en-US', 0.034), '0.034')
  assert.doesNotThrow(() => fmtPercent('xx-XX', 0.5), '非法 locale 回退')
})

test('WB-11.18:日期用 UTC 显式格式化,不随本机时区漂移', () => {
  assert.equal(fmtDate('en-US', '2026-10-20'), '10/20/2026')
  assert.equal(fmtDate('zh-CN', '2026-10-20'), '2026/10/20')
})

test('WB-11.17:复数规则按 locale 选形,不拼语言碎片', () => {
  // 规则引擎 = Intl.PluralRules:en-US 1→one、其余→other
  assert.equal(pluralCategory('en-US', 1), 'one')
  assert.equal(pluralCategory('en-US', 3), 'other')
  // zh-CN 无复数变化,恒 other(PO 类作形容词也不变形)
  assert.equal(pluralCategory('zh-CN', 1), 'other')
  assert.equal(pluralCategory('zh-CN', 3), 'other')
  assert.equal(pluralCategory('xx-XX', 3), 'other', '非法 locale 由 Intl 回退到默认规则')
})

test('WB-11.17:tPlural 按词典 .one/.other 选形,{n} 自动注入', () => {
  assert.equal(
    tPlural('en-US', 'tasks.remaining', 1),
    en['tasks.remaining.one'].replace('{n}', '1'),
  )
  assert.equal(
    tPlural('en-US', 'tasks.remaining', 3),
    en['tasks.remaining.other'].replace('{n}', '3'),
  )
  // zh 恒 other(词典里 .one 仅为与 en 键集对齐,运行时不命中)
  assert.equal(
    tPlural('zh-CN', 'tasks.remaining', 1),
    zh['tasks.remaining.other'].replace('{n}', '1'),
  )
  // 复数形照常吃命名参数
  assert.equal(
    tPlural('en-US', 'data.rowsExported', 2, { where: 'CSV' }),
    en['data.rowsExported.other'].replace('{n}', '2').replace('{where}', 'CSV'),
  )
})
