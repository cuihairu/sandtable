---
title: 12 · 参数扫描
---

# 参数扫描

## Grid Search

```yaml
parameters:
  model.warrior.attack:
    min: 90
    max: 110
    step: 5
  model.dungeon.reward_gold:
    min: 100
    max: 200
    step: 20
```

自动产生笛卡尔积:

```text
90/100 · 90/120 · 90/140 · … · 110/200
```

**规模公式**:总运行数 = ∏((max − min) / step + 1) × R(replicates)。上例为 5 × 6 = 30 个候选;再乘 R = 5,即 150 次仿真。网格设计先算这笔账。

寻址路径经[参数注册表](./07-config-formula)校验;候选之间并行执行,确定性不受线程数影响([并行确定性](./06-deterministic-rng))。

## Random Search

用于高维参数空间:在注册表声明的范围内按分布采样。

## Latin Hypercube(`mode: latin_hypercube`,2026-10-09 落地)

Random 的分层改进:每维 [min, max] 分 `samples` 层、层内均匀采 1 点,再各维独立 Fisher–Yates 洗牌配对——同样 N 个样本下每维的覆盖均匀性优于纯随机(各维保证无空层、无堆叠),适合高维空间预算有限时的采样。

```yaml
sweep:
  mode: latin_hypercube
  samples: 24        # 候选数 = samples(与 Random 同字段)
  replicates: 4
```

- 候选数 = `samples`,总运行数 = samples × R;规模上限与 Random 同门(MAX_CANDIDATES 兜底);
- 采样流与 `base_seed` 绑定:同配置同采样,线程数无关(与 [Random 模式](#random-search) 同一条纪律);
- 洗牌只打乱层序配对,不改变层内取值——排序后仍每层恰一点;
- `step` 不参与(与 Random 一致,只作范围元数据保留)。

## Monte Carlo 的语义

本项目的 Monte Carlo 指**多 seed 复跑**(replicates):同一候选换 seed 跑 R 次,用于估计指标的抽样噪声、给出置信区间。它是一种统计手段,不是参数寻优方法。

## 网格是离散的,推荐是连续的

::: warning 网格点之间的空白
步长 5 的网格上只有 95 / 100 / 105 这些点。如果实验结论需要"推荐 96~101"这样的**连续区间**,它不可能直接从网格点读出来——必须对网格结果做**插值或代理模型**(约束边界处线性 / 二次插值),这一步在[平衡推荐](./15-recommendation)中定义。扫描层只负责提供格点数据,不假装自己有连续分辨率。
:::

## 输出

每个候选输出[标准结果目录](./09-data-output);sweep 层附加:

- 候选清单(参数组合 + 实验标识);
- 汇总表:候选 × 指标(均值 ± CI),CSV 输出;
- 失败候选的标注(配置错误 / 运行失败),不静默丢弃。
