---
title: 28 · 术语表
---

# 28 · 术语表

[English](/guide/28-glossary) | [中文](/zh/guide/28-glossary)

| 术语 | Term | 定义 | 证据 |
| --- | --- | --- | --- |
| 场景 | Scenario | 用户编写的 `scenario`/`model` YAML 文档；执行前先解析、注册表检查并编译。 | `crates/sandtable-core/src/scenario/file.rs:86` |
| 模型配置 | SimConfig | 内核消费的编译后类型化仿真配置；是源 YAML 与运行时语义之间的边界。 | `crates/sandtable-core/src/config/mod.rs:36` |
| 行为者 | Actor | 内存 World 中持有状态的仿真参与者，例如拥有分群、成长和资源状态的玩家。 | `crates/sandtable-core/src/world.rs:10` |
| 世界 | World | 单个 replicate 的内存状态聚合：Actor、时间、资源、指标及其他可变仿真状态。 | `crates/sandtable-core/src/world.rs:55` |
| 键控随机数流 | Keyed RNG | 从种子材料派生的具名确定性随机流，使系统可复现且不共享隐藏可变状态。 | `crates/sandtable-core/src/rng.rs:24` |
| 事件队列 | EventQueue | 按 `(tick, sequence)` 排序的确定性优先队列；同 tick 内保持调度 FIFO。 | `crates/sandtable-core/src/kernel.rs:69` |
| 系统 | System | 内核扩展 trait：声明标识、订阅事件，并对 World 执行一步变更。 | `crates/sandtable-core/src/kernel.rs:123` |
| 重复实验 | Replicate | 一次独立种子的模型执行；其指标会被保留用于聚合与比较。 | `crates/sandtable-core/src/sim.rs:41` |
| 对照实验 | Comparison / CRN | 对基线与候选输出做样本级统计比较，并用公共随机数降低方差。 | `crates/sandtable-core/src/experiment.rs:120` |
| 扫描规格 | SweepSpec | 声明式实验计划：展开参数候选，并定义执行与统计范围。 | `crates/sandtable-core/src/sweep.rs:174` |
| 引擎契约 | EngineContract | 与外部引擎适配器交换仿真载荷的版本化记录 schema 和校验边界。 | `crates/sandtable-engine/src/contract.rs:35` |
| 项目文档 | ProjectDoc | 工作台文档模型：持久化场景/实验草稿、执行结果、队列状态及相关 UI 状态。 | `apps/web/src/workbench/state/projectDoc.ts:40` |
| 配置哈希 | config_hash | 附着在结果上的规范化配置身份，用于把输出匹配到精确接受的输入。 | `crates/sandtable-core/src/config/mod.rs:90` |
| Worker 协议 | Worker Protocol | 工作台 executor 与 sweep worker 使用的版本化浏览器请求/响应契约。 | `apps/web/src/workbench/state/workerProtocol.ts:11` |
