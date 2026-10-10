---
title: 17 · 项目结构
---

# 项目结构

## crate 布局

MVP 只拆两个 crate(避免过度工程化,理由见[技术栈](./08-tech-stack));平台壳按阶段增加,目录提前预留:

```text
sandtable/
├── crates/
│   ├── sandtable-core/
│   │   └── src/
│   │       ├── model/        # 配置编译为不可变 Model
│   │       ├── config/       # 加载、校验、注册表、规范化、config_hash
│   │       ├── rng/          # 带键随机数派生
│   │       ├── time/         # Clock 与事件调度
│   │       ├── world/        # World、实体存储、事件队列
│   │       ├── systems/      # 内置游戏系统(MVP:最小 RPG 硬编码)
│   │       ├── metrics/      # 在线聚合器与指标定义
│   │       ├── experiment/   # 运行编排、replicates、比较
│   │       └── lib.rs
│   ├── sandtable-cli/
│   │   └── src/main.rs       # clap 子命令,薄封装 core(MVP)
│   └── sandtable-wasm/       # wasm-bindgen 薄绑定(已落地:validate_config / run_simulation;native 纯函数承逻辑,wasm 层只包装,与 CLI 等价有测试锁死)
│
├── apps/
│   ├── web/                  # React + TS + Vite(已落地:配置编辑 → 本地仿真 → KPI/曲线/分群表,零图表库;项目多配置选择器已落地)
│   └── desktop/              # Tauri 2 壳(Phase 7:src-tauri + core path 直连,命令面 6 个全接线,native query 已入 UI;Linux 本机先行)
│
├── examples/
│   └── minimal-rpg/          # MVP 最小 RPG 实验配置与说明
├── docs/                     # 本文档站(VitePress)
├── .github/workflows/        # CI(含 wasm32 门禁)与 Pages 部署
└── README.md
```

## 依赖方向

```text
sandtable-cli ─┐
sandtable-wasm ─┼→ sandtable-core
apps/desktop ──┘
core 内部:experiment → systems → world/kernel;config/model 被各层依赖
分析层(DuckDB / Arrow)只被壳层调用,不进 core
```

core 不依赖任何壳;systems 不依赖 experiment;kernel 不依赖任何上层。

## 平台边界规则

| 规则 | 落点 |
| --- | --- |
| `cargo check --target wasm32-unknown-unknown` 从 Phase 1 起进 CI | [路线图](./18-roadmap) Phase 1 |
| core 禁止 `duckdb` / `web-sys` / `tokio` / 文件与网络 I/O / 壁钟 | [仿真内核](./04-kernel)平台边界 |
| 并行(rayon)是 feature,core 算法串行确定,WASM 下退化单线程 | [技术栈](./08-tech-stack) |

## 模块职责速查

| 模块 | 职责 | 关键约束 |
| --- | --- | --- |
| model | 配置编译产物,不可变 | 无运行时状态 |
| config | 注册表 / 规范化 / hash | 同语义配置同 hash |
| rng | (seed, actor_id, day, event_index, purpose) 派生 | 纯函数,无共享状态 |
| time / world | 离散事件队列、实体存储 | 有序容器(BTreeMap / IndexMap) |
| systems | 战斗 / 经济 / 成长 / 奖励 / 行为 | 确定性;带键随机消费 |
| metrics | 在线聚合(直方图 / 草图 / Welford) | 不落个体明细 |
| experiment | 编排与比较 | 统计单位 = replicate |

## 命名核查结论(2026-10)

| 平台 | 结论 |
| --- | --- |
| GitHub | `cuihairu/sandtable` 无冲突(本仓库) |
| crates.io | `sandtable` 前缀暂无冲突记录;**正式发布前需再核一次** |
| PyPI | `sandtable` 已被占用;将来 Python 绑定**另行命名**,不占用 sandtable 名(设计文档暂记候选 `sandtable_sim`,发布前按本章纪律再核)——载体与分期见 [scripts/scripting-design.md](https://github.com/cuihairu/sandtable/blob/main/scripts/scripting-design.md) |

内置系统模块命名 `systems`;若未来独立成 crate 用 `sandtable-systems`,不用 `sandtable-model`(避免与概念 Model 混淆,见[技术栈](./08-tech-stack))。

## 与原计划的差异

原计划列了六个 crate(core / model / config / experiment / report / cli)。合并与调整理由:

- 配置、实验在 MVP 规模下不足以独立成 crate,拆开只会增加接口维护成本;
- `sandtable-model` 与概念 Model 重名,内容(战斗、经济系统)实际是 systems;
- report 在 HTML 阶段(Phase 5)出现真实需求时再独立;
- Web / Desktop 是壳(apps/),不是 crate——壳的职责是把 core 装进目标平台,不承载仿真语义。

扩张原则:**有真实复用或编译隔离需求时再拆**,不预设。
