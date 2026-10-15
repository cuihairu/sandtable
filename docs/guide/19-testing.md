---
title: 19 · 测试策略
---

# 测试策略

## 分层总览

| 层 | 保证什么 | 判据 |
| --- | --- | --- |
| 单元测试 | 组件行为正确 | 断言 |
| **解析解对照** | **仿真器没写错**(机制正确性) | 仿真均值落入闭式解 CI |
| 确定性快照 | 同版本同平台可复现 | 逐位一致 |
| 统计回归 | 跨版本 / 重构不改分布 | 均值 ± CI 相容 |
| 案例 KPI 水平断言(**已建**,2026-10-15) | 案例数值改动不悄悄漂移平衡水平 | 锚值 ±10% 带 |
| 并行确定性(**已建**,2026-10-15) | 线程数不影响结果 | 逐位一致 |
| 性能 smoke(**粗粒度已建** + criterion 细基准已建,2026-10-15) | 算力预算不漂移 | 时长阈值 / 基线对比 |
| 生成物新鲜度(**已建**,2026-10-15) | 提交进仓的图与实况一致 | 订阅矩阵逐边对账 |

**解析解对照是最有力的一层**:单元测试证明"每块零件符合规格",解析解证明"整机算出来的答案客观上是对的"。

## 单元测试

覆盖:RNG 派生(键相同 → 值相同;键任一分量不同 → 值不同)、Clock / 事件队列(有序性)、公式求值(对照手算)、战斗结算、经济聚合、成长曲线、指标聚合器(对照朴素实现)。

## 解析解对照

确认模拟器没有写错的最有力手段:构造存在**闭式解**的场景,比较仿真结果与数学期望。

例 1——期望伤害:命中概率 p、命中伤害恒为 a − d,则 N 场战斗总伤害的期望是 N·p·(a−d),方差闭式可算。仿真均值必须落入闭式值 ± 3σ。

例 2——期望收益:玩家每日固定打 k 场副本、掉落期望 g,则 30 天金币总收入的期望是 30·k·g。同理对照。

例 3——流失模型:恒定流失概率 p_c 下,D7 留存的期望是 (1−p_c)⁷(与仿真口径对齐后对照)。

要求:至少一条解析解测试进入 Phase 1 验收([路线图](./18-roadmap));新增系统时,凡存在闭式解的机制必须配对照测试。

## 确定性测试:快照 vs 统计回归

::: warning 两层不要混用
**快照测试**:同版本 + 同平台 + 同 seed → 结果**逐位一致**。实现为结果摘要(规范化 JSON)的哈希快照,CI 中比对;字节级偏差即回归。

**统计回归**:跨版本或重构后,浮点结果**允许**不同(优化器、依赖升级都可能改变浮点细节),改为比较指标均值 ± CI 是否相容。

| 场景 | 用哪层 |
| --- | --- |
| 日常 CI(同平台) | 快照(逐位) |
| 升级 Rust 版本 / 依赖 / 重构后 | 快照更新 + 统计回归确认分布未漂移 |
| native ↔ wasm 比对(同配置同 seed) | 统计回归(基础算术逐位一致,超越函数允许 ULP 级差异,见[确定性随机数](./06-deterministic-rng)) |
| 跨平台比对 | 统计回归(浮点不承诺跨平台逐位) |
:::

## 并行确定性测试

同一实验在 `rayon` 线程数 = 1 / 4 / 满核下运行,结果摘要必须逐位一致。这是[并行确定性规则](./06-deterministic-rng)(有序容器、固定归约)的守卫测试。

**已建**(2026-10-15):`crates/sandtable-cli/tests/parallel_determinism.rs` 对 `sandtable sweep`(候选间 par_iter 并行的唯一面)在 `RAYON_NUM_THREADS` = 1 / 4 / 满核三档下各跑同一实验,`candidates.csv` 与 `summary.csv` 逐位相等——`run_candidate` 纯函数、`collect` 保序、采样流绑 base_seed 与线程无关;随 `cargo test --workspace` 进 CI。

## Monte Carlo 统计测试

涉及随机性的端到端性质用统计断言:多 seed 复跑后检验均值、方差、置信区间、分位数是否落在理论或历史基线范围内。**不要求**这类测试的浮点逐位一致。

## 案例 KPI 水平断言

黄金快照锚**默认配置**(内核行为变 → CI 红),不锚案例配置;`crates/sandtable-cli/tests/cases.rs` 的水平断言补这一缺口:对 `examples/pokemon.yaml`(200 玩家 × 30 天 × 1 replicate,确定性)锚 churn / retention_d7 / win_rate / 均等级的绝对水平,容差 ±10%,retention_d7 取 docs 21 硬约束下限 0.9 而非带宽(0.985 的 −10% 下探会越过健康线)。**改案例数值 = 有意变更**:须同步更新锚值,让平衡面位移出现在评审里,而不是靠人工 review 兜底。锚值口径见[真实配置验证](./21-pokemon-case)。

## 性能守卫

**已建(粗粒度,2026-10-15)**:`crates/sandtable-cli/tests/perf_smoke.rs`——10,000 玩家 × 30 天全流程(simulate + 导出)debug 时长 < 120s(实测基线 2.4s 的约 50 倍余量,只拦数量级退化,共享 runner 抖动不进判定);随 `cargo test --workspace` 进 CI。

**已建(criterion 细基准,2026-10-15,用户拍板引入)**:`crates/sandtable-core/benches/hot_paths.rs` 覆盖四个热点——公式求值(`formula_eval_xp_needed`,默认 xp_needed 公式对典型变量求值)、带键随机数派生(`rng_derive_u64`)、战斗解析结算(`combat_settle_battle`)、事件循环全流程含在线聚合(`sim_pipeline_200x30`,与案例 KPI 锚同口径 200 玩家 × 30 天 × 1 replicate)。

**运行**(仓库根,手动触发,不进常规 CI 门禁——基准耗时且共享 runner 噪声大):

```sh
cargo bench -p sandtable-core --bench hot_paths
```

**解读与回归口径**:每次输出 `[下界 均值 上界]` 置信区间;首次跑后 criterion 自动留基线,后续跑给出 `change: [x% y% z%] (p = …)` 与方向判定。口径:**均值变化 >10% 且 p < 0.05 才视为退化信号**,且只作排查信号不作门禁(共享机噪声常见 ±10-20%,单看一次输出会误判)。要做严谨对比时显式管理基线:改动前 `cargo bench -p sandtable-core --bench hot_paths -- --save-baseline before`,改动后 `--baseline before` 对照;热点结构有意变化(新增 System / 改聚合路径)后重录基线。HTML 报告在 `target/criterion/report/`。

**依赖口径**:criterion 仅 `sandtable-core` 的 dev-dependency,不进 release 依赖树;`cargo test --workspace` 会编译但不执行基准(编译耗时被 CI rust-cache 摊薄)。

## 生成物新鲜度守卫

「程序生成」只保证**生成器**与实况同源,不保证**提交进仓的那一份**被重新生成过:加了 System、改了订阅矩阵却忘了跑 example,图会静默过期,而正文仍写着「与代码同源」。`crates/sandtable-core/tests/doc_assets.rs` 补这条缝——对 `docs/assets/systems/system-graph.svg` 反解每条订阅边的行栅格,与 `system_registry` 实况逐边对账(框标签缺失、边数不符、订阅改挂都红),底部注记引用的 `crate::systems` 模块必须真实存在;失效信息直接给出重跑命令。

::: tip 覆盖面的诚实边界
公式曲线图(`docs/assets/formulas/*.svg`)**不在守卫内**:坐标映射逻辑只存在于 `formula_curves.rs`,测试里复制一份反解实现就是第二份必然漂移的实现。它的新鲜度仍靠生成器 panic(表达式编译不过即失败)+ 人工重绘。
:::

## CI 集成

GitHub Actions:每个 push 跑单元 + 快照 + 解析解对照,外加 **`cargo check --target wasm32-unknown-unknown` 平台门禁**(core 引入平台依赖立即失败,见[仿真内核](./04-kernel));统计回归在依赖升级与发布前手动触发;并行确定性守卫、性能粗粒度守卫与生成物新鲜度守卫已建(随全量测试跑,见上三节);criterion 细基准已建但**不进常规 CI 门禁**,本地 `cargo bench -p sandtable-core --bench hot_paths` 手动触发(见性能守卫节)。
