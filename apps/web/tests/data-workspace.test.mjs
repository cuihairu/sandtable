// WB-09.06 · 数据工作区产物语义锁:report.json 形状与 CLI 同构(main.rs
// meta_json 同口径),days.csv 原样透传,Parquet 与 days 同源——三个操作
// 在 App 源级守卫;reportJson 抽到 lib/reportArtifact(node 可直 import)。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { reportJson } from '../src/lib/reportArtifact.ts'

const OUT = {
  config_hash: 'hash_ws_0001',
  meta: { schema_version: '1', model_version: 'demo-model-1' },
  results: [
    {
      config_hash: 'hash_ws_0001',
      replicate: 0,
      seed: 7,
      win_rate: 0.534,
      day_stats: [{ day: 1, active: 99 }],
    },
  ],
  days_csv: 'day,active\r\n1,99\r\n',
}

test('WB-09.06:reportJson 形状与 CLI 同构——meta 四环境字段 + results 原样透传', () => {
  const parsed = JSON.parse(reportJson(OUT))
  assert.deepEqual(
    Object.keys(parsed),
    ['meta', 'results'],
    '顶层只有 meta + results(config_hash 随 results 条目携带,不在顶层)',
  )
  assert.deepEqual(Object.keys(parsed.meta), [
    'generated_at_unix',
    'git_sha',
    'schema_version',
    'model_version',
  ])
  assert.deepEqual(parsed.results, OUT.results, 'results 原样透传,不重算不删字段')
  assert.equal(parsed.meta.schema_version, '1')
  assert.equal(parsed.meta.model_version, 'demo-model-1')
})

test('WB-09.06:环境字段不参与确定性——同 out 两次导出 results 逐位一致', () => {
  const a = JSON.parse(reportJson(OUT))
  const b = JSON.parse(reportJson(OUT))
  assert.deepEqual(a.results, b.results, '时间戳等环境字段不影响 results')
  assert.ok(Number.isInteger(a.meta.generated_at_unix), '时间戳是秒级整数')
  assert.ok(Math.abs(Date.now() / 1000 - a.meta.generated_at_unix) < 60, '时间戳取导出时刻')
  // node 无 import.meta.env → git_sha 回退 unknown(与 CLI 未设 SANDTABLE_GIT_SHA 同)
  assert.equal(a.meta.git_sha, 'unknown')
})

test('WB-09.06:数据工作区继续提供 days.csv / report.json / days.parquet 三个操作', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  // days.csv:内核 days_csv 原样落盘,JS 不重拼(边界就是 download 的入参;
  // 与 CLI 逐字节一致由 Rust web_parity 锁死,这里锁前端不改写)
  assert.ok(app.includes("download(out.days_csv, 'days.csv', 'text/csv')"), 'days.csv 原样透传内核产物')
  assert.ok(!/days_csv[^)]*\.split\(/.test(app), 'JS 不对 days_csv 重拼浮点')
  assert.ok(
    app.includes("download(reportJson(out), 'report.json', 'application/json')"),
    'report.json 走单点 reportArtifact',
  )
  assert.ok(app.includes("exportCsvAsParquet(out.days_csv, 'days')"), 'Parquet 与 days.csv 同源(同一份按天数据)')
  assert.ok(app.includes("download(buf, 'days.parquet', 'application/octet-stream')"), 'Parquet 产物名固定 days.parquet')
})
