// WB-05 · 配置 YAML ↔ 参数表桥接(纯逻辑,节点侧可测)。
// 职责:
// - 解析场景 YAML(子集解析器:嵌套映射 / 块序列 / 行内 flow / 引号 / 注释),
//   产出「注册路径 → 值 token 精确跨度」的叶表与节区间(WB-05.01 当前配置读取);
// - 编辑走「跨度替换 / 定向插入」外科手术,绝不整体重序列化——未编辑字节
//   (注释、damage_model、loot 表、公式、tier_table 等结构)逐字节保留
//   (WB-05.13 同步 / WB-05.15 round-trip);
// - 基线差异:绝对变化 + 相对变化;基线为 0 只给绝对值,不给无穷百分比
//   (WB-05.08 红线);
// - 缺值如实上报(缺值/未写入配置),不回退注册表默认值(WB-05.03 红线)。
// 内核是 YAML 的最终权威:本模块解析只为表格显示与定向编辑,任何应用前
// 都要过内核完整校验(paramsLogic.kernelCheck)。
import { PARAM_REGISTRY, registryParam } from './paramRegistry.ts'

export type TierTableRow = {
  hp: number
  attack: number
  defense: number
  /** null = 缺省,运行时回退锚点 × 产出增长率^tier */
  gold: number | null
  xp: number | null
}

export type StageRuleRow = {
  readonly from: number
  readonly to: string
  readonly effect: string
  readonly chance: number
}

export type YamlLeaf = {
  /** 点分注册路径(映射键拼接;序列内部键不生成路径) */
  path: string
  /** key 所在行(1-based) */
  line: number
  /** 值原文(引号剥离后;仅展示/数值解析用) */
  raw: string
  /** 值 token 在文档中的字符跨度 [start, end)(绝对偏移) */
  start: number
  end: number
  /** key token 起点(key..value 整段剪切用) */
  keyStart: number
  indent: number
  /** 值在行内 flow 映射里(删除需按 token 剪切) */
  inFlow: boolean
}

export type YamlBlock = {
  path: string
  startLine: number
  endLine: number
  indent: number
}

/** 行内 flow 映射的括号跨度(流内补键落点;偏移为文档绝对位置) */
export type YamlFlow = { path: string; open: number; close: number; line: number }

export type ParsedConfig = {
  leaves: YamlLeaf[]
  /** 映射节(块式;含 flow 值所在行)——插入缺失键时的落点 */
  sections: YamlBlock[]
  /** 块序列值整体(如 tier_table)——按结构参数处理,不生成子路径 */
  seqBlocks: YamlBlock[]
  flowMaps: YamlFlow[]
  errors: Array<{ line: number; message: string }>
}

/* ————— 基础工具 ————— */

/** 注释起点(行内偏移):# 前是行首或空白,且不在引号内;无则 -1。 */
function commentStart(line: string): number {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === '\'' || c === '"') {
      quote = c
    } else if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return i
    }
  }
  return -1
}

function unquote(text: string): string {
  const t = text.trim()
  if (t.length >= 2 && ((t[0] === '\'' && t[t.length - 1] === '\'') || (t[0] === '"' && t[t.length - 1] === '"'))) {
    return t.slice(1, -1)
  }
  return t
}

/* ————— 行内 flow(映射/序列)扫描 ————— */
// 约定:cursor 相对 text 起点;绝对偏移 = spanBase + cursor。

function skipWs(text: string, i: number): number {
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
  return i
}

function readFlowToken(text: string, i: number): { token: string; start: number; end: number } {
  // 读到深度 0 的 , / } / ] 为止;引号内字面读取
  let quote: string | null = null
  let depth = 0
  const start = i
  while (i < text.length) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '\'' || c === '"') {
      quote = c
    } else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') {
      if (depth === 0) break
      depth--
    } else if ((c === ',' || c === ':') && depth === 0) break
    i++
  }
  return { token: text.slice(start, i).trim(), start, end: i }
}

type FlowScan = { end: number; error: string | null }

/** 扫描行内 flow 值(text[0] 须为 { 或 [),登记叶路径与括号跨度(绝对偏移)。 */
function scanFlow(text: string, spanBase: number, prefix: string, line: number, out: ParsedConfig): FlowScan {
  let i = skipWs(text, 0)
  const open = text[i]
  if (open !== '{' && open !== '[') return { end: i, error: 'flow 值应以 { 或 [ 开头' }
  const close = open === '{' ? '}' : ']'
  const openAbs = spanBase + i
  i++
  for (;;) {
    i = skipWs(text, i)
    if (i >= text.length) return { end: i, error: `flow 未闭合(缺 ${close})` }
    if (text[i] === close) {
      if (open === '{') out.flowMaps.push({ path: prefix, open: openAbs, close: spanBase + i, line })
      return { end: i + 1, error: null }
    }
    if (open === '{') {
      const keyTok = readFlowToken(text, i)
      const key = unquote(keyTok.token)
      if (key === '' || key.includes(':')) return { end: i, error: `flow 键不合法:${key}` }
      let j = skipWs(text, keyTok.end)
      if (text[j] !== ':') return { end: j, error: `flow 项缺冒号:${key}` }
      j = skipWs(text, j + 1)
      if (text[j] === '{' || text[j] === '[') {
        const sub = scanFlow(text.slice(j), spanBase + j, `${prefix}.${key}`, line, out)
        if (sub.error) return sub
        i = j + sub.end
      } else {
        const val = readFlowToken(text, j)
        out.leaves.push({
          path: `${prefix}.${key}`,
          line,
          raw: unquote(val.token),
          start: spanBase + val.start,
          end: spanBase + val.end,
          keyStart: spanBase + keyTok.start,
          indent: -1,
          inFlow: true,
        })
        i = val.end
      }
      i = skipWs(text, i)
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === close) {
        out.flowMaps.push({ path: prefix, open: openAbs, close: spanBase + i, line })
        return { end: i + 1, error: null }
      }
      return { end: i, error: `flow 项之间应以逗号分隔(得到 ${JSON.stringify(text[i] ?? '')})` }
    }
    // [ ... ] 序列:整体不生成子路径(结构参数)
    const val = readFlowToken(text, i)
    i = val.end
    i = skipWs(text, i)
    if (text[i] === ',') {
      i++
      continue
    }
    if (text[i] === close) return { end: i + 1, error: null }
    return { end: i, error: 'flow 序列项之间应以逗号分隔' }
  }
}

/** flow 文本是否括号平衡(引号感知);未闭合返回 false。 */
function flowBalanced(text: string): boolean {
  let quote: string | null = null
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '\'' || c === '"') {
      quote = c
    } else if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') depth--
  }
  return depth <= 0
}

/* ————— 主解析 ————— */

/** 解析场景 YAML(子集):块映射/序列 + 行内 flow + 注释 + 引号标量。
 * 输出叶表(带精确跨度)与节区间;语法问题进 errors(不抛异常)。 */
export function parseConfig(yaml: string): ParsedConfig {
  const out: ParsedConfig = { leaves: [], sections: [], seqBlocks: [], flowMaps: [], errors: [] }
  const lines = yaml.split('\n')
  const lineStarts: number[] = []
  let off = 0
  for (const l of lines) {
    lineStarts.push(off)
    off += l.length + 1
  }
  type Frame = { indent: number; path: string }
  const stack: Frame[] = []
  let seqOpen: { path: string; indent: number; startLine: number; endLine: number } | null = null
  const flushSeq = (): void => {
    if (seqOpen) {
      out.seqBlocks.push({ ...seqOpen })
      seqOpen = null
    }
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const lineNo = idx + 1
    const rawLine = lines[idx]
    const cStart = commentStart(rawLine)
    const visible = (cStart === -1 ? rawLine : rawLine.slice(0, cStart)).replace(/\r$/, '')
    if (visible.trim() === '') continue
    const indent = (/^[ ]*/.exec(visible) as RegExpExecArray)[0].length
    if (visible[indent] === '\t') {
      out.errors.push({ line: lineNo, message: '缩进不能使用 Tab(须为空格)' })
      continue
    }
    const content = visible.trim()
    if (/^-(?:[ ]|$)/.test(content)) {
      const parent = stack[stack.length - 1]
      if (!parent) {
        out.errors.push({ line: lineNo, message: '序列项缺少所属键' })
        continue
      }
      if (seqOpen && seqOpen.path === parent.path && seqOpen.indent === indent) {
        seqOpen.endLine = lineNo
      } else {
        flushSeq()
        seqOpen = { path: parent.path, indent, startLine: lineNo, endLine: lineNo }
      }
      continue
    }
    // 序列项的续行(块式映射项的后续键):只属于更深缩进的项内部
    const m = /^((?:'[^']*'|"[^"]*"|[^:\s])+?)\s*:(.*)$/.exec(content)
    if (seqOpen && indent > seqOpen.indent) {
      seqOpen.endLine = lineNo
      continue
    }
    flushSeq()
    if (!m) {
      out.errors.push({ line: lineNo, message: `无法识别的行(应为 key: value):${content.slice(0, 30)}` })
      continue
    }
    const key = unquote(m[1])
    const rest = m[2].trim()
    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1]
    const path = parent ? `${parent.path}.${key}` : key
    const keyStart = lineStarts[idx] + indent + m.index
    const valStart = keyStart + m[1].length + (m[2].length - m[2].trimStart().length) + 1
    if (rest === '') {
      // 节(空值键):块映射/块序列的开头
      stack.push({ indent, path })
      out.sections.push({ path, startLine: lineNo, endLine: lineNo, indent })
      continue
    }
    if (rest[0] === '{' || rest[0] === '[') {
      // flow 值:收集到括号平衡(可能跨行;joined 是文档连续切片,跨度即绝对偏移)
      let endIdx = idx
      while (!flowBalanced(yaml.slice(valStart, lineStarts[endIdx] + lines[endIdx].length)) && endIdx + 1 < lines.length) {
        endIdx++
      }
      const joined = yaml.slice(valStart, lineStarts[endIdx] + lines[endIdx].length)
      const scan = scanFlow(joined, valStart, path, lineNo, out)
      if (scan.error) out.errors.push({ line: lineNo, message: scan.error })
      out.sections.push({ path, startLine: lineNo, endLine: endIdx + 1, indent })
      continue
    }
    // 引号未闭合
    if (rest[0] === '\'' && /^'[^']*'/.test(rest) === false) {
      out.errors.push({ line: lineNo, message: '引号未闭合' })
      continue
    }
    out.leaves.push({
      path,
      line: lineNo,
      raw: unquote(rest),
      start: valStart,
      end: valStart + rest.length,
      keyStart,
      indent,
      inFlow: false,
    })
  }
  flushSeq()
  // 节区间收尾:节 endLine = 下一个不深于该节缩进的非空行之前
  for (const section of out.sections) {
    for (let i = section.startLine; i <= lines.length; i++) {
      const line = lines[i - 1] ?? ''
      const cs = commentStart(line)
      const vis = (cs === -1 ? line : line.slice(0, cs)).trim()
      if (i > section.startLine && vis !== '' && (/^[ ]*/.exec(line) as RegExpExecArray)[0].length <= section.indent) {
        break
      }
      if (vis !== '') section.endLine = i
    }
  }
  // 重复键(同一注册路径出现两次)——serde 侧同样拒绝,提前给出定位
  const seen = new Map<string, number>()
  for (const leaf of out.leaves) {
    const prev = seen.get(leaf.path)
    if (prev !== undefined) {
      out.errors.push({ line: leaf.line, message: `参数重复定义:${leaf.path}(首次在第 ${prev} 行)` })
    } else {
      seen.set(leaf.path, leaf.line)
    }
  }
  return out
}

/* ————— 读取 ————— */

/** 注册路径 → 当前配置数值;缺值/不可解析返回 undefined(不回退默认值)。 */
export function readNumeric(parsed: ParsedConfig, path: string): number | undefined {
  const leaf = parsed.leaves.find((l) => l.path === path)
  if (!leaf) return undefined
  const n = Number(leaf.raw)
  return leaf.raw !== '' && Number.isFinite(n) ? n : undefined
}

/** 注册路径 → 值原文(含非数值型:duration/公式/结构开关);缺值 null。 */
export function readText(parsed: ParsedConfig, path: string): string | null {
  const leaf = parsed.leaves.find((l) => l.path === path)
  return leaf ? leaf.raw : null
}

/** 注册路径是否已写入配置(叶 / 块序列 / 节)。 */
export function hasParam(parsed: ParsedConfig, path: string): boolean {
  return (
    parsed.leaves.some((l) => l.path === path) ||
    parsed.seqBlocks.some((b) => b.path === path) ||
    parsed.sections.some((s) => s.path === path)
  )
}

/** 配置中数值注册路径 → 数值(参数域视图;候选 ID / 导出用)。
 * 只取注册表数值 kind 的路径,schema_version 等非注册键不进域。 */
export function numericValuesOf(parsed: ParsedConfig): Record<string, number> {
  const values: Record<string, number> = {}
  for (const leaf of parsed.leaves) {
    const reg = registryParam(leaf.path)
    if (!reg) continue
    const n = Number(leaf.raw)
    if (Number.isFinite(n)) values[leaf.path] = n
  }
  return values
}

/* ————— 编辑(跨度替换 / 定向插入;不做整体重序列化) ————— */

export type ApplyOutcome =
  | { ok: true; yaml: string; unchanged?: boolean }
  | { ok: false; error: string }

const splice = (yaml: string, start: number, end: number, text: string): string =>
  yaml.slice(0, start) + text + yaml.slice(end)

function yamlScalar(value: unknown): string {
  if (typeof value === 'string' && (value === '' || /^[0-9+-].|true|false|null/.test(value))) return `'${value}'`
  return String(value)
}

function lootToModelYaml(loot: unknown): string | null {
  if (loot === null || typeof loot !== 'object') return null
  const lines = Object.entries(loot as Record<string, unknown>).map(([childKey, child]) => {
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      const nested = yamlScalarMap(child as Record<string, unknown>, 6)
      return nested === null ? null : `    ${childKey}:\n${nested}`
    }
    return `    ${childKey}: ${yamlScalar(child)}`
  })
  return lines.includes(null) ? null : ['  loot:', ...lines].join('\n')
}

function yamlScalarMap(value: Record<string, unknown>, indent: number): string | null {
  const pad = ' '.repeat(indent)
  const lines = Object.entries(value).map(([childKey, child]) => {
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      const nested = yamlScalarMap(child as Record<string, unknown>, indent + 2)
      return nested === null ? null : `${pad}${childKey}:\n${nested}`
    }
    return `${pad}${childKey}: ${yamlScalar(child)}`
  })
  return lines.includes(null) ? null : lines.join('\n')
}

/** 把单条编辑写到 YAML:已有值 → 值 token 原位替换(注释与缩进保留);
 * 缺值 → 就近插入(流内补键 / 节尾补链 / 无节时文末建节)。 */
export function applyParamEdit(yaml: string, parsed: ParsedConfig, path: string, newText: string): ApplyOutcome {
  if (newText !== newText.trim() || newText.includes('\n')) {
    return { ok: false, error: `非法值文本:${JSON.stringify(newText)}` }
  }
  const leaf = parsed.leaves.find((l) => l.path === path)
  if (leaf) {
    if (leaf.raw === newText) return { ok: true, yaml, unchanged: true }
    return { ok: true, yaml: splice(yaml, leaf.start, leaf.end, newText) }
  }
  if (parsed.seqBlocks.some((b) => b.path === path)) {
    return { ok: false, error: `${path} 是结构参数(块序列),请在高级 YAML 编辑中修改` }
  }
  const segments = path.split('.')
  for (let k = segments.length - 1; k >= 1; k--) {
    const ancestor = segments.slice(0, k).join('.')
    const flow = parsed.flowMaps.find((f) => f.path === ancestor)
    if (flow) {
      // 流内补键:收括号前插入(空 flow 整体替换)
      const inner = yaml.slice(flow.open + 1, flow.close).trim()
      const leafKey = segments[segments.length - 1]
      if (inner === '') {
        return { ok: true, yaml: splice(yaml, flow.open, flow.close + 1, `{ ${leafKey}: ${newText} }`) }
      }
      return { ok: true, yaml: splice(yaml, flow.close, flow.close, `, ${leafKey}: ${newText}`) }
    }
    const section = parsed.sections.find((s) => s.path === ancestor)
    if (section) {
      const missing = segments.slice(k)
      const lines = yaml.split('\n')
      const insertAt = section.endLine // 0-based:插在 1-based endLine 行之后
      const baseIndent = section.indent + 2
      const block = missing.map((seg, j) => {
        const ind = ' '.repeat(baseIndent + 2 * j)
        return j === missing.length - 1 ? `${ind}${seg}: ${newText}` : `${ind}${seg}:`
      })
      lines.splice(insertAt, 0, ...block)
      return { ok: true, yaml: lines.join('\n') }
    }
  }
  const block = segments.map((seg, j) => {
    const ind = ' '.repeat(2 * j)
    return j === segments.length - 1 ? `${ind}${seg}: ${newText}` : `${ind}${seg}:`
  })
  const trimmed = yaml.replace(/\n*$/, '')
  return { ok: true, yaml: (trimmed === '' ? '' : trimmed + '\n') + block.join('\n') + '\n' }
}

/** 批量编辑:逐条应用(每条后重解析,跨度随行数变化保持正确)。
 * 任何一条失败即整体失败;调用方把失败档在写回之前(不产生半批修改)。 */
export function applyParamEdits(yaml: string, edits: ReadonlyArray<{ path: string; text: string }>): ApplyOutcome {
  let current = yaml
  for (const e of edits) {
    const parsed = parseConfig(current)
    const applied = applyParamEdit(current, parsed, e.path, e.text)
    if (!applied.ok) return { ok: false, error: `${e.path}: ${applied.error}` }
    current = applied.yaml
  }
  return { ok: true, yaml: current }
}

/** 恢复单项到基线:基线有值 → 写回基线文本;基线无值 → 从候选删除该键。 */
export function restoreParam(yaml: string, parsed: ParsedConfig, path: string, baselineText: string | null): ApplyOutcome {
  if (baselineText !== null) return applyParamEdit(yaml, parsed, path, baselineText)
  return removeParam(yaml, parsed, path)
}

/** 从候选删除一个参数键(块叶删行;flow 叶按 token 剪切;结构块删整块)。 */
export function removeParam(yaml: string, parsed: ParsedConfig, path: string): ApplyOutcome {
  const leaf = parsed.leaves.find((l) => l.path === path)
  if (leaf) {
    if (!leaf.inFlow) {
      const lines = yaml.split('\n')
      lines.splice(leaf.line - 1, 1)
      return { ok: true, yaml: lines.join('\n') }
    }
    let start = leaf.keyStart
    let end = leaf.end
    if (yaml[end] === ',') {
      end++
      while (yaml[end] === ' ') end++
    } else {
      while (yaml[start - 1] === ' ') start--
      if (yaml[start - 1] === ',') start--
      while (yaml[start - 1] === ' ') start--
    }
    return { ok: true, yaml: splice(yaml, start, end, '') }
  }
  const seq = parsed.seqBlocks.find((b) => b.path === path)
  if (seq) {
    const lines = yaml.split('\n')
    lines.splice(seq.startLine - 1, seq.endLine - seq.startLine + 1)
    return { ok: true, yaml: lines.join('\n') }
  }
  // 块式节(结构参数,如 loot.tables):删除节整体(含子级)
  const section = parsed.sections.find((s) => s.path === path)
  if (section) {
    const lines = yaml.split('\n')
    lines.splice(section.startLine - 1, section.endLine - section.startLine + 1)
    return { ok: true, yaml: lines.join('\n') }
  }
  return { ok: false, error: `${path}: 配置中不存在,无需删除` }
}

/** 读取 model.dungeon.tier_table(块序列)。缺块返回 null;缺字段不猜测,
 * 给出行号与字段错误;非法数值行原样报错。gold/xp 可选,表示回退几何产出。 */
export function readTierTable(yaml: string, parsed: ParsedConfig = parseConfig(yaml)): readonly TierTableRow[] | null {
  const seq = parsed.seqBlocks.find((block) => block.path === 'model.dungeon.tier_table')
  if (!seq) return null
  const lines = yaml.split('\n')
  const rows: TierTableRow[] = []
  for (let lineNo = seq.startLine; lineNo <= seq.endLine; lineNo++) {
    const raw = lines[lineNo - 1] ?? ''
    const visible = raw.trim()
    if (!visible.startsWith('-')) continue
    const flowStart = visible.indexOf('{')
    const flowEnd = visible.lastIndexOf('}')
    if (flowStart === -1 || flowEnd <= flowStart) return null
    const body = visible.slice(flowStart, flowEnd + 1)
    if (!body) return null
    const match = /^\{\s*(.*?)\s*\}\s*$/.exec(body)
    if (!match) return null
    const row: Record<string, string> = {}
    for (const item of match[1].split(',')) {
      const pair = item.split(':')
      if (pair.length !== 2) return null
      row[unquote(pair[0])] = unquote(pair[1])
    }
    const number = (key: 'hp' | 'attack' | 'defense' | 'gold' | 'xp'): number | null => {
      const rawValue = row[key]
      if (rawValue === undefined) return key === 'gold' || key === 'xp' ? null : Number.NaN
      const value = Number(rawValue)
      return Number.isFinite(value) ? value : Number.NaN
    }
    const hp = number('hp')
    const attack = number('attack')
    const defense = number('defense')
    if (!Number.isFinite(hp) || !Number.isFinite(attack) || !Number.isFinite(defense)) return null
    const hpValue = hp as number
    const attackValue = attack as number
    const defenseValue = defense as number
    rows.push({ hp: hpValue, attack: attackValue, defense: defenseValue, gold: number('gold'), xp: number('xp') })
  }
  return rows
}

/** 把成长曲线整表写回 model.dungeon.tier_table。已有表按行剪切,保留
 * tier_table 键行与其前缀注释;缺块时按与注册默认 YAML 一致的二级缩进插入
 * dungeon 节尾。整表一次替换,不走逐格 patch,避免半批修改。 */
export function applyTierTable(yaml: string, rows: readonly TierTableRow[]): ApplyOutcome {
  if (rows.length === 0) return { ok: false, error: 'model.dungeon.tier_table: 至少需要 1 行' }
  const lines = yaml.split('\n')
  const parsed = parseConfig(yaml)
  if (parsed.errors.length > 0) {
    return { ok: false, error: `第 ${parsed.errors[0].line} 行:${parsed.errors[0].message}` }
  }
  const seq = parsed.seqBlocks.find((block) => block.path === 'model.dungeon.tier_table')
  const section = parsed.sections.find((item) => item.path === 'model.dungeon.tier_table')
  const indent = seq?.indent ?? (section?.indent ?? 4) + 2
  const table = rows
    .map((row) => {
      const output = row.gold === null && row.xp === null
        ? ''
        : `, gold: ${row.gold ?? 0}, xp: ${row.xp ?? 0}`
      return `${' '.repeat(indent)}- { hp: ${row.hp}, attack: ${row.attack}, defense: ${row.defense}${output} }`
    })
    .join('\n')
  if (seq) {
    lines.splice(seq.startLine - 1, seq.endLine - seq.startLine + 1, table)
    return { ok: true, yaml: lines.join('\n') }
  }
  const dungeon = parsed.sections.find((section) => section.path === 'model.dungeon')
  if (!dungeon) return { ok: false, error: 'model.dungeon 节不存在;请先用高级 YAML 编辑创建结构' }
  const dungeonLines = parsed.sections
    .filter((section) => section.path.startsWith('model.dungeon.'))
    .map((section) => section.endLine)
  const insertAt = dungeonLines.length === 0 ? dungeon.endLine : Math.max(...dungeonLines)
  lines.splice(insertAt, 0, '    tier_table:', table)
  return { ok: true, yaml: lines.join('\n') }
}

/** 把掉落配置整段写回 model.loot;已有节剪切保留注释前一行,缺段追加文件尾。
 * loot 是结构化整体,整段替换避免编辑过程中留下 on_victory/rewards 半配置。 */
export function applyLootConfig(yaml: string, loot: unknown): ApplyOutcome {
  const lines = yaml.split('\n')
  const parsed = parseConfig(yaml)
  if (parsed.errors.length > 0) return { ok: false, error: `第 ${parsed.errors[0].line} 行:${parsed.errors[0].message}` }
  const block = lootToModelYaml(loot)
  if (block === null) return { ok: false, error: 'loot: 无法序列化为受支持 YAML' }
  const section = parsed.sections.find((item) => item.path === 'model.loot')
  if (section) {
    lines.splice(section.startLine - 1, section.endLine - section.startLine + 1, block)
    return { ok: true, yaml: lines.join('\n') }
  }
  const model = parsed.sections.find((item) => item.path === 'model')
  if (!model) return { ok: false, error: 'model 节不存在;请先用高级 YAML 编辑创建结构' }
  lines.splice(model.endLine, 0, block)
  return { ok: true, yaml: lines.join('\n') }
}

/** 读取 model.stage_rules 块序列;块缺失返回 null,不把“无规则”伪装成空规则。 */
export function readStageRules(yaml: string, parsed: ParsedConfig = parseConfig(yaml)): readonly StageRuleRow[] | null {
  const seq = parsed.seqBlocks.find((block) => block.path === 'model.stage_rules')
  if (!seq) return null
  const section = parsed.sections.find((item) => item.path === 'model.stage_rules')
  const lines = yaml.split('\n')
  const rows: StageRuleRow[] = []
  const start = section?.startLine ?? seq.startLine
  const end = section?.endLine ?? seq.endLine
  for (let lineNo = start; lineNo <= end; lineNo++) {
    const visible = (lines[lineNo - 1] ?? '').trim()
    if (!visible.startsWith('-')) continue
    const body = /^-\s*\{\s*(.*?)\s*\}\s*$/.exec(visible)?.[1]
    if (!body) return null
    const row: Record<string, string> = {}
    const effectMatch = /effect:\s*([^,}]+)/.exec(body)
    if (!effectMatch) return null
    row.effect = unquote(effectMatch[1].trim())
    const rest = body.replace(/,\s*effect:\s*([^,}]+)/, '')
    for (const item of rest.split(',')) {
      const pair = item.split(':')
      if (pair.length !== 2) return null
      row[unquote(pair[0].trim())] = unquote(pair[1].trim())
    }
    const chance = Number(row.chance)
    if (!/^\d+$/.test(row.from ?? '') || row.to === undefined || row.effect === undefined
      || !Number.isSafeInteger(chance) || chance < 0 || chance > 100) return null
    rows.push({ from: Number(row.from), to: row.to, effect: row.effect, chance })
  }
  return rows
}

/** 整段替换 model.stage_rules;只裁剪该块,相邻 YAML、注释与内核未知键保留。 */
export function applyStageRules(yaml: string, rows: readonly StageRuleRow[]): ApplyOutcome {
  if (rows.length === 0) return { ok: false, error: 'model.stage_rules: 至少需要 1 条规则' }
  const parsed = parseConfig(yaml)
  if (parsed.errors.length > 0) {
    return { ok: false, error: `第 ${parsed.errors[0].line} 行:${parsed.errors[0].message}` }
  }
  for (const row of rows) {
    if (!/^[A-Za-z0-9_-]+$/.test(row.to) || /["']/.test(row.effect)
      || !/^[A-Za-z0-9_./:-]+$/.test(row.effect)) {
      return { ok: false, error: 'stage_rules: to/effect 含不受支持的 YAML 字符' }
    }
  }
  const section = parsed.sections.find((item) => item.path === 'model.stage_rules')
  const lines = yaml.split('\n')
  const seq = parsed.seqBlocks.find((block) => block.path === 'model.stage_rules')
  const indent = seq?.indent ?? (section?.indent ?? 2) + 2
  const rules = rows
    .map((row) => `${' '.repeat(indent)}- { from: ${row.from}, to: '${row.to}', effect: '${row.effect}', chance: ${row.chance} }`)
    .join('\n')
  if (seq) {
    lines.splice(seq.startLine - 1, seq.endLine - seq.startLine + 1, rules)
    return { ok: true, yaml: lines.join('\n') }
  }
  const model = parsed.sections.find((item) => item.path === 'model')
  if (!model) return { ok: false, error: 'model 节不存在;请先用高级 YAML 编辑创建结构' }
  lines.splice(model.endLine, 0, '  stage_rules:', rules)
  return { ok: true, yaml: lines.join('\n') }
}

/* ————— 基线差异(WB-05.08) ————— */

export type ParamDelta = {
  /** 绝对变化(候选 − 基线);任一侧缺值为 null */
  abs: number | null
  /** 相对变化文本;基线为 0 或任一侧缺值时为 null(不给无穷百分比) */
  rel: string | null
  /** 展示文本:— / +N(仅绝对) / +N(+x.x%) */
  text: string
}

export function paramDelta(base: number | undefined, cand: number | undefined): ParamDelta {
  if (base === undefined || cand === undefined) return { abs: null, rel: null, text: '—' }
  const abs = cand - base
  if (abs === 0) return { abs: 0, rel: null, text: '—' }
  if (base === 0) return { abs, rel: null, text: `${abs > 0 ? '+' : ''}${abs}` }
  const pct = (abs / Math.abs(base)) * 100
  return {
    abs,
    rel: `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`,
    text: `${abs > 0 ? '+' : ''}${abs}(${pct > 0 ? '+' : ''}${pct.toFixed(1)}%)`,
  }
}

/* ————— 内核错误定位(WB-05.07) ————— */

/** 从内核错误消息里定位注册路径(取最长命中);定位不到返回 null。
 * 内核口径:Error::Config 消息含 `路径: 说明` 或 serde 错误含字段路径。 */
export function locateKernelError(message: string): string | null {
  let best: string | null = null
  for (const p of PARAM_REGISTRY) {
    if (message.includes(p.path) && (best === null || p.path.length > best.length)) best = p.path
  }
  return best
}

/* ————— 注册表默认配置(WB-05.01 演示模式基线) ————— */

/** 由注册表合成注册默认场景 YAML(演示模式基线;逐项来自 PARAM_REGISTRY,
 * 非运行产物)。结构类缺省('—')不写入;公式以引号字符串书写。 */
/** 默认基线故意不物化的注册项。
 * 内核对可选段取显式性契约(config.rs):`model.loot` 一旦在场,on_victory 必须指名
 * tables 中的键,不猜默认表;只物化 rate_mult 会把 loot 变成半配置 → 内核校验红。
 * 内核侧 loot 缺省时 rate_mult 隐式取 1.0(registry.rs),不发该段行为等价。 */
export const DEFAULT_YAML_OMITTED: readonly string[] = ['model.loot.rate_mult']

export function buildDefaultYaml(): string {
  const lines: string[] = [
    '# 参数表内置基线:逐项取自参数注册表默认值(crates/sandtable-core/src/registry.rs)。',
    '# 演示模式(未打开项目)的只读基线,非运行产物。',
    "schema_version: '1'",
    '',
  ]
  const emitted = new Set<string>([''])
  for (const p of PARAM_REGISTRY) {
    if (p.default === '—') continue
    if (DEFAULT_YAML_OMITTED.includes(p.path)) continue
    const segs = p.path.split('.')
    for (let d = 0; d < segs.length - 1; d++) {
      const sub = segs.slice(0, d + 1).join('.')
      if (!emitted.has(sub)) {
        emitted.add(sub)
        lines.push(`${' '.repeat(2 * d)}${segs[d]}:`)
      }
    }
    const value = p.kind === 'expr' ? `'${p.default}'` : p.default
    lines.push(`${' '.repeat(2 * (segs.length - 1))}${segs[segs.length - 1]}: ${value}`)
  }
  return lines.join('\n') + '\n'
}
