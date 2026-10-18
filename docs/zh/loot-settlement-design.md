# sandtable 掉落结算 System 设计

[English](/loot-settlement-design) | [中文](/zh/loot-settlement-design)

**状态:已代决(巡检代决,2026-10-20,推进单 r0240)。** 本文是 2026-10-18 独立审核为表三第二批规定的「先出设计再实施」一步,代决记录见 §4;实施随本批次按先测后码推进,台账挂 `todo.md`。下文锚点基于 `3d04e1a`。

## 0. 定位(承既有架构口径)

- 审核止损(P1-6)让含 `model.loot` 的配置**加载即拒**、`rate_mult` 数值通道保持关闭,今天不存在静默不生效的旋钮。本设计给该配置面接上消费方:战斗胜利时从加权表抽取并结算金币 / 经验——把 24 章 §3 的 planned shape 变成活语义。
- 不做:物品 / 背包系统(掉落只结算货币);按层绑表(dungeon tier 配置已带 gold/xp,掉落是叠加在其上的奖励层);alias method 热路径(24 章已把它押后到单表日引用 ~10⁶ 次量级)。

## 1. 现状(代码锚点)

- `Purpose::Loot = 3` 已存在,仿真路径未用(`rng.rs:22-47`;仅 `disttest weighted` 消费,`main.rs:1290-1293`);尾追加锁测试覆盖 0–8(`rng.rs:361-395`)。
- 战斗不是队列事件:`settle_battle` 返回 `BattleOutcome { win, rounds, damage_dealt, gold, xp }`(`combat.rs:123-131`);胜利分支内联在 `PlayerDaySystem::update`(`sim.rs:299-316`),本地 `DayRng::new(seed, actor.id, day)` 在 `sim.rs:255`。
- 既有水龙头:战斗金币 `sim.rs:312`(× 鲸鱼倍率)、练级金币 / 经验 `sim.rs:281-291`;经验经 `progression::gain_xp`(`progression.rs:15-36`)。内核再无其他 `gold +=`。
- `LootConfig { rate_mult, tables }` 已能解析并通过逐项校验(`config.rs:614-636`),随后被 P1-6 无条件拒绝(`config.rs:638-644`);`loot` 为 `Option` + `skip_serializing_if`(`config.rs:542-543`),未配置时 `config_hash` 逐字节不变(`config.rs:892`,测试 `952-953`)。
- 注册表 spec 保留(`registry.rs:243-253`);数值通道双向关闭(`registry.rs:449-453`、`567-571`)并带镜像测试豁免(`registry.rs:673-695`);参数表 = 56 行。
- `disttest weighted` 已从场景 YAML 读掉落表(`main.rs:1265-1293`),但含掉落的文件今天到不了这里(加载先拒)。
- `WeightedTable` 原语已落地且过 χ²(`rng.rs:130-192`,验收 `rng.rs:453-470`)。

## 2. 需求

策划以 YAML 结构维护掉落表(Excel→CSV 通道只管数值;表走 `tier_table` 先例——改形状是编辑 YAML,不走数值通道)。仿真须在胜利时结算表内数额,让 sweep / 推荐 / 报告能用数字回答审核表三那一行的问题——「掉落产出倍率的经济影响」——而不是一纸拒载。

## 3. 设计

### 3.1 配置面(在文档既有 planned shape 上加一个同层 map)

```yaml
model:
  loot:
    rate_mult: 1.0       # 数值通道重开(参数表 56 → 57)
    on_victory: chest    # 每次战斗胜利抽取的表
    tables:
      chest:
        weights: { gold_small: 70, gold_mid: 25, xp_charm: 5 }  # 抽取分布(形状不变)
    rewards:             # 新增:条目名 → 结算数额(结构性,tier_table 先例)
      gold_small: { gold: 10, xp: 0 }
      gold_mid:  { gold: 50, xp: 0 }
      xp_charm:  { gold: 0,  xp: 20 }
```

### 3.2 结算语义

- 挂点:胜利分支内联(`sim.rs:309-316`),在基础奖励结算之后——每次胜利一次 `DayRng::weighted(Purpose::Loot, &table)` 抽取(CDF 二分),随后每种货币 `round(amount × rate_mult)`;金币随战斗金币同口径乘鲸鱼倍率,经验走 `progression::gain_xp`(含升级级联)。
- 确定性:战斗按玩家 id 序、事件序号顺序推进,掉落抽取逐位可复现。
- 未配置的配置消费零次掉落抽取——其他一切不动。

### 3.3 随机数键纪律

- 消费预留的 `Purpose::Loot = 3`,走本地 `DayRng`;不新增 Purpose、不改键形,且不存在掉落状态(状态 / 键分离自然成立)。
- purpose 是键的一个维度,掉落抽取不可能扰动 CombatHit / CombatDamage / Churn / … 流;非掉落轴的 A/B 可比性由构造保证,并由 CRN 隔离测试锁定(§5)。

### 3.4 数值通道、参数表、config_hash、指标

- 重开 `model.loot.rate_mult` 读写(删两处 `Err` 分支与镜像测试豁免);spec 描述去掉「保留槽」措辞;参数表 56 → 57。
- `model.loot.tables` 保持 `ParamKind::Table`(结构性;不进数值通道)。
- `config_hash`:未配置 → 不变(既有 Option 跳过 + 测试);配置 → loot 节进哈希(预期行为;BTreeMap 排序保证稳定,`config.rs:233`)。
- 新 `MetricKey::LootGoldPerPlayer` 尾追加(`ALL` 7 → 8,`experiment.rs:157-183`),按 gacha 先例做 Option 指标:未配置时 `None` + `unavailable_reason`「loot 未配置」(P1-5 机制),JSON 字段 `skip_serializing_if`;CLI 摘要加条件掉落行,compare / sweep / optimize / surrogate 的指标清单加该名字。

### 3.5 disttest:不新增测试种类

weighted 种类已端到端覆盖表抽取(共享 χ² 助手);重开加载后它对含掉落的 YAML 重新可达,纳入验收。`rate_mult` 只缩放量不改形状,分布检验不碰它(24 章纪律)。

## 4. 决策点(代决记录,2026-10-20)

| # | 决策点 | 选择 | 理由(一行) | 被否项 |
| --- | --- | --- | --- | --- |
| 1 | 挂点 | 胜利分支内联(`sim.rs:309-316`) | `BattleOutcome` 是本地数据;战斗不是队列事件 | 新 `SimEvent` 变体(登记 / 探针纪律成本换零收益;gacha 的 tick-0 事件不迁移——它是建号时机) |
| 2 | 表条目语义 | 扁平 `weights` + 同层 `rewards` map | 保持 24 章文档形状;数额按 tier_table 先例走结构面 | 条目 = `{weight, gold, xp}` 内层 map(形状分叉);内核定死目录(不可标定,违背本仓目的) |
| 3 | 表绑定 | `on_victory` 指名;每胜一次抽取 | 显式可审计;后续可扩 | 按层绑表(tier 配置已带 gold/xp,YAGNI);全部表各抽一次(隐式不可审计) |
| 4 | 数额算术 | `round(amount × rate_mult)`,鲸鱼倍率随战斗金币 | 对齐既有水龙头纪律;确定性 | 向下取整(系统性偏低,破坏期望对账);绕开鲸鱼倍率(水龙头口径不一) |
| 5 | 随机数键 | 既有 `Purpose::Loot = 3`,本地 `DayRng` | 槽位本就为此预留;尾追加锁不动 | 新尾追加 Purpose(键空间增长,无必要) |
| 6 | 指标 | `LootGoldPerPlayer` 尾追加,Option / unavailable_reason | 审核那行的问题需要数字;gacha 先例完全对口 | 不加指标(影响不可见);占比指标(报告层可由两个金币指标导出) |
| 7 | disttest | 不新增种类 | weighted χ² 已端到端覆盖原语,只是重新可达 | 专门「loot」种类(重复造机器) |
| 8 | 加载拒绝 | 删 P1-6 拒绝;保留并扩展逐项校验 | 止损的目的——无静默旋钮——由「有消费方」达成 | 拒绝留在旗标后面(两个真值来源) |

## 5. 分期与验收

Phase A(本批次,先测后码——每步先红):

1. 配置校验测试:权重条目缺 rewards 对应;rewards 条目无人引用;`on_victory` 指向不存在的表;数额为负;条目金额全零;未配置不变式。
2. 注册表:撤镜像测试豁免 → `rate_mult` 读写 Ok;参数表计数 57。
3. CRN 隔离:仅掉落配置不同的 A/B 对 → 非掉落逐日统计逐位相同,掉落 KPI 有别(gacha 先例)。
4. 黄金快照:未配置逐字节不变;purpose 锁 0–8 不变。
5. disttest weighted 对含掉落 YAML 重新可达,χ² 通过。
6. 指标:未配置时 `unavailable_reason`;配置后有值。
7. 实施顺序:config 结构 + 校验 → 注册表重开 → 仿真结算 → 指标 → CLI 摘要行。
8. 引擎契约:`LootContract::validate`(`engine/importer.rs:270-291`)认识 `rewards` / `on_victory`;19 个 roundtrip 测试保持绿。

验收门:`cargo test --workspace` 绿;clippy `--all-targets` 零告警;`cargo fmt --check`;`pnpm docs:build`;`params export` 打 57 项;KPI 锚值用例保持绿(案例配置不配 loot)。

Phase B(押后,按需):alias method 热路径;按层绑表;非货币物品计数(邻接背包)。

## 6. 同步清单(实施必须一并动)

- docs:23 章掉落行 🔶 → ✅;24 章 warning 框 → 交付记录并更新参数表计数;审计文档 B4 注记。
- 台账:`todo.md` 条目带证据(命令 + 数值 + file:line)。
- 本文状态行:在实施 commit 中改为「已落地」。
