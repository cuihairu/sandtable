---
title: 24 · 随机函数与概率系统
---

# 随机函数与概率系统

[宝可梦案例](./21-pokemon-case)暴露过一条规律:数值方案的"手感"大半由随机结构决定——命中浮动、掉落惊喜、抽卡保底,而 sandtable 目前只内置了最窄的一层(均匀 + 伯努利)。本页把随机能力系统**整体整理成一张设计图纸**:每项能力给出适用场景、确定性键与状态的归宿、API 形态,以及与既有实验机制(sweep / CI95 / 黄金快照)的衔接方式。设计侧口径(期望怎么算、保底怎么定、方差怎么调)与 hello-game [numerical/05 掉落与概率设计](https://github.com/cuihairu/hello-game/blob/main/docs/numerical/05.md)互为表里:那边讲"设计侧怎么定",本页讲"仿真侧怎么验"。

## 三条铁律(承[确定性随机](./06-deterministic-rng))

::: tip 任何随机能力进内核前,先过三条
1. **带键可复现**:每笔抽取走键派生 `key = (seed, actor_id, day, event_index, purpose)`,purpose 枚举集中注册,禁止旁路系统随机;
2. **可配置可扫描**:概率/权重/保底参数进参数注册表,能被 sweep 当作数值轴(分布形态类参数进 `Table` 槽,同 `tier_table` 先例,不进数值通道);
3. **可检验**:实现必须配一个统计验收——均值型用 replicates 的 CI95,分布型用卡方检验(见下文"验证机制选型")。
:::

## 能力清单总览

| # | 能力 | 典型场景 | 键与状态 | 现状 |
| --- | --- | --- | --- | --- |
| 1 | 均匀 / 伯努利 | 命中、伤害浮动、日常掷骰 | 键即抽取,无状态 | ✅ 已有 |
| 2 | 正态分布 | 群体初始属性、会话时长、评分噪声 | 键即抽取(消耗两次均匀),无状态 | ⛔ 本页设计 |
| 3 | 加权表(有放回) | 掉落表、品质 roll | 表在加载期编译;键即抽取 | ✅ R1 已落地(2026-10-10) |
| 4 | 洗牌 / 无放回加权抽样 | 卡组抽牌、限定池去重、组队抽样 | 键即抽取,无状态 | ✅ R1 已落地(2026-10-10) |
| 5 | 保底序列(硬/软) | 抽卡、稀有掉落兜底 | **计数器是 actor 确定性状态**;抽取仍走键 | ✅ R2 已落地(2026-10-10) |
| 6 | 回放种子 | 复现任意一局 / A/B 同路径 | 键结构即设计;种子即实验标识 | ✅ 已有(docs 06) |
| 7 | 分布检验(卡方) | 验证 1–4 的实现与配置一致(公示合规) | 纯统计工具,不进仿真路径 | ✅ R1 已落地(2026-10-10) |

## 各能力 API 设计

### 1. 均匀 / 伯努利(已有,口径存档)

```text
rng.uniform(lo, hi)      # [lo, hi) 均匀;combat.dmg_var 即其应用
rng.bernoulli(p)         # P(真) = p;combat.p_hit 即其应用
```

无状态、O(1)。唯一纪律:范围与概率进注册表(`F64` 槽,可 sweep)。

### 2. 正态分布 Normal(μ, σ)

**场景**:玩家初始属性扰动、每日会话时长、匹配评分噪声——任何"围绕中心抖动"的群体量。

```text
rng.normal(mu, sigma) -> f64     # Box–Muller:两次带键均匀 → 一次正态
```

- Box–Muller(1958)经典变换,一次生成消耗两个独立均匀数;键纪律不变(`purpose` 区分用途),只是**一次逻辑抽取消耗两个均匀值**——`event_index` 按逻辑抽取计数,保证 A/B 改参数不挪键(承 docs 06 CRN 边界);
- 正态无界,属性类用途必须配 `clamp`,钳位边界进注册表;文档与报告里如实标注"截断正态";
- 参考实现口径:[NumPy Generator.normal](https://numpy.org/doc/stable/reference/random/generator.html)(语义对照,非实现依赖)。

### 3. 加权表 WeightedTable(有放回)✅ R1 已落地

**场景**:掉落表(70/25/5 三档)、品质 roll、NPC 行为分支。

```yaml
# 配置面(落地形态:表挂 model.loot.tables 下;加载期校验:权重非负、至少一项为正)
model:
  loot:
    rate_mult: 1.0        # 全局掉率倍率(数值槽,可 sweep;乘到掉落产出量,不改表形状)
    tables:
      chest:
        weights: { gold_small: 70, gold_mid: 25, gem: 5 }
```

```text
加载期:weights → WeightedTable{names, cums, total}(CDF 前缀和,加载期编译)
运行期:rng.weighted(Purpose::Loot, &table) -> 项索引   # 均匀一次 + CDF 二分,O(log n)
```

- 轮盘线性扫 O(n) 是朴素实现;alias method(Walker 1977;Vose 1991 给出 O(n) 构造 / O(1) 采样)为**热路径优化项**,构造成本一次性,仅当表被单日百万级引用时启用——MVP 用 CDF 二分,可读性优先;
- 表条目的**权重**不进数值通道(`model.loot.tables` 走 `ParamKind::Table`,同 `tier_table` 先例:改形态走 YAML 编辑);"全局掉率倍率"落为数值参数 `model.loot.rate_mult`(**扫它 = 扫产出强度**;分布检验不涉及它——倍率乘量不改分布形状);
- 权重非概率:期望占比 = wᵢ/Σw,报告层负责换算成"每百次期望次数"给策划看。

### 4. 洗牌与无放回抽样 ✅ R1 已落地

**场景**:卡组抽牌(无放回)、限定池去重掉落(无放回加权)、组队随机抽样。

```text
rng.shuffle(purpose, &mut xs)                  # Fisher–Yates,O(n),消耗 n−1 抽取
rng.sample(purpose, &xs, k) -> Vec<T>          # 局部 Fisher–Yates,只洗前 k 位,O(k)
rng.sample_weighted(purpose, &xs, &table, k)   # A-Res 键序法,O(n log n)
```

- Fisher–Yates(经典,见 Knuth TAOCP 卷 2)为均匀洗牌标准解;**局部洗牌**抽 k 项天然等价无放回均匀;
- 带权无放回用 A-Res 键序法(Efraimidis & Spirakis 2006:每项算键 u^(1/w) 取前 k 大),一次性流式、与权重尺度无关;
- 洗牌 / 抽样走独立 purpose `Shuffle`(追加在枚举尾,不挪旧键)与流式抽取 `draw_stream`(一次读计数器、推进 n、按 `base+i` 派生)——批量抽取只动本 purpose 计数器,其他用途键空间不受影响;
- 卡组类场景注意:**洗牌结果依赖牌序输入**——牌序进配置(数组序即洗牌前序),键不变则洗牌不变,CRN 成立。

- Fisher–Yates(经典,见 Knuth TAOCP 卷 2)为均匀洗牌标准解;**局部洗牌**抽 k 项天然等价无放回均匀;
- 带权无放回用 A-Res 键序法(Efraimidis & Spirakis 2006:每项算键 u^(1/w) 取前 k 大),一次性流式、与权重尺度无关;
- 卡组类场景注意:**洗牌结果依赖牌序输入**——牌序进配置(数组序即洗牌前序),键不变则洗牌不变,CRN 成立。

### 5. 保底序列(硬保底 / 软保底)✅ R2 已落地

**场景**:抽卡(单抽概率 p、第 N 抽必出、连续未中后概率递增)、稀有掉落兜底。

::: warning 状态与抽取分离
保底**计数器是 actor 的确定性状态**(进 World,随快照走);**抽取本身仍走带键均匀**——键不含保底计数。这样 CRN 边界不变:改保底参数不改键,随机流不动,对比干净。
:::

```yaml
model:
  gacha:
    base_rate: 0.02        # 单抽基础概率
    pity_hard: 50          # 硬保底:第 50 抽必出(0 = 无)
    pity_soft_start: 0     # 软保底起点抽数(0 = 无)
    pity_soft_step: 0.0    # 起点后每抽概率增量(0 = 无软保底)
```

- 状态机:每 actor 维护 `since_last_hit`;单抽成功率 `p' = min(1, base_rate + max(0, k − pity_soft_start) · pity_soft_step)`,且 `since_last_hit + 1 ≥ pity_hard > 0` 时 `p' = 1`(实现:`systems::gacha::hit_rate`);
- 四个参数全部 `F64`/`U64` 数值槽(注册表 `model.gacha.*`):**sweep 可扫保底长度**(它直接改变期望补贴,见下);`base_rate ≤ 0` 在 `validate` 拦截(否则抽卡永不终止);
- 执行形态:配置了 `model.gacha` 时,每个 actor 在 **tick 0(第 1 天之前)** 调一次"出到即止"会话(`systems::gacha::pull_until_hit`,逐抽消耗 `Purpose::Gacha` 键直到命中)——开号语义,不进任何一天的统计;
- **验收口径(设计侧 ↔ 仿真侧的对账)**:hello-game numerical/05 的手算账——单抽 2%、无保底期望 50 抽;硬保底 50 抽时期望 ≈ **31.8 抽**(闭式 `E[T] = (1 − (1−p)^H)/p = (1 − 0.98⁵⁰)/0.02 = 31.79`,前 49 抽全空概率 0.98⁴⁹ ≈ 37.2%,截断把长尾砍掉)。仿真的机器验收 = 万次抽样均值 ± CI95,落在闭式值 ± CI 内即通过(核心测试 `抽卡_期望抽数对齐解析解` 用 2000 玩家对账,容差 1.0);软保底无闭式,抽样均值本身就是验收手段(同页口径);
- 期望抽数是**新 KPI**:`MetricKey::GachaPullsToHit`(`gacha_pulls_to_hit`),走既有 replicates → `summarize` → CI95 全链,可比较、可 sweep、可推荐;未配置 gacha 时为 `None`,`#[serde(skip_serializing_if)]` 不进 JSON(黄金快照逐字节不变)。

### 6. 回放种子(已有,口径存档)

`base_seed + r`(第 r 个 replicate)即回放机制:同 seed 同配置 → results 逐位一致(`web_parity` / 黄金快照锁死,见[测试策略](./19-testing))。本页只补一条设计约定:**实验报告必须落 `base_seed`**(已落在 report.json / sweep.json 的 meta),使任何一次 run 可被 `--seed` 复跑——"回放"不需要新机制,需要的是报告可追溯(已满足)。

### 7. 分布检验(卡方)✅ R1 已落地

::: tip 定位红线
分布检验是**随机原语的测试台**,不进仿真路径(与 DuckDB 同纪律:事后验证)。
:::

**场景**:验证加权表实现与配置一致(公示口径合规:hello-game numerical/05 的红线——"公示的概率就是玩家会拿来做决策的概率")、验证均匀/正态的统计正确性。

```text
sandtable disttest uniform --samples 100000 --buckets 10 --alpha 0.01
sandtable disttest weighted <scenario.yaml> chest --samples 100000 --alpha 0.01
# 或(core API):chi_square(&observed, &expected) -> (stat, df, p);merge_buckets 做 Cochran 合并
```

- 口径:Pearson χ² = Σ(Oᵢ−Eᵢ)²/Eᵢ,df = 独立桶数 − 1;p ≥ α 通过。参考语义:[SciPy `stats.chisquare`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chisquare.html)(交叉验证用,非运行时依赖);
- 桶样本规则:每桶期望计数 ≥ 5(经典 Cochran 规则),不满就合并桶——否则 χ² 失真,检验结果无效;
- **保底这类马尔可夫链型结构不能直接 χ² 单抽频数**(抽取间不独立):验收走两条——状态分布检验(对 `since_last_hit` 的平稳分布)与期望抽数 CI95(上节),设计文档阶段就写明,防"拿 χ² 硬套保底"的伪验收。

## 验证机制选型(与既有实验机制的衔接)

| 问题类型 | 机制 | 已有? |
| --- | --- | --- |
| "均值差多少算显著"(留存/胜率/产出) | replicates → CI95 / A/B 配对差 | ✅ docs 13/11 |
| "这个参数影响多大" | sweep + OAT 敏感性 + 推荐区间 | ✅ docs 12/14/15 |
| "掉率倍率对经济的影响" | `loot.rate_mult` / `gacha.*` 进注册表 → sweep 当数值轴 | ✅ R1/R2 已落地 |
| "随机实现与配置一致吗" | **卡方分布检验**(原语级) | 本页设计 |
| "这次 run 可复现吗" | base_seed + 黄金快照 + web_parity | ✅ docs 06/19 |

一句话:**CI95 管"量测的噪声",卡方管"实现的正确",黄金快照管"回归的不变"**——三者各管一段,不要互相替代。

## 分期计划

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| R1 ✅ 已落地(2026-10-10) | 加权表(加载期 CDF + YAML 面 + `ParamKind::Table`)+ 洗牌/无放回抽样 + `disttest` 子命令(均匀/加权) | 新 purpose 不动旧键(黄金快照逐位不变);万次采样 χ² 全过;params 表计数 +1(rate_mult) |
| R2 ✅ 已落地(2026-10-10) | 保底状态机(硬/软)+ 期望抽数 KPI + 抽卡案例 yaml | 数值例对账(2%/50 保底 → 闭式 31.79 ± CI);sweep 保底长度出推荐区间(10 ~ 44.6,上端插值);params 表计数 +4(`model.gacha.*`);黄金快照逐位不变 |
| R3 | 正态(带 clamp)+ χ² 扩展正态分桶 | 均值/方差的 CI 覆盖;Box–Muller 双消耗的键稳定性测试(A/B 改 μ 不挪键) |

R1/R2/R3 均为内核扩展,动 `rng.rs` 与注册表——**实施前以本页为口径基线,逐阶段走完测试全绿再合入**(每阶段独立提交)。

### R1 落地存档(2026-10-10)

- **purpose 键纪律**:`Purpose::Shuffle = 6` 追加在枚举尾(锁定测试断言 0–6 逐位不变);加权表抽取复用既有空置的 `Purpose::Loot = 3`,R2/R3 用途届时继续尾部追加。黄金快照(`tests/golden.rs`)逐字节通过,`config_hash` 不变。
- **配置面**:落地形态比设计稿多一层——`model.loot: {rate_mult, tables: {表名: {weights: {...}}}}`。`tables` 走 `ParamKind::Table`(结构参数,不进数值通道),`rate_mult` 是 F64 数值槽(params 表计数 +1:52 → 53)。`loot: Option<LootConfig>` + `skip_serializing_if`(同 training 字段先例),未配置时 config_hash 与旧版逐字节一致。
- **抽取原语**(`rng.rs`):`WeightedTable`(from_weights 校验 / probabilities / pick 二分)、`Draw::weighted`、`DayRng::weighted` / `draw_stream`(流式,一次推进 n)/ `shuffle`(Fisher–Yates,n−1 抽取)/ `sample`(局部洗牌取前 k)/ `sample_weighted`(A-Res 键序法,`u^(1/w)` 取前 k 大,total_cmp 排序 + 序号 tiebreak)。
- **分布检验**(`disttest.rs`,不进仿真路径):Pearson χ²、Cochran 桶合并(期望 ≥ 5)、p 值经正则化不完全伽马(级数 + Lentz 连分数,Lanczos ln Γ);CLI `disttest uniform | weighted`,检验失败退出码 1,配置错误 2。

### R2 落地存档(2026-10-10)

- **purpose 键纪律**:`Purpose::Gacha = 7` 继续尾部追加(锁定测试断言 0–7 逐位);黄金快照逐字节通过,`config_hash` 对未配置 gacha 的配置不变。
- **状态与抽取分离**(铁律的 R2 兑现):保底计数器 `gacha_since_hit`(连同 `gacha_pulls` / `gacha_hits`)是 `Actor` 字段,**不进 RNG 键**;逐抽消耗 `Purpose::Gacha` 键。CRN 测试锁死:只改 `pity_hard` 的 A/B 臂,日统计逐位一致、仅抽卡 KPI 不同。
- **状态机**(`systems::gacha`):`hit_rate(cfg, k)` = `min(1, base_rate + max(0, k − pity_soft_start)·pity_soft_step)`,硬保底 `k+1 ≥ pity_hard > 0` 时钳 1(软保底只在 `step > 0` 生效);`pull_until_hit` 会话语义 = "出到即止"。`validate` 拦 `base_rate ≤ 0 / > 1` 与负步长(≤ 0 会让会话永不终止)。
- **执行形态**:`SimEvent::GachaRoll` 调度在 tick 0(Clock 起点,第 1 天之前)——开号会话不进任何一天的日统计;`RunMetrics.gacha_pulls_to_hit = 总抽数/总命中`,`Option` + `skip_serializing_if`(训练字段先例),未配置时 JSON 不变。
- **KPI 全链接通**:`MetricKey::GachaPullsToHit` 进比较 / sweep / 推荐链;params 表计数 +4(53 → 57,`model.gacha.{base_rate, pity_hard, pity_soft_start, pity_soft_step}`)。CLI simulate 摘要条件输出 gacha 行。
- **数值对账**:闭式 `E[T] = (1 − (1−p)^H)/p`(截断几何),2%/50 → 31.79(设计稿手算 31.6 系粗估,以闭式为准);核心测试对账容差 1.0(2000 玩家)。无保底退化 `1/p = 50` 同测。
- **推荐区间验收**:`examples/gacha-pity-sweep.yaml` 扫 `pity_hard ∈ {10..50}`,hard 约束「E[T] ≤ 30」→ 可行段 [10, 44.6](上端点插值;解析交点 H = ln(0.4)/ln(0.98) ≈ 45.7,CI 抖动 ±1 内)。核心测试 `抽卡_扫保底长度出推荐区间` 锁死同口径。
- **公示口径一致性**(验收第三项的 R2 形态):加权表的"公示 = 实现"由 R1 `disttest weighted` 承担;保底是马尔可夫链结构(抽取间不独立),按本页第 7 节纪律**不做 χ² 单抽频数**,对账走闭式 E[T] ± CI95(上两项)——报告层输出 `gacha_pulls_to_hit` 均值与 CI95 即一致性证据。

## 来源与分级

| 级别 | 内容 | 来源 |
| --- | --- | --- |
| 本仓(公式) | 带键结构、purpose 注册、CRN 边界、黄金快照 | [06 章](./06-deterministic-rng)、[19 章](./19-testing)、`crates/sandtable-core/src/rng.rs` |
| 交叉引用 | 期望/硬保底/软保底/方差/公示合规的设计侧口径 | hello-game [numerical/05](https://github.com/cuihairu/hello-game/blob/main/docs/numerical/05.md) |
| 算法(加权表) | alias method | A. J. Walker (1977);M. D. Vose, "A linear algorithm for generating random numbers with a given distribution", *IEEE Trans. Software Eng.* 17(9), 1991 |
| 算法(无放回加权) | A-Res 键序法 | Efraimidis & Spirakis, "Weighted random sampling with a reservoir", *Inf. Process. Lett.* 97(5), 2006 |
| 算法(经典) | Fisher–Yates | Knuth, *TAOCP* Vol. 2(半开放寻址洗牌节);Box–Muller: G. E. P. Box & M. E. Muller (1958) |
| 工具文档 | 语义对照与交叉验证 | [NumPy Generator](https://numpy.org/doc/stable/reference/random/generator.html)、[SciPy chisquare](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chisquare.html) |
| 统计规则 | 每桶期望 ≥ 5 | Cochran (1954) 经典近似规则 |
| 组织方式 | 三铁律、状态/抽取分离、验证选型表、分期 | 本页作者综合(在 docs 06 约束下的设计推导) |
