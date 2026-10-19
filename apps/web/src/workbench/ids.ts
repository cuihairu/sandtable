// WB-02.10 · 标识体系:Project / Baseline / Candidate / Experiment / Run / Job
// 六类持久 ID。纪律(todo 本条红线):
// - 不用数组下标或 UI 展示名充当持久 ID;数组下标只允许出现在渲染列表
//   的 React key 之外——所有列表以稳定 ID 作为身份来源;
// - 内容可推导的身份(候选参数域、运行输入快照)用内容哈希派生,同输入
//   ⇒ 同 ID,重排/筛选/部分返回后仍指向同一对象;
// - 创建型身份(项目、实验、任务)在创建时生成一次,此后不变,不随改名
//   或重渲染漂移。
// 桥接入口字段名与内核 snake_case 对齐(WB-03 接真实数据时直接复用)。

export type Brand<T, K extends string> = T & { readonly __brand: K }

export type ProjectId = Brand<string, 'ProjectId'>
export type BaselineId = Brand<string, 'BaselineId'>
export type CandidateId = Brand<string, 'CandidateId'>
export type ExperimentId = Brand<string, 'ExperimentId'>
export type RunId = Brand<string, 'RunId'>
export type JobId = Brand<string, 'JobId'>

export type StableId = ProjectId | BaselineId | CandidateId | ExperimentId | RunId | JobId

/** ID 前缀:对象域一目了然,也用于持久化数据的合法性检查。 */
export const ID_PREFIXES = {
  project: 'prj_',
  baseline: 'bls_',
  candidate: 'cnd_',
  experiment: 'exp_',
  run: 'run_',
  job: 'job_',
} as const

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES]

/** 前缀合法性:前缀_ + ≥8 位 [0-9a-z] 身份段。 */
export function isStableId(value: unknown, prefix?: IdPrefix): value is StableId {
  if (typeof value !== 'string') return false
  const re = prefix ? new RegExp(`^${prefix}[0-9a-z]{8,}$`) : /^[a-z]{3}_[0-9a-z]{8,}$/
  return re.test(value)
}

/** 展示名等价身份检查:名单/归档里常用。 */
export function sameId(a: StableId | string | null | undefined, b: StableId | string | null | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && a === b
}

/**
 * FNV-1a 双跑哈希(两条 offset basis),输出 16 位 hex。
 * 只做身份派生,不做任何安全用途。
 */
export function stableHash(input: string): string {
  const round = (basis: number): number => {
    let h = basis
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return h >>> 0
  }
  return round(0x811c9dc5).toString(16).padStart(8, '0') +
    round(0x9dc5811c).toString(16).padStart(8, '0')
}

/** 内容派生 ID:同内容恒等(规范序列化后哈希)。 */
export function hashId(prefix: IdPrefix, ...parts: ReadonlyArray<string | number | boolean>): StableId {
  const digest = stableHash(parts.map(canonicalPart).join('|'))
  return `${prefix}${digest}` as StableId
}

function canonicalPart(part: string | number | boolean): string {
  if (typeof part === 'number') {
    if (!Number.isFinite(part)) throw new Error(`hashId 收到非有限数值:${part}`)
    return String(part)
  }
  return String(part)
}

/** 创建型 ID:创建时生成一次。无 crypto 环境回退 Math.random(仍满足一次性)。 */
export function createId(prefix: IdPrefix): StableId {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replaceAll('-', '')
    : Math.random().toString(36).slice(2).padEnd(12, '0') + Date.now().toString(36)
  return `${prefix}${random.slice(0, 16)}` as StableId
}

/**
 * 候选 ID = 基线 ID + 参数域(按路径排序后规范序列化)。
 * 同基线同参数域 ⇒ 同候选(内容寻址,跨筛选/排序/会话稳定)。
 */
export function candidateIdFor(
  baselineId: BaselineId,
  values: Readonly<Record<string, number>>,
): CandidateId {
  const domain = Object.keys(values)
    .filter((path) => values[path] !== undefined)
    .sort()
    .map((path) => `${path}:${values[path]}`)
    .join(';')
  const baselineDigest = stableHash(String(baselineId)).slice(0, 8)
  const domainDigest = stableHash(domain)
  return `cnd_${baselineDigest}${domainDigest}` as CandidateId
}

/**
 * 运行 ID = 输入快照(实验 ID + 配置哈希 + seed + 模型/schema 版本)派生。
 * 同一个输入快照重复提交 → 任务重试也产出同一个 run 引用,结果可追溯。
 */
export function runIdFor(input: {
  experimentId: ExperimentId
  configHash: string
  seed: number | string
  modelVersion: string
  schemaVersion: string
}): RunId {
  return hashId(ID_PREFIXES.run, input.experimentId, input.configHash, input.seed, input.modelVersion, input.schemaVersion) as RunId
}

/** 对象引用(文档标签/项目浏览器共用):对象 ID + 稳定路径。 */
export type ObjectRef = {
  id: StableId
  kind: keyof typeof ID_PREFIXES
}

export function refOf(id: StableId): ObjectRef {
  const kind = (Object.keys(ID_PREFIXES) as Array<keyof typeof ID_PREFIXES>).find(
    (k) => isStableId(id, ID_PREFIXES[k]),
  )
  if (!kind) throw new Error(`非法稳定 ID:${String(id)}`)
  return { id, kind }
}

/* —— 领域对象骨架(WB-03 接真实数据时扩展字段) —— */

/** 基线:只读参照系,候选从中派生。 */
export type Baseline = {
  id: BaselineId
  projectId: ProjectId
  name: string
  readonly: boolean
}
