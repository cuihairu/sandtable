---
layout: home

hero:
  name: Sandtable
  text: 面向游戏系统的配置驱动仿真与实验框架
  tagline: 把游戏系统放进数字沙盘——调整参数,推演 7 / 30 / 90 天,用指标与置信区间比较差异,辅助平衡决策。
  actions:
    - theme: brand
      text: 从项目定位开始
      link: /guide/01-positioning
    - theme: alt
      text: 路线图
      link: /guide/18-roadmap
    - theme: alt
      text: GitHub
      link: https://github.com/cuihairu/sandtable

features:
  - title: 配置驱动
    details: Model 与 Scenario 分离。游戏数值、公式、规则进配置;实验环境单独描述,改参数不改代码。
  - title: 分层时间模型
    details: 宏观时间线用离散事件推进,Fixed Tick 只在单场战斗内部可选使用。MVP 战斗采用解析结算,避开全程 tick 的算力陷阱。
  - title: 确定性优先
    details: 带键随机数 (seed, actor_id, day, event_index, purpose),与调用顺序无关。同配置同 seed,结果逐位一致;改参数后随机路径仍可比。
  - title: 实验一等公民
    details: Grid / Random 扫描、多 seed 复跑、候选比较是核心模型而非外挂脚本。约束判定基于置信区间,不是点估计。
  - title: 在线聚合指标
    details: 不存每个玩家每步的数据。固定分箱直方图、分位数草图、增量统计,十万玩家 × 90 天也在内存预算内。
  - title: 相对比较立场
    details: 玩家行为概率是人为设定的,输出的绝对数值不可信。Sandtable 的价值在 A/B 差值(ΔD7 Power 这类),不在绝对预言。
---
