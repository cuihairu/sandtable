// WB-04 · 项目文档层:打开 / 保存 / 多配置草稿 / 运行快照与运行索引。
// 纯逻辑(节点侧可测),React 组合在 WorkbenchApp 与 project/ 组件。
// 纪律:
// - 复用 lib/project.ts 的 unpackProject / packProject(WB-04.02/07),
//   校验失败返回 {ok:false},由调用方保留当前项目;
// - 基线只读(WB-04.05):打开时的参照系冻结,候选存基线引用 + 当前值 +
//   修改状态,候选 ID 内容寻址(WB-02.10 体系);
// - 草稿按对象隔离(WB-04.06):键 = 归档路径或候选 ID,切换对象互不覆盖;
// - 运行快照(WB-04.09):提交时生成不可变快照(输入 sha256、模型/schema
//   版本、seed、实验条件);内核执行接入前(WB-07)模型/schema 版本如实记
//   'unknown',不冒充已知版本;
// - 运行索引(WB-04.08):多次运行按现有路径纪律平铺为 results/<run_id>.<产物>
//   两段路径,附 results/runs.json 索引。兼容性说明:manifest 维持 schema '1'
//   不变;索引自身是 kind:'result' 条目,旧读取端按契约「result 字节不解析」
//   当作不透明产物,兼容无损;不引入嵌套路径,不制造非法三段路径。
import { packProject, unpackProject, sha256Hex } from '../../lib/project.ts'
import type { EntryKind, PackInput } from '../../lib/project.ts'
import { candidateIdFor, hashId, ID_PREFIXES, runIdFor } from '../ids.ts'
import type { BaselineId, CandidateId, ProjectId, RunId } from '../ids.ts'
import { DEMO_SOURCE, KERNEL_SOURCE, isDataSource } from '../../lib/dataSource.ts'
import type { DataSource } from '../../lib/dataSource.ts'

/* —— 打开项目(WB-04.02/03/04) —— */

/** 已保存结果的版本状态(结果条目按契约 hash 校验、默认不解析)。 */
export type ResultFileStatus =
  | { state: 'known'; version: string }
  | { state: 'unknown-version'; version: string; message: string }
  | { state: 'opaque' }

/** 项目内对象(归档条目):路径即稳定 ID,不做数组下标身份。 */
export type ProjectObject = {
  path: string
  kind: EntryKind
  /** 目录内文件名(展示用,身份仍用 path) */
  name: string
}

export type ProjectDoc = {
  /** 内容派生项目 ID(同名同内容 ⇒ 同 ID),持久化草稿按它隔离(WB-04.11) */
  projectId: ProjectId
  name: string
  /** 打开时的文件名(保存默认名) */
  sourceName: string
  objects: readonly ProjectObject[]
  /** 归档原始字节(未编辑条目按字节保真回写) */
  files: ReadonlyMap<string, Uint8Array>
  /** 每个结果条目的版本状态(未知版本给可读提示,WB-04.04) */
  resultStatus: Readonly<Record<string, ResultFileStatus>>
  openedAtUnix: number
}

export type OpenOutcome =
  | { ok: true; doc: ProjectDoc }
  | { ok: false; error: string }

/** 本工具可解析的 report.json schema_version(文档 09 章契约 v1)。 */
export const KNOWN_RESULT_VERSIONS: readonly string[] = ['1']

/**
 * WB-04.04 · 已保存结果加载:report.json 校验 meta.schema_version,
 * 未知版本给出可读提示(条目仍按字节保留,不静默丢弃);其余产物按契约
 * 不解析(状态 opaque,字节已过 sha256 校验)。
 */
export function inspectResult(path: string, bytes: Uint8Array): ResultFileStatus {
  if (!path.endsWith('.json')) return { state: 'opaque' }
  let parsed: { schema_version?: unknown; meta?: { schema_version?: unknown } }
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    // 名为 .json 但解析失败的产物:按契约 result 字节不解析,保持 opaque
    return { state: 'opaque' }
  }
  const version = parsed.meta?.schema_version ?? parsed.schema_version
  if (version === undefined) return { state: 'opaque' }
  if (typeof version !== 'string' || !KNOWN_RESULT_VERSIONS.includes(version)) {
    return {
      state: 'unknown-version',
      version: String(version),
      message:
        `结果 ${path} 的 schema_version 为 ${JSON.stringify(String(version))},` +
        `本工具支持 ${KNOWN_RESULT_VERSIONS.join('/')};条目已按字节保留(hash 校验通过),暂不做结果展示`,
    }
  }
  return { state: 'known', version }
}

/**
 * WB-04.02 · 打开 .sandtable 归档:复用 unpackProject 全量校验
 * (manifest、路径纪律、文件集合与 sha256)。失败返回 {ok:false},
 * 调用方必须保留当前项目,不得半替换。
 */
export async function openProject(bytes: Uint8Array, sourceName: string): Promise<OpenOutcome> {
  let proj
  try {
    proj = await unpackProject(bytes)
  } catch (e) {
    return { ok: false, error: `项目校验未通过,已保留当前项目:\n${String(e)}` }
  }
  const hasConfig = proj.entries.some((e) => e.kind !== 'result')
  if (!hasConfig) {
    return {
      ok: false,
      error: `${proj.name}:归档内没有 scenario / experiment 配置,已保留当前项目`,
    }
  }
  const objects = proj.entries.map((e) => ({
    path: e.path,
    kind: e.kind,
    name: e.path.split('/')[1] ?? e.path,
  }))
  const resultStatus: Record<string, ResultFileStatus> = {}
  for (const e of proj.entries) {
    if (e.kind !== 'result') continue
    resultStatus[e.path] = inspectResult(e.path, proj.files.get(e.path)!)
  }
  return {
    ok: true,
    doc: {
      projectId: hashId(ID_PREFIXES.project, 'sandtable-archive', proj.name) as ProjectId,
      name: proj.name,
      sourceName,
      objects,
      files: proj.files,
      resultStatus,
      openedAtUnix: Math.floor(Date.now() / 1000),
    },
  }
}

/** WB-04.01 · 裸 YAML 迁入工作台:包装成单场景的内存项目(可编辑、可再保存)。 */
export async function projectFromYaml(
  fileName: string,
  yaml: string,
): Promise<ProjectDoc> {
  const safeName = fileName.replace(/\.(yaml|yml|txt)$/i, '') || 'yaml-draft'
  const path = `scenarios/${safeName}.yaml`
  const bytes = new TextEncoder().encode(yaml)
  return {
    projectId: hashId(ID_PREFIXES.project, 'yaml-draft', safeName, await sha256Hex(bytes)) as ProjectId,
    name: safeName,
    sourceName: safeName,
    objects: [{ path, kind: 'scenario', name: `${safeName}.yaml` }],
    files: new Map([[path, bytes]]),
    resultStatus: {},
    openedAtUnix: Math.floor(Date.now() / 1000),
  }
}

export function objectsOfKind(doc: ProjectDoc, kind: EntryKind): ProjectObject[] {
  return doc.objects.filter((o) => o.kind === kind)
}

/* —— 只读基线与候选派生(WB-04.05) —— */

/** 基线参照系:只读,候选从中派生(结构上无修改入口)。 */
export type BaselineSource = {
  readonly baselineId: BaselineId
  readonly projectId: ProjectId
  /** 基线参照的来源对象(场景路径) */
  readonly label: string
  readonly readonly: true
}

/** 候选文档:保存基线引用、当前值与修改状态(WB-04.05)。 */
export type CandidateDoc = {
  readonly candidateId: CandidateId
  readonly baselineId: BaselineId
  /** 当前值(完整参数域) */
  readonly values: Readonly<Record<string, number>>
  /** 修改状态:相对基线被改动的参数路径(升序) */
  readonly modified: readonly string[]
  /** 是否已保存到项目文件 */
  readonly saved: boolean
}

/** 项目场景对象 → 只读基线(冻结,杜绝运行时改写)。 */
export function baselineOfProject(doc: ProjectDoc, scenarioPath: string): BaselineSource {
  return Object.freeze({
    baselineId: hashId(ID_PREFIXES.baseline, doc.projectId, scenarioPath) as BaselineId,
    projectId: doc.projectId,
    label: scenarioPath,
    readonly: true,
  })
}

/** 从基线派生候选:基线引用 + 当前值 + 修改状态一次成型。 */
export function deriveCandidate(
  baseline: BaselineSource,
  baseValues: Readonly<Record<string, number>>,
  values: Readonly<Record<string, number>>,
): CandidateDoc {
  const modified = Object.keys(values)
    .filter((k) => values[k] !== baseValues[k])
    .sort()
  return Object.freeze({
    candidateId: candidateIdFor(baseline.baselineId, values),
    baselineId: baseline.baselineId,
    values: Object.freeze({ ...values }),
    modified,
    saved: false,
  })
}

/* —— 多对象草稿(WB-04.06/04.10/04.12) —— */

export type ObjectDraft = {
  /** 编辑缓冲(该对象当前草稿内容) */
  content: string
  /** 与项目文件一致的保存状态(浏览器草稿与文件保存分开记录,WB-04.11) */
  saved: boolean
  /** 撤销栈(逐次修改前内容) */
  history: readonly string[]
  /** 重做栈(WB-05.12 统一撤销/重做;撤销时压入) */
  future: readonly string[]
}

export type DraftMap = Readonly<Record<string, ObjectDraft>>

/** 取对象草稿:无记录时回落到项目文件原文(saved = 与文件一致)。 */
export function draftOf(drafts: DraftMap, key: string, baseContent: string): ObjectDraft {
  return drafts[key] ?? { content: baseContent, saved: true, history: [], future: [] }
}

/** 只写该对象的草稿:切换对象不覆盖其他对象的缓冲(WB-04.06);
 * 新修改使重做栈失效(WB-05.12 线性历史语义)。 */
export function writeDraft(
  drafts: DraftMap,
  key: string,
  baseContent: string,
  content: string,
): DraftMap {
  const prev = draftOf(drafts, key, baseContent)
  if (prev.content === content) return drafts
  return {
    ...drafts,
    [key]: { content, saved: false, history: [...prev.history, prev.content].slice(-50), future: [] },
  }
}

export function undoDraft(drafts: DraftMap, key: string, baseContent: string): DraftMap {
  const prev = draftOf(drafts, key, baseContent)
  if (prev.history.length === 0) return drafts
  const history = [...prev.history]
  const content = history.pop() as string
  return { ...drafts, [key]: { content, saved: false, history, future: [prev.content, ...prev.future].slice(0, 50) } }
}

/** WB-05.12 · 重做:撤销过的内容按后进先出恢复;新修改(见 writeDraft)清空。 */
export function redoDraft(drafts: DraftMap, key: string, baseContent: string): DraftMap {
  const prev = draftOf(drafts, key, baseContent)
  if (prev.future.length === 0) return drafts
  const future = [...prev.future]
  const content = future.shift() as string
  return { ...drafts, [key]: { content, saved: false, history: [...prev.history, prev.content].slice(-50), future } }
}

/** 关闭文档 / 放弃修改:该对象草稿回到项目文件原文。 */
export function resetDraft(drafts: DraftMap, key: string): DraftMap {
  const next = { ...drafts }
  delete next[key]
  return next
}

/** WB-04.10 · 写盘成功后才调用:只把指定对象标为已保存,其余不动。 */
export function markSaved(drafts: DraftMap, keys: readonly string[]): DraftMap {
  let changed = false
  const next: Record<string, ObjectDraft> = { ...drafts }
  for (const key of keys) {
    const d = next[key]
    if (d && !d.saved) {
      next[key] = { ...d, saved: true }
      changed = true
    }
  }
  return changed ? next : drafts
}

/** WB-04.12 · 未保存对象清单(打开其他项目/关闭/退出前守卫的依据)。 */
export function unsavedKeys(drafts: DraftMap): string[] {
  return Object.keys(drafts).filter((k) => !drafts[k].saved)
}

/** 项目文件的原文内容(草稿回落基准)。 */
export function baseContentOf(doc: ProjectDoc, path: string): string {
  const bytes = doc.files.get(path)
  return bytes === undefined ? '' : new TextDecoder().decode(bytes)
}

/* —— 运行快照(WB-04.09) —— */

export type RunConditions = Record<string, number | string | boolean>

export type RunSnapshot = {
  readonly runId: RunId
  readonly experimentId: string
  readonly scenarioPath: string | null
  readonly experimentPath: string | null
  /** 输入 YAML 的 sha256(可追溯:同哈希 ⇒ 同输入字节) */
  readonly configHash: string
  readonly modelVersion: string
  readonly schemaVersion: string
  readonly seed: number | string
  readonly conditions: Readonly<RunConditions>
  /** WB-03.16 · 数据来源标记;快照只可能是 kernel(demo 在入口即拒) */
  readonly dataSource: DataSource
  readonly createdAtUnix: number
}

/** 场景 YAML 的 seed 字段(字面读取;解析完整 YAML 是 WB-03/05 的桥接职责)。 */
export function seedOfYaml(yaml: string): number | null {
  const m = /(^|\n)\s*seed:\s*(\d+)\s*(\n|$)/.exec(yaml)
  return m ? Number(m[2]) : null
}

/**
 * WB-04.09 · 运行提交时生成不可变输入快照:输入 sha256、模型/schema 版本、
 * seed 与实验条件,deep freeze + 内容派生 runId(同快照 ⇒ 同 run 引用)。
 * 内核执行接入前(WB-07)model/schema 版本如实记 'unknown'。
 */
export async function snapshotRun(input: {
  experimentId: string
  scenarioPath?: string | null
  experimentPath?: string | null
  yaml: string
  modelVersion?: string
  schemaVersion?: string
  seed?: number | string
  conditions?: RunConditions
  /** WB-03.16 · 缺省 kernel;显式传 synthetic_demo 即拒(写闸) */
  dataSource?: DataSource
}): Promise<RunSnapshot> {
  // WB-03.16 · 写闸:演示数据不得登记为运行快照(运行集合只收 kernel)
  if (input.dataSource === DEMO_SOURCE) {
    throw new Error('演示数据(synthetic_demo)不得登记为运行快照:真实运行集合只收 kernel 来源(WB-03.16)')
  }
  const dataSource = isDataSource(input.dataSource) ? input.dataSource : KERNEL_SOURCE
  const configHash = await sha256Hex(new TextEncoder().encode(input.yaml))
  const modelVersion = input.modelVersion ?? 'unknown'
  const schemaVersion = input.schemaVersion ?? 'unknown'
  const seed = input.seed ?? seedOfYaml(input.yaml) ?? 'unspecified'
  return Object.freeze({
    runId: runIdFor({
      experimentId: input.experimentId as Parameters<typeof runIdFor>[0]['experimentId'],
      configHash,
      seed,
      modelVersion,
      schemaVersion,
    }),
    experimentId: input.experimentId,
    scenarioPath: input.scenarioPath ?? null,
    experimentPath: input.experimentPath ?? null,
    configHash,
    modelVersion,
    schemaVersion,
    seed,
    conditions: Object.freeze({ ...input.conditions }),
    dataSource,
    createdAtUnix: Math.floor(Date.now() / 1000),
  })
}

/* —— 运行索引与产物路径(WB-04.08) —— */

/** 运行索引在归档内的固定路径(result 条目;旧读取端按不透明产物兼容)。 */
export const RUNS_INDEX_PATH = 'results/runs.json'
export const RUNS_INDEX_SCHEMA = '1'

export type RunIndexEntry = {
  run_id: string
  experiment_id: string
  scenario_path: string | null
  experiment_path: string | null
  config_hash: string
  model_version: string
  schema_version: string
  seed: number | string
  conditions: RunConditions
  /** WB-03.16 · 数据来源标记;索引只收 kernel(demo 在写/读两闸显式拒绝) */
  data_source: DataSource
  created_at_unix: number
  /** 归档内产物路径(平铺两段 results/<run_id>.<名>,过路径纪律) */
  files: readonly string[]
}

/** 产物落归档的路径:平铺两段 `results/<run_id>.<产物名>`,不嵌套子目录。 */
export function runArtifactPaths(runId: string, artifactNames: readonly string[]): string[] {
  return artifactNames.map((n) => `results/${runId}.${n}`)
}

/** 提交登记的运行索引条目(口径同 WB-04.08):快照字段逐字映射,
 *  设计侧的基线配置哈希记进 conditions 供审计;产物路径按索引纪律预留,
 *  真实执行终局由 run/artifacts 动作补齐实际产物。 */
export function runIndexEntryOf(snap: RunSnapshot, baseConfigHash: string | undefined): RunIndexEntry {
  return {
    run_id: snap.runId,
    experiment_id: snap.experimentId,
    scenario_path: snap.scenarioPath,
    experiment_path: snap.experimentPath,
    config_hash: snap.configHash,
    model_version: snap.modelVersion,
    schema_version: snap.schemaVersion,
    seed: snap.seed,
    conditions: { ...snap.conditions, base_config_hash: baseConfigHash ?? '' },
    data_source: snap.dataSource,
    created_at_unix: snap.createdAtUnix,
    files: runArtifactPaths(snap.runId, []),
  }
}

/** 序列化运行索引(条目按 run_id 排序,确定性,与打包纪律同源)。
 *  WB-03.16 · 写闸:demo 来源或来源字段缺失/非法的条目显式拒绝——
 *  演示数据不进真实运行集合,不静默修正。 */
export function runsIndexFile(runs: readonly RunIndexEntry[]): string {
  for (const r of runs) {
    if (!isDataSource(r.data_source)) {
      throw new Error(
        `运行索引条目 ${r.run_id} 的 data_source 为 ${JSON.stringify(String(r.data_source))},` +
        '真实运行集合只收 kernel(WB-03.16);来源缺失或非法都显式拒绝',
      )
    }
    if (r.data_source === DEMO_SOURCE) {
      throw new Error(`运行索引条目 ${r.run_id} 是演示数据(synthetic_demo):演示数据不得进入真实运行集合(WB-03.16)`)
    }
  }
  const sorted = [...runs].sort((a, b) => (a.run_id > b.run_id ? 1 : a.run_id < b.run_id ? -1 : 0))
  return JSON.stringify({ schema_version: RUNS_INDEX_SCHEMA, runs: sorted }, null, 2)
}

export type RunsIndexRead =
  | { ok: true; runs: RunIndexEntry[] }
  | { ok: false; error: string }

/** WB-03.02 · 缺失产物审计单位:哪个 run 的哪个文件不在场。 */
export type MissingArtifact = { runId: string; file: string }

/** 索引声称的产物逐条对照实际在场文件,缺失即显式点名(run_id + 文件)。
 * 不静默跳过、不用 0/空串填空——调用方(UI/保存)按缺失如实标注。
 * presentPaths 接受 Set 或数组(数组即 Object.keys() 的产物路径清单)。 */
export function auditRunArtifacts(
  runs: readonly RunIndexEntry[],
  presentPaths: ReadonlySet<string> | readonly string[],
): readonly MissingArtifact[] {
  const present = presentPaths instanceof Set ? presentPaths : new Set(presentPaths)
  const missing: MissingArtifact[] = []
  for (const r of runs) {
    for (const file of r.files) {
      if (!present.has(file)) missing.push({ runId: r.run_id, file })
    }
  }
  return missing
}

/** 读取运行索引:未知 schema_version 给可读错误(不做静默猜测)。
 *  WB-03.16 · 读闸:data_source 缺席 = v1 时代条目,按 kernel 推断(演示数据
 *  自始就没有进入索引的通道,缺席即 kernel 是事实推断);demo 来源显式拒绝;
 *  其他非法值可读报错,不静默降级。 */
export function readRunsIndex(text: string): RunsIndexRead {
  let parsed: { schema_version?: unknown; runs?: unknown }
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `runs.json 解析失败: ${String(e)}` }
  }
  if (parsed.schema_version !== RUNS_INDEX_SCHEMA) {
    return {
      ok: false,
      error:
        `runs.json schema_version 为 ${JSON.stringify(String(parsed.schema_version))},` +
        `本工具支持 ${RUNS_INDEX_SCHEMA};运行索引暂不可读,归档内结果文件仍按字节保留`,
    }
  }
  if (!Array.isArray(parsed.runs)) return { ok: false, error: 'runs.json 缺少 runs 数组' }
  const runs: RunIndexEntry[] = []
  for (const raw of parsed.runs) {
    const r = raw as RunIndexEntry
    if (r.data_source === DEMO_SOURCE) {
      return {
        ok: false,
        error: `运行索引条目 ${r.run_id} 是演示数据(synthetic_demo):演示数据不得混入真实运行集合(WB-03.16),归档内结果文件仍按字节保留`,
      }
    }
    if (r.data_source !== undefined && !isDataSource(r.data_source)) {
      return {
        ok: false,
        error: `运行索引条目 ${r.run_id} 的 data_source 为 ${JSON.stringify(String(r.data_source))},不是合法来源(kernel / synthetic_demo)`,
      }
    }
    runs.push(r.data_source === undefined ? { ...r, data_source: KERNEL_SOURCE } : r)
  }
  return { ok: true, runs }
}

/** WB-09.07 · 归档重开:运行索引 + 产物回读为登记簿形态,重开后续接再导出。
 * 索引缺失 = 空恢复不报错(零运行项目);索引不可读 = 可读错误(结果文件
 * 仍按字节保留,不静默丢);产物只收在场条目,缺失交给 auditRunArtifacts 点名。 */
export function restoreRunsFromArchive(
  files: ReadonlyMap<string, Uint8Array>,
): { runs: RunIndexEntry[]; artifacts: Record<string, string | Uint8Array>; error: string | null } {
  const indexBytes = files.get(RUNS_INDEX_PATH)
  if (indexBytes === undefined) return { runs: [], artifacts: {}, error: null }
  const read = readRunsIndex(new TextDecoder().decode(indexBytes))
  if (!read.ok) return { runs: [], artifacts: {}, error: read.error }
  const artifacts: Record<string, string | Uint8Array> = {}
  for (const r of read.runs) {
    for (const f of r.files) {
      const bytes = files.get(f)
      if (bytes !== undefined) artifacts[f] = bytes
    }
  }
  return { runs: read.runs, artifacts, error: null }
}

/* —— 保存编排(WB-04.07/04.10) —— */

/** 保存构建:全部配置(选中与未选中)+ 完整产物,一次进归档。 */
export async function buildProjectSave(
  doc: ProjectDoc,
  drafts: DraftMap,
  opts: {
    /** 运行产物(键 = 归档内完整路径 results/...,WB-04.08) */
    runArtifacts?: Readonly<Record<string, string | Uint8Array>>
    /** 运行索引内容(缺省按已登记运行自动生成) */
    runsIndex?: string
  } = {},
): Promise<PackInput> {
  const scenarios: Record<string, string> = {}
  const experiments: Record<string, string> = {}
  for (const o of doc.objects) {
    if (o.kind === 'result') continue
    // 草稿有编辑 → 用草稿内容;未编辑 → 原文字节保真(UTF-8 往返恒等)
    const d = drafts[o.path]
    const content = d ? d.content : baseContentOf(doc, o.path)
    if (o.kind === 'scenario') scenarios[o.path] = content
    else experiments[o.path] = content
  }
  const results: Record<string, string | Uint8Array> = {}
  // 项目既有结果(打开时已过 sha256 校验)原样保留
  for (const [path, bytes] of doc.files) {
    if (path.startsWith('results/')) results[path.slice('results/'.length)] = bytes
  }
  // 运行产物(键须为 results/ 两段路径)
  for (const [path, data] of Object.entries(opts.runArtifacts ?? {})) {
    if (!path.startsWith('results/') || path.slice('results/'.length).includes('/')) {
      throw new Error(`运行产物路径越界(须为 results/<文件> 两段): ${path}`)
    }
    results[path.slice('results/'.length)] = data
  }
  // 运行索引:调用方显式给定优先;否则仅当确有运行产物时按产物聚合兜底
  // (零运行的项目不塞空索引,保持打开→保存字节不添噪)
  let index = opts.runsIndex
  if (index === undefined) {
    const hasRunArtifacts = Object.keys(results).some(
      (n) => n !== 'runs.json' && /^run_[0-9a-z]+\./.test(n),
    )
    if (hasRunArtifacts) index = runsIndexFromArtifacts(results)
  }
  if (index !== undefined) results[RUNS_INDEX_PATH.slice('results/'.length)] = index
  return { name: doc.name, configs: { scenarios, experiments }, results }
}

/** 从产物文件聚合最小运行索引(有产物无登记时兜底,files 只列本 run 产物)。 */
function runsIndexFromArtifacts(results: Record<string, string | Uint8Array>): string {
  const runs = new Map<string, string[]>()
  for (const name of Object.keys(results)) {
    if (name === 'runs.json') continue
    // 产物命名 results/<run_id>.<产物名>;run_id 形如 run_<hex>
    const m = /^(run_[0-9a-z]+)\.(.+)$/.exec(name)
    if (!m) continue
    const files = runs.get(m[1]) ?? []
    files.push(`results/${name}`)
    runs.set(m[1], files)
  }
  return runsIndexFile(
    [...runs.entries()].map(([runId, files]) => ({
      run_id: runId,
      experiment_id: '',
      scenario_path: null,
      experiment_path: null,
      config_hash: '',
      model_version: '',
      schema_version: '',
      seed: 'unspecified',
      conditions: {},
      data_source: KERNEL_SOURCE,
      created_at_unix: 0,
      files,
    })),
  )
}

/* —— 草稿持久化(WB-04.11) —— */

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** 草稿存储键按项目隔离:浏览器草稿与项目文件保存是两条记录(WB-04.11)。 */
export const draftStorageKey = (projectId: string): string => `sandtable-wb2-project-${projectId}`

const PERSIST_VERSION = '1'

type PersistedPayload = {
  version: string
  projectId: string
  savedAt: number
  drafts: Record<string, ObjectDraft>
}

/** 浏览器草稿持久化(按项目隔离);失败返回 false(存储不可用不阻塞编辑)。 */
export function persistObjectDrafts(
  storage: StorageLike,
  doc: ProjectDoc,
  drafts: DraftMap,
): boolean {
  try {
    const payload: PersistedPayload = {
      version: PERSIST_VERSION,
      projectId: doc.projectId,
      savedAt: Date.now(),
      drafts: { ...drafts },
    }
    storage.setItem(draftStorageKey(doc.projectId), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/**
 * WB-04.11 · 刷新恢复:只恢复同一项目的草稿——projectId 不一致(跨项目)、
 * 版本不一致或载荷损坏一律丢弃,防止跨项目串数据。只保留本项目对象键。
 */
export function restoreObjectDrafts(storage: StorageLike, doc: ProjectDoc): DraftMap {
  let raw: string | null
  try {
    raw = storage.getItem(draftStorageKey(doc.projectId))
  } catch {
    return {}
  }
  if (!raw) return {}
  let parsed: PersistedPayload
  try {
    parsed = JSON.parse(raw) as PersistedPayload
  } catch {
    return {}
  }
  if (parsed.version !== PERSIST_VERSION) return {}
  // 防串数据:载荷声明的项目必须就是当前项目
  if (parsed.projectId !== doc.projectId) return {}
  const ownPaths = new Set(doc.objects.map((o) => o.path))
  const drafts: Record<string, ObjectDraft> = {}
  for (const [key, d] of Object.entries(parsed.drafts ?? {})) {
    if (!ownPaths.has(key)) continue
    if (typeof d?.content !== 'string' || typeof d?.saved !== 'boolean') continue
    drafts[key] = { content: d.content, saved: d.saved, history: [], future: [] }
  }
  return drafts
}

export function clearObjectDrafts(storage: StorageLike, doc: ProjectDoc): void {
  try {
    storage.removeItem(draftStorageKey(doc.projectId))
  } catch {
    // 存储不可用:清不掉就留着,不影响当前会话
  }
}

/* —— 文件选择与错误口径(WB-04.01/04.13) —— */

export type FilePickOutcome =
  | { ok: true; name: string; bytes: Uint8Array }
  | { ok: 'cancel' }
  | { ok: false; error: string }

/**
 * WB-04.01/04.13 · 读取文件选择结果:取消(未选文件)返回 'cancel',
 * 不是错误;读取失败映射为可读提示(权限/不可读说明原因)。
 * 桌面端说明:归档打开需要字节,走 webview 文件选择(与浏览器同一实现,
 * 取消语义一致);native 文件对话框(tauri-plugin-dialog)继续用于路径型
 * 本地查询(桌面壳 lib.rs 已注册);下载统一走 blob → 壳层 on_download →
 * ~/Downloads(既有下载处理,复用不改)。
 */
export async function readPickedFile(file: File | null | undefined): Promise<FilePickOutcome> {
  if (!file) return { ok: 'cancel' }
  try {
    return { ok: true, name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }
  } catch (e) {
    return { ok: false, error: describeFileError(file.name, e) }
  }
}

/** 路径/权限失败给可读原因(不裸抛底层错误码)。 */
export function describeFileError(name: string, err: unknown): string {
  const s = String(err ?? '')
  if (/not.?readable|NotReadable/i.test(s)) {
    return `无法读取 ${name}:文件不可读(可能已被移动、删除或被其他程序占用)`
  }
  if (/eperm|eacc|permission|denied|权限/i.test(s)) {
    return `无法读取 ${name}:权限不足,请检查文件与目录权限后重试`
  }
  if (/abort|cancel/i.test(s)) return `已取消打开 ${name}`
  return `无法打开 ${name}:${s}`
}

export { packProject }
