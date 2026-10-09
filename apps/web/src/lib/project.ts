// 项目文件解包(文档 09 章 `.sandtable` 契约的浏览器侧):manifest v1
// 校验与 CLI `project check` 同规——路径纪律、逐条 sha256(WebCrypto)、
// 归档文件集合与清单严格相等。scenario / experiment 的 YAML 加载校验留在
// CLI / wasm 侧,这里保证打包层完好;zip 解包用 fflate(本地打包,零外链)。
import { unzipSync } from 'fflate'

export type EntryKind = 'scenario' | 'experiment' | 'result'

export interface ProjectEntry {
  path: string
  kind: EntryKind
  sha256: string
}

export interface UnpackedProject {
  name: string
  entries: ProjectEntry[]
  files: Map<string, Uint8Array>
}

const DIR_BY_KIND: Record<EntryKind, string> = {
  scenario: 'scenarios',
  experiment: 'experiments',
  result: 'results',
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // digest 要求 ArrayBuffer 支撑的视图(FFlate 返回的是 ArrayBufferLike,
  // 先复制到确切 ArrayBuffer)
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** 与 CLI check_entry_path 同规;返回 null 表示通过。 */
function checkEntryPath(path: string, kind: EntryKind): string | null {
  if (path.includes('\\')) return `路径须用正斜杠: ${path}`
  const segs = path.split('/')
  if (path.startsWith('/') || segs.includes('..') || segs.includes('.')) {
    return `路径须为相对路径且不含 .. 或 .: ${path}`
  }
  if (segs.length !== 2) return `路径须为 <目录>/<文件> 两段: ${path}`
  if (segs[0] !== DIR_BY_KIND[kind]) {
    return `${path}: ${kind} 条目须位于 ${DIR_BY_KIND[kind]}/ 下`
  }
  if (kind !== 'result' && !segs[1].endsWith('.yaml')) {
    return `${path}: ${DIR_BY_KIND[kind]} 条目须为 .yaml`
  }
  return null
}

/** 解包并校验 .sandtable 归档;坏档抛错(文案与 CLI 同义)。 */
export async function unpackProject(data: Uint8Array): Promise<UnpackedProject> {
  const files = new Map(Object.entries(unzipSync(data)))
  const mf = files.get('manifest.json')
  if (!mf) throw new Error('归档缺少 manifest.json')
  let manifest: {
    schema_version?: string
    name?: string
    entries?: ProjectEntry[]
  }
  try {
    manifest = JSON.parse(new TextDecoder().decode(mf))
  } catch (e) {
    throw new Error(`manifest.json 解析失败: ${String(e)}`)
  }
  if (manifest.schema_version !== '1') {
    throw new Error(
      `manifest schema_version = ${manifest.schema_version},本工具支持 "1"`,
    )
  }
  const name = manifest.name?.trim() ?? ''
  if (name === '') throw new Error('manifest name 不能为空')
  const entries = manifest.entries ?? []
  const declared = new Set<string>()
  for (const e of entries) {
    if (declared.has(e.path)) throw new Error(`清单路径重复: ${e.path}`)
    declared.add(e.path)
  }
  // 归档文件集合与清单严格相等(manifest.json 除外)
  const actual = new Set(files.keys())
  actual.delete('manifest.json')
  for (const e of entries) {
    if (!actual.has(e.path)) throw new Error(`清单声明 ${e.path} 但归档中不存在`)
    actual.delete(e.path)
  }
  if (actual.size > 0) {
    throw new Error(`归档中存在清单未声明的条目:${[...actual].join(', ')}`)
  }
  const errors: string[] = []
  for (const e of entries) {
    const bad = checkEntryPath(e.path, e.kind)
    if (bad) {
      errors.push(bad)
      continue
    }
    const got = await sha256Hex(files.get(e.path)!)
    if (got !== e.sha256) {
      errors.push(`${e.path}: sha256 不匹配(清单 ${e.sha256},实际 ${got})`)
    }
  }
  if (errors.length > 0) throw new Error(`项目校验失败:\n${errors.join('\n')}`)
  return { name, entries, files }
}
