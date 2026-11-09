// English dictionary · errors domain (prefix errors.). Entry fragment, see ../en.ts (WB-11.03).
export const errors = {
  // 错误信息({detail} = raw kernel message)
  'errors.parse': 'Parse failure: {detail}',
  'errors.config': 'Configuration error: {detail}',
  'errors.param': 'Parameter error: {detail}',
  'errors.serialize': 'Failed to serialize candidate results: {detail}',
  'errors.unknown': 'Unknown error: {detail}',
  // 缺词兜底(WB-11.25):正式界面绝不回显翻译 key
  'errors.missingText': '(missing text)',
} as const
