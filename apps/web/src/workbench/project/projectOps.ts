// P1-01 · 项目文档操作(项目与场景管理 ①):创建与复制。
// 纪律:
// - 复用既有 ProjectDoc 数据层(state/projectDoc.ts)与写回流
//   (buildProjectSave → packProject,17c95fc 已验路径);这里只做文档级
//   创建/复制,不建平行内容状态;
// - 复制 = 新项目 ID(创建型身份,生成一次)+ 同内容独立文档:对象清单、
//   归档字节、结果版本状态逐项复制,与原项目互不影响;保存走各自归档;
// - 新建项目 = 一个场景对象起步,内容取注册表默认 YAML(params/configYaml
//   的 buildDefaultYaml,与参数页「恢复全部默认值」同源),保证初始场景
//   能过内核校验、可保存、可运行;
// - 名字守卫与 packProject 同口径:trim 后非空。
import { createId, ID_PREFIXES } from '../ids.ts'
import type { ProjectDoc } from '../state/projectDoc.ts'
import { buildDefaultYaml } from '../params/configYaml.ts'

export function projectNameError(name: string): string | null {
  return name.trim() === '' ? '项目名不能为空' : null
}

function slugOf(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug === '' ? 'scenario' : slug
}

/** 新建项目:单场景起步(默认配置 YAML),内容可编辑、可保存、可运行。 */
export function createProjectDoc(name: string): { ok: true; doc: ProjectDoc } | { ok: false; error: string } {
  const clean = name.trim()
  if (clean === '') return { ok: false, error: '项目名不能为空' }
  const yaml = buildDefaultYaml()
  const path = `scenarios/${slugOf(clean)}.yaml`
  const bytes = new TextEncoder().encode(yaml)
  return {
    ok: true,
    doc: {
      projectId: createId(ID_PREFIXES.project) as ProjectDoc['projectId'],
      name: clean,
      sourceName: clean,
      objects: [{ path, kind: 'scenario', name: `${slugOf(clean)}.yaml` }],
      files: new Map([[path, bytes]]),
      resultStatus: {},
      openedAtUnix: Math.floor(Date.now() / 1000),
    },
  }
}

/**
 * 复制项目:同内容独立文档(新项目 ID)。对象、归档字节(未编辑条目按
 * 字节保真)与结果版本状态逐项复制;打开后的草稿编辑互不影响。
 */
export function duplicateProjectDoc(
  doc: ProjectDoc,
  newName: string,
): { ok: true; doc: ProjectDoc } | { ok: false; error: string } {
  const clean = newName.trim()
  if (clean === '') return { ok: false, error: '项目名不能为空' }
  return {
    ok: true,
    doc: {
      projectId: createId(ID_PREFIXES.project) as ProjectDoc['projectId'],
      name: clean,
      sourceName: clean,
      objects: doc.objects.map((o) => ({ ...o })),
      files: new Map(doc.files),
      resultStatus: { ...doc.resultStatus },
      openedAtUnix: Math.floor(Date.now() / 1000),
    },
  }
}
