// P1-04 · 多候选并排比较(项目与场景管理 ④):字段级 diff。纪律:
// - 输入是候选的参数值域(路径 → 数值),来源由调用方给:候选草稿自带
//   values(analysis/resultModel.copyCandidate),或 YAML 经 parseConfig +
//   numericValuesOf 平铺(与参数页同口径)——本模块不做 YAML 解析,不碰
//   内核语义;
// - 并排 = 全部候选按参数路径对齐的行集:字段并集、缺失显式记 null、
//   有差异的行点出;基线参照可选(给 diffVsBase 标注)。
export type CompareCandidate = {
  readonly id: string
  readonly label: string
  readonly values: Readonly<Record<string, number>>
}

export type CompareRow = {
  readonly path: string
  /** 候选 ID → 值;该候选缺失此字段 = null(显式点名,不用 0 冒充) */
  readonly values: Readonly<Record<string, number | null>>
  /** 任一候选之间有差异(含缺失 vs 在场) */
  readonly changed: boolean
  /** 提供基线参照时:任一候选与基线不同 */
  readonly diffVsBase: boolean | null
}

export type CompareResult = {
  readonly rows: readonly CompareRow[]
  /** 有差异的参数路径(升序) */
  readonly changedPaths: readonly string[]
}

const NO_VALUES: Record<string, number> = {}

/**
 * 多候选并排比较:按参数路径并集对齐;全同候选得零差异行集。
 * 候选不足两个时仍可对单候选与基线比(diffVsBase),候选间 changed 恒 false。
 */
export function compareCandidates(
  candidates: readonly CompareCandidate[],
  baseValues?: Readonly<Record<string, number>>,
): CompareResult {
  const paths = new Set<string>()
  for (const c of candidates) {
    for (const p of Object.keys(c.values ?? NO_VALUES)) paths.add(p)
  }
  if (baseValues) {
    for (const p of Object.keys(baseValues)) paths.add(p)
  }
  const rows: CompareRow[] = []
  const changedPaths: string[] = []
  for (const path of [...paths].sort()) {
    const values: Record<string, number | null> = {}
    let changed = false
    let first: number | null | undefined
    for (const c of candidates) {
      const v = (c.values ?? NO_VALUES)[path]
      const cell = typeof v === 'number' && Number.isFinite(v) ? v : null
      values[c.id] = cell
      if (first === undefined) first = cell
      else if (cell !== first) changed = true
    }
    let diffVsBase: boolean | null = null
    if (baseValues) {
      const base = baseValues[path]
      diffVsBase = candidates.some((c) => {
        const cell = values[c.id]
        return cell === null ? base !== undefined : cell !== base
      })
    }
    if (changed) changedPaths.push(path)
    rows.push({ path, values, changed, diffVsBase })
  }
  return { rows, changedPaths }
}
