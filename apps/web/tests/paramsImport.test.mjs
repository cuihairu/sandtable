// CSV 参数导入第一片守卫:模板/宽表表头、列映射、单位换算、差异预览与逐行错误。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  autoMapColumns,
  parseParameterImportFile,
  parseCsv,
  previewParamImport,
  transformParamImportValue,
} from '../src/workbench/params/paramImport.ts'
import { PARAM_REGISTRY, registryParam } from '../src/workbench/params/paramRegistry.ts'
import { parseConfig } from '../src/workbench/params/configYaml.ts'
import { buildRowModels } from '../src/workbench/params/paramsLogic.ts'
import { strToU8, zipSync } from 'fflate'

const rows = buildRowModels(
  parseConfig('model:\n  warrior:\n    attack: 100\n'),
  parseConfig('model:\n  warrior:\n    attack: 100\n'),
)

function zipEntry(name, content) {
  return [name, strToU8(content)]
}

function zipFile(entries) {
  return zipSync(Object.fromEntries(entries))
}

test('CSV 参数导入:表头乱序自动识别,path/value 以外的字典列缺失不阻塞', () => {
  const parsed = parseCsv('value,path\r\n120,model.warrior.attack')

  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(autoMapColumns(parsed.headers), ['value', 'path'])

  const missingOptional = parseCsv('path,value\r\nmodel.warrior.attack,120')
  assert.deepEqual(missingOptional.errors, [])
  assert.deepEqual(autoMapColumns(missingOptional.headers), ['path', 'value'])
})

test('CSV 参数导入:缺必需表头、缺数据行给出明确报告', () => {
  assert.ok(parseCsv('path\r\nmodel.warrior.attack').errors.some(
    (error) => error.line === 1 && error.reason === 'missing required header: value',
  ))
  assert.ok(parseCsv('').errors.some(
    (error) => error.line === 1 && error.reason === 'CSV is empty',
  ))
  assert.ok(parseCsv('path,value').errors.some(
    (error) => error.line === 1 && error.reason === 'CSV has no data rows',
  ))
})

test('CSV 参数导入:宽表按 registry 路径自动映射,未知表头保持未映射', () => {
  const headers = ['model.warrior.attack', 'unknown.column', 'model.gacha.base_rate']
  const mapping = autoMapColumns(headers)

  assert.equal(mapping[0], 'model.warrior.attack')
  assert.equal(mapping[1], null)
  assert.equal(mapping[2], 'model.gacha.base_rate')
})

test('CSV 参数导入:百分比转原生比率,不支持的转换明确失败', () => {
  const probability = registryParam('model.gacha.base_rate')
  const duration = registryParam('scenario.duration')

  assert.equal(transformParamImportValue(probability, '50%', 'percent'), '0.5')
  assert.equal(transformParamImportValue(probability, '25', 'percent'), '0.25')
  assert.equal(transformParamImportValue(duration, '45d', 'days'), '45d')
  assert.equal(transformParamImportValue(probability, '150', 'percent'), null)
  assert.equal(transformParamImportValue(probability, '30d', 'days'), null)
})

test('CSV 参数导入:差异预览逐项报告缺值/当前值/导入值,只输出有变化的 edits', () => {
  const preview = previewParamImport(
    rows,
    parseCsv([
      'model.warrior.attack,model.gacha.base_rate',
      '120,0.25',
    ].join('\r\n')),
    autoMapColumns(['model.warrior.attack', 'model.gacha.base_rate']),
  )

  assert.equal(preview.ok, true)
  assert.deepEqual(preview.reports, [
    { line: 2, path: 'model.warrior.attack', reason: null },
    { line: 2, path: 'model.gacha.base_rate', reason: null },
  ])
  assert.deepEqual(preview.rows, [
    {
      line: 2,
      path: 'model.warrior.attack',
      currentValue: '100',
      importValue: '120',
      changed: true,
    },
    {
      line: 2,
      path: 'model.gacha.base_rate',
      currentValue: '(missing)',
      importValue: '0.25',
      changed: true,
    },
  ])
  assert.equal(preview.edits.length, 2)
})

test('CSV 参数导入:未知路径、空值、不兼容单位逐行入错误报告且不生成 edits', () => {
  const preview = previewParamImport(
    rows,
    parseCsv([
      'model.unknown.path,model.warrior.attack,model.gacha.base_rate',
      '30,,150%',
    ].join('\r\n')),
    autoMapColumns([
      'model.unknown.path',
      'model.warrior.attack',
      'model.gacha.base_rate',
    ]),
    { 'model.gacha.base_rate': 'percent' },
  )

  assert.equal(preview.ok, false)
  assert.deepEqual(preview.edits, [])
  assert.deepEqual(preview.reports.map((report) => ({
    line: report.line,
    path: report.path,
  })), [
    { line: 2, path: 'model.warrior.attack' },
    { line: 2, path: 'model.gacha.base_rate' },
  ])
  assert.ok(preview.reports.every((report) => report.reason !== null))
})

test('CSV 参数导入:模板重复路径整批失败,空值仍逐行报告', () => {
  const preview = previewParamImport(
    rows,
    parseCsv([
      'path,value',
      'model.warrior.attack,120',
      'model.warrior.attack,130',
      'model.warrior.attack,',
    ].join('\n')),
    ['path', 'value'],
  )

  assert.equal(preview.ok, false)
  assert.deepEqual(preview.edits, [])
  assert.ok(preview.reports.some((report) => report.line === 3 && report.reason.includes('duplicate path')))
  assert.ok(preview.reports.some((report) => report.line === 4 && report.reason.includes('value is empty')))
})

test('CSV 参数导入:引号内换行仍归入同一条记录', () => {
  const parsed = parseCsv([
    'path,value',
    'model.warrior.attack,"120\n130"',
  ].join('\n'))

  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(parsed.headers, ['path', 'value'])
  assert.deepEqual(parsed.rows, [['model.warrior.attack', '120\n130']])
})

test('CSV 参数导入:XLSX 只读首个工作表并保留 CSV 语义', async () => {
  const shared = zipEntry('xl/sharedStrings.xml', [
    '<?xml version="1.0"?><sst count="3" uniqueCount="3">',
    '<si><t>model.warrior.attack</t></si>',
    '<si><t>model.gacha.base_rate</t></si>',
    '<si><t>50</t></si>',
    '</sst>',
  ].join(''))
  const workbook = zipEntry('xl/workbook.xml', '<?xml version="1.0"?><sheets><sheet name="A" r:id="rId1"/></sheets>')
  const rels = zipEntry('xl/_rels/workbook.xml.rels', [
    '<Relationships><Relationship Id="rId1"',
    ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"',
    ' Target="worksheets/sheet1.xml"/></Relationships>',
  ].join(''))
  const sheet = zipEntry('xl/worksheets/sheet1.xml', [
    '<sheetData>',
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
    '<row r="2"><c r="A2"><v>50</v></c><c r="B2" t="s"><v>2</v></c></row>',
    '</sheetData>',
  ].join(''))
  const workbookEntry = zipEntry('[Content_Types].xml', '<Types/>')
  const zip = zipFile([workbookEntry, rels, workbook, sheet, shared])
  const file = new File([zip], 'parameters.xlsx')
  const table = await parseParameterImportFile(file)

  assert.deepEqual(table.errors, [])
  assert.deepEqual(table.headers, ['model.warrior.attack', 'model.gacha.base_rate'])
  const preview = previewParamImport(rows, table, autoMapColumns(table.headers), {
    'model.gacha.base_rate': 'percent',
  })
  assert.equal(preview.ok, true)
  assert.deepEqual(preview.edits, [
    { path: 'model.warrior.attack', text: '50' },
    { path: 'model.gacha.base_rate', text: '0.5' },
  ])
})

test('CSV 模板表头是机器 schema,注册表每行只出现一次', () => {
  const text = 'path,value,type,unit,source\r\n'
    + PARAM_REGISTRY.map((param) => `${param.path},,${param.kind},,registry`).join('\r\n')
  const parsed = parseCsv(text)

  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(autoMapColumns(parsed.headers), ['path', 'value', null, null, null])
  assert.equal(parsed.rows.length, PARAM_REGISTRY.length)
})
