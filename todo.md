# TODO

> 2026-10-14 对账:挂闸条目逐条核对本仓 git log / docs 决策记录 / 测试现状;完成项一行证据(commit hash + 测试数)。
> 2026-10-16 复核:5 条挂闸/方向性解锁条件逐条仍成立——真实案例二期无运营数据入仓(examples/ 仅公开数值示例)、桌面人工开窗验收无执行记录、随机函数无品类需求、Web API 无服务端需求、GP 无按需触发;open PR/issue=0、Dependabot=0。无可自服务项,不重开已裁决搁置。
> 2026-10-16 docs 双语:docs/ 根目录 5 页(b64138a)+ docs/guide/ 25 章(f247cfb + d05f5d2)+ 英文首页入口(95c1b1b)全部完成,docs 双语面已清。
> 2026-10-17 迁 VitePress 官方 locales:英文升为主语言占根路由(`/guide/`),中文整树移入 `docs/zh/`(`/zh/guide/`),导航栏出内置语言切换;此前同目录 `.en.md` 配对路由作废(下两条历史行的做法已被取代,内容全部保留)。
> 2026-10-17 收尾(e990ad2,补记于 10-18 巡检):两棵树 29 页自定义「English | 中文」切换行全撤,语言切换归 VitePress 导航栏内置,路由不变,页面正文无改动。
> 2026-10-18 巡检复核:可自服务区已清;5 条挂闸/方向性逐条核解锁证据仍无新输入——真实案例二期无运营数据入仓(2026-10-16 后 git log 仅 docs 提交,工作树净)、桌面人工开窗验收无执行记录(需本机 GUI 人工走查)、随机函数/Web API/GP 无新需求登记(open PR/issue=0,Dependabot=0);CI 与 Deploy Docs 至 e990ad2 全绿;tauri 上游 max stable 仍 2.12.4(3.0.0-α.5),tauri 3 未 stable,parked glib 抬升条件不满足,不重开已裁决搁置。

## 待办(可自服务)

### 专业数值策划工作台（产品功能蓝图：[`docs/专业工作台功能蓝图.md`](docs/专业工作台功能蓝图.md)）

> 2026-10-19 整理专业软件功能蓝图；2026-10-20 按用户“全部重新设计”要求完成 V2 界面设计与交互原型。以下正式产品能力仍按闭环分期，原型交付不代表内核、项目文件或商业软件直连已接通。外部商业软件采用可选互通。

- [x] **首轮工作台原型已被 V2 替代**（2026-10-20）：原三页聚合工作台未达到用户要求，V2 重新设计窗口结构、首屏与操作流程，不视首轮为通过验收。
- [x] **V2 五工作区交互原型**（2026-10-20）：`apps/web/public/prototype/` 包含独立 HTML / CSS / JS，结果分析（主响应图 + 小多图 + 候选表 + 检查器）、参数编辑、实验设计、任务队列、数据交换；图表/表格联动、筛选、参数本地保存、批量编辑撤销、任务取消及 CSV/JSON/SVG 下载实际工作。无头 Chromium 交互与五档窗口检查通过；截图见 `docs/assets/workbench/`。合成样例和演示队列不代表内核已接入。
- [x] **V2 界面设计与入口修复**（2026-10-20）：重写 `docs/专业工作台界面设计.md`、专用 Master/page 规则；纠正 `win_rate` 全程口径与 registry 元数据边界；Vite 将 `/prototype/` 重定向到 `/prototype/index.html`，修复旧目录路径回退到主应用导致看不到原型的问题。
- [ ] **Phase A · 策划闭环**
  - [ ] 对照当前 Web/Tauri 实现盘点缺口：项目/场景/基线/候选方案/实验记录/结果/报告，列出已有、部分支持、缺失及代码入口。
  - [ ] 工作区信息架构：项目导航、场景与基线、参数库、实验、结果分析、报告、导入导出；持续显示保存与运行状态。
  - [ ] 参数元信息与浏览：系统分组、稳定 ID、说明、类型、单位、默认值、范围、步长、来源和影响 KPI；搜索、筛选、收藏。
  - [ ] 类型化参数编辑：数值/概率/表格/曲线/公式编辑；高级 YAML 入口与结构化编辑保持同步。
  - [ ] 参数变更管理：基线差异、绝对/百分比变化、撤销重做、单项恢复、批量调整、命名方案和改动备注。
  - [ ] 导入前校验与预览：类型/范围/公式/引用/概率权重检查；错误定位、差异确认，禁止静默覆盖基线。
  - [ ] 候选方案管理：从基线派生、多个方案对照、历史方案复制；实验结果绑定不可变配置快照。
  - [ ] A/B 实验设计器：方案、KPI、天数、玩家数、replicates、seed/cohort/输出粒度；展示运行摘要和估算信息。
  - [ ] 运行状态体验：阶段进度、完成数、错误/警告、取消、后台运行和完成通知；页面切换后任务仍可见。
  - [ ] 结果总览：基线/候选值、差值、相对变化、CI、效应量、样本量和状态；区分未达标与证据不足。
  - [ ] 基础专业图表：时间序列及置信带、方案差值、cohort 对比、分布/分位数；图表显示口径和运行条件。
  - [ ] 实验历史与可复现：配置哈希、模型版本、seed、实验条件、指标版本；支持搜索、复制、复跑和备注结论。
  - [ ] 报告完善：HTML/PDF、图表选择、实验条件/差异/统计结果/假设/策划结论；结果带可追溯实验标识。
  - [ ] Excel 基础互通：参数 CSV/XLSX 模板、导入预览/列映射/错误报告、变更确认、结果扁平表导出。
- [ ] **Phase B · 实验分析效率**
  - [ ] 网格/随机/LHS 扫描设计器：边界、步长、组合数预览、预算控制、失败点重跑和结果筛选。
  - [ ] 扫描热图、敏感性分析、Pareto 图；图上数据点可追溯回候选参数和实验。
  - [ ] 结果分析增强：cohort 分面、分布长尾分析、经济产消/存量、掉落与抽卡概率分布。
  - [ ] 自定义 KPI、指标字典、图表模板和报告模板。
  - [ ] 批量实验队列、暂停/取消策略、状态持久化和资源预算提示。
  - [ ] Excel 工作流增强：XLSX 多表、命名工作表、字段映射复用和 Power Query 友好数据结构。
- [ ] **Phase C · 外部生态与团队能力（按实际需求启动）**
  - [ ] Power BI/Tableau 数据包：稳定 schema、字段字典、runs/metrics_daily/cohorts/parameters 等分表及示例。
  - [ ] MATLAB：先提供数据导出和 `.m` 脚本模板；有真实用户需求后评估可选的本机 MATLAB Engine 连接器，核心功能不得依赖 MATLAB。
  - [ ] Python 自动化 SDK：脚本创建/运行实验、读取结果、自定义分析，并记录脚本与依赖版本。
  - [ ] 多人协作：共享项目、权限、评论、审核、锁定/冲突处理；需另行决定服务端形态。
  - [ ] 企业 BI 服务端发布、自动刷新和企业数据源连接；需由实际团队流程触发。
- [ ] **技术与验收约束**：仿真内核不依赖商业软件；导入先预览校验；历史实验不可被配置覆盖；图表默认使用聚合结果，密集数据视真实性能再切 Canvas；长任务不阻塞 UI。逐项验收口径见功能蓝图 §6。

- [x] 桌面长任务进度与取消(2026-10-20 落地;已代决(巡检代决,2026-10-20,推进单 sandtable;审核表三第三批原为「建议第三批,需拍板」,已给明确方案且改动面在 apps/desktop、与内核解耦,不涉发版 / License / 支付 / 资产授权,按推进单代决条款执行)):`run_simulation` 改**异步 command + `spawn_blocking`**(CPU 重活不占主线程 / 异步运行时),逐 replicate 经 `Channel<ProgressEvent>` 上报 `{done,total}`,新增 `cancel_run` 命令 + 活动任务令牌(登记 / 清理)——取消在 **replicate 边界**生效(内核无中途退出面,粒度刻意落在 replicate 之间,仿真语义零改动),取消返回 `Err(已取消: 完成 k/N replicate)` 而非半截结果(少 replicate 过不了 CI₉₅ 汇总口径);前端仿真面板出进度 + 取消按钮(取消文案走中性 note 而非红字错误),扫描面板在**候选循环边界**可中止(主线程候选间已让出,web 与桌面均可点;取消后已完成候选留表、不出推荐);`sweep_candidate` 仅异步化——候选内 replicate 循环在 core `run_candidate` 内,replicate 级进度 / 取消需内核暴露观测面,按「与内核解耦」刻意不做;`Channel` 非 Deserialize 不能套 `Option`(只能作裸命令参数),故 `onProgress` 为必传、唯一前端调用方同提交更新。测试:`cargo test -p sandtable-desktop` **12 passed**(原 7,新增 5:进度回调不改结果、replicate 边界取消含开跑前已取消、mock app + 真实 Channel 命令全链、取消令牌登记 / 清理 / 无操作语义);web `tsc -b && vite build` 过、`oxlint` 过、`node --test` 4 + 8 passed。表三批次结清:review 表三两行 ⏳→✅(第二批掉落结算 + 第三批桌面进度取消)+ 分批口径改写;18 章 Phase 7 补交付记录(en/zh,命令面 6→7 含 `cancel_run`)、17 章目录注释 6→7、22 章补扫描取消口径(en/zh)。**剩余**:桌面人工开窗验收仍归用户本机(推进单不代做)
- [x] docs 13 章掉落 KPI 段落(2026-10-20,R2 推进单):对齐 gacha 先例(13:97/98 专属段落)补「掉落(人均掉落金币)」——切片口径(全额已入 `gold_earned_total`,切片 ≤ 总额;纯经验奖励无该指标)+ 结算机制指引(24 章 §3 + 设计文档)+ 约束写法示例 `loot_gold_per_player max 5000` + 未配置为 `None` 不进 JSON(en/zh 双份)。触发:新增指标 grep 探针(`grep -rn gacha_pulls_to_hit` 全仓)扫出 13 章是唯一漏掉的 KPI 参考面;代码面(CLI ×3 / experiment / sweep)与 web / python(无硬编码指标清单)均核过无漂移。docs-only:`docs:build` 绿
- [x] 掉落结算案例补齐(2026-10-20,FIRE1019 推进单):对齐 gacha R2 交付先例(随附 `examples/gacha-pity.yaml` + 冒烟)补 `examples/loot-settlement.yaml`——数值与 24 章 §3 配置面示例**逐字一致**(公示 = 实现:三档 70/25/5,金币档 10/50,经验档 20,rate_mult 1.0,seed 42);`cases.rs` 新增 `loot_case_settlement_wired` 冒烟:validate 绿 + simulate 200×30×1 绿 + `loot_gold_per_player` 出现且 > 0 + 切片 ≤ 总产出(切片 ⊆ 全额口径);24 章交付记录(en/zh)加案例指引。`cargo test -p sandtable-cli --test cases` **3 passed**(原 2);`docs:build` 绿

- [x] 掉落结算 System(2026-10-20 落地;已代决(巡检代决,2026-10-20,推进单 r0240);设计 docs/loot-settlement-design.md + zh 孪生,决策点代决记录见其 §4):**按设计 §5 Phase A 先测后码实施完成**。配置面 `model.loot: {rate_mult, on_victory, tables, rewards}`——胜利分支内联结算(`sim.rs` 胜利分支,`Purpose::Loot` 独立键维度,数额 `round(× rate_mult)`、金币同乘鲸鱼倍率、经验走 `gain_xp` 级联);`validate` 拒负数/全零数额、on_victory 须指向 tables 中的表、双向引用闭合(无悬空条目/死配置);注册表重开 `rate_mult` 数值通道并注册 `on_victory`/`rewards` 为 `ParamKind::Table`(YAML 树校验需要,与 `tables` 同先例);`LootGoldPerPlayer` 尾追加指标(ALL 7→8,Option + unavailable_reason,P1-5 机制);CLI 指标清单 ×3 加名。与计划的两处落地面差异(已回填设计 §3.4):未配置基线的 `rate_mult` 落值会凭空生成残缺 loot 节,故参数通道整体扣留 `model.loot.*` —— 默认参数表 **56 项**、配置 loot 的基线 **57 项**(合并 YAML 对已配置基线整节随写,同 `damage_model` 保留先例);CLI 无逐指标摘要(simulate 只打耗时),故摘要行改为指标清单。验收门实测:core lib **165 passed**;engine **20 passed**(新增 `loot_settlement_contract_roundtrip`);CLI params **6 passed**(新增 loot 基线回导用例);`cargo test --workspace` 全绿(含案例 KPI 锚值);clippy `--all-targets` 零告警;`cargo fmt --check` 干净;`pnpm docs:build` 绿(38s,仅既有 chunk 体积提示);手动 `disttest weighted loot.yaml chest` χ²=0.6990/df=2/p=0.705 通过;`params export` 默认 56 项、loot 基线 57 项。**设计 §6 同步完成**:23 章掉落行 🔶→✅(en/zh)、24 章 §3 警示框改交付记录 + 配置面示例补全 + rate_mult 通道口径改写 + 常见问答行 + R1 交付记录(en/zh)、审计 B4 注记结清(en/zh)、设计文档状态改「已落地」并回填落地面差异
- [x] docs 首页首访语言探测(2026-10-18,c0935e9,巡检补记):`docs/index.md` 加 `<script setup lang="ts">` 段,仅根路径(`/sandtable/` 含去尾斜杠两种形态)在 `onBeforeMount` 按 `navigator.languages` 跳 `/sandtable/zh/`;优先级 = `localStorage['sandtable-lang-auto-picked']` 手动选择 > 浏览器语言 > 保持当前 locale;点击内置语言切换链接时写入该 key;SSR 侧 `typeof window === 'undefined'` 守卫,`navigator.languages` 缺失时回退单值。Deploy Docs run 39080635636 绿;理由注释:vitepress 无此能力、GitHub Pages 不支持 `_redirects`
- [x] docs 中文原始计划页翻译(2026-10-17,6ebf469):**原计划的正文本来就是中文**(实测 CJK 43% / ASCII 字母 57%,213 行纯英文全是英文技术名词、章节标题与分隔线),此前「英文原稿 1564 行」的判断有误;真正缺的是英文侧。故按 locales 语向改正:`docs/zh/计划-原始.md` 落中文原文(33 处描述性标题按 zh 章词汇中文化,如 仿真内核/确定性随机数/公式引擎/实验管线/参数扫描/平衡推荐/路线图/单元测试/先度量后优化;Grid Search/Monte Carlo/Fixed Tick/Casual-Core-Whale 等技术名词原样保留),`docs/计划-原始.md` 为英文对照版(296 行散文实译 + 3 段中文步骤图转英文);67 个代码块 64 个三版逐字节一致、仅 3 段步骤图按语言各自本地化;结构对账(围栏 134/134、块 67/67、标题 74/74、分隔线 57/57、列表 182/182);两份切换器与 route 互指;README ×2 与 18 章双向引用同步;`docs:build` 绿
- [x] docs 迁 VitePress 官方 locales(2026-10-17,06f5f63):英文占根路由(`/guide/`、根目录 4 份文档 + 英文首页 `docs/index.md`),中文整树入 `docs/zh/`(`/zh/guide/`、`/zh/index.md` 与根文档中文版);`config.mts` 加 `locales.root`(en)+ `locales.zh`(zh-CN,侧栏/搜索/页脚文案全中文化),导航栏出内置语言切换;收口停滞会话的半成品:两棵树切换器统一为绝对路由 `/guide/NN | /zh/guide/NN`(原英文页自指、中文页链到已不存在的 `.en.md`)、两棵树图片深度对调修正(根 `../assets/`、zh `../../assets/`)、两个首页 hero action 各自带 locale 前缀、`docs/en/index.md` 与 `计划-原始.zh.md` 退役;结构对账 25/25 对齐(去代码围栏后标题/表格行/列表项/提示块计数全等)、`.en.md` 残留引用 0;`docs:build` 绿(dist 出双首页 + 双语 25 章 + 双语根文档)
- [x] docs 英文首页入口(2026-10-16,95c1b1b;2026-10-17 被 locales 取代):原做法 = `docs/en/index.md` 独立 `layout: home` + 同目录 `.en.md` 路由;locales 迁移后英文首页改为根 `docs/index.md`,该文件已退役,内容未丢
- [x] docs 子目录双语配对(docs/guide/ 25 章,2026-10-16,f247cfb + d05f5d2;2026-10-17 路由随 locales 调整):25 章中英全文齐备;此前配对形态为同目录 `.en.md` × 25,现英文并入根路由 `NN.md`、中文在 `docs/zh/guide/NN.md`;结构对账 25/25 对齐;`docs:build` 绿。口径见 2026-10-16 docs 补双语执行单:命令/路径/代码/专有名词原样保留

## 待办(挂闸:需用户拍板 / 等外部输入 / 人工验收才开工)

- [ ] **BLOCKED** 真实案例二期 + 模型校准。缺:用户提供的真实运营数据与外部对标基准;公开数值案例不能替代二期输入(2026-10-19 核查:仓内无该数据,open PR/issue=0)。已代决(2026-10-19 巡检授权):校准路径设计落 `docs/calibration-design.md`(数值通道自由变量 + 既有 sweep/optimize/RF 链 + ±10% 带与 retention 0.9 底线 + 尾段 hold-out 防过拟合;缺件即锚点 unmapped 不代数据)——设计解锁方法不解锁数据,仍 BLOCKED 于 §2 三个必需交付件
- [ ] **BLOCKED** 桌面端投入。缺:用户本机 GUI 环境完成并记录 native 文件对话框及 Windows / macOS 完整交互走查;自动化断言已尽。自动化链已覆盖:构建(run 38420221169 三腿绿)、启动(run 38436094647 20s 存活)、安装包安装+运行(run 38457041427,Windows 含 msi 腿 38488806732);证据 docs 18 Phase 7
  - 2026-10-19 Windows 侧核查（Windows 主机到位，HEAD=127ed5b）：**GUI 环境本身在**——真 Windows 11、WebView2 运行时 155.0.4283.62 在位、本会话有截图能力。**但仍拿不到可运行的桌面二进制**：①本机无 cargo/rustc/rustup，也无 MSVC cl.exe/link.exe 与 Windows SDK（Tauri 2 在 Windows 需 MSVC ABI，GNU 目标不支持 WebView2 COM 绑定），无法本机构建 apps/desktop/src-tauri；②远端无 release/tag 可下载预构建产物（GitHub API `/releases`、`/tags` 均空数组）；③GitHub Actions 的 msi 产物（run 38488806732）需 PAT 才能下载，无凭据不编造。native 文件对话框确认为 `tauri-plugin-dialog`（apps/desktop/src-tauri/src/lib.rs:64 `.plugin(tauri_plugin_dialog::init())`），只在桌面壳工作——浏览器跑 apps/web 无法走查该对话框，替代验证=假验证，不做。故 Windows 走查**仍未完成**，缺=MSVC+Windows SDK 构建工具链（或提供可下载的预构建 Windows 二进制/PAT）。macOS 那一半仍缺。
  - 2026-10-20:上面 ② 的解锁路径落地——desktop-package.yml 加每日 schedule + `nightly` 手动入参,三腿构建+安装冒烟全绿后重建单一滚动 nightly 预发布 Release(公开下载 Windows msi+nsis / macOS dmg / Linux deb,无需 PAT;无更新自动跳过,`--latest=false` 永不占正式版位)。Windows 真机走查可直接用 nightly 安装器开窗;macOS 主机仍缺,该条整体仍 BLOCKED。实证 run 39216865044(三腿全绿,nightly 预发布 4 资产 msi/nsis/dmg/deb;`releases/latest` 端点 404 证正式位空置;无凭据 curl nsis 安装器 302→200 公开可下载)。
- [ ] **BLOCKED** 随机函数扩展后续。缺:真实品类需求及顾客 System 立项输入;24 章 7 项能力已全落地,唯一候选 Poisson 到达过程尚未触发真实需求(2026-10-19 核查:open PR/issue=0);候选见 docs 24 分期计划引言末段

## 方向性(无期限,出现真实需求再启;全量见 docs 02 后续方向)

- [ ] **BLOCKED** Web API。缺:真实服务端需求与对应使用场景;local-first 不预设,docs 02 MVP 明确不做「游戏服务器运行时」(2026-10-19 核查:open PR/issue=0)
- [ ] **BLOCKED** GP 优化。缺:按需触发的实际优化需求及随机森林代理无法满足的证据;Bayesian 随机森林代理已落地,GP 留后续(2026-10-19 核查:open PR/issue=0)

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
         （2026-10-20 更新：4、5 已由巡检代决并落地——掉落结算 401b7c5 + e40b8c8、
         桌面进度取消见上方 2026-10-20 条目，review 表三行 ⏳→✅；6 仍挂外部闸门）
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
