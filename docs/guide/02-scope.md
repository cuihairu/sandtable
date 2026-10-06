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

## 后续方向

- 参数优化(Bayesian / Evolutionary / Pareto)
- 真实游戏引擎 Adapter
- CI 平衡回归
- Excel / CSV 配置导入(策划数值表接入)
- Web UI 与可视化系统图
- 策划工作流

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
