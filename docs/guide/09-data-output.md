---
title: 09 · 数据输出
---

# 数据输出

不要让 CSV 成为唯一输出格式,也不要让 Parquet 成为 MVP 负担。

## MVP:JSON + CSV

| 格式 | 用途 | 内容 |
| --- | --- | --- |
| JSON | 元数据与结论 | 实验标识(seed / config_hash / schema_version / 代码版本)、配置快照、指标汇总、约束判定、候选比较、推荐 |
| CSV | 人工查看与交换 | 指标时间序列(按天)、群体分布、cohort 切片、A/B 比较表——策划可直接用 Excel 打开 |

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

## Parquet:feature flag,不进 MVP

Parquet 适合大规模时序、群体明细与 notebook 分析,但 Arrow 系依赖编译重、依赖树大。决定:**作为 feature flag 提供,MVP 只输出 JSON + CSV**;需要 notebook 深度分析时再启用。CSV 的列设计从一开始就面向 pandas / polars 友好(首列天索引、明确 NaN 表示、UTF-8)。

## HTML 报告

最终实验报告、图表、KPI 展示、参数对比的 HTML 输出属于报告阶段(见[路线图](./18-roadmap) Phase 5),不在 MVP 内。

## 配置接入:Excel / CSV 导入(待评估)

策划的数值表大多维护在 Excel / CSV 里,从现有配置表导入可能比 YAML 手工编辑更影响实际采用。列入后续方向(Phase 5 评估):CSV 数值表 → 参数注册表 的导入通道。MVP 阶段手工转换。

## 分析侧接口

- 保证 CSV / Parquet(feature 启用时)输出质量,使 notebook 分析顺畅;
- Python 绑定列入后续方向——注意 PyPI 上的 `sandtable` 名称已被占用,届时 Python 包需另行命名([命名核查](./17-project-structure))。
