// WB-02.09 · 命令表匹配逻辑(纯函数,节点测试可导入;CommandSearch.tsx 消费)。
export type CommandEntry = {
  id: string
  label: string
  hint: string
  icon: string
  run: () => void
}

export function matchCommands(entries: readonly CommandEntry[], query: string, limit = 9): CommandEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return entries.slice(0, limit)
  return entries
    .filter((e) => `${e.label} ${e.hint}`.toLowerCase().includes(q))
    .slice(0, limit)
}
