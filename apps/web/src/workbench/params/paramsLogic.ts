// WB-05 · 参数编辑领域逻辑(WB-02.06 版重写:数据源 = 注册表 × 配置 YAML)。
// 红线:
// - 基线只读——可变写入只针对候选 YAML(WB-05.03);
// - 批量修改先整预览/校验再一次性应用,任一项失败不产生半批修改(WB-05.11);
// - 前端只做基础检查(有限数/整数域/概率范围),最终有效性由内核完整校验,
//   校验失败定位参数并保留待修复输入与原始错误(WB-05.06/05.07);
// - 缺值不自动回退默认值:缺值就是缺值,如实显示(WB-05.03)。
import { PARAM_REGISTRY, displayParamName, paramGroup } from './paramRegistry.ts'
import type { RegistryParam } from './paramRegistry.ts'
import { locateKernelError, numericValuesOf, paramDelta, readNumeric, readText } from './configYaml.ts'
import type { ParsedConfig, ParamDelta } from './configYaml.ts'

/** 参数行模型:注册表定义 × 基线值 × 候选值(WB-05.01/05.03)。 */
export type ParamRowModel = {
  def: RegistryParam
  group: string
  /** 基线列:基线 YAML 实际写入的值(缺值 present=false,不回退默认) */
  baseline: CellValue
  /** 候选列:候选 YAML 实际写入的值 */
  candidate: CellValue
  /** 候选相对基线是否有差异(含出现/消失) */
  modified: boolean
  /** 数值通道可编辑(u32/u64/i64/f64/mix);dur/expr/table 只读+高级编辑入口 */
  editable: boolean
}

export type CellValue = { present: boolean; text: string; num?: number }

const NUMERIC_KINDS: ReadonlySet<string> = new Set(['u32', 'u64', 'i64', 'f64', 'mix'])

function cellOf(parsed: ParsedConfig, path: string): CellValue {
  const text = readText(parsed, path)
  if (text === null) return { present: false, text: '' }
  const num = readNumeric(parsed, path)
  return num === undefined ? { present: true, text } : { present: true, text, num }
}

/** 全量参数行:注册表逐项 × 基线解析 × 候选解析(WB-05.01/05.03)。 */
export function buildRowModels(baseParsed: ParsedConfig, candParsed: ParsedConfig): ParamRowModel[] {
  return PARAM_REGISTRY.map((def) => {
    const baseline = cellOf(baseParsed, def.path)
    const candidate = cellOf(candParsed, def.path)
    const modified =
      baseline.text !== candidate.text || baseline.present !== candidate.present
    return {
      def,
      group: paramGroup(def.path),
      baseline,
      candidate,
      modified,
      editable: NUMERIC_KINDS.has(def.kind),
    }
  })
}

/** 候选相对基线的已修改参数路径(升序;WB-05.08 摘要与文档标签计数用)。 */
export function modifiedPaths(base: ParsedConfig, cand: ParsedConfig): string[] {
  return PARAM_REGISTRY
    .filter((p) => readText(base, p.path) !== readText(cand, p.path))
    .map((p) => p.path)
}

/** 候选参数域(数值注册路径 → 数值;候选 ID 派生与导出共用)。 */
export function candidateValues(candParsed: ParsedConfig): Record<string, number> {
  return numericValuesOf(candParsed)
}

/** 基线差异行(WB-05.08):候选相对基线的已修改参数(升序)。
 * 绝对变化与相对变化由 paramDelta 给出;基线为 0 不给百分比。 */
export function diffRows(rows: readonly ParamRowModel[]): Array<{
  path: string
  baseline: CellValue
  candidate: CellValue
  delta: ParamDelta
}> {
  const out = []
  for (const row of rows) {
    if (!row.modified) continue
    out.push({
      path: row.def.path,
      baseline: row.baseline,
      candidate: row.candidate,
      delta: paramDelta(row.baseline.num, row.candidate.num),
    })
  }
  return out.sort((a, b) => (a.path > b.path ? 1 : -1))
}

/* ————— 前端基础校验(WB-05.06) ————— */

/** 单项基础检查(前端侧):有限数、整数域、无符号域、概率/权重范围。
 * 通过返回 ''。跨参数关系与最终有效性归内核完整校验。
 * u64 边界(WB-03.08 口径):超过 JS 安全整数明确拒绝(先于安全整数检查),
 * 不静默舍入;文本级大整数在 parseCellInput 按原文拒绝。 */
export function validateParam(def: RegistryParam, value: number): string {
  if (!Number.isFinite(value)) return '请输入有限数值'
  if (def.kind === 'u64' && value > Number.MAX_SAFE_INTEGER) return '超出 JS 安全整数上限,请改用高级 YAML 编辑'
  if ((def.kind === 'u32' || def.kind === 'u64' || def.kind === 'i64') && !Number.isSafeInteger(value)) return '需要安全范围内的整数'
  if (def.kind === 'u32' && (value < 0 || value > 4294967295)) return '范围为 0–4294967295'
  if (isProbabilityPath(def.path) && (value < 0 || value > 1)) return '概率范围为 0–1'
  if (def.kind === 'mix' && (value < 0 || value > 1)) return '权重范围为 0–1'
  return ''
}

/** 概率语义路径:p_* 系列与抽卡基础命中率((0,1],开区间交内核把关)。 */
function isProbabilityPath(path: string): boolean {
  return path.includes('.p_') || path === 'model.gacha.base_rate'
}

/** 数值 → 写入 YAML 的标量文本(f64 用最短往返表示,整数直接十进制)。 */
export function formatScalar(value: number): string {
  return String(value)
}

const BIGINT_MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER)

/** 单元格输入解析(编辑缓冲提交前的公共关口,WB-05.04/05.06)。 */
export type CellCommit =
  | { state: 'empty'; error: string }
  | { state: 'invalid'; error: string }
  | { state: 'ok'; value: number; text: string }

export function parseCellInput(input: string, def: RegistryParam): CellCommit {
  const text = input.trim()
  if (text === '') return { state: 'empty', error: '请输入数值' }
  // u64 文本级边界(WB-03.08 口径):JS Number 会把 2^53 以上的整数静默舍入,
  // 先按原文检查,超界明确拒绝(不静默丢精度)
  if (def.kind === 'u64' && /^\d+$/.test(text) && BigInt(text) > BIGINT_MAX_SAFE) {
    return { state: 'invalid', error: '超出 JS 安全整数上限,请改用高级 YAML 编辑' }
  }
  const value = Number(text)
  if (Number.isNaN(value)) return { state: 'invalid', error: '请输入数值' }
  const error = validateParam(def, value)
  if (error) return { state: 'invalid', error }
  return { state: 'ok', value, text: formatScalar(value) }
}

/* ————— 内核完整校验(WB-05.06/05.07) ————— */

export type KernelCheck =
  | { ok: true; /** validate_config 的解析结果(config_hash/players/days/…) */
      info: unknown }
  | { ok: false; message: string; path: string | null }

/**
 * 内核完整校验:复用 lib/wasm 的 validate_config(浏览器/桌面同源内核)。
 * 失败时返回原始错误详情并尽量定位注册路径(定位不到 path=null,
 * 由调用方在整批层面呈现)。validator 可注入(节点侧测试)。
 */
export async function kernelCheck(
  yaml: string,
  validate?: (yaml: string) => Promise<unknown>,
): Promise<KernelCheck> {
  let run = validate
  if (!run) {
    // 动态引入:节点侧测试不触发 wasm/tauri 模块加载
    const mod = await import('../../lib/wasm.ts')
    run = mod.validateConfig
  }
  try {
    const info = await run(yaml)
    return { ok: true, info }
  } catch (e) {
    const message = typeof e === 'string' ? e : String(e)
    return { ok: false, message, path: locateKernelError(message) }
  }
}

/* ————— 筛选与搜索(WB-05.09/05.10) ————— */

export type VisibilityOpts = {
  search: string
  group: string
  changedOnly: boolean
  /** 只看错误:行级非法(编辑缓冲/内核错误)由调用方传入路径集合 */
  errorsOnly: boolean
  invalidPaths: ReadonlySet<string>
  /** 当前语言(显示名解析用;语言切换不重置搜索输入) */
  locale: string
}

/** 行可见性:搜索(路径+原始描述+当前语言显示名)× 分组 × 只看变更 × 只看错误。 */
export function visibilityFilter(rows: readonly ParamRowModel[], opts: VisibilityOpts): ParamRowModel[] {
  const q = opts.search.trim().toLowerCase()
  return rows.filter((row) => {
    if (q !== '') {
      const haystack = `${row.def.path} ${row.def.desc} ${displayParamName(row.def.path, opts.locale)}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    if (opts.group !== 'all' && row.group !== opts.group) return false
    if (opts.changedOnly && !row.modified) return false
    if (opts.errorsOnly && !opts.invalidPaths.has(row.def.path)) return false
    return true
  })
}

/* ————— 批量倍率(WB-05.11) ————— */

export type BulkPreviewRow = {
  path: string
  from: number
  to: number
  error: string
}

export type BulkPreview = {
  ok: boolean
  rows: BulkPreviewRow[]
  /** 整批一次性应用的编辑表(仅 ok 时有意义) */
  edits: Array<{ path: string; text: string }>
  /** 整体级错误(倍率非法/未勾选) */
  error?: string
}

/** 批量倍率预演:逐项给出 from → to 与校验结果;任何一项失败 ok=false。
 * 应用是一次性整批(applyParamEdits),不产生半批修改。 */
export function bulkPreview(
  rows: readonly ParamRowModel[],
  ids: readonly string[],
  factor: number,
): BulkPreview {
  if (!Number.isFinite(factor) || factor < 0) {
    return { ok: false, rows: [], edits: [], error: '倍率需为非负有限数值' }
  }
  if (ids.length === 0) {
    return { ok: false, rows: [], edits: [], error: '尚未勾选任何参数' }
  }
  const preview: BulkPreviewRow[] = []
  const edits: Array<{ path: string; text: string }> = []
  let ok = true
  for (const id of ids) {
    const row = rows.find((r) => r.def.path === id)
    if (!row) {
      preview.push({ path: id, from: Number.NaN, to: Number.NaN, error: `参数不存在:${id}` })
      ok = false
      continue
    }
    if (!row.editable) {
      preview.push({ path: id, from: Number.NaN, to: Number.NaN, error: '结构/公式参数不进数值批量通道' })
      ok = false
      continue
    }
    if (row.candidate.num === undefined) {
      preview.push({ path: id, from: Number.NaN, to: Number.NaN, error: '候选缺值,先写入配置再批量修改' })
      ok = false
      continue
    }
    const from = row.candidate.num
    const to = row.def.kind === 'f64'
      ? Number((from * factor).toPrecision(10))
      : Math.round(from * factor)
    const error = validateParam(row.def, to)
    preview.push({ path: id, from, to, error })
    if (error) {
      ok = false
    } else {
      edits.push({ path: id, text: formatScalar(to) })
    }
  }
  return { ok, rows: preview, edits }
}
