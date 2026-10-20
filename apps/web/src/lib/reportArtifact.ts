// WB-09.06 · report.json 产物语义单点(数据工作区 App 与 CLI 同构):
// meta 四个环境字段(generated_at_unix / git_sha / schema_version /
// model_version)+ results 原样透传——与 CLI simulate --out 写盘的
// {meta, results} 同构(main.rs meta_json 同口径),results 逐值一致由
// web_parity 锁死;环境字段不参与确定性,前端不重算不补字段。
// config_hash 不在顶层:它随每个 result 条目携带(RunMetrics 字段)。
import type { SimOutput } from './types.ts'

/** report.json 内容(文档 09 章契约):环境字段 + 结果,与 CLI report 产物同构。 */
export function reportJson(out: SimOutput): string {
  return JSON.stringify(
    {
      meta: {
        // 环境字段(文档 22 绑定纪律):时间戳取导出时刻,
        // git_sha 由构建注入(VITE_GIT_SHA),未注入回退 unknown(与 CLI 同)
        generated_at_unix: Math.floor(Date.now() / 1000),
        git_sha: import.meta.env?.VITE_GIT_SHA ?? 'unknown',
        schema_version: out.meta.schema_version,
        model_version: out.meta.model_version,
      },
      results: out.results,
    },
    null,
    2,
  )
}
