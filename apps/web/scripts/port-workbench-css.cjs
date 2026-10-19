// 一次性迁移脚本:原型 public/prototype/workbench.css → src/workbench/workbench.css
// (WB-02.02 React 壳消费)。规则:
// - 去掉 :root 块(token 已由 src/tokens.css --wb- 前缀正式化);
// - var(--x) → var(--wb-x) 机械映射;.desktop 壳根与 .wb-app 合一;
// - 其余选择器全部加 .wb-app 作用域,避免与现役 index.css 的元素级规则
//   (button/table/h1…)互相污染;@media 内部递归处理;
// - html/body/驼峰嵌套局部规则丢弃(壳根自带字体/背景/盒模型)。
// 原型保持只读设计参考;手工微调直接改目标文件。
const fs = require('fs')

let css = fs.readFileSync('apps/web/public/prototype/workbench.css', 'utf8')
css = css.replace(/:root\s*\{[^}]*\}\s*/, '')

for (const n of [
  'ink', 'muted', 'line', 'soft-line', 'canvas', 'surface', 'teal', 'teal-dark',
  'teal-pale', 'selected', 'amber', 'amber-pale', 'red', 'red-pale', 'green', 'mono',
]) {
  css = css.split(`var(--${n})`).join(`var(--wb-${n})`)
}
// 壳根合一(含 @media 内 recurrence 前的原文)与注释清理
css = css.replace(/\/\*[\s\S]*?\*\//g, '')
css = css.split('.desktop.explorer-collapsed').join('.SHELL.explorer-collapsed')
css = css.split('.desktop').join('.SHELL')

// 把整份 CSS 切成 [前导文本, selector, body] 三元组流(无嵌套花括号的值,够用)
function transform(text, scope) {
  let out = ''
  let rest = text
  for (;;) {
    const open = rest.indexOf('{')
    if (open === -1) {
      out += rest
      break
    }
    let head = rest.slice(0, open)
    // 找配对右括号
    let depth = 1
    let i = open + 1
    while (depth > 0 && i < rest.length) {
      if (rest[i] === '{') depth++
      else if (rest[i] === '}') depth--
      i++
    }
    const body = rest.slice(open + 1, i - 1)
    rest = rest.slice(i)
    const atMatch = /^\s*@([a-z-]+)\s*([^{]*)$/.exec(head)
    if (atMatch) {
      // @media/:prefers 等包裹规则:递归内部
      out += `${head.slice(head.indexOf('@'))}{${transform(body, scope)}}`
      continue
    }
    if (/^\s*@(keyframes|font-face|supports|property)/.test(head)) {
      out += `${head.trim()}{${body}}`
      continue
    }
    const parts = head
      .split(',')
      .map((s0) => s0.trim())
      .filter(Boolean)
      .map((s) => {
        if (s.startsWith('.SHELL')) return `.wb-app${s.slice(6)}`
        if (/^(html\b|body\b)/.test(s)) return null
        return `${scope} ${s}`
      })
      .filter(Boolean)
    if (parts.length === 0) continue
    out += `${parts.join(',')}{${body}}`
  }
  return out
}

const scoped = transform(css, '.wb-app')
fs.writeFileSync('apps/web/src/workbench/workbench.css', scoped)
console.log('written', scoped.length, 'bytes')
