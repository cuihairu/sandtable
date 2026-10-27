---
title: 17 · 项目结构
---

[English](/guide/17-project-structure) | [中文](/zh/guide/17-project-structure)

# 项目结构

## crate 布局

MVP 只拆两个 crate(避免过度工程化,理由见[技术栈](./08-tech-stack));平台壳按阶段增加,目录提前预留:

```text
sandtable/
├── crates/
│   ├── sandtable-core/
│   │   └── src/
│   │       ├── config.rs      # 配置加载 / 校验 / 规范化 / config_hash
│   │       ├── registry.rs    # 参数注册表(path / kind / default / desc)
│   │       ├── scenario.rs    # YAML 场景与实验文件加载(scenario+model/sweep/optimize 节)
│   │       ├── formula.rs     # 有界表达式求值器(加载期编译)
│   │       ├── rng.rs         # 带键随机数派生(SplitMix64)
│   │       ├── kernel.rs      # Clock / EventQueue / System trait(离散事件骨架)
│   │       ├── world.rs       # World 与实体存储
│   │       ├── systems/       # 内置游戏系统(behavior / combat / progression / churn / gacha)
│   │       ├── metrics.rs     # RunMetrics 与在线聚合
│   │       ├── sim.rs         # 仿真主循环(事件驱动)
│   │       ├── experiment.rs  # replicates、CRN 配对比较、统计
│   │       ├── sweep.rs       # 网格 / 随机 / LHS 扫描引擎
│   │       ├── sensitivity.rs # OAT 弹性
│   │       ├── recommend.rs   # 单轴插值推荐
│   │       ├── optimize.rs    # 进化 + Pareto 寻优
│   │       ├── surrogate.rs   # 随机森林代理(只读 sweep 产物)
│   │       ├── disttest.rs    # χ² 分布检验(disttest 子命令数据面)
│   │       ├── export.rs      # 输出渲染(JSON / CSV / 人类可读;Arrow 在 export/arrow.rs)
│   │       └── lib.rs
│   ├── sandtable-cli/
│   │   └── src/main.rs       # clap 子命令,薄封装 core(MVP)
│   ├── sandtable-wasm/       # wasm-bindgen 薄绑定(已落地:validate_config / run_simulation;native 纯函数承逻辑,wasm 层只包装,与 CLI 等价有测试锁死)
│   ├── sandtable-python/     # pyo3 薄绑定(已落地:load / run / sweep / recommend / params 只读面 + 阶段 3 日粒度读态回调 run_with_day_hook;同 wasm 双层结构独立实现,maturin 出 wheel,py_parity 与 CLI 锁死)
│   └── sandtable-engine/     # 引擎无关 JSON 契约薄壳(已落地:契约导出(有效值纪律)/ 参考导入器 / 回流约定;core path 依赖纯函数,roundtrip 回归锁死,examples/export_pokemon.rs 最小可跑)
│   └── sandtable-mcp/        # Rust 版 MCP 服务器(已落地:官方 rmcp SDK + stdio,原生直调 core——不经 wasm/Node;工具五枚 sandtable_validate / sandtable_run / sandtable_plan_sweep / sandtable_analyze / sandtable_calibrate;内核错误以 tool-level error 原文透传,交互预算上限拒绝超大运行)
│
├── apps/
│   ├── web/                  # React + TS + Vite(已落地:配置编辑 → 本地仿真 → KPI/曲线/分群表,零图表库;项目多配置选择器已落地)
│   └── desktop/              # Tauri 2 壳(Phase 7:src-tauri + core path 直连,命令面 7 个全接线,native query 已入 UI;Linux 本机先行)
│
├── examples/                 # 场景与实验 YAML(pokemon / gacha-pity / pokemon-sweep 等)
│   └── python/               # 外挂模式示例(阶段 0:kpi_report / daily_curves / parquet_analysis;零 Rust 依赖回退路径)
├── docs/                     # 本文档站(VitePress)
├── scripts/                  # scripting-design.md + scripting-perf-report.md(阶段 3 实测)+ templates/(阶段 2 官方编排模板)+ desktop_smoke.sh(桌面无头冒烟,CI desktop-smoke job 同配方)
├── .github/workflows/        # CI(含 wasm32 门禁)与 Pages 部署
└── README.md
```

## 依赖方向

```text
sandtable-cli     ─┐
sandtable-wasm    ─┼→ sandtable-core
sandtable-python  ─┤
sandtable-engine  ─┤
sandtable-mcp     ─┤
apps/desktop      ─┘
core 内部:experiment / sweep / optimize → sim → systems → world/kernel
config / scenario / registry / formula 被各层依赖
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
| config / scenario | YAML 装载、校验、规范化、config_hash | 同语义配置同 hash |
| registry / formula | 参数注册表、公式求值 | 未知路径给编辑距离建议 |
| rng | (seed, actor_id, day, event_index, purpose) 派生 | 纯函数,无共享状态 |
| kernel / world | 离散事件队列、实体存储 | 有序容器(BTreeMap / IndexMap) |
| systems | 战斗 / 经济 / 成长 / 奖励 / 行为 / 保底 | 确定性;带键随机消费 |
| metrics | 在线聚合(日粒度计数器 / 快照日分位) | 不落个体明细 |
| experiment / sweep / optimize | 编排、比较、扫描与寻优 | 统计单位 = replicate |

## 命名核查结论(2026-10)

| 平台 | 结论 |
| --- | --- |
| GitHub | `cuihairu/sandtable` 无冲突(本仓库) |
| crates.io | `sandtable` 前缀暂无冲突记录;**正式发布前需再核一次** |
| PyPI | `sandtable` 已被占用;Python 绑定**另行命名已落地**(2026-10-11 阶段 1:发行名 `sandtable-sim`,导入名 `sandtable_sim`,不占用 sandtable 名;**正式发布前按本章纪律再核一次**)——载体与分期见 [scripts/scripting-design.md](https://github.com/cuihairu/sandtable/blob/main/scripts/scripting-design.md) |

内置系统模块命名 `systems`;若未来独立成 crate 用 `sandtable-systems`,不用 `sandtable-model`(避免与概念 Model 混淆,见[技术栈](./08-tech-stack))。

## 与原计划的差异

原计划列了六个 crate(core / model / config / experiment / report / cli)。合并与调整理由:

- 配置、实验在 MVP 规模下不足以独立成 crate,拆开只会增加接口维护成本;
- `sandtable-model` 与概念 Model 重名,内容(战斗、经济系统)实际是 systems;
- report 在 HTML 阶段(Phase 5)出现真实需求时再独立;
- Web / Desktop 是壳(apps/),不是 crate——壳的职责是把 core 装进目标平台,不承载仿真语义。

扩张原则:**有真实复用或编译隔离需求时再拆**,不预设。
