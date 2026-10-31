// V2 设计 token 守卫(节点侧,CI web job 跑):src/tokens.css 是原型与设计
// 系统的正式化层——原型 workbench.css :root 的每个 token 必须以 --wb- 前缀
// 原值收录(迁移期漂移 = 守卫红),语义色与字阶/间距取自
// design-system/sandtable/MASTER.md「视觉 token」节;文件只允许 :root 声明块
// (零元素规则 ⇒ 对现役 Phase 6 界面零视觉影响,面改版 WB-02.02+ 才消费)。
// 跑法(仓库根):node --test apps/web/tests/tokens.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (p) => readFileSync(join(here, '..', p), 'utf8')

/** 抽一个声明块里的 custom property(值内空白折叠为一格)。 */
function customProps(block) {
  const out = new Map()
  for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;}]+)/g)) {
    out.set(name, value.replace(/\s+/g, ' ').trim())
  }
  return out
}

function rootBlock(css, label) {
  const m = css.match(/:root\s*\{([^}]*)\}/)
  assert.ok(m, `${label} 缺 :root 块`)
  return m[1]
}

const proto = customProps(rootBlock(read('public/prototype/workbench.css'), '原型'))
const tokens = customProps(read('src/tokens.css'))

test('原型 :root 每个 token 以 --wb- 前缀原值收录', () => {
  assert.ok(proto.size >= 15, `原型 :root 应有 ≥15 个 token,实测 ${proto.size}`)
  for (const [name, value] of proto) {
    const mine = tokens.get(`--wb-${name.slice(2)}`)
    assert.ok(mine !== undefined, `缺 --wb-${name.slice(2)}(原型 ${name})`)
    assert.equal(mine, value, `${name} 取值漂移:原型 ${value},tokens.css ${mine}`)
  }
})

test('原型 :root 字体栈与 --wb-font-ui 一致(无外部字体请求纪律)', () => {
  const stack = rootBlock(read('public/prototype/workbench.css'), '原型')
    .match(/font-family\s*:\s*([^;}]+)/)?.[1]
  assert.ok(stack, '原型 :root 缺 font-family')
  const norm = (s) => s.replace(/\s+/g, '').replace(/["']/g, '').toLowerCase()
  assert.equal(norm(tokens.get('--wb-font-ui') ?? ''), norm(stack))
})

test('MASTER.md 语义色与字阶/间距必有且取值正确', () => {
  const required = {
    '--wb-app-bar': '#222c30', // 应用栏
    '--wb-rail': '#29353b', // 功能轨
    '--wb-explorer': '#f2f5f6', // 项目浏览器
    '--wb-canvas': '#fff', // 数据画布
    '--wb-ink': '#293539', // 正文
    '--wb-muted': '#617178', // 辅助文字
    '--wb-line': '#d8e0e3', // 边框
    '--wb-teal': '#087f86', // 主要操作 / 数据点
    '--wb-selected-candidate': '#ba7e20', // 选中候选
    '--wb-selected-row': '#eaf5f5', // 选中表格行
    '--wb-verdict-pass': '#28724e', // 通过
    '--wb-verdict-border': '#95610e', // 临界
    '--wb-verdict-fail': '#9c4c46', // 未通过
    '--wb-fs-body': '13px', // 正文
    '--wb-fs-table': '12px', // 表格
    '--wb-fs-title': '19px', // 工作区标题
    '--wb-space-1': '4px', // 基础间距
    '--wb-radius-sm': '3px',
    '--wb-radius-md': '4px',
    '--wb-control-h': '32px', // 按钮最小高
  }
  for (const [name, value] of Object.entries(required)) {
    assert.equal(tokens.get(name), value, `${name} 应为 ${value}`)
  }
})

test('token 全部带 --wb- 前缀且无重复定义', () => {
  const css = read('src/tokens.css')
  for (const name of tokens.keys()) {
    assert.ok(name.startsWith('--wb-'), `V2 token 须带 --wb- 前缀: ${name}`)
  }
  const decls = [...css.matchAll(/--[a-z0-9-]+(?=\s*:)/g)].map((m) => m[0])
  assert.equal(new Set(decls).size, decls.length, '存在重复定义的 token')
})

test('tokens.css 只含 :root 声明块(零元素规则)', () => {
  const stripped = read('src/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const m of stripped.matchAll(/([^{}/]+)\{/g)) {
    assert.equal(m[1].trim(), ':root', `只允许 :root 选择器,见「${m[1].trim()}」`)
  }
})
