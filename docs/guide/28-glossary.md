---
title: 28 · Glossary
---

# 28 · Glossary

[English](/guide/28-glossary) | [中文](/zh/guide/28-glossary)

| 术语 | Term | Definition | Evidence |
| --- | --- | --- | --- |
| 场景 | Scenario | A user-authored `scenario`/`model` YAML document that is parsed, registry-checked, and compiled before execution. | `crates/sandtable-core/src/scenario/file.rs:86` |
| 模型配置 | SimConfig | The compiled, typed simulation configuration consumed by the kernel; it is the boundary between source YAML and runtime semantics. | `crates/sandtable-core/src/config/mod.rs:36` |
| 行为者 | Actor | A stateful simulation participant held in the in-memory world, such as a player with cohort, progression, and resource state. | `crates/sandtable-core/src/world.rs:10` |
| 世界 | World | The per-replicate, in-memory aggregate of actors, time, resources, metrics, and other mutable simulation state. | `crates/sandtable-core/src/world.rs:55` |
| 键控随机数流 | Keyed RNG | Deterministic named random streams derived from seed material so systems can be replayed without sharing hidden mutable state. | `crates/sandtable-core/src/rng.rs:24` |
| 事件队列 | EventQueue | A deterministic priority queue ordered by `(tick, sequence)`, preserving FIFO order for events scheduled in the same tick. | `crates/sandtable-core/src/kernel.rs:69` |
| 系统 | System | The kernel extension trait that declares an identity, subscribed event types, and a mutation step over the world. | `crates/sandtable-core/src/kernel.rs:123` |
| 重复实验 | Replicate | One seeded, independent execution of the model whose metrics are retained for aggregation and comparison. | `crates/sandtable-core/src/sim/run.rs:11` |
| 对照实验 | Comparison / CRN | A sample-level statistical comparison of baseline and candidate outputs, using common random numbers to reduce variance. | `crates/sandtable-core/src/experiment/stats.rs:110` |
| 扫描规格 | SweepSpec | A declarative experiment plan that expands parameter candidates and defines execution/statistical scope. | `crates/sandtable-core/src/sweep.rs:174` |
| 引擎契约 | EngineContract | The versioned record schema and validation boundary used to exchange simulation payloads with external engine adapters. | `crates/sandtable-engine/src/contract.rs:35` |
| 项目文档 | ProjectDoc | The workbench document model that persists scenario/experiment drafts, execution results, queue state, and related UI state. | `apps/web/src/workbench/state/projectDoc.ts:40` |
| 配置哈希 | config_hash | The canonical configuration identity attached to results so outputs can be matched to the exact accepted input. | `crates/sandtable-core/src/config/mod.rs:90` |
| Worker 协议 | Worker Protocol | The versioned browser request/response contract used by the workbench executor and sweep worker. | `apps/web/src/workbench/state/workerProtocol.ts:11` |
