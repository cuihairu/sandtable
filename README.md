# Sandtable

> **Sandtable is a configuration-driven simulation and experimentation framework for game systems.**

**Sandtable** 是一个面向游戏系统的配置驱动仿真与实验框架,用于长期模拟玩家、战斗、经济和成长系统,并通过实验与指标分析辅助游戏平衡。

## 项目定位(请先读这一段)

- **相对比较,而非绝对预测。** 玩家行为概率是人为设定的,仿真输出的绝对数值不可信。Sandtable 的价值在于比较:参数 A 与参数 B 跑同一场实验后的差值(如 ΔD7 Power、ΔWinRate)及其置信区间。
- **建模假设:** MVP 阶段玩家相互独立、只有 PvE 内容、经济指标是全体玩家资源产出与消耗的聚合。这是最大的建模假设,决定了"按玩家并行"的架构。引入市场、PvP 或公会后将改变架构,不属于 MVP。

## 当前状态

文档先行,代码未开始。完整计划见文档站(源码在 [`docs/`](docs/)),按修正版路线图自 Phase 1(最小闭环纵向切片)开工。

- 文档站(部署后):https://cuihairu.github.io/sandtable/
- 本地构建:`pnpm install && pnpm docs:dev`

## 文档结构

计划原文为单体文档(存档于 `docs/计划-原始.md`),现拆分为 20 章。章节与原计划的对应关系:

| 章节 | 内容 | 原计划 |
| --- | --- | --- |
| [01 项目定位](docs/guide/01-positioning.md) | 核心问题、建模假设、相对比较定位 | §1 |
| [02 产品边界](docs/guide/02-scope.md) | 做什么、不做什么、许可证 | §2 |
| [03 核心概念](docs/guide/03-concepts.md) | 七个概念、Model 与 World 拆分 | §3 |
| [04 仿真内核](docs/guide/04-kernel.md) | World 组成、执行循环、并行模型 | §4 |
| [05 时间模型](docs/guide/05-time-model.md) | 分层嵌套:离散事件 + 战斗内 tick | §4.1、§21 |
| [06 确定性随机数](docs/guide/06-deterministic-rng.md) | 带键随机数、并行确定性规则 | §5 |
| [07 配置与公式引擎](docs/guide/07-config-formula.md) | 参数注册表、config_hash、表达式编译 | §6 |
| [08 技术栈](docs/guide/08-tech-stack.md) | 选型总表与依赖决策记录 | §7、§8 |
| [09 数据输出](docs/guide/09-data-output.md) | JSON/CSV 优先,Parquet 走 feature flag | §9 |
| [10 CLI](docs/guide/10-cli.md) | 子命令与输出约定 | §10 |
| [11 实验管线](docs/guide/11-experiment-pipeline.md) | 全流程与 replicates | §11 |
| [12 参数扫描](docs/guide/12-parameter-sweep.md) | Grid / Random / Monte Carlo | §12 |
| [13 KPI 与指标](docs/guide/13-kpi-metrics.md) | 指标公式、在线聚合、置信区间判定 | §13 |
| [14 敏感性分析](docs/guide/14-sensitivity.md) | OAT 弹性(选定方法) | §14 |
| [15 平衡推荐](docs/guide/15-recommendation.md) | 插值区间、置信度定义 | §15 |
| [16 MVP](docs/guide/16-mvp.md) | 最小 RPG 闭环、A/B 对比、验收标准 | §16、§17、§26 |
| [17 项目结构](docs/guide/17-project-structure.md) | crate 划分与命名核查 | §18 |
| [18 路线图](docs/guide/18-roadmap.md) | 纵向切片 + 验证节点 | §19 |
| [19 测试策略](docs/guide/19-testing.md) | 解析解对照、快照与统计回归分层 | §20 |
| [20 设计原则与愿景](docs/guide/20-principles-vision.md) | 原则、产品形态、愿景 | §22–§25 |

## 许可证

[Apache-2.0](LICENSE)。
