// WB-06.09/06.02 · 结构化表单 ⇄ 有效实验配置(实验 YAML)的纯逻辑。
// 纪律(同 WB-05 的外科手术式编辑红线):
// - 只生成/替换顶层 sweep 节(表单拥有的部分);scenario/model 与其余
//   内容按行原样保留(未编辑的模型内容不重排、不丢注释);
// - sweep 节序列化形状逐字段对照 examples/pokemon-sweep.yaml 与
//   core::scenario::SweepSection(mode/replicates/samples/parameters/
//   targets);Grid 含 step,Random/LHS 只含 min/max(内核 Random 模式
//   不用 step,序列化不输出该字段 即 WB-06.14「不适用字段不序列化」);
// - 比例类指标阈值写 0–1 比例口径(WB-06.08,UI 百分数不直接入 YAML)。
import { parseConfig } from '../params/configYaml.ts'
import type { ParsedConfig } from '../params/configYaml.ts'
import {
  sweepModeOf, KPI_POOL,
} from './designerLogic.ts'
import type { DesignDraft, FactorDraft } from './designerLogic.ts'
import type { SweepModeName } from './designerLogic.ts'

/** 数值 → YAML 字面(整数不带小数点;有限小数按浮点原文)。 */
function yamlNumber(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`因子值不是有限数:${v}`)
  return Number.isInteger(v) ? String(v) : String(v)
}

function fmtThreshold(v: number): string {
  // 比例类带一位可读性(0.2 而非 0.20000000000001);绝对值原样。
  const text = Number.isInteger(v) ? String(v) : Number(v.toFixed(6)).toString()
  return text
}

/** 表单草稿 → 顶层 sweep 节文本(换行结尾;不含末尾空行)。 */
export function sweepSectionText(design: DesignDraft): string {
  const mode = sweepModeOf(design.method, design.sampling)
  if (mode === null) throw new Error('A/B 方法没有 sweep 节(A/B 比较不是参数扫描)')
  const randomLike = mode !== 'grid'
  const lines: string[] = ['sweep:']
  lines.push(`  mode: ${mode}`)
  lines.push(`  replicates: ${yamlNumber(design.reps)}`)
  if (randomLike) lines.push(`  samples: ${yamlNumber(design.samples)}`)
  lines.push('  parameters:')
  for (const f of design.factors) {
    const range = randomLike
      ? `{min: ${yamlNumber(f.min)}, max: ${yamlNumber(f.max)}}`
      : `{min: ${yamlNumber(f.min)}, max: ${yamlNumber(f.max)}, step: ${yamlNumber(f.step)}}`
    lines.push(`    ${f.path}: ${range}`)
  }
  if (design.targets.length > 0) {
    lines.push('  targets:')
    for (const t of design.targets) {
      const parts = [`metric: ${t.metric}`, `kind: ${t.kind}`]
      if (t.min !== null) parts.push(`min: ${fmtThreshold(t.min)}`)
      if (t.max !== null) parts.push(`max: ${fmtThreshold(t.max)}`)
      lines.push(`    - {${parts.join(', ')}}`)
    }
  }
  return lines.join('\n') + '\n'
}

/** 找顶层 sweep 节(含起行/末行,行号 1 起;未找到返回 null)。 */
function sweepSectionSpan(parsed: ParsedConfig): { startLine: number; endLine: number } | null {
  const sec = parsed.sections.find((s) => s.path === 'sweep')
  return sec ? { startLine: sec.startLine, endLine: sec.endLine } : null
}

/**
 * 把结构化表单生成为有效实验配置:候选(场景+模型)YAML 上生成/更新顶层
 * sweep 节。sweep 节整体替换(它是表单拥有的部分),其余行逐行不动
 * (未编辑的模型内容与注释逐字节保留——tests/experiment-form.test.mjs 锁)。 */
export function buildExperimentYaml(candYaml: string, design: DesignDraft): string {
  const section = sweepSectionText(design)
  const parsed = parseConfig(candYaml)
  const span = sweepSectionSpan(parsed)
  if (parsed.errors.length > 0) {
    throw new Error(`场景 YAML 解析失败,不能生成实验配置:第 ${parsed.errors[0].line} 行 ${parsed.errors[0].message}`)
  }
  let lines: string[]
  if (span) {
    lines = candYaml.split('\n')
    lines.splice(span.startLine - 1, span.endLine - span.startLine + 1)
  } else {
    lines = candYaml.split('\n')
    // 去掉文首因结尾换行产生的最后空串,保证追加处干净
    while (lines.length > 1 && lines[lines.length - 1].trim() === '') lines.pop()
  }
  const body = section.replace(/\n$/, '').split('\n')
  return [...lines, ...body, ''].join('\n')
}

/* ————— 读回(项目实验对象 → 表单草稿;WB-06.01 共享草稿引用) ————— */

export type SweepReadback =
  | { ok: true; method: DesignDraft['method']; sampling: DesignDraft['sampling']; factors: FactorDraft[]; samples: number; reps: number }
  | { ok: false; reason: string }

const MODE_TO_FORM: Record<string, { method: DesignDraft['method']; sampling: DesignDraft['sampling'] }> = {
  grid: { method: 'grid', sampling: 'lhc' },
  random: { method: 'random', sampling: 'uniform' },
  latin_hypercube: { method: 'random', sampling: 'lhc' },
}

/** 实验对象 YAML → 设计草稿子集。sweep 节缺省(如旧版场景文件)返回
 *  ok:false(调用方保留当前草稿,不静默清空)。 */
export function readSweepDesign(yaml: string): SweepReadback {
  const parsed = parseConfig(yaml)
  // sweep.parameters 的 flow 值会被 parseConfig 展开成
  // sweep.parameters.<path>.min/max/step 叶(targets 的 - {..} 项除外)。
  const num = (path: string): number | null => {
    const v = readLeafNum(parsed, path)
    return v
  }
  const modeText = readLeafText(parsed, 'sweep.mode') ?? 'grid'
  const mapping = MODE_TO_FORM[modeText]
  if (!mapping) return { ok: false, reason: `sweep.mode「${modeText}」不是内核模式(grid/random/latin_hypercube)` }
  const reps = num('sweep.replicates') ?? 5
  const samples = num('sweep.samples') ?? 0
  // 参数键:叶子路径形如 sweep.parameters.<path>.<field>;同一参数路径的
  // 三字段聚合成 FactorDraft。键本身含点,与根路径字符串还原边界处理见下。
  const factorPaths = new Map<string, { min?: number; max?: number; step?: number }>()
  const PARAMS_PREFIX = 'sweep.parameters.'
  for (const leaf of parsed.leaves) {
    if (!leaf.path.startsWith(PARAMS_PREFIX)) continue
    const tail = leaf.path.slice(PARAMS_PREFIX.length)
    const m = /^(.+)\.(min|max|step)$/.exec(tail)
    if (!m) continue
    const entry = factorPaths.get(m[1]) ?? {}
    entry[m[2] as 'min' | 'max' | 'step'] = Number(leaf.raw)
    factorPaths.set(m[1], entry)
  }
  if (factorPaths.size === 0) return { ok: false, reason: 'sweep.parameters 没有可读的参数域' }
  // 注意:YAML 键含点(如 model.warrior.attack)已被 parseConfig 原样作为
  // 一段键混入路径尾,因此 <path> 与 .min/.max 的分割点取最后一个出现且
  // 排除键冲突;这里读出的 key 即完整注册路径(分组时保持原字符串)。
  const factors: FactorDraft[] = []
  for (const [path, e] of factorPaths) {
    if (e.min === undefined || e.max === undefined) {
      return { ok: false, reason: `sweep.parameters ${path}:min/max 缺失` }
    }
    factors.push({ path, min: e.min, max: e.max, step: e.step ?? 0 })
  }
  return {
    ok: true,
    method: mapping.method,
    sampling: mapping.sampling,
    factors,
    samples,
    reps,
  }
}

function readLeafNum(parsed: ParsedConfig, path: string): number | null {
  const leaf = parsed.leaves.find((l) => l.path === path)
  if (!leaf) return null
  const n = Number(leaf.raw)
  return leaf.raw !== '' && Number.isFinite(n) ? n : null
}

function readLeafText(parsed: ParsedConfig, path: string): string | null {
  const leaf = parsed.leaves.find((l) => l.path === path)
  return leaf ? leaf.raw : null
}

/** 内核指标清单一致性(组件侧禁自造指标;WB-06.07)。 */
export function metricInPool(metric: string): boolean {
  return (KPI_POOL as readonly string[]).includes(metric)
}

export type { SweepModeName }
