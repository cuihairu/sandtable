// 绑定层错误分类(WB-03.01 错误类型族):wasm/Tauri 命令面以字符串 Err
// 返回,前缀是稳定契约、与 CLI stderr 同源——「配置错误:」(YAML 解析 /
// load / validate 链)、「参数错误:」(参数越界 / Web 规模预算)、
// 「候选结果序列化失败:」(绑定层序列化事故);失败候选的
// status.config_error 不带前缀,由候选自身承载,不走本分类。
// 完整统一分类(初始化 / 取消 / 运行错误)是 WB-03.15,在此扩展。
export type WasmErrorKind = 'config' | 'param' | 'serialize' | 'other'

export interface WasmError {
  kind: WasmErrorKind
  /** 原始消息(含前缀),locale 化展示是 WB-03.15 */
  message: string
}

/** 前缀 → kind;顺序即匹配优先级(前缀互不为前缀,顺序无歧义) */
const PREFIXES: readonly [WasmErrorKind, string][] = [
  ['config', '配置错误'],
  ['param', '参数错误'],
  ['serialize', '候选结果序列化失败'],
]

export function classifyWasmError(message: string): WasmError {
  for (const [kind, prefix] of PREFIXES) {
    if (message.startsWith(prefix)) return { kind, message }
  }
  return { kind: 'other', message }
}
