// 共享的子集 YAML 值解析(结构化编辑器读候选配置用):只认 嵌套映射 /
// 标量 / flow-map,注释剥离;列表与多行字面量不支持(编辑器场景不出现)。
// 从 LootTableEditor 内联抽出,gacha/behavior 编辑器复用同一形状约定。

/** 缩进驱动的最小 YAML→对象(逐行,注释剥离,不支持列表与块标量)。 */
export function yamlToValue(source: string): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  const stack: Array<{ indent: number; value: Record<string, unknown> }> = [{ indent: -2, value: root }]
  for (const raw of source.split('\n')) {
    const comment = raw.indexOf('#')
    const visible = comment === -1 ? raw : raw.slice(0, comment)
    if (visible.trim() === '') continue
    const indent = visible.length - visible.trimStart().length
    const match = /^([^:]+):\s*(.*)$/.exec(visible.trim())
    if (!match) continue
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop()
    const key = match[1].trim()
    if (match[2] === '') {
      const child: Record<string, unknown> = {}
      stack[stack.length - 1].value[key] = child
      stack.push({ indent, value: child })
    } else stack[stack.length - 1].value[key] = parseScalar(match[2])
  }
  return root
}

/** 标量解析:true/false/数字/flow-map `{k: v, ...}`/去引号文本。 */
export function parseScalar(raw: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  const flow = /^\{(.*)\}$/.exec(raw)
  if (flow) {
    const value: Record<string, unknown> = {}
    for (const part of flow[1].split(',')) {
      const pair = part.split(':')
      if (pair.length === 2) value[pair[0].trim()] = parseScalar(pair[1].trim())
    }
    return value
  }
  return raw.replace(/^['"]|['"]$/g, '')
}
