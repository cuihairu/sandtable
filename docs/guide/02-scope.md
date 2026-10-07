---
title: 02 · 产品边界
---

# 产品边界

## 第一阶段做什么

- 配置驱动的游戏模型
- 长期时间推进(离散事件为主,见[时间模型](./05-time-model))
- 玩家 / Actor 模拟
- 战斗(解析结算起步)
- 资源经济
- 成长系统
- 玩家分群
- KPI / Metrics(公式化定义,见 [KPI 与指标](./13-kpi-metrics))
- Monte Carlo(多 seed 复跑)
- 参数 Sweep
- 实验结果比较
- 参数敏感性分析
- 可复现实验
- JSON / CSV 报告(Parquet 走 feature flag,见[数据输出](./09-data-output))

## 产品形态:同一内核,三种壳

Sandtable 规划三种运行形态,共用**同一个 Rust Core**,不存在 JS 重实现:

| 形态 | 定位 | 阶段 |
| --- | --- | --- |
| **CLI** | CI、大规模实验、开发者自动化 | MVP(唯一交付形态) |
| **Web**(WASM + React) | 浏览器本地跑小中型仿真,"Try in your browser" 演示与教学 | Phase 6 |
| **Desktop**(Tauri 2) | Windows 等平台的主力形态:本地文件 + native 分析,无 Node / Python 后端 | Phase 7 |

三条共性约束:

- **Local-first**:配置、实验、仿真、结果、分析全部本地完成,不需要账号、服务器、数据库、网络;
- **单一内核**:CLI / Web / Desktop 都链接 `sandtable-core`,严禁为 Web 单独写一份 JS 仿真——否则"Web 结果和桌面结果不一样"迟早发生,可复现性承诺就破了;
- **架构先行,功能后置**:MVP 只交付 CLI,但 Core 从 Phase 1 起就以"可编译 WASM、可被 Tauri 复用、与分析引擎解耦"为硬约束([仿真内核](./04-kernel)平台边界)。

## 后续方向

- 参数优化(Bayesian / Evolutionary / Pareto)
- 真实游戏引擎 Adapter
- CI 平衡回归
- Excel / CSV 配置导入(策划数值表接入)
- DuckDB 分析层与 Arrow / Parquet 数据契约(见[数据输出](./09-data-output))
- Web 版与桌面版(见[路线图](./18-roadmap) Phase 6 / 7)
- 可视化系统图与策划工作流

## MVP 明确不做

避免项目一开始失控:

- 通用 MMORPG 引擎
- 游戏服务器运行时
- 完整 Machinations 克隆
- Unity / Unreal / Godot 编辑器
- LLM 玩家、强化学习玩家
- 复杂行为树编辑器
- 在线 SaaS、多人协作平台
- 复杂自动寻优 UI

::: tip 核心原则
**先把 Simulation Kernel 和 Experiment Loop 做正确,再做产品界面。**
:::

## 与建模假设的关系

"不做"清单里的 PvP、公会、市场不是随手省略,而是与[项目定位](./01-positioning)中的建模假设一一对应:玩家独立、仅 PvE、经济为聚合量。这三个假设共同构成 MVP 的可行域;越界项(玩家间交互)属于架构级变更,列入后续方向而非 MVP 补丁。

## 许可证

项目以 **Apache-2.0** 发布,已随仓库确立。第三方依赖选型必须考虑许可证兼容性——例如 evalexpr 自 13.x 起改为 AGPL-3.0,与 Apache-2.0 项目不兼容,已从公式引擎候选中排除(详见[配置与公式引擎](./07-config-formula))。
