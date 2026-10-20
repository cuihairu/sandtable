// WB-10.14 · 默认入口切换守卫:挂载判定是纯逻辑,这里逐值断言无 hash、
// 任意非 legacy hash、工作台深链与 legacy 深链的入口归属,以及 main.tsx
// 与该判定和组件的真实接线。旧应用自身无 hash 链接,#/legacy 后缀不被改写。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { entryRoute, legacyHash } from '../src/entryRoute.ts'

test('默认入口:无 hash 与任意非 legacy hash 渲染 V2 工作台', () => {
  assert.equal(entryRoute(''), 'workbench')
  assert.equal(entryRoute('#'), 'workbench')
  assert.equal(entryRoute('#analysis'), 'workbench')
  assert.equal(entryRoute('#/'), 'workbench')

  const source = readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')
  assert.match(source, /entryRoute\(window\.location\.hash\)/)
  assert.match(source, /route === 'workbench' \? <WorkbenchApp \/> : <App \/>/)
  assert.doesNotMatch(source, /useWorkbench/)
})

test('legacy 深链:渲染旧应用且内部入口不自改根 hash', () => {
  assert.equal(entryRoute('#/legacy'), 'legacy')
  assert.equal(entryRoute('#/legacy/analysis'), 'legacy')
  assert.equal(legacyHash('#/legacy/analysis'), '#/legacy/analysis')

  const source = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /location\.hash|href="#\/?"/)
})

test('workbench 深链:parameters 直达且路由前缀仍生效', () => {
  assert.equal(entryRoute('#/workbench/parameters'), 'workbench')
  assert.equal(legacyHash('#/workbench/parameters'), '#/legacy')
})
