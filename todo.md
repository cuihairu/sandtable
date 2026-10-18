# TODO

> 2026-10-14 对账:挂闸条目逐条核对本仓 git log / docs 决策记录 / 测试现状;完成项一行证据(commit hash + 测试数)。
> 2026-10-16 复核:5 条挂闸/方向性解锁条件逐条仍成立——真实案例二期无运营数据入仓(examples/ 仅公开数值示例)、桌面人工开窗验收无执行记录、随机函数无品类需求、Web API 无服务端需求、GP 无按需触发;open PR/issue=0、Dependabot=0。无可自服务项,不重开已裁决搁置。
> 2026-10-16 docs 双语:docs/ 根目录 5 页(b64138a)+ docs/guide/ 25 章(f247cfb + d05f5d2)+ 英文首页入口(95c1b1b)全部完成,docs 双语面已清。
> 2026-10-17 迁 VitePress 官方 locales:英文升为主语言占根路由(`/guide/`),中文整树移入 `docs/zh/`(`/zh/guide/`),导航栏出内置语言切换;此前同目录 `.en.md` 配对路由作废(下两条历史行的做法已被取代,内容全部保留)。
> 2026-10-17 收尾(e990ad2,补记于 10-18 巡检):两棵树 29 页自定义「English | 中文」切换行全撤,语言切换归 VitePress 导航栏内置,路由不变,页面正文无改动。
> 2026-10-18 巡检复核:可自服务区已清;5 条挂闸/方向性逐条核解锁证据仍无新输入——真实案例二期无运营数据入仓(2026-10-16 后 git log 仅 docs 提交,工作树净)、桌面人工开窗验收无执行记录(需本机 GUI 人工走查)、随机函数/Web API/GP 无新需求登记(open PR/issue=0,Dependabot=0);CI 与 Deploy Docs 至 e990ad2 全绿;tauri 上游 max stable 仍 2.12.4(3.0.0-α.5),tauri 3 未 stable,parked glib 抬升条件不满足,不重开已裁决搁置。

## 待办(可自服务)

- [x] docs 13 章掉落 KPI 段落(2026-10-20,R2 推进单):对齐 gacha 先例(13:97/98 专属段落)补「掉落(人均掉落金币)」——切片口径(全额已入 `gold_earned_total`,切片 ≤ 总额;纯经验奖励无该指标)+ 结算机制指引(24 章 §3 + 设计文档)+ 约束写法示例 `loot_gold_per_player max 5000` + 未配置为 `None` 不进 JSON(en/zh 双份)。触发:新增指标 grep 探针(`grep -rn gacha_pulls_to_hit` 全仓)扫出 13 章是唯一漏掉的 KPI 参考面;代码面(CLI ×3 / experiment / sweep)与 web / python(无硬编码指标清单)均核过无漂移。docs-only:`docs:build` 绿
- [x] 掉落结算案例补齐(2026-10-20,FIRE1019 推进单):对齐 gacha R2 交付先例(随附 `examples/gacha-pity.yaml` + 冒烟)补 `examples/loot-settlement.yaml`——数值与 24 章 §3 配置面示例**逐字一致**(公示 = 实现:三档 70/25/5,金币档 10/50,经验档 20,rate_mult 1.0,seed 42);`cases.rs` 新增 `loot_case_settlement_wired` 冒烟:validate 绿 + simulate 200×30×1 绿 + `loot_gold_per_player` 出现且 > 0 + 切片 ≤ 总产出(切片 ⊆ 全额口径);24 章交付记录(en/zh)加案例指引。`cargo test -p sandtable-cli --test cases` **3 passed**(原 2);`docs:build` 绿

- [x] 掉落结算 System(2026-10-20 落地;已代决(巡检代决,2026-10-20,推进单 r0240);设计 docs/loot-settlement-design.md + zh 孪生,决策点代决记录见其 §4):**按设计 §5 Phase A 先测后码实施完成**。配置面 `model.loot: {rate_mult, on_victory, tables, rewards}`——胜利分支内联结算(`sim.rs` 胜利分支,`Purpose::Loot` 独立键维度,数额 `round(× rate_mult)`、金币同乘鲸鱼倍率、经验走 `gain_xp` 级联);`validate` 拒负数/全零数额、on_victory 须指向 tables 中的表、双向引用闭合(无悬空条目/死配置);注册表重开 `rate_mult` 数值通道并注册 `on_victory`/`rewards` 为 `ParamKind::Table`(YAML 树校验需要,与 `tables` 同先例);`LootGoldPerPlayer` 尾追加指标(ALL 7→8,Option + unavailable_reason,P1-5 机制);CLI 指标清单 ×3 加名。与计划的两处落地面差异(已回填设计 §3.4):未配置基线的 `rate_mult` 落值会凭空生成残缺 loot 节,故参数通道整体扣留 `model.loot.*` —— 默认参数表 **56 项**、配置 loot 的基线 **57 项**(合并 YAML 对已配置基线整节随写,同 `damage_model` 保留先例);CLI 无逐指标摘要(simulate 只打耗时),故摘要行改为指标清单。验收门实测:core lib **165 passed**;engine **20 passed**(新增 `loot_settlement_contract_roundtrip`);CLI params **6 passed**(新增 loot 基线回导用例);`cargo test --workspace` 全绿(含案例 KPI 锚值);clippy `--all-targets` 零告警;`cargo fmt --check` 干净;`pnpm docs:build` 绿(38s,仅既有 chunk 体积提示);手动 `disttest weighted loot.yaml chest` χ²=0.6990/df=2/p=0.705 通过;`params export` 默认 56 项、loot 基线 57 项。**设计 §6 同步完成**:23 章掉落行 🔶→✅(en/zh)、24 章 §3 警示框改交付记录 + 配置面示例补全 + rate_mult 通道口径改写 + 常见问答行 + R1 交付记录(en/zh)、审计 B4 注记结清(en/zh)、设计文档状态改「已落地」并回填落地面差异
- [x] docs 首页首访语言探测(2026-10-18,c0935e9,巡检补记):`docs/index.md` 加 `<script setup lang="ts">` 段,仅根路径(`/sandtable/` 含去尾斜杠两种形态)在 `onBeforeMount` 按 `navigator.languages` 跳 `/sandtable/zh/`;优先级 = `localStorage['sandtable-lang-auto-picked']` 手动选择 > 浏览器语言 > 保持当前 locale;点击内置语言切换链接时写入该 key;SSR 侧 `typeof window === 'undefined'` 守卫,`navigator.languages` 缺失时回退单值。Deploy Docs run 39080635636 绿;理由注释:vitepress 无此能力、GitHub Pages 不支持 `_redirects`
- [x] docs 中文原始计划页翻译(2026-10-17,6ebf469):**原计划的正文本来就是中文**(实测 CJK 43% / ASCII 字母 57%,213 行纯英文全是英文技术名词、章节标题与分隔线),此前「英文原稿 1564 行」的判断有误;真正缺的是英文侧。故按 locales 语向改正:`docs/zh/计划-原始.md` 落中文原文(33 处描述性标题按 zh 章词汇中文化,如 仿真内核/确定性随机数/公式引擎/实验管线/参数扫描/平衡推荐/路线图/单元测试/先度量后优化;Grid Search/Monte Carlo/Fixed Tick/Casual-Core-Whale 等技术名词原样保留),`docs/计划-原始.md` 为英文对照版(296 行散文实译 + 3 段中文步骤图转英文);67 个代码块 64 个三版逐字节一致、仅 3 段步骤图按语言各自本地化;结构对账(围栏 134/134、块 67/67、标题 74/74、分隔线 57/57、列表 182/182);两份切换器与 route 互指;README ×2 与 18 章双向引用同步;`docs:build` 绿
- [x] docs 迁 VitePress 官方 locales(2026-10-17,06f5f63):英文占根路由(`/guide/`、根目录 4 份文档 + 英文首页 `docs/index.md`),中文整树入 `docs/zh/`(`/zh/guide/`、`/zh/index.md` 与根文档中文版);`config.mts` 加 `locales.root`(en)+ `locales.zh`(zh-CN,侧栏/搜索/页脚文案全中文化),导航栏出内置语言切换;收口停滞会话的半成品:两棵树切换器统一为绝对路由 `/guide/NN | /zh/guide/NN`(原英文页自指、中文页链到已不存在的 `.en.md`)、两棵树图片深度对调修正(根 `../assets/`、zh `../../assets/`)、两个首页 hero action 各自带 locale 前缀、`docs/en/index.md` 与 `计划-原始.zh.md` 退役;结构对账 25/25 对齐(去代码围栏后标题/表格行/列表项/提示块计数全等)、`.en.md` 残留引用 0;`docs:build` 绿(dist 出双首页 + 双语 25 章 + 双语根文档)
- [x] docs 英文首页入口(2026-10-16,95c1b1b;2026-10-17 被 locales 取代):原做法 = `docs/en/index.md` 独立 `layout: home` + 同目录 `.en.md` 路由;locales 迁移后英文首页改为根 `docs/index.md`,该文件已退役,内容未丢
- [x] docs 子目录双语配对(docs/guide/ 25 章,2026-10-16,f247cfb + d05f5d2;2026-10-17 路由随 locales 调整):25 章中英全文齐备;此前配对形态为同目录 `.en.md` × 25,现英文并入根路由 `NN.md`、中文在 `docs/zh/guide/NN.md`;结构对账 25/25 对齐;`docs:build` 绿。口径见 2026-10-16 docs 补双语执行单:命令/路径/代码/专有名词原样保留

## 待办(挂闸:需用户拍板 / 等外部输入 / 人工验收才开工)

- [ ] 真实案例二期 + 模型校准。解除条件:用户提供真实运营数据与对标基准(2026-10-11 拍板挂起不立项;一期宝可梦用公开数值已跑通全链见 docs 21,二期要真实运营面数据与外部基准,仓内无此输入)
- [ ] 桌面端投入。**剩:人工开窗验收**——native 文件对话框 GUI 与 Windows / macOS 完整交互走查(需本机 GUI 环境,自动化断言已尽);自动化链已覆盖:构建(run 38420221169 三腿绿)、启动(run 38436094647 20s 存活)、安装包安装+运行(run 38457041427,Windows 含 msi 腿 38488806732);证据 docs 18 Phase 7
- [ ] 随机函数扩展后续。解除条件:出现真实品类需求(24 章 7 项能力已全落地;唯一已记录候选 = 23 章 NPC 顾客行为所需 Poisson 到达过程,需与顾客 System 同启,候选登记见 docs 24 分期计划引言末段)

## 方向性(无期限,出现真实需求再启;全量见 docs 02 后续方向)

- [ ] Web API(仅当出现真实服务端需求,local-first 不预设;docs 02 MVP 明确不做「游戏服务器运行时」)
- [ ] GP 优化(按需;Bayesian 已拍板随机森林代理并落地,GP 留后续,见 docs 12)

## 已完成(一行证据:hash + 测试/运行条数,过程细节见 desktop-package.yml 注释与 docs 18)

- [x] CI 平衡回归(已代决(巡检代决),2026-10-15,决策记录 docs/方向项定义草案.md §4,5552dbc): 案例 KPI 水平断言进 `crates/sandtable-cli/tests/cases.rs`(churn/win_rate/均等级锚值 ±10% 带,retention_d7 取硬约束下限 0.9,gacha-pity 不锚——已有闭式对账),KPI 测 + core 157 测全绿
- [x] 可视化系统图与策划工作流(已代决(巡检代决),2026-10-15,决策记录 docs/方向项定义草案.md §4,5552dbc): `crates/sandtable-core/examples/system_graph.rs` 探测真实调度面出 SVG(docs/assets/systems/system-graph.svg,docs 04 引用)+ 策划工作流五步导览进 docs 21 + docs 19 测试层登记,docs:build 绿
- [x] 游戏引擎 Adapter(已代决(巡检 R1),2026-10-14,59538ee): `crates/sandtable-engine` 引擎无关 JSON 契约(导出有效值纪律 + 参考导入器 + 回流约定),roundtrip 19 测 + workspace 全绿;理由:五决策点均属产品方向/设计取舍且有明确推荐,不涉版本发布、License、付费、素材授权或人工验收
- [x] Windows msi 腿补进安装冒烟(2026-10-14,d789b37): run 38488806732 三腿绿,msi 段 exit 0、装点 alive 20s
- [x] 安装包安装+运行冒烟(2026-10-14,89ce5c1 + fcef016 + 5ea7076): run 38457041427 三腿绿,安装产物各 alive 20s
- [x] 桌面启动冒烟升 CI(f74bc98): run 38436094647 双腿绿,裸产物 alive 20s
- [x] 桌面安装包链路 CI(99b614f + 26e8c25): run 38420221169 三腿绿,三平台制品齐
- [x] 随机原语指针对账(2026-10-14,f77fb4d): docs:build 绿
- [x] 桌面 5-6 步解卡(2026-10-13,d8b5896 + 75b4e00): project.test.mjs 6 测 CI 接入
- [x] 复杂行为脚本阶段 3(2026-10-11,a1e1ac4 + 127da96 + d99a8a9): 21 pytest 测
- [x] query 守卫与路径字面量测试(33def8a): query.rs 6 测 + 桌面 lib.rs 7 测,CI 绿
- [x] 桌面无头冒烟升 CI 门(77bd901,cffb43d): Xvfb 截屏判定,runner 实证绿
- [x] pnpm overrides 三 pin(3b5528e): docs:build 绿
- [x] glib 0.20.0 评估(2026-10-11,e5399ba): parked,随 tauri 3 stable 一并抬
- [x] 文档一致性审计(2026-10-13,d092b0a): 三类差异 25 条已修,落表 docs/审计-文档一致性.md

验收:改动后 pnpm docs:build 过 / cargo check 过;测试绿才 push。
- [x] 审核整改（2026-10-18 独立审核，见 docs/review/luna-review-2026-10-18.md）：c0e1e08 + 1d21665 + fcd7a5b
      1) 表一「缺陷」6 项全修，先核对再动手：P1-1 公式探针+运行时兜底（config.rs / progression.rs:23）、
         P1-2 概率有限性+区间+sessions_frac（config.rs）、P1-3 网格先计数后物化（sweep.rs plan/validate）、
         P1-4 按日滚动排程（sim.rs schedule_day，黄金快照逐位等价）、P1-5 目标可用性预检
         （experiment.rs unavailable_reason + scenario/optimize 双层）、P2 Pareto 无前沿改报错（optimize.rs）
      2) 表二「文档与实现不一致」5 项以代码为准改文档：24 章 intro/loot 接入状态、23 章掉落、
         07 章脚本已落地、index 内存承诺 + 页脚 MIT→Apache-2.0；同步审计 B4 与 loot 数值通道关闭
      3) 表三「值得补的能力」只出评估与分期建议（不实现）：1–3 已随缺陷整改落地，
         4 掉落结算 / 5 桌面进度取消 / 6 真实数据校准待用户拍板
      测试：cargo test --workspace 绿 / clippy --all-targets 零告警 / pnpm docs:build 过；不 bump 版本号。
- [x] 文档时效性清理（2026-10-18 用户令：很多文档已过时，2026-10-19 完成）：
      1) 通读核对：README 快起 3 条命令逐条实跑 exit 0；10 章子命令表与 `--help` 全量比对一致；
         `query` 不在默认构建确认为 `#[cfg(feature = "duckdb")]` 门控（非漂移，文档已注明）
      2) 以代码为准修正（未改任何业务代码）：
         - 10 章 phantom `--scenario` 旗标 → 位置参数（实测 `params import --help` =
           `[OPTIONS] <CSV> [SCENARIO]`，CLI 无 `--scenario` 旗标）：
           en docs/guide/10-cli.md:86,89-91,97 / zh docs/zh/guide/10-cli.md:87,89-90,97
         - 24 章 params 表计数 57→56（rate_mult 数值通道随审核整改关闭），en/zh 各两处
         - 用法块旧写法 2 处（compare 选项序、params export）en/zh 已先期修正
      3) 已废弃功能：未发现「已移除但文档仍称可用」项；原始计划
         docs/计划-原始.md:682 / zh:685 的 compare 旧用法为历史文档，保留不改
         （todo.md:13 双语结构对齐锁定，不属活契约）
      4) 示例逐条实跑：`compare --attack-a 100 --attack-b 105 --replicates 12` exit 0；
         `params export examples/pokemon.yaml --out p.csv` →「已导出 56 项」；
         `params import p.csv examples/pokemon.yaml --out merged.yaml` →「已导入 56 项,
         config_hash = b51d2f79…」exit 0（import 本身成功；后续 validate 的失败见下条）
      5) 门禁：pnpm docs:build 过（61.38s）；dist 重建后 grep `--scenario` 零命中
      附带发现（代码缺陷，另列条目，不属文档面）：params 回导合并产物丢 `damage_model`
      枚举槽，`damage_model: ratio` 基线（如 examples/pokemon.yaml）回导产物必然被
      config.rs:739 守卫拒载 —— merged_yaml 只写数值槽（params.rs:115-128）所致
- [x] params 回导合并产物丢枚举槽（2026-10-19 文档时效性清理中发现，同日修复）：
      `params import --out` 的 merged_yaml 只写数值注册表路径，`damage_model` 枚举槽
      被丢弃；`damage_model: ratio` 基线回导后 ratio_k 仍在而口径缺省为 difference，
      被 validate 拒载（config.rs:739 守卫），与 CLI 自印「可直接 simulate」矛盾。
      修法（先测后码）：新增 tests/params.rs::params_roundtrip_keeps_damage_model
      （ratio 基线导出→回导→validate 全链，先红后绿）；merged_yaml 在
      damage_model 为 Some 时写回 model.combat.damage_model（params.rs:129-133）。
      测试：cargo test -p sandtable-cli --test params 5 绿 / clippy --all-targets
      零告警 / cargo fmt --check 过。
