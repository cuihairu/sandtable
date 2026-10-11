---
title: 13 · KPI 与指标
---

# KPI 与指标

指标回答"系统运行得好不好"。本章给出每个指标的**明确公式**、采集方式与统计口径——指标没有公式就没有约束,没有约束就没有推荐。

## 指标类型

```text
Scalar · Time Series · Distribution · Histogram · Percentile · Cohort · Correlation
```

## 采集架构:在线聚合

10 万玩家 × 90 天的量级下,**不能**存每个玩家每步的明细再事后统计。指标在事件处理时增量聚合:

| 结构 | 用途 |
| --- | --- |
| 固定分箱直方图 | 分布(Power、金币存量),分箱在编译期定 |
| 分位数草图(t-digest 或 P²) | P50 / P90 / P99,内存有界 |
| Welford 增量均值 / 方差 | 均值类指标,数值稳定 |
| 整数计数器 | 次数类(战斗数、胜利数、流失数)——金币等可数资源用整数,不用浮点 |

内存量级:每指标 KB 级 × 指标数 × cohort 数,与玩家数量无关。

## 指标定义(公式)

以下 `a` 遍历当日活跃玩家;`active(a, d)` 表示玩家 a 在第 d 天有至少一次登录。

### 战斗

```text
win_rate(d)  = 胜利战斗数(d) / 总战斗数(d)
death_rate(d) = 玩家战败次数(d) / 总战斗数(d)
```

### 成长

```text
Dn_power  = 第 n 天日结时 Power 的分布(报告 P50 / P90)
Dn_level  = 第 n 天日结时 Level 的分布
```

### 经济

```text
产出(d) = 当日全体玩家获得的金币总量(战斗掉落 + 奖励)
回收(d) = 当日全体玩家消耗的金币总量(升级 + 消耗)
G(d)    = 第 d 天日结时全体存续玩家的金币存量总和

inflation(d) = (G(d) − G(d−1)) / max(G(d−1), 1)        —— 主口径:存量日增长率
sink_ratio(d) = 回收(d) / max(产出(d), 1)               —— 辅助口径:回收产出比,< 1 表示经济在净增发
```

MVP 没有价格体系,通胀定义为**金币总量日增长率**(主口径),并同期输出 sink_ratio 作诊断。约束(如 `inflation ≤ 0.05`)绑定主口径。报告窗口用 30 天累计增长率与日均增长率两个数。

### 留存与流失

```text
retention_Dn = |{a : active(a, n)}| / |{a : active(a, 1)}|     —— D1 / D7 / D14 / D30 留存

churn(a, d) ⟺ 玩家 a 已连续 K 天不活跃(K 默认 3,可配)
churn_rate(d) = 新增流失数(d) / 期初活跃数(d)
```

::: warning 流失必须有机制来源
留存指标如果只是统计口径,难度调整就不会影响玩家去留,"长期仿真"没有意义。MVP 内置最简流失机制,把指标与行为挂钩:

```text
停滞(stalled):玩家连续 S 天等级与 Power 均无增长(S 默认 2)
流失判定:每日一次伯努利试验
  p_churn = p_base            (未停滞)
  p_churn = p_stall           (停滞;p_stall > p_base)
```

这样"改难度 → 胜率变化 → 成长速度变化 → 停滞率变化 → 留存变化"的链条在 MVP 内是通的。
:::

### 收支

```text
income(d)  = 产出(d) 的玩家人均值
spending(d) = 回收(d) 的玩家人均值
```

### Whale 的 MVP 定义

MVP 没有付费系统,不存在购买事件。Whale 在 MVP 中定义为**高活跃 + 成长倍率**:session 频率与资源获取按倍率放大(硬编码常数),并在输出中标注"无付费语义"。引入最小付费事件是后续扩展,届时 Whale 定义迁移到付费口径。

### 抽卡(保底期望抽数)

保底类玩法用**期望抽数** `gacha_pulls_to_hit` 衡量:一次"抽到首次命中即止"会话的抽数聚合,是策划感知"坑深不深"的直接量。硬 / 软保底状态机与闭式对账(截断几何 `E[T](H) = (1 − (1−p)^H)/p`,H 为硬保底抽数)见[随机函数与概率系统](./24-random-functions);该指标与其余指标同走 CI₉₅ 判定链,约束写法如 `gacha_pulls_to_hit max 30`。

## 统计口径与置信区间

**统计单位是 replicate,不是玩家**(理由见[实验管线](./11-experiment-pipeline))。设某候选跑了 R 个 replicate,第 r 个 replicate 的某指标聚合值为 m_r:

```text
mean  = (1/R) · Σ m_r
sd    = 样本标准差(m_r)
CI₉₅  = mean ± t(0.975, R−1) · sd / √R
```

**效应量**:A/B 比较报告 Δ = mean_B − mean_A 及双方 CI;并报告标准化效应 d = Δ / pooled_sd。|d| 与 CI 的组合构成[推荐置信度](./15-recommendation)的判据。

## 约束判定:基于置信区间,不是点估计

::: warning 点估计判定会在噪声上翻车
`win_rate ∈ [0.48, 0.52]` 这种硬约束,单次实验的抽样噪声就可能达到 ±0.02——点估计 0.519 与 0.521 的差别没有意义。判定规则:

| CI₉₅ 与约束区间的位置 | 判定 |
| --- | --- |
| CI 完全落在约束区间内 | **PASS** |
| CI 与约束边界相交 | **BORDERLINE**(推荐场景按 FAIL 处理,或加 replicates 收窄 CI) |
| CI 完全落在约束区间外 | **FAIL** |
:::

## Targets 配置

```yaml
targets:
  - metric: combat.win_rate
    min: 0.48
    max: 0.52
    type: hard
  - metric: economy.inflation
    max: 0.05
    type: hard
  - metric: progression.day_7_power
    target: 12000
    tolerance: 0.10
    type: soft
```

支持:`min / max / range / target / tolerance / weight`,以及 `hard`(一票否决)与 `soft`(加权计分)。判定输出示例:

```text
Candidate A    Win Rate PASS · Inflation FAIL · D7 Power PASS
Candidate B    Win Rate PASS · Inflation PASS · D7 Power PASS
```

BORDERLINE 在报告中单独标注,不与 PASS 合并。

## Cohort 切片

以上指标全部支持按 cohort(Casual / Core / Whale)切片输出;约束绑定聚合口径或切片口径,在 targets 中显式声明,避免"全局通过、某群体崩坏"被均值掩盖。
