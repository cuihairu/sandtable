// 查询结果列式化与视图命名(纯函数,零依赖):从 duck.ts 抽出,让 node
// --test 守卫可以直接 import(duck.ts 顶层带 vite `?url` 导入,node 解析不了)。
// BigInt 归一是 2026-10-13 WebKit 崩溃修复的边界,回归即整页白屏复发,
// 守卫锁死(tests/columns.test.mjs)。

export type QueryColumn = { name: string; values: (string | number | null)[] }

/** Arrow 结果表 → 列式数据。Arrow Int64 列 toArray() 出 BigInt 值;
 * WebKit(JSC)下流向 React 渲染会 throw「Invalid argument type in
 * ToBigInt operation」(2026-10-13 无头走查,ErrorBoundary 把白屏换成
 * 这条文案才定位到)。指标值域在 2^53 内,序列化边界统一归一 number,
 * 浏览器/壳两端行为一致。 */
export function toColumns(table: {
  schema: { fields: { name: string }[] }
  getChild: (name: string) => { toArray: () => unknown[] } | null
}): QueryColumn[] {
  return table.schema.fields.map((f) => ({
    name: f.name,
    values: ((table.getChild(f.name)?.toArray() ?? []) as unknown[]).map((v) =>
      typeof v === 'bigint' ? Number(v) : (v as string | number | null),
    ),
  }))
}

/** 结果文件名词根 → 合法视图名:非法字符转 _,非字母开头加 t_ 前缀,
 * 冲突加序号(项目载入/native query 同一注册规则)。 */
export function tableName(path: string, used: Set<string>): string {
  const base = path.split(/[\\/]/).pop() ?? 'file'
  const stem = base.replace(/\.[^.]*$/, '').replace(/[^a-zA-Z0-9_]/g, '_')
  const safe = /^[A-Za-z_]/.test(stem) ? stem : `t_${stem}`
  let name = safe
  let i = 2
  while (used.has(name)) name = `${safe}_${i++}`
  return name
}
