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

## 自动寻优(`optimize`,Phase 8 点火,2026-10-10)

扫描回答"这条曲线上哪些点可行",寻优回答"机器帮我在多维空间里找可行点"——[平衡推荐](./15-recommendation)遗留的"多参数联合可行域需要代理模型或优化器"由此接上。实验文件的第三节换成 `optimize`:

```yaml
optimize:
  mode: evolutionary
  population: 8        # 种群大小
  generations: 5       # 迭代代数
  elite: 2             # 精英保留数(每代原样进入下一代)
  mutation_rate: 0.3   # 每维变异概率
  mutation_scale: 0.2  # 变异幅度(相对各维 [min,max] 宽度)
  replicates: 4
  parameters:          # 与 sweep.parameters 同形状(step 不参与)
    model.warrior.attack: { min: 20, max: 220 }
    model.dungeon.reward_gold: { min: 800, max: 2000, step: 100 }
  targets:             # hard 约束定义可行域(与 sweep.targets 同形状)
    - { metric: churn_rate, min: 0.0, max: 0.2, kind: hard }
  objective:           # 可行点内的排序目标(可省;省略则任一可行点即达标)
    metric: power_p50
    direction: maximize
```

**适应度是字典序,不是加权分**(可解释性优先):

1. 主键:hard 约束 pass 数(复用[约束判定](./13-kpi-metrics)三态,PASS 计 1);
2. 次键:objective 指标值(direction 已折算为越大越好;省略则同分,先到先得);
3. 配置错误候选垫底,不静默、不崩溃。

**进化算法**(纯内核、单线程、逐代依赖——代间串行是算法语义,非性能欠账):

- 初始种群:各维 [min, max] 均匀采样;采样流与 `base_seed` 绑定,同配置同结果,线程数无关;
- 每代:精英原样保留 → 余量由 锦标赛选择(size 2)× 逐维均匀交叉 × 均匀变异 产生;
- 变异用均匀扰动而非高斯——正态随机属[随机函数](./24-random-functions) R3 分期,寻优不越界抢依赖;
- 最优解跨代追踪(同适应度保先到),全历史候选落盘可追溯。

**成本账**:总仿真数 = [population + generations × (population − elite)] × replicates(精英不重评;粗上界 population × (generations + 1) × replicates 用于预算校验)。上限沿用 MAX_CANDIDATES,先算账再跑。

**输出**:与 sweep 同目录契约——`opt.json`(meta + spec + best + 逐代统计)、`candidates.csv`(全历史候选 × 指标 + 判定)。

**非目标**:本节先交付可运行的进化寻优,不为后续算法预埋接口。

**后续增量裁定(2026-10-10,按仓内决策记录自行裁定)**:

1. **Bayesian 代理模型选型 = 随机森林(RF)**。待拍板点见上(GP / 随机森林),裁定依据项目铁律:① RF 纯离散树、无线性代数依赖,wasm32 兼容好(GP 需稠密矩阵求逆,核心要背数值线性代数代码);② RF 的 bootstrap 与特征采样复用现有 SplitMix64 键派生流,与确定性纪律同构;③ 特征重要性直接回答"哪些参数驱动指标",同"适应度字典序非加权"的可解释性纪律(GP 核长度尺度是黑箱超参);④ 本项目典型 36–152 候选,RF 足够;GP 的优势场景(昂贵评估 + 预测不确定性量化)当前无需求,留作后续评估。
2. **Pareto / 多目标 = 约束感知非支配排序**(NSGA-II 式:非支配层级 + 拥挤距离破平)。加权求和被适应度设计明确拒绝("字典序,不是加权分");Pareto 前沿本身即答案,不压成单值。裁定后即开工实施(见下节)。

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
