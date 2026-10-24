---
layout: home

hero:
  name: Sandtable
  text: 面向游戏系统的配置驱动仿真与实验框架
  tagline: 把游戏系统放进数字沙盘——调整参数,推演 7 / 30 / 90 天,用指标与置信区间比较差异,辅助平衡决策。
  actions:
    - theme: brand
      text: 从项目定位开始
      link: /zh/guide/01-positioning
    - theme: alt
      text: 路线图
      link: /zh/guide/18-roadmap
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
    details: 不存每个玩家每步的数据。日粒度整数计数与增量统计,加固定快照日(D1 / 3 / 7 / 14 / 30)分位直算;事件队列按日滚动排程,十万玩家 × 90 天也在内存预算内。
  - title: 相对比较立场
    details: 玩家行为概率是人为设定的,输出的绝对数值不可信。Sandtable 的价值在 A/B 差值(ΔD7 Power 这类),不在绝对预言。
  - title: 单核三形态
    details: 同一 Rust 内核跑 CLI / Web(WASM)/ Desktop(Tauri 2)。core 可编译 wasm32 是 Phase 1 的 CI 门禁;浏览器跑小中型,桌面与 CLI 跑大型;local-first,无服务器。
footer:
  message: "本页为中文首页；请使用导航栏语言切换器访问英文站点。"
  copyright: Apache-2.0
---

## 架构总览

一个纯 Rust 内核，各消费面并列在旁边 —— CLI、Web 工作台（WASM）、桌面壳（Tauri 2）、Python 绑定与游戏引擎契约。仿真、分析与产物都留在用户本机，链路里没有服务器。实线是业务 / 数据流，虚线是注册表查找：

<figure style="margin:0">
  <picture>
    <source media="(max-width: 720px)" type="image/svg+xml" srcset="/architecture/system-zh-mobile.svg"/>
    <img src="/architecture/system-zh.svg" alt="sandtable 架构：单内核与各消费面" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
  </picture>
  <figcaption>内核与其配置 / KPI 注册表、各壳之间的数据流；窄屏下为同一内容的竖排改版。</figcaption>
</figure>

图里的 crate 与目录对应关系见[项目结构](/zh/guide/17-project-structure)。

## 界面预览

数值实验工作台 V2（`apps/web` 交互原型，内置合成样例数据）的五个工作区，也是桌面（Tauri）端实现的设计基准（见[桌面对齐基准](../专业工作台桌面对齐基准.md)）：

<div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:8px">
  <figure style="flex:1 1 460px;margin:0">
    <img src="../assets/screenshots/analysis.png" alt="结果分析工作区" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>结果分析</strong> —— 参数响应图 + 95% CI、候选表与检查器三方联动，看扫描结果与约束判定。</figcaption>
  </figure>
  <figure style="flex:1 1 460px;margin:0">
    <img src="../assets/screenshots/parameters.png" alt="参数编辑工作区" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>参数编辑</strong> —— 注册表参数宽表：基线只读、候选值可编辑，支持批量修改与类型校验。</figcaption>
  </figure>
  <figure style="flex:1 1 460px;margin:0">
    <img src="../assets/screenshots/designer.png" alt="实验设计工作区" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>实验设计</strong> —— A/B / Grid / Random-LHS 方法选择、运行预算与运行前基础校验。</figcaption>
  </figure>
  <figure style="flex:1 1 460px;margin:0">
    <img src="../assets/screenshots/runs.png" alt="运行任务工作区" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>运行任务</strong> —— 任务队列的进度与取消；已有样例结果独立保留。</figcaption>
  </figure>
  <figure style="flex:1 1 460px;margin:0">
    <img src="../assets/screenshots/exchange.png" alt="数据与导出工作区" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>数据与导出</strong> —— CSV / JSON / SVG 下载，保留参数 ID、指标口径与 CI。</figcaption>
  </figure>
  <figure style="flex:1 1 460px;margin:0">
    <img src="../assets/screenshots/analysis-768.png" alt="768px 窄屏下的结果分析工作区" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>窄屏适配</strong> —— 768px 下图表、候选表与检查器仍可同屏操作。</figcaption>
  </figure>
</div>

