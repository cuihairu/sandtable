// P1 · 公式编辑预检:白名单/语法、引用提示与示例求值。
export type FormulaIssue = { readonly message: string }

export type FormulaReport = {
  readonly issues: readonly FormulaIssue[]
  readonly references: readonly string[]
  readonly valid: boolean
}

export type FormulaPasteRow = {
  readonly line: number | null
  readonly expression: string | null
  readonly message: string | null
}

export type PastedFormula = {
  readonly expressions: readonly string[]
  readonly reports: readonly FormulaPasteRow[]
  readonly valid: boolean
}

/** TSV 优先、单字符 CSV 逐行判定;单列表头跳过,坏表达式保留报告。 */
export function parseFormulaPaste(text: string): PastedFormula {
  const reports: FormulaPasteRow[] = []
  const expressions: string[] = []
  let headerSeen = false
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (const [index, rawLine] of lines.entries()) {
    const line = index + 1
    const trimmed = rawLine.trim()
    if (trimmed === '') continue
    const cells = trimmed.includes('\t')
      ? trimmed.split('\t')
      : trimmed.includes(',') ? trimmed.split(',') : [trimmed]
    const expression = cells.map((cell) => cell.trim()).filter((cell) => cell !== '').join(' ')
    if (!headerSeen && expression.toLowerCase() === 'formula') {
      headerSeen = true
      continue
    }
    if (cells.length > 1) {
      reports.push({ line, expression: null, message: `公式应为一列,得到 ${cells.length} 列` })
      continue
    }
    expressions.push(expression)
    reports.push({ line, expression, message: null })
  }
  if (expressions.length === 0 && reports.length === 0) {
    reports.push({ line: null, expression: null, message: '粘贴内容为空' })
  }
  return { expressions, reports, valid: reports.every((report) => report.message === null) && expressions.length > 0 }
}

export const FORMULA_VARIABLES = ['level', 'xp_base', 'xp_pow'] as const
const BUILTIN_ARITY: Record<string, number> = {
  min: 2, max: 2, clamp: 3, floor: 1, ceil: 1, abs: 1, round: 1,
}

type Token =
  | { kind: 'number'; value: number; pos: number }
  | { kind: 'name'; value: string; pos: number }
  | { kind: 'operator'; value: string; pos: number }

/** 与内核公式同一优先级与语义;除零返回 0,布尔为 0/1。 */
export function evalFormula(source: string, env: Readonly<Record<typeof FORMULA_VARIABLES[number], number>>): number {
  const tokens = scan(source)
  if (tokens.length === 0) return Number.NaN
  let pos = 0
  const peek = () => tokens[pos]
  const eat = (value: string): boolean => {
    if (peek()?.kind === 'operator' && peek()?.value === value) { pos++; return true }
    return false
  }
  const expr = (): number => {
    const condition = or()
    if (eat('?')) { const thenValue = expr(); if (!eat(':')) return Number.NaN; const elseValue = expr(); return condition !== 0 ? thenValue : elseValue }
    return condition
  }
  const or = (): number => {
    let value = and()
    while (eat('||')) value = value !== 0 || and() !== 0 ? 1 : 0
    return value
  }
  const and = (): number => {
    let value = equality()
    while (eat('&&')) value = value !== 0 && equality() !== 0 ? 1 : 0
    return value
  }
  const equality = (): number => {
    let left = relational()
    while (peek()?.kind === 'operator' && (peek()?.value === '==' || peek()?.value === '!=')) {
      const operator = String(tokens[pos++].value)
      const right = relational()
      left = operator === '==' ? Number(left === right) : Number(left !== right)
    }
    return left
  }
  const relational = (): number => {
    let left = additive()
    while (peek()?.kind === 'operator' && (['<', '<=', '>', '>='] as const).includes(peek()?.value as '<' | '<=' | '>' | '>=')) {
      const operator = String(tokens[pos++].value)
      const right = additive()
      left = Number(operator === '<' ? left < right : operator === '<=' ? left <= right : operator === '>' ? left > right : left >= right)
    }
    return left
  }
  const additive = (): number => {
    let value = multiplicative()
    while (peek()?.kind === 'operator' && (peek()?.value === '+' || peek()?.value === '-')) {
      const operator = tokens[pos++].value
      value = operator === '+' ? value + multiplicative() : value - multiplicative()
    }
    return value
  }
  const multiplicative = (): number => {
    let value = unary()
    while (peek()?.kind === 'operator' && (['*', '/', '%'] as const).includes(peek()?.value as '*' | '/' | '%')) {
      const operator = tokens[pos++].value
      const right = unary()
      if (operator === '*') value *= right
      else if ((operator === '/' || operator === '%') && right === 0) value = 0
      else value = operator === '/' ? value / right : value % right
    }
    return value
  }
  const unary = (): number => {
    if (eat('-')) return -unary()
    if (eat('!')) return unary() === 0 ? 1 : 0
    return power()
  }
  const power = (): number => {
    const base = primary()
    if (eat('^')) return base ** unary()
    return base
  }
  const primary = (): number => {
    const token = peek()
    if (!token) return Number.NaN
    if (token.kind === 'number') { pos++; return token.value }
    if (token.kind === 'name') {
      pos++
      if (eat('(')) {
        const args: number[] = []
        if (!eat(')')) {
          do { args.push(expr()) } while (eat(','))
          if (!eat(')')) return Number.NaN
        }
        const arity = BUILTIN_ARITY[token.value]
        if (arity !== args.length) return Number.NaN
        const [a, b, c] = args
        switch (token.value) {
          case 'min': return Math.min(a, b)
          case 'max': return Math.max(a, b)
          case 'clamp': return Math.min(Math.max(a, b), c)
          case 'floor': return Math.floor(a)
          case 'ceil': return Math.ceil(a)
          case 'abs': return Math.abs(a)
          case 'round': return Math.round(a)
          default: return Number.NaN
        }
      }
      return FORMULA_VARIABLES.includes(token.value as typeof FORMULA_VARIABLES[number])
        ? env[token.value as typeof FORMULA_VARIABLES[number]]
        : Number.NaN
    }
    if (eat('(')) { const value = expr(); return eat(')') ? value : Number.NaN }
    return Number.NaN
  }
  const value = expr()
  return pos === tokens.length ? value : Number.NaN
}

export function reviewFormula(source: string): FormulaReport {
  const issues: FormulaIssue[] = []
  const references: string[] = []
  if (source.trim() === '') issues.push({ message: '公式为空' })
  if (source.length > 512) issues.push({ message: '公式超过 512 字符上限' })
  try {
    const tokens = scan(source)
    for (const token of tokens) {
      if (token.kind !== 'name' || BUILTIN_ARITY[token.value] !== undefined) continue
      if (FORMULA_VARIABLES.includes(token.value as typeof FORMULA_VARIABLES[number])) {
        if (!references.includes(token.value)) references.push(token.value)
      } else issues.push({ message: `未知变量:${token.value}(可用 ${FORMULA_VARIABLES.join(', ')})` })
    }
    const value = evalFormula(source, { level: 1, xp_base: 1, xp_pow: 1 })
    if (!Number.isFinite(value) || Number.isNaN(value)) issues.push({ message: '语法不完整或函数实参数量错误' })
    else if (value <= 0) issues.push({ message: '示例求值必须为正(内核要求 xp_needed 恒为正)' })
  } catch (error) {
    issues.push({ message: error instanceof Error ? error.message : '公式无效' })
  }
  return { issues, references, valid: issues.length === 0 }
}

function scan(source: string): Token[] {
  const out: Token[] = []
  let index = 0
  while (index < source.length) {
    const char = source[index]
    if (/\s/.test(char)) { index++; continue }
    if (/[0-9.]/.test(char)) {
      const start = index
      while (index < source.length && /[0-9.eE+-]/.test(source[index])) index++
      out.push({ kind: 'number', value: Number(source.slice(start, index)), pos: start })
      continue
    }
    if (/[A-Za-z_]/.test(char)) {
      const start = index
      while (index < source.length && /[A-Za-z0-9_]/.test(source[index])) index++
      out.push({ kind: 'name', value: source.slice(start, index), pos: start })
      continue
    }
    const pair = source.slice(index, index + 2)
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(pair)) { out.push({ kind: 'operator', value: pair, pos: index }); index += 2; continue }
    if ('+-*/%^()<>!?:,'.includes(char)) { out.push({ kind: 'operator', value: char, pos: index }); index++; continue }
    throw new Error(`位置 ${index + 1}: 意外的字符 ${JSON.stringify(char)}`)
  }
  return out
}
