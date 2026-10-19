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
import {
  t, tPlural, displayName, createLocaleStore, configureI18n, openLocaleSession, applyDocumentLocale,
} from '../src/lib/i18n/index.ts'
import {
  detectFromLanguages,
  resolveInitialLocale,
  persistLocale,
  LOCALE_STORAGE_KEY,
} from '../src/lib/i18n/detect.ts'
import { fmtNumber, fmtNumberSig, fmtPercent, fmtDate } from '../src/lib/i18n/format.ts'
import { pluralCategory } from '../src/lib/i18n/plural.ts'
import { localizeWasmError } from '../src/lib/i18n/errorText.ts'

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
  // 未知 key → 不抛错(WB-11.25 定的正式/开发两种形态见专属测试)
  assert.doesNotThrow(() => t('zh-CN', 'no.such.key'))
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

test('WB-11.25:缺词——正式界面不回显翻译 key,走本地化兜底', () => {
  // 节点测试默认非 dev(即正式形态)
  assert.equal(t('zh-CN', 'no.such.key'), zh['errors.missingText'], 'zh 界面兜底中文文案')
  assert.equal(t('en-US', 'no.such.key'), en['errors.missingText'])
  assert.equal(t('fr-FR', 'no.such.key'), en['errors.missingText'], '未知 locale 退 en-US 词典后照样兜底')
  assert.equal(tPlural('en-US', 'no.such', 3), en['errors.missingText'], '复数形缺词同样兜底')
  // 在库词条不受影响
  assert.equal(t('zh-CN', 'params.changed', { n: '3' }), zh['params.changed'].replace('{n}', '3'))
})

test('WB-11.25:开发环境回显原 key 定位缺失,每键每 locale 只告警一次', () => {
  configureI18n({ dev: true })
  const seen = []
  const origWarn = console.warn
  console.warn = (msg) => seen.push(String(msg))
  try {
    assert.equal(t('zh-CN', 'no.such.key'), 'no.such.key', 'dev 回显 key 便于 grep')
    assert.equal(t('zh-CN', 'no.such.key'), 'no.such.key', '重复调用不再刷屏')
    assert.equal(t('en-US', 'no.such.key'), 'no.such.key')
    assert.equal(tPlural('zh-CN', 'no.such', 1), 'no.such.other', '复数缺词回显全形键')
  } finally {
    console.warn = origWarn
    configureI18n({ dev: false })
  }
  assert.equal(seen.filter((m) => m.includes('no.such.key')).length, 2, 'zh|en 各报一次')
  assert.equal(seen.filter((m) => m.includes('no.such.other')).length, 1)
  // 恢复正式形态
  assert.equal(t('zh-CN', 'no.such.key'), zh['errors.missingText'])
})

test('WB-11.21:错误码稳定,参数化翻译携带原始内核详情', () => {
  const raw = '配置错误: 表 damage_model 不存在'
  const e = localizeWasmError('zh-CN', raw)
  assert.equal(e.code, 'config_error', '稳定错误码,不随界面语言变')
  assert.equal(e.detail, raw, '原始内核错误逐字保留,供定位')
  assert.equal(
    e.text,
    zh['errors.config'].replace('{detail}', raw),
    '文本走词典参数化模板,不拼碎片',
  )
  assert.equal(localizeWasmError('zh-CN', '参数错误: replicates 超出预算').code, 'param_error')
  assert.equal(localizeWasmError('en-US', '候选结果序列化失败: boom').code, 'serialize_error')
  assert.match(localizeWasmError('en-US', '参数错误: too big').text, /^Parameter error:/)
})

test('WB-11.21:未知错误本地化兜底;非 Error 入参不抛错', () => {
  const weird = 'something totally unexpected'
  const e = localizeWasmError('zh-CN', weird)
  assert.equal(e.code, 'unknown_error')
  assert.equal(e.text, zh['errors.unknown'].replace('{detail}', weird))
  assert.doesNotThrow(() => localizeWasmError('en-US', undefined))
  assert.doesNotThrow(() => localizeWasmError('en-US', new Error('std boom')))
  assert.equal(
    localizeWasmError('en-US', new Error('std boom')).detail,
    'std boom',
    'Error 实例取 message',
  )
})

test('WB-11.20:显示名——有译词用译词,自定义/未翻译回显原始 desc', () => {
  assert.equal(displayName('zh-CN', 'common.language', 'Language'), zh['common.language'])
  assert.equal(displayName('en-US', 'common.language', '语言'), en['common.language'])
  // 项目自定义参数:key 无译词 → 回显注册表原始 desc,不假装自动翻译
  assert.equal(displayName('zh-CN', 'custom.param.bonus', 'Special bonus'), 'Special bonus')
  assert.equal(displayName('fr-FR', 'custom.param.bonus', '原始描述'), '原始描述', '未知 locale 也不吞原文')
})

// —— 会话装配(WB-11.05/.06/.07 接线的库侧内核) ——
// openLocaleSession 是应用入口与组件之间唯一的 locale 状态面:
// 引导(持久化 > 系统语言 > en-US)、手动选择落持久化、文档头应用。
const memStorage = (saved) => ({
  getItem: (k) => (k === LOCALE_STORAGE_KEY ? saved : null),
  setItem: () => {},
})

test('WB-11.06/.07:会话引导——持久化压过系统语言,坏存值视同未选择', () => {
  assert.equal(openLocaleSession({ storage: memStorage('zh-CN'), languages: ['en-US'] }).get(), 'zh-CN', '手动选择压过系统语言')
  assert.equal(openLocaleSession({ storage: memStorage('garbage'), languages: ['en-US'] }).get(), 'en-US')
  assert.equal(openLocaleSession({ storage: null, languages: ['zh-CN'] }).get(), 'zh-CN', '无存储直接按系统语言')
  assert.equal(openLocaleSession({ storage: memStorage(null), languages: ['fr-FR'] }).get(), 'en-US', '无命中兜底 en-US')
})

test('WB-11.07:手动选择写入持久化;同值不写不发通知', () => {
  const writes = []
  const sink = { getItem: () => null, setItem: (k, v) => writes.push([k, v]) }
  const session = openLocaleSession({ storage: sink, languages: [] })
  let fired = 0
  session.subscribe(() => fired++)
  session.set('zh-CN')
  assert.equal(session.get(), 'zh-CN')
  assert.equal(fired, 1)
  assert.deepEqual(writes, [[LOCALE_STORAGE_KEY, 'zh-CN']], '手动选择落持久化')
  session.set('zh-CN') // 同值:不重复写存储,不重复通知
  assert.equal(fired, 1)
  assert.equal(writes.length, 1)
})

test('WB-11.29:持久化写失败不中断切换,开发形态每会话只告警一次', () => {
  // 正式形态:存储不可写(隐私模式/满配额)静默降级,语言照常切换
  const boom = { getItem: () => null, setItem: () => { throw new Error('quota') } }
  const session = openLocaleSession({ storage: boom, languages: [], dev: false })
  assert.doesNotThrow(() => session.set('zh-CN'))
  assert.equal(session.get(), 'zh-CN', '存储不可写时切换仍生效')
  // 开发形态:告警一次,不刷屏
  const seen = []
  const origWarn = console.warn
  console.warn = (msg) => seen.push(String(msg))
  try {
    const devSession = openLocaleSession({ storage: boom, languages: [], dev: true })
    devSession.set('zh-CN')
    devSession.set('en-US')
    devSession.set('zh-CN')
  } finally {
    console.warn = origWarn
  }
  assert.equal(seen.filter((m) => m.includes('locale')).length, 1, '写失败只告警一次')
})

test('WB-11.10(部分):文档 lang 与标题跟随 locale,创建/切换即应用,未知 locale 退 en-US', () => {
  const makeDoc = () => {
    const d = { lang: '', title: '' }
    return { d, target: { setLang: (l) => (d.lang = l), setTitle: (t) => (d.title = t) } }
  }
  // 创建即应用(引导阶段同步设置,不等首帧渲染)
  const a = makeDoc()
  openLocaleSession({ storage: memStorage('zh-CN'), languages: ['en-US'], doc: a.target })
  assert.equal(a.d.lang, 'zh-CN')
  assert.equal(a.d.title, zh['common.appTitle'], '标题走词典,不散落硬编码')
  // 切换即应用(订阅者在同一通知里读到新文档头)
  const b = makeDoc()
  const session = openLocaleSession({ storage: memStorage(null), languages: ['en-US'], doc: b.target })
  session.set('zh-CN')
  assert.equal(b.d.lang, 'zh-CN')
  assert.equal(b.d.title, zh['common.appTitle'])
  session.set('en-US')
  assert.equal(b.d.title, en['common.appTitle'], '英文界面英文标题')
  // 未知 locale:按 en-US 应用,不把非法值写进文档头
  const c = makeDoc()
  applyDocumentLocale('fr-FR', c.target)
  assert.equal(c.d.lang, 'en-US')
  assert.equal(c.d.title, en['common.appTitle'])
  // setLang 可选:正文语言与 locale 尚不一致时(WB-11.11~16 未完成)浏览器侧
  // 只同步标题,不带 setLang 的目标也照常工作
  const titleOnly = { title: '' }
  const titleTarget = { setTitle: (t) => (titleOnly.title = t) }
  applyDocumentLocale('zh-CN', titleTarget)
  assert.equal(titleOnly.title, zh['common.appTitle'])
  assert.doesNotThrow(() =>
    openLocaleSession({ storage: memStorage(null), languages: ['zh-CN'], doc: titleTarget }).set('en-US'),
  )
})

test('WB-11.11:壳组件词条齐全(应用栏/功能轨/浏览器/文档标签/状态栏)', () => {
  // 与组件实际用 key 同步维护:漏一个,界面上就有一处中文漏翻成 key 或退兜底
  const required = [
    // 应用栏 AppBar
    'common.appSubtitle', 'common.projectTitle', 'common.builtinSample', 'common.projectFile',
    'common.openProject', 'common.openProjectHint', 'common.saveProject', 'common.saveProjectHint',
    'common.commandSearchPlaceholder', 'common.demoBadge', 'common.wordmarkAria',
    // 功能轨 ActivityRail
    'nav.workspaces', 'nav.shortcuts',
    'nav.short.analysis', 'nav.short.parameters', 'nav.short.designer', 'nav.short.runs', 'nav.short.exchange',
    // 项目浏览器 ProjectExplorer
    'common.explorer', 'common.collapseExplorer', 'common.demoData', 'common.unsavedChanges', 'common.baselineReadonly',
    // 文档标签 DocumentTabs
    'common.openDocuments', 'common.unsaved',
    'nav.tab.analysis', 'nav.tab.parameters', 'nav.tab.designer', 'nav.tab.runs', 'nav.tab.exchange',
    // 状态栏 StatusBar
    'common.project', 'common.tasksRunning', 'common.taskQueue', 'common.activeTaskTitle',
    'common.dataSourceDemo', 'common.dataSourceReal', 'common.viewShortcuts',
  ]
  for (const k of required) {
    assert.ok(k in zh, `zh 缺词条 ${k}`)
    assert.ok(k in en, `en 缺词条 ${k}`)
    assert.ok(zh[k].trim() !== '' && en[k].trim() !== '', `词条 ${k} 不得为空`)
  }
})

test('WB-11.12:参数页词条双语齐全(筛选/表头/检查器/批量/YAML 编辑)', () => {
  // params.* 全集在两种语言里键集合一致且非空;ts 侧还有 en satisfies 锁,
  // 这里点名的关键面是运行时兜底:漏一个,参数页就有一处中文漏翻退兜底
  const zhParams = Object.keys(zh).filter((k) => k.startsWith('params.'))
  const enParams = Object.keys(en).filter((k) => k.startsWith('params.'))
  assert.deepEqual([...enParams].sort(), [...zhParams].sort(), 'params.* 键集合必须双语一致')
  for (const k of zhParams) {
    assert.ok(zh[k].trim() !== '', `zh 词条 ${k} 不得为空`)
    assert.ok(en[k].trim() !== '', `en 词条 ${k} 不得为空`)
  }
  // 关键交互面点名:批量操作 / 内核校验 / 高级 YAML 编辑 / 表格计数
  const required = [
    'params.previewBulk', 'params.applyBulk', 'params.checking', 'params.roundHint',
    'params.kernelFailed', 'params.bulkKernelError', 'params.bulkRowsFailed', 'params.bulkOk',
    'params.yamlApply', 'params.yamlErrorLine', 'params.yamlNote',
    'params.registryCount', 'params.colDelta', 'params.empty',
    'params.kind.table', 'params.resetOne', 'params.savedLabelProject',
  ]
  for (const k of required) {
    assert.ok(zhParams.includes(k), `缺词条 ${k}`)
  }
  // 插值占位双语对齐(漏占位会把 {n} 直接显示给用户)
  for (const k of ['params.registryCount', 'params.selectRowAria', 'params.changeCount', 'params.bulkRowsFailed']) {
    const zhSlots = [...zh[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const enSlots = [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(enSlots, zhSlots, `${k} 双语占位必须一致`)
  }
})

test('WB-11.13:实验设计页词条双语齐全(方法/因子/场景/采样/预算/预检)', () => {
  const zhExp = Object.keys(zh).filter((k) => k.startsWith('experiment.'))
  const enExp = Object.keys(en).filter((k) => k.startsWith('experiment.'))
  assert.deepEqual([...enExp].sort(), [...zhExp].sort(), 'experiment.* 键集合必须双语一致')
  for (const k of zhExp) {
    assert.ok(zh[k].trim() !== '', `zh 词条 ${k} 不得为空`)
    assert.ok(en[k].trim() !== '', `en 词条 ${k} 不得为空`)
  }
  // 五个表单区块点名:方法说明 / 因子表 / 场景字段 / 随机策略 / 预算与预检
  const required = [
    'experiment.methodTitle.grid', 'experiment.methodDesc.grid',
    'experiment.colFactorPath', 'experiment.addFactorAria', 'experiment.samplesLabel',
    'experiment.scenarioSectionTitle', 'experiment.daysNote', 'experiment.mixNote',
    'experiment.samplingLabel', 'experiment.sampling.lhc', 'experiment.samplingNote',
    'experiment.planTitle', 'experiment.planSims', 'experiment.planStale', 'experiment.noPlan',
    'experiment.preflightTitle', 'experiment.checkPlan', 'experiment.submitLabel', 'experiment.submitNote',
    // 逻辑层错误串(designerLogic 纯函数输出,缺省 zh-CN)
    'experiment.errNameRequired', 'experiment.errFactorDup', 'experiment.errKpiNeedBound',
    'experiment.errScenarioNoSeed', 'experiment.errMixPercent', 'experiment.errThresholdRatio',
    'experiment.errLeafWrite', 'experiment.errKpiUnknown', 'experiment.budgetHint',
  ]
  for (const k of required) {
    assert.ok(zhExp.includes(k), `缺词条 ${k}`)
  }
  // 通知类(提交路径)与插值占位对齐
  const slots = ['experiment.planBound', 'experiment.abCrn', 'experiment.refExperiment',
    'experiment.submitNote', 'experiment.abBaselineArm', 'experiment.factorExists',
    'experiment.errKindNotSweepable', 'experiment.errKpiNeedBound', 'experiment.errLeafWrite',
    'experiment.errThresholdNumber', 'experiment.errScenarioDurationBad']
  for (const k of slots) {
    assert.ok(zhExp.includes(k), `缺词条 ${k}`)
    const zhSlots = [...zh[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const enSlots = [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(enSlots, zhSlots, `${k} 双语占位必须一致`)
  }
})

test('WB-11.14:KPI 显示名与单位后缀双语齐全(指标 id 稳定,显示名走词典)', () => {
  const zhA = Object.keys(zh).filter((k) => k.startsWith('analysis.'))
  const enA = Object.keys(en).filter((k) => k.startsWith('analysis.'))
  assert.deepEqual([...enA].sort(), [...zhA].sort(), 'analysis.* 键集合必须双语一致')
  for (const k of zhA) {
    assert.ok(zh[k].trim() !== '', `zh 词条 ${k} 不得为空`)
    assert.ok(en[k].trim() !== '', `en 词条 ${k} 不得为空`)
    // 显示名/单位不参与插值,不得携带 {slot};统计文案族的占位走双语对齐断言
    if (k.startsWith('analysis.kpi')) {
      assert.ok(!/\{\w+\}/.test(zh[k]) && !/\{\w+\}/.test(en[k]), `${k} 不应有插值占位`)
    }
  }
  for (const k of ['analysis.feasibilitySummary', 'analysis.rowFailed', 'analysis.replicateMissingDetail',
    'analysis.interpBoth', 'analysis.interpSplit']) {
    assert.ok(zhA.includes(k), `缺词条 ${k}`)
    const zhSlots = [...zh[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const enSlots = [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(enSlots, zhSlots, `${k} 双语占位必须一致`)
  }
  // 八个内核指标逐一点名(designerLogic.KPI_POOL 同源集合)
  for (const m of ['retention_d7', 'retention_d3', 'win_rate', 'gold_per_player', 'power_p50',
    'churn_rate', 'gacha_pulls_to_hit', 'loot_gold_per_player']) {
    assert.ok(zhA.includes(`analysis.kpi.${m}`), `缺指标显示名 analysis.kpi.${m}`)
  }
  for (const u of ['percent', 'gold', 'power', 'count']) {
    assert.ok(zhA.includes(`analysis.kpiUnit.${u}`), `缺单位词条 analysis.kpiUnit.${u}`)
  }
  // 点值锁定:zh 真值源 + en 自然语
  assert.equal(zh['analysis.kpi.retention_d7'], 'D7 留存率')
  assert.equal(en['analysis.kpi.retention_d7'], 'D7 retention')
})

test('WB-11.15:队列面文案——状态/进度/错误/恢复经词典双语可解', async () => {
  const { statusLabel, errorClassLabel, recoveryText } = await import('../src/workbench/tasks/taskText.ts')
  // 六态:zh 真值源 + en 自然语,缺省 zh(演示面板/节点测试口径)
  assert.equal(statusLabel('cancelling', 'zh-CN'), zh['tasks.cancelling'])
  assert.equal(statusLabel('cancelling', 'en-US'), en['tasks.cancelling'])
  assert.equal(statusLabel('failed', 'zh-CN'), '已失败')
  assert.equal(statusLabel('failed', 'en-US'), 'Failed')
  // 错误分类 + 恢复动作(缺省 zh;execFsm 侧 zh 简表由 execution 测试另行锁定)
  assert.equal(errorClassLabel('init', 'zh-CN'), '初始化失败')
  assert.equal(errorClassLabel('init', 'en-US'), 'Initialization failed')
  assert.match(recoveryText('budget', 'sweep'), /缩小实验规模/)
  assert.equal(recoveryText('budget', 'sweep', 'en-US'), en['tasks.recovery.budget'])
  assert.equal(recoveryText('bridge', 'ab', 'en-US'), en['tasks.recovery.bridgeAb'])
  // 模板键双语占位一致
  for (const k of ['tasks.progress.candidates', 'tasks.footer.succeeded', 'tasks.toast.realDone',
    'tasks.toast.failed', 'tasks.demo.cancelled', 'tasks.toast.stoppedCandidatePartial']) {
    const zs = [...zh[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    const es = [...en[k].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(es, zs, `${k} 双语占位必须一致`)
  }
})

test('WB-11.15:执行域 toast 发结构化词条,入队时按当前 locale 解析', async () => {
  const { notify, listNotices, resetForTest } = await import('../src/workbench/state/notifications.ts')
  const { setLocale, localeSession } = await import('../src/workbench/state/localeStore.ts')
  const before = localeSession.get()
  try {
    resetForTest()
    setLocale('zh-CN')
    notify('info', { key: 'tasks.toast.demoDone', params: { name: '扫描任务' } })
    assert.equal(listNotices().at(-1).message, '任务「扫描任务」演示结束:未执行仿真,未生成新的结果产物')
    setLocale('en-US')
    notify('success', { key: 'tasks.toast.realDoneComparison', params: { name: 'sweep', n: 3 } })
    assert.equal(listNotices().at(-1).message, 'Task "sweep" real execution finished: 3 candidates; A/B comparison is ready')
    // 直排字符串照旧透传(既有调用方不受影响)
    notify('warning', 'plain text stays verbatim')
    assert.equal(listNotices().at(-1).message, 'plain text stays verbatim')
  } finally {
    setLocale(before)
    resetForTest()
  }
})

test('WB-11.10:浏览器壳同步 <html lang>(localeStore 接线;applyDocumentLocale 行为另测)', async () => {
  const { readFileSync } = await import('node:fs')
  const src = readFileSync(new URL('../src/workbench/state/localeStore.ts', import.meta.url), 'utf8')
  // 正文翻译(WB-11.11~16)落地后 domDoc 必须带 setLang:setLang 在节点不可测
  // (document 守卫),与 WB-07.17 同款源级守卫锁接线存在
  assert.match(src, /setLang: \(lang\) => \{/, 'localeStore 需接线 setLang')
  assert.match(src, /document\.documentElement\.lang = lang/)
})

test('WB-11.18:format 层 maxFractionDigits(封顶不补零)与有效数字封顶', () => {
  assert.equal(fmtNumber('en-US', 1234.5678, { maxFractionDigits: 2 }), '1,234.57')
  assert.equal(fmtNumber('en-US', 100, { maxFractionDigits: 1 }), '100', '整数不补零(沿用 maximumFractionDigits 口径)')
  assert.equal(fmtNumberSig('en-US', 123456, 5), '123,460')
  assert.equal(fmtNumberSig('en-US', 0.123456, 5), '0.12346')
})

test('WB-11.18:展示层不直接构造 Intl 数字/日期格式化器(统一走 lib/i18n/format)', async () => {
  const { readdirSync, readFileSync } = await import('node:fs')
  const path = await import('node:path')
  const root = new URL('../src/', import.meta.url).pathname
  const bad = []
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const s = readFileSync(p, 'utf8')
        if (/new Intl\.(NumberFormat|DateTimeFormat)/.test(s) && !p.replaceAll('\\', '/').includes('lib/i18n')) {
          bad.push(path.relative(root, p))
        }
      }
    }
  }
  walk(root)
  assert.deepEqual(bad, [], `绕过 format 层的文件: ${bad.join(', ')}`)
})
