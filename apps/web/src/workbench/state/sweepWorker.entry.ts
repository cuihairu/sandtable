// WB-07.09 · 真实 Worker 入口:在 Worker 线程初始化并复用 WASM,主线程保持
// 可交互。绑定与 serveSweepWorker 在此对接;本文件不做任何业务决策。
// 桌面壳(Tauri)不走 Worker:native 命令面本就在后台线程执行。
import init, {
  run_simulation as runSim,
  sweep_plan as sweepPlan,
  sweep_candidate as sweepCandidate,
  sweep_recommend as sweepRecommend,
  ab_compare as abCompare,
  optimize as optimizeBinding,
  surrogate_train as surrogateTrainBinding,
  surrogate_predict as surrogatePredictBinding,
  daily_aggregate as dailyAggregateBinding,
  kpi_eval as kpiEvalBinding,
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
  optimize: async (yaml) =>
    JSON.parse(optimizeBinding(yaml) as unknown as string),
  surrogateTrain: async (results, metric, trees, maxDepth, minSamplesLeaf, seed) =>
    JSON.parse(
      // wasm u64 → JS bigint(wasm-bindgen ABI),超参上限由内核 SurrogateSpec::validate 拦
      surrogateTrainBinding(JSON.stringify(results), metric, trees, maxDepth, minSamplesLeaf, BigInt(seed)) as unknown as string,
    ),
  surrogatePredict: async (modelJson, paramsJson) =>
    JSON.parse(surrogatePredictBinding(modelJson, paramsJson) as unknown as string),
  dailyAggregate: async (results) =>
    JSON.parse(dailyAggregateBinding(JSON.stringify(results)) as unknown as string),
  kpiEval: async (expression, results) =>
    JSON.parse(kpiEvalBinding(expression, JSON.stringify(results)) as unknown as string),
})

self.onmessage = (e: MessageEvent): void => {
  void server.onMessage(e.data)
}
