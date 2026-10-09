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

## 映射

### 全局缩放

宝可梦 50 级域的伤害量级(~15–40/轮)与 sandtable 默认域(~80/轮)不同。取**全局线性系数 ×5** 把玩家三围、怪物 HP/攻防、经验 yield 统一缩放,使战斗轮数量级对齐(比值口径基准 t0:练到与 ace 同级(~L14)的玩家 2–3 轮清剿 Brock Onix)。系数取 5 而非精确等效值(5.33)纯粹为了配置可读,轮数偏差计入校准余量。

### 战斗口径(比值直抄)

sandtable 支持比值口径(`combat.damage_model: ratio`,阻力 #1 根治),宝可梦伤害公式可直抄 `dmg = ratio_k·attack/(attack+defense)`,**零换算**。`ratio_k` 标定:Gen1 L50 威力 60 期望伤害 `((2L/5+2)·60·A/D/50 + 2)`、随机取中值 0.925、×5 域下 A/D=1 锚点 ≈ 131 → `k = 2×131 ≈ 262`,取 **260**(配置可读,同全局 ×5 的取整先例)。比例结构在锚点对齐,原作公式的非线性项(威力/等级项)不逐位等价——同差值换算先例,计入校准余量。

### 映射表

| 宝可梦概念 | sandtable 参数 | 值 | 来源级 |
| --- | --- | --- | --- |
| 关都八道馆 | `dungeon.tiers` | 8 | 公式结构 |
| tier0 = Brock Onix@L14 | `m_hp / m_attack / m_defense` | 165 / 85 / 245(锚点行) | 锚点(直抄) |
| 馆主阶梯逐层形状(Onix→Rhydon) | `dungeon.tier_table` | 三维逐层 8 行(见下) | 锚点(直抄) |
| 综合战力口径备查 | `tier_growth` | 1.25(几何拟合,逐层表给出时不参与) | 锚点(直抄) |
| 首馆奖金 ¥1,400 | `reward_gold` | 1400(1:1 锚定) | 锚点 |
| Onix@L14 yield 216 | `reward_xp` | 1080(×5) | 公式+锚点 |
| 奖金曲线增速(1400→7000) | `reward_gold_growth` | 1.26 | 公式+锚点 |
| 经验曲线增速(216→1457) | `reward_xp_growth` | 1.31 | 公式+锚点 |
| Medium Fast `3L²−3L+1` | `xp_base / xp_pow` | 15 / 2.0(幂律拟合,×5) | 公式 |
| Charizard 84/78 种族值 | `warrior.attack / defense / hp` | 30 / 30 / 60(L1 能力值 ×5,真起步) | 公式(直抄) |
| 野怪练级产出(假设层类比) | `training.xp / gold` + `behavior.*.p_training` | 300 / 100 + 分群带 | 假设层 |
| 每级成长 `B/50` | `level_*_gain` | 8 / 8 / 13(×5 取整) | 公式 |
| 伤害随机 85–100% | `p_hit / dmg_var` | 0.95 / 7 | 公式 |
| 比值伤害公式 A/D 比例结构 | `combat.damage_model / ratio_k` | ratio / 260(锚点标定) | 公式+锚点 |
| 会话结构、churn(重标定)、消费链、分群 | behavior / churn / upgrade_* | churn 按练级环重标定,余维持默认 | 假设层 |

### 逐层表(阻力 #3 根治后的 `tier_table`)

逐馆 ace 等级取自 pokered `parties.asm`,种族值取自图鉴,三维 = 能力公式 `floor(2B·L/100)+5`(HP 为 `+L+10`)×5 直抄,零换算:

| t | 馆主 | ace @ 等级 | hp(×5) | attack(×5) | defense(×5) |
| --- | --- | --- | --- | --- | --- |
| 0 | Brock | Onix @14 | 165 | 85 | 245 |
| 1 | Misty | Starmie @21 | 280 | 180 | 200 |
| 2 | Lt. Surge | Raichu @24 | 310 | 240 | 155 |
| 3 | Erika | Victreebel @29 | 425 | 325 | 210 |
| 4 | Koga | Weezing @43 | 540 | 410 | 540 |
| 5 | Sabrina | Alakazam @43 | 500 | 240 | 215 |
| 6 | Blaine | Arcanine @47 | 705 | 540 | 400 |
| 7 | Giovanni | Rhydon @50 | 825 | 675 | 625 |

锯齿形状是真实的(由各 ace 种族值决定):Raichu 防 55 是玻璃炮(defense 155),Weezing 防 120 是肉墙(defense 540),Alakazam 攻 50/防 45 紧随 Weezing 又脆回去(240/215)。相对综合战力口径的 1.25 几何阶梯,逐层偏差最高 +34%(Weezing)、最低 −43%(Alakazam)——这正是单参数 `tier_growth` 表达不了的"形状旋转",也是逐层表存在的理由。

产出(gold / xp)不进表:奖金与经验的**增速**已由双增长率精确表达(见阻力 #2),中段形状按几何近似,逐格奖金/经验序列可后补进表(行内 `gold / xp` 缺省即回退几何)。

## 跑通记录

`validate` → `simulate`(1 万玩家 × 30 天)→ `sweep` → `recommend` → `report` 全链通过;案例运行在比值口径(`damage_model: ratio`)、玩家 L1 真起步(练级产出面带到首馆可战等级)。下列数字为两项根治落地后的口径:

**基线分层**(300 玩家 × 2 replicates 抽样):

| 分群 | 均等级 | 均金币 | churn |
| --- | --- | --- | --- |
| casual | 12.7 | 6,717 | 9.2% |
| core | 14.5 | 12,099 | 12.2% |
| whale | 36.7 | 60,611 | 9.7% |

分群进度梯度符合"日场次 casual≈1 / core≈2 / whale≈5"的行为假设;30 天终点当量徽章数 casual 0–1 / core 1–2 / whale 4–6(首馆门槛 ≈ L14),whale 未触原作 50 级封顶——L1 起步后终点比旧口径(名义 L14 起步,55.6)低、形状更贴近原作节奏。行为/churn 为重标定的假设层(见阻力 #4)。

**单轴扫描**(`model.warrior.attack` 20→220,即"初始练度 vs 馆主曲线"失配度,4 replicates;硬约束换为 churn ≤ 0.2 与 retention_d7 ≥ 0.9——win_rate 聚合口径含练级期败仗,不再适合作硬约束):

| attack | win_rate | churn_rate | power_p50 | 判定 |
| --- | --- | --- | --- | --- |
| 20 | 0.335 | 0.123 | 545 | PASS |
| 60 | 0.640 | 0.106 | 720 | PASS |
| 100 | 0.719 | 0.105 | 809 | PASS |
| 140 | 0.754 | 0.103 | 891 | PASS |
| 180 | 0.754 | 0.103 | 971 | PASS |
| 220 | 0.754 | 0.103 | 1051 | PASS |

- **初始练度不再决定生死**:attack 20(不足基准 2/3)churn 也只有 0.123——练级环兜底,弱起步玩家回头练级而非死亡螺旋。与旧口径对照(差值口径下同轴低点 win 0.53 / churn 0.45 双 FAIL)正是阻力 #1 + #4 联合根治的语义差;
- win_rate 随初始练度上升并在 0.754 饱和:练度越高越早解锁高层,高层败仗计入分母——瓶颈从"打不动"转为"爬得快";
- 弹性(OAT):`churn_rate −0.106`、`win_rate +0.556`、`power_p50 +0.223`、`gold +0.437`,全部显著;
- **推荐区间 [20, 220]**(全段可行),Confidence Medium。

**report**:多源合并单文件 HTML,含扫描折线(SVG,带 CI 须与推荐带)、KPI、推荐块。

## 阻力清单(接入过程暴露的表达力缺口)

1. **差值 vs 比值战斗模型**:比值模型在 A/D ≪ 1 时伤害平滑趋小,差值模型钳到 1——首日全灭的根因。任何"玩家远弱于关卡"的场景(真实游戏常态)都需要差值等效换算才能表达,单参数缩放救不了负差值。**已解决**(2026-10-09,根治):`combat.damage_model` 显式口径开关落地——缺省 `difference`(差值口径,旧配置语义逐位不变,黄金快照不变);`ratio` 切换比值口径 `dmg = ratio_k·attack/(attack+defense) + var`(与差值口径同下限 1、同浮动叠加点,A ≪ D 时伤害平滑趋小不钳底)。`ratio_k` 为注册表数值参数(可 sweep),**仅在 ratio 口径下生效**——显式给出而口径未切时 `validate` 报错(防扫死参数,同 #2 新旧字段拆分先例:旧配置不静默改语义,新行为需显式开启)。口径切换后,攻防数值可从外部公式直抄,本案例的差值等效换算层整体删除(见映射节重写)。
2. **gold 与 xp 共用 `reward_growth`**:真实曲线增速分别为 1.26(奖金)与 1.31(经验),共用参数只能取其一。**已解决**(2026-10-07):拆成 `reward_gold_growth / reward_xp_growth`;遗留写法 `reward_growth` 只放行加载并按旧口径同时作用于两者(旧配置不静默改语义,新字段显式给出时优先),不可 sweep、不进参数表。本案例 gold 1.26 / xp 1.31,末馆奖金 +35% 的虚高随之消除。
3. **单一 `tier_growth` 表达不了形状旋转**:等比单参数只能拟合综合战力口径。**已解决**(2026-10-07):`dungeon.tier_table` 逐层显式数组落地——三维逐格覆盖几何推导,行内 `gold / xp` 缺省回退锚点几何,长度须等于 `tiers`(不进数值通道:改层形走 YAML 编辑,sweep 数值参数不受影响)。本案例已切换为逐层表(见映射节):hp 1.26 / 攻 1.34 / 防 1.14(端点几何拟合),防御序列 245→200→155→210→540→215→400→625,相对 1.25 几何阶梯综合战力偏差最高 +34%(Weezing)、最低 −43%(Alakazam)。注:首版草稿的防御序列 61→126→49→…→335 中两格复算不成立(Raichu 等级 24 非 26、Rhydon 种族值防 120 非 130),已按 pokered `parties.asm` 与图鉴逐格重验修正。
4. **无野怪练级环**:第一版映射把 tier0 锚在 Onix@L14,仿真玩家 1 级开局、全场 max(1, −31) 磨血、30 天全灭——真实游戏里"野怪→馆主"的两级强度结构被单层阶梯压扁。本案例的 workaround 是**玩家以名义 L14 起步**。**已解决**(2026-10-10,根治):核心落地**练级产出面**——`model.training { xp, gold }` 产出 + 各分群 `p_training` 行为带,练级带在强化与探索之间触发,金币经验入账、升级推进、不进战斗统计(胜率分母不含练级);零产出 `{0,0}` 合法且惰性(参数模板回导形态),产出与行为带单边给出即 `validate` 报错(耦合不静默)。两段强度层(野怪层/馆主层)未做——练级产出面实现成本更低且同解:玩家 L1 真起步,练级带把人带到首馆可战等级(casual ≈ L14 当量约 20 天,whale 约 5 天),名义起步 workaround 删除。案例同步切换:warrior 30/30/60(L1 能力值 ×5)、churn 重标定(`p_stall` 0.05→0.02、`stall_days` 2→3:原参数按全员 L14 开局标定,后期无升级日不再按 5%/日出血)、训练 xp 300 为"一次带 = 聚合一 session 野怪遭遇"的假设层(原作单只 yield 太小,30 天节奏对不上)。
5. **金币 sink 太浅**:宝可梦无金币回收环,套用强化链(`50·1.25^k`)后 30 天人均囤金 20 万——强化经济在这个场景完全无张力。反向说明 sandtable 的 sink 参数(`upgrade_cost_*`)需要与产出曲线联动的校准流程,案例中作为假设层原样保留。
6. **行为/churn 是纯假设层**:宝可梦没有会话与流失概念,`behavior.* / churn.*` 全部维持默认——案例只验证了模型结构可接入,不验证这些参数的合理性。

## 结论

**接入可行**:公式与锚点级数字(成长/奖金/种族值)可直接落进现有参数表;伤害公式经 `damage_model` 显式切换为比值口径后攻防直抄、零换算;玩家 L1 真起步由练级产出面带到首馆门槛,全链跑通;扫描与推荐在真实形状的曲线上给出的结论(初始练度不再决定生死、瓶颈从"打不动"转为"爬得快")语义可解释。

**换算层已删除**:初版因模型只有差值口径,攻防不能直抄、每个锚点要做一次差值等效;`damage_model` 比值开关落地后该层整体删除,攻防数值改为能力公式直抄——口径差异的成本从配置侧转移到模型侧,一次付清。

**表达力缺口两小两大,四项全部根治**:#2(拆双增长率)与 #3(逐层数组)以小改动根治(2026-10-07);#1(战斗口径)按比值口径根治(2026-10-09,`damage_model` 显式开关,换算层随之删除);#4(练级环)以练级产出面根治(2026-10-10,`model.training` + `p_training`,L1 真起步,名义起步 workaround 删除)。
