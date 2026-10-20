// 绑定层错误分类(WB-03.01 错误类型族 / WB-03.15 统一分类):wasm/Tauri
// 命令面以字符串 Err 返回,前缀是稳定契约、与 CLI stderr 同源——
// 「配置错误:」(YAML 解析 / load / validate 链)、「参数错误:」(参数
// 越界 / Web 规模预算 / 结果数组解析)、「候选结果序列化失败:」(绑定层
// 序列化事故);失败候选的 status.config_error 不带前缀,由候选自身
// 承载,不走本分类。执行侧六类统一分类(WB-03.15):解析失败(本表
// parse)+ 配置错误 / 参数错误 / 序列化 = 本表;初始化中/初始化失败/
// 运行错误/取消走任务状态面(ExecErrorClass init/run/budget/bridge +
// statusLabel running/cancelled,词典侧 taskText/localeWasmError)。
export type WasmErrorKind = 'parse' | 'config' | 'param' | 'serialize' | 'other'

export interface WasmError {
  kind: WasmErrorKind
  /** 原始消息(含前缀),locale 化展示是 WB-03.15 */
  message: string
  /** 剥掉通道前缀后的正文:locale 模板 {detail} 用它,避免重复前缀 */
  detail: string
}

/** 前缀 → kind;顺序即匹配优先级(前缀互不为前缀,顺序无歧义) */
const PREFIXES: readonly [WasmErrorKind, string][] = [
  ['config', '配置错误'],
  ['param', '参数错误'],
  ['serialize', '候选结果序列化失败'],
]

/** 解析失败是独立类(WB-03.15):内核把 YAML 解析并进 配置错误 通道、结果
 *  数组解析失败带 参数错误 前缀(前缀契约不动),展示层按「解析失败」事实
 *  升级为 parse 码——通道语义(改配置 / 改输入)与失败阶段(没解析过)分开。 */
const PARSE_FACT = '解析失败'

/** 剥通道前缀(含全/半角冒号与空白);无前缀则原样返回 */
function stripChannelPrefix(message: string): string {
  for (const [, prefix] of PREFIXES) {
    if (message.startsWith(prefix)) {
      return message.slice(prefix.length).replace(/^[：:]\s*/, '')
    }
  }
  return message
}

export function classifyWasmError(message: string): WasmError {
  const detail = stripChannelPrefix(message)
  if (message.includes(PARSE_FACT)) return { kind: 'parse', message, detail }
  for (const [kind, prefix] of PREFIXES) {
    if (message.startsWith(prefix)) return { kind, message, detail }
  }
  return { kind: 'other', message, detail: message }
}
