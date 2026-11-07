// 模型数据流依赖图(ST-WB-011,设计器向):节点 = 系统流,边 = 资源/数据
// 流向。分层布局是纯函数、确定性、可测;节点位置可拖拽只是视觉辅助,
// 不进 scenario/模型。

export type GraphNode = { readonly id: string; readonly layer: number }
export type GraphEdge = { readonly from: string; readonly to: string; readonly label: string }
export type GraphPos = { x: number; y: number }

/** 7 个系统流节点;layer 决定横向分层(progression→combat 是回边:战斗
 * 变强 → 赚金币 → 升级 → 战斗,游戏主环天然成环,布局按前向层展开)。 */
export const GRAPH_NODES: readonly GraphNode[] = [
  { id: 'combat', layer: 0 },
  { id: 'gacha', layer: 0 },
  { id: 'training', layer: 0 },
  { id: 'churn', layer: 0 },
  { id: 'economy', layer: 1 },
  { id: 'loot', layer: 1 },
  { id: 'progression', layer: 2 },
]

/** 数据流边:combat→loot(胜利掉落表)、combat→economy(副本金币)、
 * gacha→economy(抽卡消耗回流)、training→progression(练级经验)、
 * economy→progression(升级消耗)、progression→combat(战力回补,
 * 回边)、churn→combat(流失离场)。 */
export const GRAPH_EDGES: readonly GraphEdge[] = [
  { from: 'combat', to: 'loot', label: 'on_victory' },
  { from: 'combat', to: 'economy', label: 'gold' },
  { from: 'gacha', to: 'economy', label: 'pulls' },
  { from: 'training', to: 'progression', label: 'xp' },
  { from: 'economy', to: 'progression', label: 'upgrade' },
  { from: 'progression', to: 'combat', label: 'power' },
  { from: 'churn', to: 'combat', label: 'exit' },
]

/** 确定性分层布局:同层节点按 id 排序纵向均分,层间横向均分。
 * 返回每个节点的中心坐标(纯函数,不依赖任何外部状态)。 */
export function graphLayout(width: number, height: number): Record<string, GraphPos> {
  const maxLayer = Math.max(...GRAPH_NODES.map((node) => node.layer))
  const columns = maxLayer + 1
  const padX = 70
  const padY = 30
  const positions: Record<string, GraphPos> = {}
  for (let layer = 0; layer < columns; layer++) {
    const members = GRAPH_NODES.filter((node) => node.layer === layer).sort((a, b) => a.id.localeCompare(b.id))
    members.forEach((node, index) => {
      positions[node.id] = {
        x: columns === 1 ? width / 2 : padX + (layer * (width - 2 * padX)) / (columns - 1),
        y: padY + ((index + 0.5) * (height - 2 * padY)) / members.length,
      }
    })
  }
  return positions
}
