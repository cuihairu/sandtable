// 图表与报告模板守卫(todo L381 批六):报告模板有可引用的 id 与版本,
// 口径版本两层(模板 = 前端组版契约;schema / model / 指标字典 = 内核回传),
// 构成声明与产物 HTML 对账。锁:
// - 模板 id / 版本常量与 <meta> 落盘一致;
// - caliber 行:模板行恒在;内核版本缺失记 null 渲染「不可用」不造默认;
//   指标字典未知不造行;
// - 构成声明的每个小节 testid 在产物 HTML 里真实存在(增删小节须同步版本);
// - 图表与同范围数据表成对出现(模板红线:每张图旁都有精确值表)。
import test from 'node:test'
import assert from 'node:assert/strict'

import { METRIC_KEYS } from '../src/lib/types.ts'
import { designReport } from '../src/lib/designReport.ts'
import { designReportHtml } from '../src/lib/designReportHtml.ts'
import {
  REPORT_TEMPLATE_ID,
  REPORT_TEMPLATE_SECTIONS,
  REPORT_TEMPLATE_VERSION,
  buildCaliberRows,
} from '../src/lib/reportTemplate.ts'
import { zh } from '../src/lib/i18n/dict/zh.ts'
import { en } from '../src/lib/i18n/dict/en.ts'

const CALIBER_KEYS = [
  'report.templateSection',
  'report.colCaliberItem',
  'report.colCaliberValue',
  'report.colCaliberOrigin',
  'report.caliberTemplate',
  'report.caliberSchema',
  'report.caliberModel',
  'report.caliberDict',
  'report.caliberNote',
]

const stats = (mean) => ({ n: 2, mean, sd: 0.01, ci95_lo: mean - 0.01, ci95_hi: mean + 0.01, min: mean, max: mean })
const METRIC_STATS = METRIC_KEYS.map((metric, index) => [metric, stats(0.1 + index * 0.05)])

const AXIS_PATH = 'gacha.rate'
// 单轴 + 单候选:产物带真实参数差异,构成声明里的参数差异小节才落锚
const artifact = (runId, modelVersion, axisValue) => JSON.stringify({
  data_source: 'kernel',
  run_id: runId,
  status: 'succeeded',
  version: { model_version: modelVersion, schema_version: '1' },
  source: { data_source: 'kernel', registered: true, experiment_id: 'exp_tmpl0001', seed: 7, created_at_unix: 42 },
  spec: { kind: 'sweep', yaml: '' },
  plan: { config_hash: 'plan-hash', players: 40, days: 3, base_seed: 7, replicates: 2, mode: 'grid', axes: [{ path: AXIS_PATH }], candidates: [{ [AXIS_PATH]: axisValue }], targets: [{ metric: 'win_rate', kind: 'hard', min: 0, max: 1 }], sims: 2 },
  results: [{ values: {}, status: 'ok', metric_stats: METRIC_STATS, target_outcomes: [] }],
  export_scope: { scope: 'all', candidates: 1, total: 1 },
})

const source = {
  runId: 'run_tmpl_candidate',
  runStatus: 'succeeded',
  artifactPath: 'results/run_tmpl_candidate.report.json',
  artifactText: artifact('run_tmpl_candidate', 'model-tmpl-a', 2.5),
  index: { experiment_id: 'exp_tmpl0001', config_hash: 'candidate-hash', seed: 7, created_at_unix: 42 },
  population: 40,
  days: 3,
}
const baseline = {
  runId: 'run_tmpl_baseline',
  artifactPath: 'results/run_tmpl_baseline.report.json',
  artifactText: artifact('run_tmpl_baseline', 'model-tmpl-baseline', 1.5),
}

test('P2 报告模板:模板身份与构成声明(小节锚唯一且真实存在)', () => {
  assert.equal(REPORT_TEMPLATE_ID, 'sandtable-design-report')
  assert.match(REPORT_TEMPLATE_ID, /^sandtable-[a-z-]+$/)
  assert.match(REPORT_TEMPLATE_VERSION, /^\d+$/, '模板版本是可引用的契约号')

  const ids = REPORT_TEMPLATE_SECTIONS.map((section) => section.id)
  const testids = REPORT_TEMPLATE_SECTIONS.map((section) => section.testid).filter(Boolean)
  assert.equal(new Set(ids).size, ids.length, '小节 id 唯一')
  assert.equal(new Set(testids).size, testids.length, '小节 testid 唯一')
  for (const section of REPORT_TEMPLATE_SECTIONS) {
    assert.ok(section.heading in zh, `${section.id} 标题词典键存在(zh)`)
    assert.ok(section.heading in en, `${section.id} 标题词典键存在(en)`)
  }
  for (const testid of testids) {
    assert.match(testid, /^report-[a-z-]+$/, `小节 testid 命名不一致:${testid}`)
  }
  assert.ok(testids.includes('report-caliber'), '模板构成须含口径小节')
})

test('P2 报告模板:口径版本词典键齐全(中英镜像)', () => {
  for (const key of CALIBER_KEYS) {
    assert.ok(key in zh, `zh 缺词条 ${key}`)
    assert.ok(key in en, `en 缺词条 ${key}`)
    assert.ok(zh[key].length > 0, `${key} zh 空串`)
    assert.ok(en[key].length > 0, `${key} en 空串`)
  }
})

test('P2 口径行:模板行恒在,内核版本缺失记 null,字典未知不造行', () => {
  const empty = buildCaliberRows([], null)
  assert.equal(empty.length, 1)
  assert.deepEqual(empty[0], { key: 'template', value: `${REPORT_TEMPLATE_ID} v${REPORT_TEMPLATE_VERSION}`, origin: 'template' })

  const withRun = buildCaliberRows([{ runId: 'r1', schemaVersion: '1', modelVersion: null }], '1')
  assert.equal(withRun.length, 4, '1 个来源 = 模板 + schema + model + 字典')
  assert.equal(withRun[1].key, 'schema')
  assert.equal(withRun[1].value, '1')
  assert.equal(withRun[1].origin, 'r1')
  assert.equal(withRun[2].key, 'model')
  assert.equal(withRun[2].value, null, '缺失版本保持 null,不造默认')
  assert.equal(withRun[2].origin, 'r1')
  assert.equal(withRun[3].key, 'dict')
  assert.equal(withRun[3].value, '1')
  assert.equal(withRun[3].origin, 'metric_dictionary')

  const withoutDict = buildCaliberRows([{ runId: 'r1', schemaVersion: '1', modelVersion: 'm' }], null)
  assert.ok(withoutDict.every((row) => row.key !== 'dict'), '字典未知不造行')
  assert.equal(withoutDict.length, 3)
})

test('P2 报告模型携带模板身份与口径行', () => {
  const withDict = designReport(source, null, 'zh-CN', '1')
  assert.deepEqual(withDict.template, { id: REPORT_TEMPLATE_ID, version: REPORT_TEMPLATE_VERSION })
  assert.equal(withDict.caliber[0].key, 'template')
  assert.equal(withDict.caliber[0].value, `${REPORT_TEMPLATE_ID} v${REPORT_TEMPLATE_VERSION}`)
  assert.equal(withDict.caliber.length, 4, '单来源 + 字典 = 模板 / schema / model / 字典')
  assert.equal(withDict.caliber.at(-1).key, 'dict')
  assert.equal(withDict.caliber.at(-1).value, '1')

  const noDict = designReport(source, null, 'zh-CN')
  assert.ok(noDict.caliber.every((row) => row.key !== 'dict'), '未取到字典版本 → 无字典行')
  assert.equal(noDict.caliber.length, 3)
  assert.equal(noDict.caliber[1].value, '1', 'schema 版本取自产物')
})

test('P2 报告 HTML:模板版本落 meta,口径小节在场,图与数据表成对', () => {
  const html = designReportHtml(designReport(source, baseline, 'zh-CN', '1'))

  const metas = [...html.matchAll(/<meta name="sandtable-report-template" content="([^"]+)">/g)]
  assert.equal(metas.length, 1, '模板版本 meta 恰好一条')
  assert.equal(metas[0][1], `${REPORT_TEMPLATE_ID}/${REPORT_TEMPLATE_VERSION}`)

  for (const section of REPORT_TEMPLATE_SECTIONS) {
    assert.ok(html.includes(zh[section.heading]), `模板构成的小节标题未出现在产物:${section.id}`)
    if (section.testid !== null) {
      assert.ok(html.includes(`data-testid="${section.testid}"`), `模板构成的小节锚未出现在产物:${section.testid}`)
    }
  }

  // 条件小节:数据在场落锚,数据缺席时标题仍在、改出原因,不造空表
  assert.ok(html.includes('data-testid="report-parameter-diff"'), '有基线且轴一致时参数差异小节落锚')
  assert.match(html, /<td class="mono">gacha\.rate<\/td><td>1\.5<\/td><td>2\.5<\/td>/, '参数差异上屏基线与候选原值')
  assert.ok(html.includes('data-testid="report-conditions"'), '运行条件小节落锚')

  // 口径小节:三列表头 + 模板值 + 缺失版本渲染「不可用」
  assert.ok(html.includes('data-testid="report-caliber"'), '口径小节在场')
  for (const key of ['report.colCaliberItem', 'report.colCaliberValue', 'report.colCaliberOrigin']) {
    assert.ok(html.includes(zh[key]), `口径表列头缺失:${key}`)
  }
  assert.ok(html.includes(`${REPORT_TEMPLATE_ID} v${REPORT_TEMPLATE_VERSION}`), '模板值上屏')
  assert.ok(html.includes(zh['common.unavailable']), '缺失值渲染为不可用而非空串')

  // 模板红线:每张图旁边都有同范围精确值数据表
  // 条件小节:无基线时不出表,改出原因(role=alert),标题仍在
  const noBaseline = designReportHtml(designReport(source, null, 'zh-CN', '1'))
  assert.ok(noBaseline.includes(zh['report.sectionDiff']))
  assert.ok(!noBaseline.includes('data-testid="report-parameter-diff"'))
  assert.ok(noBaseline.includes('role="alert"'), '缺基线时出原因而非空表')

  const charts = html.match(/<svg data-testid="report-chart" /g) ?? []
  const pairedTables = html.match(/<table data-testid="report-table">/g) ?? []
  assert.ok(charts.length > 0, '报告应含图表')
  assert.equal(charts.length, pairedTables.length, '图与数据表成对(同范围精确值)')
})

test('P2 报告 HTML:英文模板同结构,口径词组走英文词典', () => {
  const html = designReportHtml(designReport(source, null, 'en-US', '1'))
  assert.ok(html.includes('lang="en-US"'))
  assert.ok(html.includes(en['report.templateSection']))
  assert.ok(html.includes(en['report.colCaliberValue']))
  assert.ok(html.includes(`${REPORT_TEMPLATE_ID} v${REPORT_TEMPLATE_VERSION}`))
})
