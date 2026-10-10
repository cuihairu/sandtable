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

## Pareto 多目标(`mode: pareto`,2026-10-10 落地)

多目标不压成加权单值——前沿本身即答案。第三节换 `objectives`(≥2 个,与 `objective` 互斥):

```yaml
optimize:
  mode: pareto
  objectives:          # ≥2 个
    - { metric: power_p50, direction: maximize }
    - { metric: gold_per_player, direction: minimize }
  targets:             # hard 约束同进化模式
    - { metric: churn_rate, min: 0.0, max: 0.2, kind: hard }
  # population / generations / elite / mutation_* / parameters 同进化模式
```

**适应度是三级字典序**(可解释性与进化模式同纪律):

1. 主键:hard 约束 pass 数(可行域语义不变——低层但目标全优,仍压不过高层);
2. 层内非支配排序(NSGA-II 式):所有目标不差且至少一个严格好才算支配;
3. 同层破平:拥挤距离(每目标归一化间距和,边界点 ∞),保前沿多样性。

精英保留 / 锦标赛 / 末代答案全走同一序。**"最优"= 末代最优层前沿 0 中拥挤距离最大者**(代表点);全前沿落 `opt.json` 的 `front0`(拥挤距离降序),逐代统计带 `front0` 规模,`candidates.csv` 照旧全历史可追溯。配置错误候选层级垫底、不进前沿。RNG 消耗序与进化模式一致(采样流同绑 `base_seed` 派生,两模式同构)。

成本账与进化模式同式(population × (generations + 1) × replicates,精英不重评)。示例:`examples/pokemon-pareto.yaml`(与 `pokemon-optimize.yaml` 同账,双目标张力交给前沿呈现)。

## 随机森林代理(`surrogate` 子命令,2026-10-10 落地)

上上节裁定 1 的随机森林落地为独立子命令——代理**只读 sweep 产物,不进仿真路径**(文档 09 章红线):

```bash
sandtable surrogate train sweep-out --metric power_p50   # → model.json(训练内 MAE + 重要性表)
sandtable surrogate predict model.json --params '{"model.warrior.attack": 105}'
sandtable surrogate importance model.json                # 参数重要性排序表
```

- 训练数据 = sweep.json 的 Ok 候选(参数集须一致;配置错误候选不进代理,缺指标 / 参数集不一致报错,退出码 2);
- 森林:bootstrap 采样(第 t 棵流 = `seed ^ t·0x9E37…`,同种子同森林、线程数无关)× CART 回归树(全特征扫相邻不同值中点,最小加权方差,两侧满足 min_samples_leaf;达限深 / 目标常数 / 无有效分裂即落叶);
- 重要性 = 分裂方差削减归一(和为 1),直接回答"哪些参数驱动指标";
- 预测 = 全树均值,附全树 min / max 散布(森林分歧度);超参(树数 / 深度 / 叶下限 / 种子)显式落 model.json;
- 定位:36–152 候选小数据的可解释代理;GP(稠密矩阵求逆 + 核超参黑箱)留后续按需评估。

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
