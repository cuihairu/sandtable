// 中文词典·错误信息域(前缀 errors.)。真值源分片,入口见 ../zh.ts(WB-11.04)。
export const errors = {
  // 错误信息(前缀与绑定层错误串对齐,见 lib/errors.ts;{detail}=原始内核消息)
  'errors.parse': '解析失败：{detail}',
  'errors.config': '配置错误：{detail}',
  'errors.param': '参数错误：{detail}',
  'errors.serialize': '候选结果序列化失败：{detail}',
  'errors.unknown': '未知错误：{detail}',
  // 缺词兜底(WB-11.25):正式界面绝不回显翻译 key
  'errors.missingText': '（文案缺失）',
} as const
