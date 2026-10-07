# 21 · 真实配置验证:宝可梦案例

P5c 的验收问题是:**一套外部真实游戏的公开数值,能否不经改模型直接接入 sandtable?接入过程暴露什么表达力缺口?**

选《宝可梦 第一世代》(关都地区)做样本:数值完全公开、社区文档完备(公式、种族值、馆主阵容与奖金都有权威页面),且它的战斗/成长结构与 sandtable 的 dungeon/progression 同构度足够高——差异处恰好就是阻力清单的内容。

配置即文档:[examples/pokemon.yaml](https://github.com/cuihairu/sandtable/blob/main/examples/pokemon.yaml)(基线)与 [examples/pokemon-sweep.yaml](https://github.com/cuihairu/sandtable/blob/main/examples/pokemon-sweep.yaml)(扫描实验),每个数字旁注明来源。

## 数据来源分级

案例中的数字按可信度分三级,文档不混用:

| 级别 | 内容 | 来源 |
| --- | --- | --- |
| 公式(权威) | 伤害公式、能力值公式、经验曲线、经验 yield 公式 | [Bulbapedia: Damage](https://bulbapedia.bulbagarden.net/wiki/Damage)、[Stats](https://bulbapedia.bulbagarden.net/wiki/Stat)、[Experience](https://bulbapedia.bulbagarden.net/wiki/Experience) |
| 锚点(页面 / 反汇编核实) | 八馆主奖金(RB)、ace 与等级(逐馆队伍)、ace 种族值 | [Gym Leader](https://bulbapedia.bulbagarden.net/wiki/Gym_Leader)、各馆主页、Pokédex 条目、[pokered 反汇编](https://github.com/pret/pokered)(`data/trainers/parties.asm`:逐馆队伍与等级) |
| 假设层(sandtable 语义) | 行为/分群/churn 参数、强化消费链、全局缩放系数、绝对汇率 | 本模型自带(宝可梦无对应结构) |

核心公式(第一世代):

- **伤害**:`((2L/5+2)·威力·A/D/50 + 2) × STAB × 属性 × 暴击 × Random(0.85–1.00)`——A/D 是**比值**模型,随机浮动 ±15%;
- **能力值**(IV/EV = 0):`HP = floor(2B·L/100)+L+10`,其他 = `floor(2B·L/100)+5`;
- **成长曲线**(Medium Fast):升到 L 的总经验 = L³,即升下一级需 `3L²−3L+1`;
- **经验 yield**(第一世代):`floor(base_exp × level / 7)`;
- **馆主奖金**(RB):Brock ¥1,400 → Misty ¥1,900 → Lt. Surge ¥2,376 → … → Giovanni ¥7,000。

## 映射与换算

### 全局缩放

宝可梦 50 级域的伤害量级(~15–40/轮)与 sandtable 默认域(~80/轮)不同。取**全局线性系数 ×5** 把玩家三围、怪物 HP/攻防、经验 yield 统一缩放,使战斗轮数量级对齐(基准战斗 t0:期望 4 轮内清剿)。系数取 5 而非精确等效值(5.33)纯粹为了配置可读,−6% 轮数偏差计入余量。

### 攻防的差值等效换算

sandtable 战斗是**差值**模型(`dmg = attack − defense + var`,下限 1),宝可梦是**比值**模型。两者不逐位等价,只能在每个馆主锚点做一次等效换算——以"玩家与 ace 同级挑战"为口径:

```
D_eq(tier t) = 玩家攻击(t 级) − 5·((26.4·A/D + 2) × 0.925)   # 26.4 = (2L/5+2)·60/50 @L50
A_eq(tier t) = 玩家防御(t 级) + 5·((26.4·M_A/P_D + 2) × 0.925)
```

即:把比值模型的期望伤害,折算成差值模型里"同等伤害"所需的差值。随机浮动取中值 0.925(对应 `p_hit: 0.95` + `dmg_var: 7` 的联合表达),威力取标准 60、不计 STAB/属性/暴击。

### 映射表

| 宝可梦概念 | sandtable 参数 | 值 | 来源级 |
| --- | --- | --- | --- |
| 关都八道馆 | `dungeon.tiers` | 8 | 公式结构 |
| tier0 = Brock Onix@L14 | `m_hp / m_attack / m_defense` | 165 / 219 / 61(锚点行) | 锚点+换算 |
| 馆主阶梯逐层形状(Onix→Rhydon) | `dungeon.tier_table` | 三维逐层 8 行(见下) | 锚点+换算 |
| 综合战力口径备查 | `tier_growth` | 1.18(几何拟合,逐层表给出时不参与) | 锚点+换算 |
| 首馆奖金 ¥1,400 | `reward_gold` | 1400(1:1 锚定) | 锚点 |
| Onix@L14 yield 216 | `reward_xp` | 1080(×5) | 公式+锚点 |
| 奖金曲线增速(1400→7000) | `reward_gold_growth` | 1.26 | 公式+锚点 |
| 经验曲线增速(216→1457) | `reward_xp_growth` | 1.31 | 公式+锚点 |
| Medium Fast `3L²−3L+1` | `xp_base / xp_pow` | 15 / 2.0(幂律拟合,×5) | 公式 |
| Charizard 84/78 种族值 | `warrior.attack / defense / hp` | 140 / 130 / 225 | 锚点+换算 |
| 每级成长 `B/50` | `level_*_gain` | 8 / 8 / 13(×5 取整) | 公式 |
| 伤害随机 85–100% | `p_hit / dmg_var` | 0.95 / 7 | 公式 |
| 野怪练级、会话、churn、消费链、分群 | behavior / churn / upgrade_* | 维持默认 | 假设层 |

### 逐层换算表(阻力 #3 根治后的 `tier_table`)

逐馆 ace 等级取自 pokered `parties.asm`,种族值取自图鉴,三维按上节换算式逐格落表:

| t | 馆主 | ace @ 等级 | hp(×5) | attack(A_eq) | defense(D_eq) |
| --- | --- | --- | --- | --- | --- |
| 0 | Brock | Onix @14 | 165 | 219 | 61 |
| 1 | Misty | Starmie @21 | 280 | 314 | 65 |
| 2 | Lt. Surge | Raichu @24 | 310 | 359 | 34 |
| 3 | Erika | Victreebel @29 | 425 | 418 | 97 |
| 4 | Koga | Weezing @43 | 540 | 510 | 276 |
| 5 | Sabrina | Alakazam @43 | 500 | 453 | 144 |
| 6 | Blaine | Arcanine @47 | 705 | 572 | 268 |
| 7 | Giovanni | Rhydon @50 | 825 | 626 | 332 |

锯齿形状是真实的(由各 ace 种族值决定):Raichu 防 55 是玻璃炮(D_eq 34),Weezing 防 120 是肉墙(D_eq 276),Alakazam 紧随其后却又脆回去(D_eq 144)。相对综合战力口径的 1.18 几何阶梯,逐层偏差 hp 最高 +69%、defense 最低 −60%——这正是单参数 `tier_growth` 表达不了的"形状旋转",也是逐层表存在的理由。

产出(gold / xp)不进表:奖金与经验的**增速**已由双增长率精确表达(见阻力 #2),中段形状按几何近似,逐格奖金/经验序列可后补进表(行内 `gold / xp` 缺省即回退几何)。

## 跑通记录

`validate` → `simulate`(1 万玩家 × 30 天)→ `sweep` → `recommend` → `report` 全链无需改模型一次通过(下列数字为逐层表 + 双增长率落地后的重跑口径):

**基线分层**(300 玩家 × 2 replicates 抽样):

| 分群 | 均等级 | 均金币 | churn |
| --- | --- | --- | --- |
| casual | 23.2 | 75,531 | 10.0% |
| core | 29.2 | 109,997 | 7.7% |
| whale | 60.2 | 233,930 | 9.7% |

分群进度梯度符合"日场次 casual≈1 / core≈2 / whale≈5"的行为假设;whale 60 级超出原作 50 级封顶——模型没有"通关"概念,通关后继续在最高层刷,属预期行为(阻力清单 #5 相关)。

**单轴扫描**(`model.warrior.attack` 100→260,即"玩家练度 vs 馆主曲线"失配度):

- attack 100(练度不足 29%):win_rate 0.53 与 churn_rate 0.45 双 FAIL——卡关引发停滞流失,与原作"打不过馆主就练级"的张力一致;
- 弹性(OAT):`win_rate +1.05`、`churn_rate −2.13`、`retention_d7 +0.31`,全部显著;
- **推荐区间 [140, 260]**(可行段下端插值 128.5,由 win_rate 目标决定),Confidence High。

**report**:多源合并单文件 HTML,含扫描折线(SVG,带 CI 须与推荐带)、KPI、推荐块。

## 阻力清单(接入过程暴露的表达力缺口)

1. **差值 vs 比值战斗模型**:比值模型在 A/D ≪ 1 时伤害平滑趋小,差值模型钳到 1——首日全灭的根因。任何"玩家远弱于关卡"的场景(真实游戏常态)都需要差值等效换算才能表达,单参数缩放救不了负差值。若模型提供 `dmg = attack·k/(attack+defense)` 类比值口径,本案例的换算层可整体删除。**未动:改战斗口径属模型核心,需设计拍板。**
2. **gold 与 xp 共用 `reward_growth`**:真实曲线增速分别为 1.26(奖金)与 1.31(经验),共用参数只能取其一。**已解决**(2026-10-07):拆成 `reward_gold_growth / reward_xp_growth`;遗留写法 `reward_growth` 只放行加载并按旧口径同时作用于两者(旧配置不静默改语义,新字段显式给出时优先),不可 sweep、不进参数表。本案例 gold 1.26 / xp 1.31,末馆奖金 +35% 的虚高随之消除。
3. **单一 `tier_growth` 表达不了形状旋转**:等比单参数只能拟合综合战力口径。**已解决**(2026-10-07):`dungeon.tier_table` 逐层显式数组落地——三维逐格覆盖几何推导,行内 `gold / xp` 缺省回退锚点几何,长度须等于 `tiers`(不进数值通道:改层形走 YAML 编辑,sweep 数值参数不受影响)。本案例已切换为逐层表(见上节换算表):hp 比率 1.26 / 攻 1.16 / 防 1.27,防御序列 61→65→34→97→276→144→268→332,相对 1.18 几何阶梯 defense 偏差最低 −60%、hp 最高 +69%。注:首版草稿的防御序列 61→126→49→…→335 中两格复算不成立(Raichu 等级 24 非 26、Rhydon 种族值防 120 非 130),已按 pokered `parties.asm` 与图鉴逐格重验修正。
4. **无野怪练级环**:第一版映射把 tier0 锚在 Onix@L14,仿真玩家 1 级开局、全场 max(1, −31) 磨血、30 天全灭——真实游戏里"野怪→馆主"的两级强度结构被单层阶梯压扁。本案例的 workaround 是**玩家以名义 L14 起步**;根治需要"野怪层/馆主层"两段强度结构或非 dungeon 的练级产出。**未动:动模型核心,需设计拍板。**
5. **金币 sink 太浅**:宝可梦无金币回收环,套用强化链(`50·1.25^k`)后 30 天人均囤金 20 万——强化经济在这个场景完全无张力。反向说明 sandtable 的 sink 参数(`upgrade_cost_*`)需要与产出曲线联动的校准流程,案例中作为假设层原样保留。
6. **行为/churn 是纯假设层**:宝可梦没有会话与流失概念,`behavior.* / churn.*` 全部维持默认——案例只验证了模型结构可接入,不验证这些参数的合理性。

## 结论

**接入可行**:公式与锚点级数字(伤害/成长/奖金/种族值)经统一换算规则可直接落进现有参数表,零模型改动,全链跑通;扫描与推荐在真实形状的曲线上给出的结论(练度不足引发流失、可行段下端由 win_rate 决定)语义可解释。

**换算层是必要成本**:两套战斗口径的差异使得攻防不能直抄,每个锚点要做一次差值等效;这是模型选择差值口径的固有代价,已在阻力 #1 中量化。

**表达力缺口两小两大**:#2(拆双增长率)与 #3(逐层数组)以小改动根治,已落地;#1(战斗口径)与 #4(练级环)动模型核心,仍需设计拍板。
