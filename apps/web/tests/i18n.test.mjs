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
