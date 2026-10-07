---
title: 09 · 数据输出
---

# 数据输出

不要让 CSV 成为唯一输出格式,也不要让 Parquet 成为 MVP 负担。

## MVP:JSON + CSV(schema 即契约)

| 格式 | 用途 | 内容 |
| --- | --- | --- |
| JSON | 元数据与结论 | 实验标识(seed / config_hash / schema_version / 代码版本)、配置快照、指标汇总、约束判定、候选比较、推荐 |
| CSV | 人工查看与交换 | 指标时间序列(按天)、群体分布、cohort 切片、A/B 比较表——策划可直接用 Excel 打开 |

::: tip MVP 的 CSV / JSON 列设计就是 Arrow 契约
列名、列序、类型从 MVP 起按"可直接映射为 Arrow RecordBatch"设计(首列天索引、明确 NaN 表示、整数计数、UTF-8)。Phase 2 增加 Arrow / Parquet 载体时只是**换包装,不改语义**,已有消费者不破坏。
:::

每次运行的输出目录约定:

```text
experiment/
├── run-0001/
│   ├── meta.json        # 实验标识、配置快照、运行环境
│   ├── metrics.csv      # 按天指标(均值、分位数)
│   └── summary.json     # 汇总指标 + 置信区间 + 约束判定
├── run-0002/
└── compare.json         # 候选比较与差值(多 run 时)
```

`meta.json` 中的字段由运行环境生成(时间戳、路径、机器信息),**不参与**结果摘要的确定性哈希——同 seed 重跑的 `summary.json` 应当逐位一致(见[测试策略](./19-testing))。

## Arrow:仿真 → 分析 → 可视化的数据契约

数据从仿真流向分析的中间表示统一为 Arrow:

```text
Simulation(在线聚合)
     ↓
结果数据集(RecordBatch)
     ↓
┌────┼──────────┐
↓    ↓          ↓
Parquet  DuckDB   DuckDB-Wasm / polars / pandas
```

选 Arrow 而不是直连某一家分析工具,是因为它是零拷贝跨语言契约:Rust(arrow-rs)、DuckDB、Python(polars / pandas)、JS 都原生读写;DuckDB 官方 Rust 客户端(duckdb-rs)与 DuckDB-Wasm 均提供 Arrow 互操作。

## DuckDB:分析引擎,不是仿真状态库

::: warning 定位红线
**DuckDB 只读结果数据集,不进仿真路径。** 仿真状态是 Rust 结构体,指标走在线聚合([KPI 与指标](./13-kpi-metrics));把每个事件 INSERT 进 DuckDB 等于把分析数据库变成运行时数据库,10⁷ 量级事件下既慢又没必要。
:::

它承担的是**事后探索**——实验产出的是典型分析型数据(`player_id / day / cohort / level / power / gold / win / reward`),SQL 是比自建 Aggregator 家族更强的查询层:

```sql
-- 分 cohort 的 D7 战力
SELECT cohort, avg(power),
       percentile_cont(0.5) WITHIN GROUP (ORDER BY power)
FROM player_daily WHERE day = 7 GROUP BY cohort;

-- 分 cohort 的经济收支差
SELECT cohort, avg(gold_income), avg(gold_spending),
       avg(gold_income - gold_spending)
FROM economy_daily GROUP BY cohort;
```

- **native**(Phase 3,CLI / 桌面):duckdb-rs,内存或文件库,直接读 Parquet / CSV;
- **浏览器**(Phase 6,Web):DuckDB-Wasm 读随结果携带的 Parquet / CSV,SQL 完全在本地执行。

### Web 形态的规模边界

DuckDB-Wasm 默认单线程,且 WASM 内存有官方 4GB 上限(浏览器实际更严)。因此 **Web 定位小中型仿真**(演示、教学、参数实验、快速交互),万级玩家 × 大量 replicates 的大型 sweep 走 CLI / Desktop——分层时间模型让单次仿真的事件量在 10⁷ 级,中小型实验放进浏览器是现实的([时间模型](./05-time-model))。

## Parquet:Phase 2 起,feature flag

Parquet 适合大规模时序、群体明细与 notebook 分析,但 Arrow 系依赖编译重、依赖树大。**MVP 不默认启用**;Phase 2 作为 feature 提供导出,DuckDB 分析层以其为主要输入。

## HTML 报告

最终实验报告、图表、KPI 展示、参数对比的 HTML 输出属于报告阶段(见[路线图](./18-roadmap) Phase 5),不在 MVP 内。

## 项目打包:导入 / 导出(规划)

::: note 概念定位
**Project(项目)是配置组织单元,不新增仿真语义**——一个 Project 把若干 Model、Scenario、Experiment 定义(可选:最近一次结果)打包为**单个可交换文件**,在任何形态(CLI / Web / Desktop)之间导入导出。七个核心概念不变,Project 只是它们的容器。
:::

倾向形态:zip 归档 + 清单(示意,细节待定):

```text
mysim.sandtable (zip)
├── manifest.yaml      # schema_version、名称、包含的条目清单
├── models/*.yaml
├── scenarios/*.yaml
├── experiments/*.yaml
└── results/           # 可选:最近实验结果(JSON/CSV/Parquet)
```

- 导入即校验:schema_version、参数注册表、config_hash 重算,坏档明确报错;
- 与 Web 形态天然互补:浏览器里直接打开一个项目文件即可复现实验;
- 排期在 Phase 5(报告与真实配置验证)之后评估,见[路线图](./18-roadmap)。

## 配置接入:Excel / CSV 导入(待评估)

策划的数值表大多维护在 Excel / CSV 里,从现有配置表导入可能比 YAML 手工编辑更影响实际采用。列入后续方向(Phase 5 评估):CSV 数值表 → 参数注册表 的导入通道。MVP 阶段手工转换。

## 分析侧接口

- 保证 CSV / Parquet(feature 启用时)输出质量,使 notebook 分析顺畅;
- Python 绑定列入后续方向——注意 PyPI 上的 `sandtable` 名称已被占用,届时 Python 包需另行命名([命名核查](./17-project-structure))。
