// ST-WB-011 · 模型数据流依赖图(节点侧守卫):
// - 节点 7 个、id 唯一;边端点合法、无自环;
// - graphLayout 纯函数:位置在界内、同层同 x、层序 x 单调、确定性(两次调用一致)。
// 跑法(仓库根):node --test apps/web/tests/dependency-graph.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

import { GRAPH_EDGES, GRAPH_NODES, graphLayout } from '../src/workbench/designer/dependencyGraph.ts'

test('节点 7 个且 id 唯一', () => {
  assert.equal(GRAPH_NODES.length, 7)
  const ids = GRAPH_NODES.map((node) => node.id)
  assert.equal(new Set(ids).size, ids.length)
})

test('边端点合法且无自环', () => {
  const ids = new Set(GRAPH_NODES.map((node) => node.id))
  assert.ok(GRAPH_EDGES.length >= 7, '主环至少 7 条数据流边')
  for (const edge of GRAPH_EDGES) {
    assert.ok(ids.has(edge.from), `未知边起点:${edge.from}`)
    assert.ok(ids.has(edge.to), `未知边终点:${edge.to}`)
    assert.notEqual(edge.from, edge.to, `自环:${edge.from}`)
  }
})

test('graphLayout 位置在界内且键与节点一一对应', () => {
  const layout = graphLayout(720, 300)
  assert.deepEqual(Object.keys(layout).sort(), GRAPH_NODES.map((node) => node.id).sort())
  for (const point of Object.values(layout)) {
    assert.ok(point.x >= 0 && point.x <= 720, `x 出界:${point.x}`)
    assert.ok(point.y >= 0 && point.y <= 300, `y 出界:${point.y}`)
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
  }
})

test('graphLayout 同层同 x、层序 x 单调', () => {
  const layout = graphLayout(720, 300)
  const byLayer = new Map()
  for (const node of GRAPH_NODES) {
    if (!byLayer.has(node.layer)) byLayer.set(node.layer, [])
    byLayer.get(node.layer).push(layout[node.id])
  }
  const xs = [...byLayer.keys()].sort((a, b) => a - b).map((layer) => {
    const points = byLayer.get(layer)
    for (const point of points) assert.equal(point.x, points[0].x, `同层 x 不一致(层 ${layer})`)
    return points[0].x
  })
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] > xs[i - 1], `层序 x 未单调递增:${xs[i - 1]} → ${xs[i]}`)
})

test('graphLayout 纯函数:两次调用结果一致', () => {
  assert.deepEqual(graphLayout(720, 300), graphLayout(720, 300))
})
