// WB-02.06 · 参数编辑领域的纯逻辑:基础校验、批量倍率预演、变更摘要。
// 红线:批量修改必须先整批校验再应用,任一项失败不产生半批修改;
// 基线只读——所有可变写入只针对候选草稿 values。
import type { ParamDef, ParamValues } from '../demo/sampleProject.ts'

/** 单项基础校验(前端侧):有限数、整数域、概率范围。最终有效性仍由内核校验。 */
export function validateParam(def: ParamDef, value: number): string {
  if (!Number.isFinite(value)) return '请输入有限数值'
  if (def.type !== 'f64' && !Number.isSafeInteger(value)) return '需要安全范围内的整数'
  if (def.type === 'u32' && (value < 0 || value > 4294967295)) return '范围为 0–4294967295'
  if (def.id.includes('.p_') && (value < 0 || value > 1)) return '概率范围为 0–1'
  return ''
}

export function changedParams(defs: readonly ParamDef[], values: ParamValues): ParamDef[] {
  return defs.filter((p) => values[p.id] !== undefined && values[p.id] !== p.base)
}

export function visibilityFilter(
  defs: readonly ParamDef[],
  values: ParamValues,
  opts: { search: string; group: string; changedOnly: boolean },
): ParamDef[] {
  const q = opts.search.trim().toLowerCase()
  return defs.filter(
    (p) =>
      (!q || `${p.id} ${p.name}`.toLowerCase().includes(q)) &&
      (opts.group === 'all' || p.group === opts.group) &&
      (!opts.changedOnly || values[p.id] !== p.base),
  )
}

export type BulkResult =
  | { ok: true; next: ParamValues; applied: number }
  | { ok: false; error: string; paramId?: string }

/**
 * 批量倍率预演:整批校验后才放行(不产生半批修改)。整数参数自动取整,
 * 小数值(f64)保留 10 位有效数字避免浮点漂移写出超长小数。
 */
export function bulkMultiply(
  defs: readonly ParamDef[],
  values: ParamValues,
  ids: readonly string[],
  factor: number,
): BulkResult {
  if (!Number.isFinite(factor) || factor < 0) {
    return { ok: false, error: '倍率需为非负有限数值' }
  }
  if (ids.length === 0) return { ok: false, error: '尚未勾选任何参数' }
  const next: ParamValues = { ...values }
  for (const id of ids) {
    const def = defs.find((p) => p.id === id)
    if (!def || next[id] === undefined) return { ok: false, error: `参数不存在:${id}`, paramId: id }
    const value = def.type === 'f64'
      ? Number((next[id] * factor).toPrecision(10))
      : Math.round(next[id] * factor)
    const error = validateParam(def, value)
    if (error) {
      return { ok: false, error: `${def.name}:${error},未应用批量修改`, paramId: id }
    }
    next[id] = value
  }
  return { ok: true, next, applied: ids.length }
}

/** 相对变化显示:基线为 0 时不给百分比(红线:不做无穷展开)。 */
export function relativeChange(def: ParamDef, value: number): string {
  if (value === def.base) return '—'
  if (def.base === 0) return `${value > 0 ? '+' : ''}${value}`
  const pct = ((value - def.base) / Math.abs(def.base)) * 100
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}
