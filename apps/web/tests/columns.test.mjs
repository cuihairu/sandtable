// 列式化守卫(节点侧,CI web job 跑):锁死 2026-10-13 WebKit 崩溃修复的
// 序列化边界——Arrow Int64 列 toArray() 出 BigInt,WebKit(JSC)流向 React
// 渲染即 throw「Invalid argument type in ToBigInt operation」(整页白屏,
// ErrorBoundary 兜出文案才定位);toColumns 边界必须归一 number。回归 =
// 守卫红,不等又一次无头走查。纯函数模块,无需 wasm。
// 跑法(仓库根):node --test apps/web/tests/columns.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { tableName, toColumns } from '../src/lib/columns.ts'

/** 造一个最小 Arrow 结果表替身:getChild().toArray() 的返回即列值。 */
function fakeTable(columns) {
  return {
    schema: { fields: columns.map(([name]) => ({ name })) },
    getChild: (name) => {
      const hit = columns.find(([n]) => n === name)
      return hit ? { toArray: () => hit[1] } : null
    },
  }
}

test('BigInt 列归一为 number(WebKit ToBigInt 崩溃边界)', () => {
  const out = toColumns(fakeTable([
    ['day', [0n, 1n, 30n]],
    ['active', [2999n, 2990n, 2500n]],
  ]))
  assert.equal(out.length, 2)
  assert.deepEqual(out[0], { name: 'day', values: [0, 1, 30] })
  for (const v of out[1].values) assert.equal(typeof v, 'number')
})

test('字符串与 null 原样透传,不误转数字', () => {
  const out = toColumns(fakeTable([
    ['tag', ['core', 'whale', null]],
    ['churn', [0.1, null, 0]],
  ]))
  assert.deepEqual(out[0].values, ['core', 'whale', null])
  assert.deepEqual(out[1].values, [0.1, null, 0])
})

test('缺列返回空数组(防御:结果表结构异常不 throw)', () => {
  const out = toColumns(fakeTable([['a', [1n]]]))
  assert.deepEqual(out[0].values, [1])
  assert.deepEqual(
    toColumns({ schema: { fields: [{ name: 'ghost' }] }, getChild: () => null })[0].values,
    [],
  )
})

test('视图名:词根提取 / 非法字符 / 冲突加序号 / 非字母开头加前缀', () => {
  assert.equal(tableName('days.csv', new Set()), 'days')
  assert.equal(tableName('run/2026/days.parquet', new Set()), 'days')
  assert.equal(tableName('win\\path\\summary.csv', new Set()), 'summary')
  assert.equal(tableName('a-b.csv', new Set()), 'a_b')
  assert.equal(tableName('2026days.csv', new Set()), 't_2026days')
  assert.equal(tableName('days.csv', new Set(['days'])), 'days_2')
  assert.equal(tableName('days.csv', new Set(['days', 'days_2'])), 'days_3')
})
