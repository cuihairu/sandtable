---
title: 17 · 项目结构
---

# 项目结构

## crate 布局

MVP 只拆两个 crate(避免过度工程化,理由见[技术栈](./08-tech-stack)):

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
│   └── sandtable-cli/
│       └── src/main.rs       # clap 子命令,薄封装 core
│
├── examples/
│   └── minimal-rpg/          # MVP 最小 RPG 实验配置与说明
├── docs/                     # 本文档站(VitePress)
├── .github/workflows/        # CI 与 Pages 部署
└── README.md
```

## 依赖方向

```text
sandtable-cli → sandtable-core
core 内部:experiment → systems → world/kernel;config/model 被各层依赖
```

core 不依赖 cli;systems 不依赖 experiment;kernel 不依赖任何上层。

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
| PyPI | `sandtable` 已被占用;将来 Python 绑定**另行命名**,不占用 sandtable 名 |

内置系统模块命名 `systems`;若未来独立成 crate 用 `sandtable-systems`,不用 `sandtable-model`(避免与概念 Model 混淆,见[技术栈](./08-tech-stack))。

## 与原计划的差异

原计划列了六个 crate(core / model / config / experiment / report / cli)。合并理由:

- 配置、实验在 MVP 规模下不足以独立成 crate,拆开只会增加接口维护成本;
- `sandtable-model` 与概念 Model 重名,内容(战斗、经济系统)实际是 systems;
- report 在 HTML 阶段(Phase 5)出现真实需求时再独立。

扩张原则:**有真实复用或编译隔离需求时再拆**,不预设。
