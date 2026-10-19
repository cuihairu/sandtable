// 机器可读导出口径守卫(WB-11.19/.22/.23,节点侧,CI web job 无 wasm 行):
// ① WB-11.22:机器输出(toCsv/machineJson/machineNumber)不接收 locale——
//    编译期即保证字段名/枚举/小数点不随界面语言漂移;数值用规范十进制
//    (小数点恒 '.',无千分位);非有限数值明确报错,不许静默变 'NaN'/null
//    (JSON.stringify 会把 NaN 变 null,同属静默造假)。
// ② WB-11.23:可读产物(SVG/报告)用导出时选定语言并在产物里记录 locale,
//    记录值与渲染语言同一来源;未知 locale 退 en-US。
// ③ WB-11.19:参数路径/KPI ID/文件路径/哈希/seed/用户输入名称六类原始字段
//    登记在 RAW_FIELD_KINDS,机器导出只收原始值,翻译只作用于显示名。
// 跑法(仓库根):node --test apps/web/tests/machine-export.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  machineNumber, machineJson, csvCell, toCsv,
  svgLanguageMeta, exportLocale,
  RAW_FIELD_KINDS, isRawFieldKind,
} from '../src/lib/machineExport.ts'
import { svgAnnotation } from '../src/workbench/demo/export.ts'
import { readFileSync } from 'node:fs'

test('WB-11.22:machineNumber 规范十进制——小数点恒为点,无千分位,-0 归一', () => {
  assert.equal(machineNumber(0.534), '0.534')
  assert.equal(machineNumber(1234.5), '1234.5', '不加千分位分隔符')
  assert.equal(machineNumber(0), '0')
  assert.equal(machineNumber(-0), '0', '-0 归一为 0')
  assert.equal(machineNumber(-12.05), '-12.05')
  assert.equal(machineNumber(100), '100', '整数值不带小数尾巴')
})

test('WB-11.22:非有限数值明确报错,不静默序列化成 NaN/Infinity/null', () => {
  assert.throws(() => machineNumber(Number.NaN), /非有限/)
  assert.throws(() => machineNumber(Number.POSITIVE_INFINITY), /非有限/)
  assert.throws(() => machineJson({ a: [1, { b: Number.NaN }] }), /非有限.*\$\.a\[1\]\.b/, '报错带取值路径,可定位')
  // 合法值照常
  assert.doesNotThrow(() => machineJson({ mean: null, ci: [0.1, 0.2] }), '不可用字段写 null 是合法表达')
})

test('WB-11.22:machineJson 输出与 JSON.stringify 同构且不随 locale 变', () => {
  const snap = { config_hash: 'abc', values: { 'model.warrior.attack': 80 }, verdict: 'pass' }
  assert.equal(machineJson(snap), JSON.stringify(snap, null, 2), '结构化输出同构;函数无 locale 参数,漂移在编译期即不可能')
})

test('WB-11.22:csvCell——数字走规范十进制,null 是空单元格(不是 0)', () => {
  assert.equal(csvCell(0.534), '0.534')
  assert.equal(csvCell(null), '', '不可用 = 空单元格,绝不写 0 填空')
  assert.equal(csvCell('plain'), 'plain')
  assert.equal(csvCell('a,b'), '"a,b"', '含逗号加引号')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""', '引号翻倍')
  assert.equal(csvCell('line1\nline2'), '"line1\nline2"', '含换行加引号')
})

test('WB-11.22:toCsv 行列结构稳定——表头原样,行宽不齐明确报错,CRLF 换行', () => {
  const out = toCsv(
    ['candidate_id', 'win_rate_mean', 'win_rate_ci95_lo'],
    [
      ['cnd_01', 0.534, 0.52],
      ['cnd_02', null, 0.48],
    ],
  )
  assert.equal(
    out,
    'candidate_id,win_rate_mean,win_rate_ci95_lo\r\ncnd_01,0.534,0.52\r\ncnd_02,,0.48',
    '表头字段名原样(机器 schema);null → 空单元格;CRLF',
  )
  assert.throws(() => toCsv(['a', 'b'], [['x']]), /列/, '行宽不齐 = 调用方错误,明确报错不静默补齐')
})

test('WB-11.23:可读产物记录导出时 locale,记录值与渲染语言同源', () => {
  assert.deepEqual(svgLanguageMeta('zh-CN'), { 'xml:lang': 'zh-CN', 'data-locale': 'zh-CN' })
  assert.deepEqual(svgLanguageMeta('fr-FR'), { 'xml:lang': 'en-US', 'data-locale': 'en-US' }, '未知 locale 退 en-US')
  const locale = exportLocale('zh-CN')
  const meta = svgLanguageMeta(locale)
  assert.equal(meta['data-locale'], locale, '记录的 locale = 渲染可读文本所用 locale,同一入参派生')
})

test('WB-11.23:SVG 标注随导出语言走词典,同一产物不混用两种语言', () => {
  const zh = svgAnnotation('zh-CN', '胜率')
  assert.equal(zh.title, '胜率 · 合成演示数据')
  assert.match(zh.desc, /synthetic_demo/)
  assert.match(zh.desc, /非/ , '中文 locale 标注是中文,不夹英文')
  const en = svgAnnotation('en-US', 'Win rate')
  assert.equal(en.title, 'Win rate · Synthetic demo data')
  assert.match(en.desc, /synthetic_demo/)
  assert.ok(!/[一-龥]/.test(en.title + en.desc), '英文 locale 标注无中文(不混语言、不冒充翻译)')
  // 未知 locale 由词典侧回退,标注仍成形
  assert.doesNotThrow(() => svgAnnotation('fr-FR', '指标'))
})

test('WB-11.23:调用侧把导出语言与本地化显示名传入 SVG 产物', () => {
  // 源级守卫:WorkbenchApp 的 SVG 导出必须同时给显示名(metricLabel)与 locale,
  // 缺一即产物不记录语言或标题回退 zh 原文——两处接线一起锁
  const app = readFileSync(new URL('../src/workbench/WorkbenchApp.tsx', import.meta.url), 'utf8')
  assert.ok(app.includes("svgFromElement(mainChart, metricLabel(metric.id"), 'SVG 标题用导出语言的指标显示名,不写死 zh label')
  assert.match(app, /svgFromElement\([\s\S]{0,200}?,\s*locale\)/, 'SVG 导出传入导出时 locale')
})

test('WB-11.19:原始字段六类登记在册,机器导出只收原始值', () => {
  assert.deepEqual(
    [...RAW_FIELD_KINDS],
    ['paramPath', 'kpiId', 'filePath', 'hash', 'seed', 'userName'],
    '参数路径/KPI ID/文件路径/哈希/seed/用户输入名称保持原始内容,永不进翻译',
  )
  for (const k of RAW_FIELD_KINDS) assert.ok(isRawFieldKind(k))
  assert.equal(isRawFieldKind('label'), false)
})
