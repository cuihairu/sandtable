---
title: 08 · 技术栈
---

# 技术栈

## 语言与形态

核心实现语言为 **Rust**。理由:高性能、内存安全、并行能力强、CLI 生态成熟、WASM 支持良好、可嵌入其他工具,适合长期运行大规模仿真。

核心要求:

```text
Deterministic · Headless · Parallel · Embeddable · Testable
```

## 选型总表

| 层 | 技术 | 阶段 |
| --- | --- | --- |
| Core | Rust | MVP |
| CLI | clap | MVP |
| 序列化 | serde + serde_json | MVP |
| 配置(YAML) | serde_yaml_ng(选型理由见[配置与公式引擎](./07-config-formula)) | MVP |
| 配置(JSON/规范化) | serde_json | MVP |
| 错误处理 | thiserror(core)/ anyhow(cli) | MVP |
| 随机数 | rand_core 兼容的带键派生(纯函数,见[确定性随机数](./06-deterministic-rng)) | MVP |
| 并行 | rayon(实验级并行;归约规则见确定性章节) | MVP |
| 表达式求值 | 内置最小求值器(加载期编译) | MVP |
| 数据输出 | JSON + CSV | MVP |
| Parquet / Arrow | **feature flag**(编译重、依赖多,MVP 不默认启用) | 按需 |
| 测试 | Rust 内置 test + 快照 | MVP |
| Benchmark | criterion | MVP 起,按需 |
| CI | GitHub Actions | MVP |
| 异步运行时 | **tokio 不进 MVP**(CPU 密集仿真无异步需求) | Web API 阶段引入 |
| Web API | Axum(届时随 tokio 引入) | 后续 |
| Web UI | React + TypeScript | 后续 |
| 图表 | ECharts / Plotly | 后续 |
| 系统图 | React Flow | 后续 |
| 脚本扩展候选 | rhai(评估项,未定) | 后续 |
| WASM | wasm-bindgen | 后续 |

::: warning 依赖纪律
- **criterion 只在 Benchmark 一行出现**,不与测试混记;
- **tokio / Axum 等异步栈**在 Web API 阶段之前不得进入依赖树;
- 引入任何依赖前检查许可证兼容性(Apache-2.0 项目排除 AGPL 依赖,实例:evalexpr)。
:::

## crate 划分

MVP 只拆两个 crate,避免过度工程化:

| crate | 职责 |
| --- | --- |
| `sandtable-core` | 内核 + 配置 + 实验:Model 编译、参数注册表、RNG、时间推进、World、内置系统(`systems` 模块)、指标、实验管线 |
| `sandtable-cli` | clap 命令行,薄封装 core |

::: warning 命名约定
内置系统(战斗、经济、成长等)在 core 内的模块叫 **`systems`**。若未来独立成 crate,命名为 `sandtable-systems`——**不用 `sandtable-model`**,避免与概念上的 Model(配置编译产物)重名混淆。
:::

未来可能独立的 crate(均非现在):report(HTML 报告)、experiment(若实验层膨胀)。

## 原则

> Core 尽量保持纯 Rust:不依赖 Web,不依赖数据库,不依赖具体游戏引擎。

core 不依赖 cli;systems 模块不依赖 experiment 模块(方向:experiment → systems → kernel)。
