// WB-07.09 · 真实 Worker 入口:在 Worker 线程初始化并复用 WASM,主线程保持
// 可交互。绑定与 serveSweepWorker 在此对接;本文件不做任何业务决策。
// 桌面壳(Tauri)不走 Worker:native 命令面本就在后台线程执行。
import init, {
  run_simulation as runSim,
  sweep_plan as sweepPlan,
  sweep_candidate as sweepCandidate,
  sweep_recommend as sweepRecommend,
  ab_compare as abCompare,
} from 'sandtable-wasm'
import { serveSweepWorker } from './sweepWorker.ts'

const server = serveSweepWorker({
  post: (msg) => self.postMessage(msg),
  init: () => init(),
  plan: async (yaml, replicatesOverride) =>
    JSON.parse(sweepPlan(yaml, replicatesOverride) as unknown as string),
  sim: async (yaml, replicates) =>
    JSON.parse(runSim(yaml, replicates) as unknown as string),
  candidate: async (yaml, replicates, values) =>
    JSON.parse(sweepCandidate(yaml, replicates, JSON.stringify(values)) as unknown as string),
  recommend: async (yaml, results) =>
    JSON.parse(sweepRecommend(yaml, JSON.stringify(results)) as unknown as string),
  abCompare: async (baseYaml, candYaml, metric, resultsA, resultsB) =>
    JSON.parse(abCompare(baseYaml, candYaml, metric, JSON.stringify(resultsA), JSON.stringify(resultsB)) as unknown as string),
})

self.onmessage = (e: MessageEvent): void => {
  void server.onMessage(e.data)
}
