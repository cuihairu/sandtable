# TODO

> 2026-10-14 对账:挂闸条目逐条核对本仓 git log / docs 决策记录 / 测试现状;完成项一行证据(commit hash + 测试数)。
> 2026-10-16 复核:5 条挂闸/方向性解锁条件逐条仍成立——真实案例二期无运营数据入仓(examples/ 仅公开数值示例)、桌面人工开窗验收无执行记录、随机函数无品类需求、Web API 无服务端需求、GP 无按需触发;open PR/issue=0、Dependabot=0。无可自服务项,不重开已裁决搁置。
> 2026-10-16 docs 双语:docs/ 根目录 5 页(b64138a)+ docs/guide/ 25 章(f247cfb + d05f5d2)+ 英文首页入口(95c1b1b)全部完成,docs 双语面已清。
> 2026-10-17 迁 VitePress 官方 locales:英文升为主语言占根路由(`/guide/`),中文整树移入 `docs/zh/`(`/zh/guide/`),导航栏出内置语言切换;此前同目录 `.en.md` 配对路由作废(下两条历史行的做法已被取代,内容全部保留)。
> 2026-10-17 收尾(e990ad2,补记于 10-18 巡检):两棵树 29 页自定义「English | 中文」切换行全撤,语言切换归 VitePress 导航栏内置,路由不变,页面正文无改动。
> 2026-10-18 巡检复核:可自服务区已清;5 条挂闸/方向性逐条核解锁证据仍无新输入——真实案例二期无运营数据入仓(2026-10-16 后 git log 仅 docs 提交,工作树净)、桌面人工开窗验收无执行记录(需本机 GUI 人工走查)、随机函数/Web API/GP 无新需求登记(open PR/issue=0,Dependabot=0);CI 与 Deploy Docs 至 e990ad2 全绿;tauri 上游 max stable 仍 2.12.4(3.0.0-α.5),tauri 3 未 stable,parked glib 抬升条件不满足,不重开已裁决搁置。

## 待办(可自服务)

### 专业数值策划工作台 · V2 后续实施

设计依据：[功能蓝图](docs/专业工作台功能蓝图.md) · [V2 界面设计](docs/专业工作台界面设计.md) · [设计系统](design-system/sandtable/MASTER.md)。原型入口：Web dev server 的 `/prototype/index.html`。

> 2026-10-20 整理。V2 设计、交互原型与截图已在 `bfd6800` 提交并推送；当前原型使用合成结果、浏览器草稿和演示队列。以下未勾选项是正式产品的接入与完善任务，不能因原型可操作而视为完成。实施顺序：P0 正式 UI / 中英切换 / 真实运行闭环 → P1 日常工作效率 → P2 专项分析 → P3 外部生态与团队能力。

#### 已交付：设计与交互原型（bfd6800）

- [x] 重新设计五个工作区：结果分析、参数编辑、实验设计、运行任务、数据交换；项目浏览器、文档标签、选择检查器与任务抽屉共同组织界面。源码：`apps/web/public/prototype/`；首轮聚合工作台已被替代。
- [x] 分析交互：主指标响应图、两个辅助图、候选表与检查器联动；支持指标切换、图表/表格视图、排序、约束筛选和复制候选参数。
- [x] 参数交互：18 个注册表参数样例、搜索、分组、只看变更、基础类型/概率校验、多选倍率、撤销、恢复与浏览器保存。
- [x] 实验与任务交互：A/B、Grid、Random/LHS 表单、运行预算与基础校验；演示任务可跨页显示进度、取消和完成。
- [x] 数据交换交互：CSV、JSON、SVG 实际下载；JSON 分别保存当前草稿与样例结果快照，导出文件标明合成数据来源。
- [x] 文档与预览：V2 设计稿、设计规则、三张页面截图、开发说明；修复 `/prototype/` 回退主应用的问题，跳转到明确的 `index.html` 入口。
- [x] 检查：无头 Chromium 验证候选联动、排序筛选、参数保存/刷新恢复、批量修改/撤销、校验、队列与取消、命令搜索、三类下载；覆盖 1920/1440/1024/768/390px 与 reduced motion。Web build、lint、docs build 通过。截图：`docs/assets/workbench/`。

#### P0 · 细分实施清单：正式 UI、现有接口与真实运行闭环

> 本节只拆任务，未开始实现。每个子项完成后单独勾选；一组任务的所有子项及验收条件完成后，才能将该组记为完成。建议顺序：WB-01 → WB-02/WB-03/WB-11 → WB-04/WB-05 → WB-06/WB-07 → WB-08/WB-09 → WB-10。中英文切换属于首批基础能力。

**已有接口与需补接口（2026-10-20 代码核对）**

| 工作内容 | 当前入口 | 后续工作 |
|---|---|---|
| 校验场景配置 | `lib/wasm.ts::validateConfig` | 复用，校验结果/错误定位接 UI |
| 仿真与逐日数据 | `runSimulation` → WASM / Tauri `run_simulation` | 复用；Web 迁 Worker，输出接结果状态 |
| Grid / Random / LHS 规划 | `planSweep` → `sweep_plan` | 已支持，接结构化表单与计划预览 |
| 运行一个扫描候选 | `runSweepCandidate` → `sweep_candidate` | 已支持，接真实队列和部分结果 |
| 敏感性/单轴推荐 | `recommendSweep` → `sweep_recommend` | 已支持，保留单轴/完整结果等调用条件 |
| 桌面进度/取消 | `Channel<SimProgress>` / `cancelRun` | 已支持 replicate 边界取消，迁接新 UI |
| `.sandtable` 打包/解包 | `lib/project.ts::packProject/unpackProject` | 已支持；补多对象保存与历史结果恢复 |
| 参数定义/当前值/回写 | core `registry::all/read_numeric/apply_numeric` | 内核已有，WASM/Tauri/TS 桥接需补 |
| A/B 配对统计 | core `experiment::compare` | 内核已有，完整实验执行与前端桥接需补 |
| 双语界面 | V2 原型主要中文，正式应用无统一翻译层 | 新增中文/英文词典、切换入口与状态保持 |

以下新增组件/类型名是实施建议；实际落地时与现有代码风格统一。这里的 API 主要指本地 WASM/Tauri 调用，不把 HTTP 服务作为前置依赖。

##### WB-01 · 能力盘点与接入边界

入口：`apps/web/src/App.tsx`、`src/lib/{wasm,types,project}.ts`、`components/SweepPanel.tsx`、`crates/sandtable-wasm/src/lib.rs`、`apps/desktop/src-tauri/src/lib.rs`。

- [x] WB-01.01：列出 V2 五个工作区的所有按钮、输入、选择器、图表事件和读写对象。
  - 证据：`docs/专业工作台V2能力盘点.md` §1（1.1–1.6 六张交互清单，66 项，含读写对象与 file:line）。
- [x] WB-01.02：为每个交互标明“纯 UI / 已有接口 / 需补桥接 / 后续功能”，登记对应代码入口。
  - 证据：`docs/专业工作台V2能力盘点.md` §1 分类列 + §2 汇总（纯 UI 42 / 已有接口 13 / 需补桥接 6 / 后续功能 5）。
- [x] WB-01.03：对照 WASM 导出、Tauri command 和 TS 包装，记录参数名、返回形状及错误形状。
  - 证据：`docs/专业工作台V2能力盘点.md` §3（10 能力 × 三层对照表 + camelCase/snake_case 映射 + Err 前缀清单）。
- [x] WB-01.04：确认 `sweep_plan` 的 Grid、Random、`latin_hypercube` 路径均可复用，避免把已有采样能力列成重建项。
  - 证据：`docs/专业工作台V2能力盘点.md` §4（`sweep.rs:226/259/283` 三路径 + wasm 测试 `wasm/lib.rs:354-441`；结论：只缺表单→YAML 组装件）。
- [x] WB-01.05：核对浏览器与桌面的 replicates、候选数、玩家×天数预算；以各自执行接口约束为准，去掉原型统一假预算。
  - 证据：`docs/专业工作台V2能力盘点.md` §5（Web 64/200/400k = `wasm/lib.rs:24,85,88`；桌面无预算门 = `desktop/lib.rs:8-9`；内核候选 ≤10,000 = `sweep.rs:24`；原型 100,000 假预算登记移除）。
- [x] WB-01.06：登记 Web 同步 WASM、桌面 replicate 进度、扫描候选边界取消之间的差异。
  - 证据：`docs/专业工作台V2能力盘点.md` §6（执行/进度/取消三维度差异，run=replicate 边界全弃、扫描=候选边界保留）。
- [x] WB-01.07：列出现有项目归档、配置、结果、查询与导出能力，决定迁移时保留的用户入口。
  - 证据：`docs/专业工作台V2能力盘点.md` §7（16 项保留入口 + 3 项缺口：多对象保存、结果持久引用、项目版本管理）。
- [x] WB-01.08：明确参数桥接与 A/B 统计桥接的最小输入/输出，列出本批需要新增的绑定。
  - 证据：`docs/专业工作台V2能力盘点.md` §8（`registry_all`/`read_numeric`/A/B 三条新增绑定 + I/O 表；内核依据 `registry.rs:309,407,488`、`experiment.rs:113`）。
- [x] WB-01.09：为每个工作区准备真实空状态、加载、校验失败、执行失败、无结果与部分完成状态。
  - 证据：`docs/专业工作台V2能力盘点.md` §9（六工作区 × 六态矩阵，现状/目标分列）。
- [x] WB-01.10：形成“UI 交互 → 状态 → 接口 → 产物 → 验收”对照表，记录 Web/桌面差异及依赖。
  - 证据：`docs/专业工作台V2能力盘点.md` §10（12 条端到端链路 + 差异/依赖汇总行）。

验收：五个工作区的主要交互均能定位接口或明确缺口；不以演示 toast/定时器替代真实行为。

##### WB-02 · V2 迁入 React 与共享状态

依赖：WB-01。入口：`apps/web/src/main.tsx`、`App.tsx`、`index.css`；保留 `public/prototype/` 作为设计参考。

> 桌面对齐：桌面（Tauri）侧工作区实现以 apps/web V2 设计与 tokens 为基准，见[专业工作台桌面对齐基准](docs/专业工作台桌面对齐基准.md)。

- [x] WB-02.01：把原型颜色、字体、间距、边框、状态色整理为正式应用的 CSS tokens。
  - 证据：`apps/web/src/tokens.css`(新增 `--wb-` 前缀 :root custom property 层,取值源=原型 `wb.css` :root + 设计系统 MASTER.md 视觉 token 表;零元素规则——现役 Phase 6 界面零视觉变化)+ `main.tsx` 入口导入 + `apps/web/tests/tokens.test.mjs` 5 测(原型 token 逐位收录 / 字体栈一致 / MASTER 语义色与字阶间距 / 前缀与去重 / 只 :root 块)+ CI 前端守卫接入。测试:`node --test` tokens 5 passed(columns 4 + presets/project 8 不变)、`oxlint` 过、`pnpm build` 绿。
- [x] WB-02.02：建立应用框架组件：应用栏、功能轨、项目浏览器、工作区容器、状态栏。
  - 证据:`apps/web/src/workbench/components/`——AppBar.tsx:17(应用栏)、ActivityRail.tsx:13(功能轨)、ProjectExplorer.tsx:36(资源树以稳定 ID 为身份,当前项= activeId 非下标)、WorkspaceContainer.tsx:40(tabpanel + 切页聚焦)、StatusBar.tsx:18;WorkbenchApp.tsx:182-310 组装,`.wb-app` 作用域样式 workbench.css(取值全走 e016dfa 的 `--wb-` tokens,与 540af41 桌面截图基准对齐)。
- [x] WB-02.03：建立文档标签组件；标签记录对象 ID、标题、未保存状态与当前激活项。
  - 证据:components/DocumentTabs.tsx:18(role=tab/aria-selected)+ state/workbenchStore.ts:283 `deriveDocuments`——每个文档记录稳定对象 ID(候选=内容寻址 `cnd_*`、结果集=运行 `run_*`、实验草稿=`exp_*` 派生,非下标)、标题、unsaved 圆点(草稿未保存→显示)与激活页。
- [x] WB-02.04：建立分析、参数、实验、任务、数据五个页面容器，页面路由/深链可恢复当前位置。
  - 证据:pages/ 下 AnalysisPage/ParametersPage/DesignerPage/RunsPage/ExchangePage 五容器;routing.ts:46 `parseHash/formatHash` 深链 `#/workbench/<page>?k=v`(每页白名单键:候选/主指标/视图/筛选/排序/检查器、参数焦点、方法等),WorkbenchApp.tsx:72 订阅 hashchange,store `navigate` 写 hash——刷新/新开标签恢复页面与页内位置,草稿值不进 URL。
- [x] WB-02.05：拆出响应图、候选表、选择检查器三个可独立接数据的分析组件。
  - 证据:analysis/ResponseChart.tsx:43(全 props:metric/xAxis/points/selectedId,不读全局)、CandidateTable.tsx:40(泛型 `<T>`,rows+id 注入)、SelectionInspector.tsx:36;AnalysisPage.tsx 仅组装,数据源=props 可替换(WB-03 换真实内核结果时组件零改动)。
- [x] WB-02.06：拆出参数筛选栏、参数表、参数详情与批量操作栏。
  - 证据:params/ParamFilterBar.tsx:19、ParamTable.tsx:22(行内编辑+变更/非法态)、ParamDetail.tsx:18、BulkActionBar.tsx:13;校验/批量纯函数在 paramsLogic.ts(整批失败不产生半批修改——tests/workbench-logic.test.mjs 锁定)。
- [x] WB-02.07：拆出实验方法选择、因子表、场景设置、KPI 约束表与运行计划栏。
  - 证据:designer/MethodSelect.tsx:13、FactorTable.tsx:24、ScenarioForm.tsx:25、KpiConstraintTable.tsx:14、RunPlanSidebar.tsx:16(入队经运行管理器);预算/校验纯函数 designerLogic.ts(缺名/坏域/超演示预算给可读错误,测试锁定)。
- [x] WB-02.08：拆出任务列表、任务进度、取消操作与全局任务抽屉；切页不卸载运行管理器。
  - 证据:tasks/TaskList.tsx:59(列表)/:9(TaskProgress)/:37(TaskCancelButton)+ GlobalTaskDrawer.tsx:20(状态栏直达);运行管理器 state/runManager.ts 为**模块级单例**——任务状态与定时器不入 React 树,RunsPage.tsx:13 与抽屉同源 `useSyncExternalStore(runManager.subscribe)` 订阅,切页只换订阅者;红线:演示任务明示「未执行仿真,未生成新的结果产物」(runManager.ts:32),取消在 replicate 边界落账(数值设计工作台全局快照 WB-01.06 差异登记)。
- [x] WB-02.09：建立导出对话框、确认框、命令搜索与统一通知组件，接替直接 DOM 拼接。
  - 证据:overlays/ExportDialog.tsx:21(范围/格式化)、ConfirmDialog.tsx:17、CommandSearch.tsx:20(↑↓/Enter/Esc;匹配纯函数 commands.ts `matchCommands`)+ ToastStack/notifications.ts 统一通知;OverlayDialog.tsx:19 用原生 `<dialog>.showModal` 基座,内容全 React 渲染——接替原型的 openDialog/innerHTML 拼接(public/prototype/ 保留为只读设计参考)。导出文件标注 data_source=synthetic_demo,JSON 将草稿与样例快照分列。
- [x] WB-02.10：定义 `Project/Baseline/Candidate/Experiment/Run/Job` 标识及相互引用，不用数组下标充当持久 ID。
  - 证据:src/workbench/ids.ts——六类品牌 ID + `prj_/bls_/cnd_/exp_/run_/job_` 前缀与 `isStableId` 合法性;`candidateIdFor`(基线 ID+参数域内容寻址,键序无关)、`runIdFor`(实验 ID+配置哈希+seed+模型/schema 版本派生,重试同输入⇒同 run)、`createId` 创建型一次性;`hashId` 非有限数值直接拒绝;对象引用 ObjectRef 走文档标签/浏览器。演示项目全链用稳定 ID(tests/workbench-ids.test.mjs 8 测,含「候选 ID 两两不同、数组下标零充数」锁)。
  - 本批实现说明(诚实口径):组件数据源为内置合成演示项目 synthetic_demo,统计区间为演示用对称区间——组件 props 化、WB-03 换真实内核/WB-05 接历史结果时替换数据注入,不改组件;运行管理器当前只演示任务生命周期,不产仿真结果。测试:`node --test` workbench-ids 8 passed + workbench-logic 7 passed(tokens 5/columns 4/presets/project 8 不变)、`oxlint` 0 错误、`tsc -b` 与 `pnpm build` 绿。入口:main.tsx 仅在 hash 以 `#/workbench/` 开头时进入 V2 工作台,现役 Phase 6 界面默认不变。
- [x] WB-02.11：建立共享状态与明确更新动作，区分输入草稿、运行快照、已完成结果和当前选择。(2026-10-20,`state/workbenchStore.ts` 四类分区:输入草稿 = paramDraft/objectDrafts/design、运行快照 = runs(WB-04.09 不可变条目)、已完成结果 = runArtifacts(归档产物路径键)、当前选择 = page/selection/metric/filter/sort;全部变更走 WorkbenchAction 显式动作;tests/workbench-store.test.mjs 锁定:编辑不动快照与结果、登记不碰草稿、同 run_id 重复登记幂等、选择变化三类数据引用不变)
- [x] WB-02.12：将筛选、排序、激活 KPI、候选选择、检查器开关作为 UI 状态，避免污染实验输入。(2026-10-20,上述各键均为 WorkbenchState 独立字段,reducer 各 case 只写自身字段;tests/workbench-store.test.mjs:14 个 UI 动作连发后实验输入三层(演示候选/项目对象草稿/实验设计)逐项不变,同时抽查 UI 字段落位证明测试不空转)
- [x] WB-02.13：切换页面、标签、项目资源时保留相应草稿；关闭/切换有未保存内容的文档时可恢复。(2026-10-20,navigate 不动任何草稿字段;项目模式 objectDrafts 按归档路径隔离(WB-04.06);关项目只清内存,浏览器草稿记录保留,重开同 projectId 经 restoreObjectDrafts 恢复未保存内容;object/undo 撤销栈与重做栈保留;tests/workbench-store.test.mjs 三条恢复路径锁定)
- [x] WB-02.14：迁入命令搜索、Tab/方向键/Home/End、保存/撤销快捷键，输入框内不抢占原生编辑快捷键。(2026-10-20,命令搜索 Ctrl/Cmd+K、保存 Ctrl/Cmd+S、撤销 Ctrl/Cmd+Z 在 WorkbenchApp 全局层,新增重做 Ctrl/Cmd+Shift+Z·Ctrl/Cmd+Y;裁决提为纯函数 `workbench/keyboard.ts` globalShortcutFor——输入框/文本区/contentEditable 内撤销与重做交还浏览器原生行为,Ctrl+S/K 无原生文本编辑语义任何焦点都接管,修复原实现无条件 preventDefault 抢占输入框 Ctrl+Z 的缺陷;Tab/←/→/Home/End 走 DocumentTabs roving tabindex;空历史时撤销/重做不再谎报「已撤销」;tests/workbench-shortcuts.test.mjs 6 测 + 快捷键说明弹层同步更新)
- [x] WB-02.15：为各状态接入加载、禁用、错误边界与重试；删除只有“已完成”提示却未执行动作的事件。(2026-10-20 审计落账:错误边界 main.tsx ErrorBoundary 包住两套界面,白屏换可读文案(2026-10-13 无头走查即此路径);重试 runManager.retryJob 同一执行快照重新入队(WB-07.14,RunsPage 与 TaskList「重试」按钮);禁用——RunPlanSidebar canSubmit、查询/Parquet 按钮 busy 期 disabled;演示任务完成提示明示「未执行仿真,未生成新的结果产物」不冒充真实完成,真实完成提示伴随候选数与 A/B 产物;查询引擎初始化失败 toast 报错且按钮保持可点即重试)
- [x] WB-02.16：迁入侧栏/检查器收起与窄屏局部滚动，保证桌面图表和候选表可同时操作。(2026-10-20,资源树收起 explorerCollapsed + 状态栏切换 + 1060px 断点处理;检查器 toggle-inspector 在分析页工具栏(收起/显示,aria-label 同步);页面内容 .page-scroll overflow:auto 局部滚动,应用根 100dvh overflow:hidden 不整页滚;1250px/1060px 断点 analysis-body 保持图表+检查器两列网格,图表与候选表不互斥)
- [x] WB-02.17：将已有查询、Parquet 导出等能力放入合理入口，避免更换壳后丢失功能。(2026-10-20,数据交换页新增两入口:SQL 查询——按需动态加载 duckdb-wasm 与 QueryPanel,打开即把演示候选 CSV 注册为内存表 sandtable_demo_candidates,也可载入 .sandtable 项目 / CSV 产物查自己的数据;Parquet 导出——exportCsvAsParquet 与 CSV 同列,CLI query 可 read_parquet 直接续分析;两入口 busy 期禁用、失败 toast 且可重试;桌面壳原生本地查询仍在现役单页界面未丢,见 WB-02.18)
- [ ] WB-02.18：把桌面壳的原生本地查询（LocalQuery：多选对话框 + 手输路径读磁盘产物，万级行不经前端内存）迁入工作台数据交换页。(2026-10-20 审计 WB-02.17 时发现,独立成行;当前工作台提供浏览器内 duckdb 查询等价入口)

验收：正式 React 应用可操作五个工作区；状态不因切页丢失，视觉遵循 V2，演示与真实数据来源清晰。

##### WB-11 · 中文 / 英文与即时切换（首批必需）

依赖：WB-02 的应用框架；与 WB-03 并行设计。范围是应用 UI，不仅是已存在的双语文档站。

- [x] WB-11.01：定义首版支持的 locale：`zh-CN`、`en-US`，显示名称固定为“简体中文”和“English”。(2026-10-20,`src/lib/i18n/locales.ts`:LOCALES/Locale/DEFAULT_LOCALE=en-US/isLocale 守卫,守卫测试锁死显示名不漂移)
- [x] WB-11.02：建立统一翻译入口、语言状态与中文/英文词典目录；不在组件内散落语言判断。(2026-10-20,`src/lib/i18n/index.ts`:纯函数 t() 命名参数插值、未知 locale 退 en-US、未知 key 原样返回;createLocaleStore 订阅式语言状态,待 WB-11.05/06/07 接线)
- [x] WB-11.03：给翻译 key 建立类型/结构约束，中文与英文词典使用相同 key 集合。(2026-10-20,`dict/zh.ts` 真值源 as const + `dict/en.ts` satisfies Record<keyof typeof zh, string> 编译期锁同集合,tests/i18n.test.mjs 运行时再锁一遍)
- [x] WB-11.04：按公共控件、导航、参数、实验、分析、任务、数据/导出、错误信息组织词条。(2026-10-20,首批 35 词条按八领域前缀组织,nav 侧与 routing.ts 五工作区 label 对齐;守卫锁死前缀集合与各领域非空)
- [x] WB-11.05：在应用栏或其设置菜单放置可见语言切换入口，支持键盘操作与当前语言标记。(2026-10-20,`components/LanguageSwitcher.tsx`:应用栏可见入口,listbox/option + aria-selected + 勾选图标标记当前语言;键盘 ↑/↓ 移焦点、Home/End 到头尾、Enter/空格选中、Esc/Tab 关闭并把焦点还给按钮、点击菜单外关闭;选项标签用 LOCALES 固定显示名,切换入口自身文案走词典)
- [x] WB-11.06：首次进入按浏览器/系统语言选择中文或英文；无匹配时使用 `en-US`，界面仍可手动切换。(2026-10-20,`state/localeStore.ts` 模块初始化同步引导:持久化 > navigator.languages 系统语言 > en-US,首帧前就位;纯逻辑在 `lib/i18n/session.ts`(注入 storage/语言列表/文档头,SSR 与节点测试可装配),守卫测试锁引导优先级)
- [x] WB-11.07：将用户主动选择持久化到应用设置/浏览器本地存储，优先于之后的系统语言变化。(2026-10-20,session.set 手动选择写 LOCALE_STORAGE_KEY,下次引导压过系统语言;同值不重写不重发通知;localStorage 访问/写入失败降级见 WB-11.29)
- [x] WB-11.08：切换语言即时更新当前页面，不刷新、不重新打开项目、不重跑实验。(2026-10-20 完成判定:架构即订阅驱动——locale 会话单例(WB-11.05/.06/.07)+ useSyncExternalStore,组件随 locale 重渲染,workbench 状态不重建;WB-11.09 节点测试已锁切换不丢草稿/选择/筛选/排序/页面/标签/后台任务;WB-07.17 源级守卫锁执行域六文件不 import i18n=任务对象与执行引用不随 locale 重建(不重跑实验);浏览器 effect 侧即时文案经 localeSession.get()(WorkbenchApp 快捷键提示/notifications toast 入队解析);展示面 WB-11.11~16 全部接词典,切换即出新文案,无刷新/重开路径)
- [x] WB-11.09：验证切换语言保留未保存输入、候选选择、筛选排序、打开的标签和后台任务。(2026-10-20,tests/workbench-locale.test.mjs 跨模块锁:先写候选草稿、选候选、设筛选/排序、跳页、改实验设计并入队演示任务,切 zh-CN 再切回 en-US,逐项断言草稿与保存态、候选选择、筛选、排序、当前页、实验设计原样,deriveDocuments 标签 ID 列表不变,任务仍在 runManager 队列;语言状态只在 localeSession 内变化,不刷新不重开项目)
- [x] WB-11.10：同步更新页面 `lang`、窗口/文档标题、ARIA 标签、图表替代说明和空状态。(2026-10-20 完成:正文翻译(WB-11.11~16)落地后 localeStore.domDoc 接上 setLang(document.documentElement.lang 同步,applyDocumentLocale 行为已有测试),i18n 测试 +1 源级守卫锁接线;setLang 刻意缓接的理由(读屏器按英文读中文正文)随之消除;文档标题此前已接 common.appTitle;ARIA 标签/图表替代说明/空状态已随 .11~.16 各界面接词典——nav.workspace(工作区 tabpanel)、tasks.progressAria/drawerAria/collapse、data.project.draftAria(draftAriaYaml)/resultsAria/registryAria、analysis.chart.*/table.*/demo.* aria 与空态、common.closeDialog/closeNotification/commandListAria 等)
- [ ] WB-11.11：翻译应用栏、资源树、功能轨、文档标签、状态栏、菜单、按钮及快捷键说明。(2026-10-20 部分推进:五壳组件已接词典——AppBar 全部文案、ActivityRail nav.*+nav.short.*、ProjectExplorer 自身文案(资源标题留数据侧)、DocumentTabs nav.tab.*+common.unsaved(选择器解耦为 data-doc-tabs)、StatusBar 状态文案;新增 37 词条 common.*/nav.*,i18n 测试 +1 锁五组件 34 键双语齐全;2026-10-20 第二批:调用方壳全部接词典——WorkbenchApp 15 条通知模板+保存/来源/脚注/草稿/选择标签+重置/打开/关闭三确认+关于/项目信息/快捷键三对话框,CommandSearch 标题/提示/占位/空态,OverlayDialog/ToastStack aria,ConfirmDialog 取消键;快捷键 effect 保持 [] 依赖不重挂,locale 经 localeSession.get() 即时读取(WB-11.08);saveProject 同改 get() 以免闭包 locale 触发 exhaustive-deps 不稳定告警;新增 58 词条,门禁 oxlint 0 警告/tsc/140+20 测试/vite build 全绿;已代决:演示资源组标题/项目名留数据侧(与 WB-11.12 一致),内核契约名与透传错误文案保持原文;资源树 demoGroups 数据侧标题与 .15/.16 剩余界面留后续批次,条目保持未勾)
- [x] WB-11.12：翻译参数分组、表头、字段标签、单位说明、修改状态、校验提示与批量操作文案。(2026-10-20,ParametersPage/ParamFilterBar/ParamTable/ParamDetail/BulkActionBar 五文件全接词典,新增 params.* 约 90 词条(含 8 个 kind. 类型名、11 个 group. 分组名、复数占位计数对);分组名从中文硬编码改为稳定英文键(`paramRegistry.GROUP_BY_PREFIX`)+ `paramGroupLabel(group, locale)` 显示,筛选值与 state 存的仍是键、不随语言漂移,eyebrow 与筛选下拉走显示名;locale 订阅从页面本地 localStorage 快照换成 useLocale(),与 LanguageSwitcher 同源即时生效;params-config 测试同步改用 combat/gacha 键;i18n 测试 +1 锁 params.* 键集合双语一致、关键面点名与占位双语对齐)
- [x] WB-11.13：翻译实验方法说明、因子表、场景字段、随机策略、预算、运行前检查与禁用原因。(2026-10-20 完整落地:上一批六文件静态文案约 110 词条之外,本批把 locale 穿进逻辑层——designerLogic 的 factorRowError(FactorCheckContext.locale?)/designErrors(DesignContext.locale?)/kpiAvailability/scenarioStats/applyScenarioLeaf/thresholdFromUi/budgetActions 全部改为可选 locale 参数,新增 experiment.err* 与 budgetHint 共 38 词条,错误串由 t() 出、缺省 zh-CN 真值源(站点默认 locale 是 en-US,缺省不取 DEFAULT_LOCALE,防测试契约漂移);DesignerPage/RunPlanSidebar 调用点传响应式 locale,KpiConstraintTable 的 KPI 显示名/单位后缀改走 kpiDisplayName/kpiUnitText;解析行前缀复用 params.yamlErrorLine 模板;experiment-form 测试新增 locale 线程块(缺省=中文子串、en-US=英文无中文、预算触发词仍是内核「预算」),i18n 测试 err* 点名+占位对齐)
- [x] WB-11.14：翻译 KPI 显示名、图标题、坐标轴/图例/tooltip、约束判定和统计解释。(2026-10-20 完整落地:分两批。批 A 逻辑层(3af3bbe/fe0ae65)——designerLogic 的 kpiDisplayName/kpiUnitText + analysis.kpi.*/analysis.kpiUnit.* 共 12 词条(KPI_TABLE zh 简表作回退),约束表已接;metricMeta 新增 metricLabel/metricUnit(locale?);resultModel 的 rowState/formatMetric(单位后缀改 metricUnit)/statText/feasibility、analysisView 的 dailyRows/sensitivityNoteLabel/interpolationText 全部改可选 locale 参数并新增 24 条统计文案;批 B 界面层(本条)——ResponseChart 的 svg aria/标题/基线 title/空态走 analysis.chart.*,CandidateTable 表头/空态/选择 aria/基线徽标走 analysis.table.* 且 VerdictChip 判定徽标走 analysis.verdict.*,SelectionInspector chrome(标题/折叠/硬约束/展示区间/统计口径/数据来源)走 analysis.inspector*;真实结果页 AnalysisPage 全量接线(来源行/实验/运行/主指标/筛选/图表注/候选表列/检查器/统计来源 8 项/推荐表头/单点与 A-B/逐日/草稿),演示页 DemoAnalysisPage 指标列名改走 metricLabel、约 40 条 analysis.demo.* 词条;新增 analysis.waitingComparison/sourceLabel 与 demo.candidatesTitle 三个补齐词条;内核契约名(pass/borderline/fail、hard/soft、run/replicate、day/win_rate/inflation 表头、rec.reasons、e.note 前缀、j.status)按 WB-11.15 范围保持原样不翻译。门禁:node --test 13 文件 140 通过 + analysis-results 20 通过,tsc -b/oxlint/vite build 全绿)
- [x] WB-11.15：翻译队列状态、进度、取消中/取消完成、失败、重试及部分结果提示。(2026-10-20 落地:新增 tasks/taskText.ts 显示层(无 JSX,节点可测)承担 statusLabel/errorClassLabel/recoveryText;TaskList 全量接线(进度口径三分/真实终态 footer/取消按钮双态 title/演示四态/部分结果徽标/重试/空态),GlobalTaskDrawer(标题/来源徽标/全部任务/收起 aria/空态/任务行);runManager 8 条终局与竞争 toast 改发结构化词条 {key,params},notifications.notify(非 WB-07.17 守卫文件)入队时经 localeSession.get() 解析——执行域六文件(jobLogic/execFsm/executor/runManager/workerProtocol/sweepWorker)保持零 i18n import,WB-07.17 源级守卫原样绿;终局取消 toast 按 边界种类×部分结果 拆 8 个整句词条 + realDone/realDoneComparison/failed/failedUnknown(整句成形,不在状态层拼串);内核契约名 replicate/candidate/arm/A/B 保持原样;jobLogic.STATUS_LABEL 与 execFsm.ERROR_CLASS_LABEL/recoveryFor 保留为逻辑侧 zh 简表(execution 测试口径)。新增约 66 词条(tasks.cancelling + failed 对齐为'已失败');门禁:node --test 13 文件 142 通过(+2:WB-11.15 词条锁与 toast 结构化解析锁)+ analysis-results 20 通过,tsc -b/oxlint 0 警告/vite build 全绿)
- [x] WB-11.16：翻译导入导出对话框、范围/格式选项、成功/失败提示和商业软件互通说明。(2026-10-20 落地:ExportDialog 全量(data.exportDialog.* 范围/格式/说明,取消复用 common.cancel);ExchangePage 全量(data.exchange.* 六卡/intro/互通边界/queryHint/初始化与转换态,4 条提示改结构化词条经 notifications 解析,与 runManager 同口径;表名 sandtable_demo_candidates 与 read_parquet/jsondecode 等 CLI/函数名保持原文);RunsPage 骨架(nav.runs 标题 + tasks.queueTitle 面包屑复用 + tasks.page.* 徽标/新建实验/会话说明/真实结果区/结果行 meta,j.status 保持原文);ProjectPanels 全量(data.project.* 草稿编辑器 aria/徽标/撤销放弃/已保存结果/运行登记表头与注,'report schema 版本'行与 unknown-version 内核消息保持原文);新增约 60 词条;已代决:RunsPage/ProjectPanels 并入本条以清完页面层(与 designer/params/analysis 页随各自条目落地同例)。门禁:node --test 13 文件 142 + analysis-results 20 通过,tsc -b/oxlint 0 警告/vite build 全绿)
- [x] WB-11.17：动态文案使用参数化模板；计数/复数规则按 locale 处理，不拼接中文或英文碎片。(2026-10-20,`lib/i18n`:t() 命名占位插值+未提供参数原样保留,即参数化模板;plural.ts 走 Intl.PluralRules 选形,tPlural 按词典 `<key>.<category>` 取形、失败回退 .other、{n} 自动注入;en 形句整体重写不做词缀拼接,zh 恒 other、.one 形仅为键集对齐;词典增 tasks.remaining/data.rowsExported 复数对,守卫测试 12/12)
- [x] WB-11.18：使用 `Intl` 统一显示数字、百分比、日期、时间和时长；语言切换不改变底层数值。(2026-10-20 落地:`lib/i18n/format.ts` 收口显示格式——fmtNumber/fmtPercent/fmtDate 之外新增 maxFractionDigits(封顶不补零,承接原 toFixed 口径)与 fmtNumberSig(有效数字封顶,坐标轴刻度用),格式化器按 locale+选项缓存;新源级守卫:src/** 除 lib/i18n 外禁 new Intl.NumberFormat/DateTimeFormat,数字/日期只能经 format 层;接线四处——resultModel.formatMetric(指标数值与 CI 走 maxFractionDigits+metricUnit)、ResponseChart(数据点走 metric.decimals、轴刻度走 fmtNumberSig(5),替代原 toFixed/locale 内联)、RunPlanSidebar 4 处 toLocaleString(任务数/模拟次数/玩家天数/玩家数)改 fmtNumber、DemoAnalysisPage 检查器 valueNote 百分差改 fmtNumber;fmtPercent 是唯一 ×100 点、fmtDate 按 UTC 日历日,此前已接的面(analysis 指标表/统计、任务进度、导出行)不变;已代决:旧 Phase-6 应用(src/App.tsx/SweepPanel/SweepChart/SweepMatrix)不在本次范围——待退休面,experimentYaml toFixed(6) 是机器 YAML 序列化非显示;语言切换不改底层数值=formatter 只格式化,seed/指标值/哈希不进 format 层;i18n 测试 +2(format 层口径 + Intl 构造禁令扫描),门禁:node --test 13 文件 145(+3)通过 + analysis-results 20 通过,tsc -b/oxlint 0 警告/vite build 全绿)
- [x] WB-11.19：参数路径、KPI ID、文件路径、哈希、seed 和用户输入名称保持原始内容；仅翻译系统显示名与辅助文字。(2026-10-20,`lib/machineExport.ts`:RAW_FIELD_KINDS 登记六类原始字段 + isRawFieldKind 守卫;机器输出(machineNumber/machineJson/csvCell/toCsv)一律不收 locale 参数,本地化只走显示层 t/tPlural/displayName(未翻译的原始 desc 由 WB-11.20 回显);守卫测试锁六类清单不漂移)
- [x] WB-11.20：区分“原始注册表 desc”与“已翻译展示文案”；未翻译的项目自定义描述显示原文，不假装自动翻译。(2026-10-20 落地:边界本就分层——RegistryParam.desc 是注册表 zh 原文(与 registry.rs 逐字锁漂移,WB-05.01),展示译名在独立 EN_NAMES 表(displayParamName),词典侧 displayName(locale,key,raw) 有译词用译词/未知 key 回显原始 desc(i18n 测试已锁);详情面板定义区恒显原始 desc + registryNote 如实标注「取自参数注册表」,不冒充翻译;本条补 params-config 守卫测试锁死参数侧口径——64 项 zh 展示名=原文逐条、en 展示名全量独立译名(既不回显路径也不拿 zh 原文冒充,断言 name≠path 且 name≠desc)、未登记自定义路径如实回显标识不虚构译文;项目自定义参数当前无入表面(参数表行模型只来自注册表),WB-03 桥接接入 ParamDefinition 后自定义 desc 走同一 displayName/回显口径;数据侧标题(demoGroups/项目名)按 WB-11.11 已代决保持原文)
- [x] WB-11.21：为可识别校验/运行错误提供稳定错误码与参数化翻译；保留原始内核错误详情供定位，未知错误使用本地化兜底。(2026-10-20,`lib/i18n/errorText.ts`:错误码 config_error/param_error/serialize_error/unknown_error 稳定不变,复用 lib/errors.ts 前缀分类;词典 errors.* 改 {detail} 参数化模板,localizeWasmError(locale, err)→{code,text,detail},detail=原始内核消息逐字保留;未知走 errors.unknown 本地化兜底,缺词纪律(WB-11.25)对错误词条同样生效;守卫测试 16/16)
- [x] WB-11.22：机器可读导出保持稳定字段名、枚举值与小数点；CSV/JSON 不能因切换语言改变 schema。(2026-10-20,`lib/machineExport.ts`:machineNumber 规范十进制(点小数、无千分位、-0 归一)、toCsv/csvCell RFC4180(表头原样、行宽不齐明确报错、CRLF、null=空单元格非 0)、machineJson 递归拒非有限数值(JSON.stringify 的 NaN→null 是静默造假);全部函数无 locale 参数=编译期保证 schema 不随语言漂移;demo 导出(csvCell/JSON)切到共用口径,不再四舍五入;守卫测试 7 条)
- [x] WB-11.23：SVG/可读报告使用导出时选定语言并记录 locale；不把本地化显示文本写回实验配置。(2026-10-20 落地:`lib/machineExport.ts` exportLocale/svgLanguageMeta(记录值与渲染语言同源,未知 locale 退 en-US,先期已测)之上完成调用侧接线——demo/export.ts 新增纯函数 svgAnnotation(locale,metricLabel) 出标题/来源说明(走 data.export.svgTitleNote/svgDescNote 双语词条,原混排 zh 标题后缀+en desc 收口为同语言产物),svgFromElement 的 locale 从可选改必传(唯一调用方就位,导出必记录 xml:lang+data-locale);WorkbenchApp SVG 导出传 metricLabel(id,locale) 显示名 + 导出 locale;机器快照 demoSnapshot 继续只收原始草稿经 machineJson(无 locale 参数,WB-11.22 已锁),实验配置不写本地化显示文本;machine-export 测试 +2(svgAnnotation 双语与同语言断言、WorkbenchApp 调用侧源级守卫锁两处接线),门禁:13 文件 148 + analysis-results 20 通过,tsc/oxlint/vite build 全绿)
- [x] WB-11.24：核对英文长标签、中文行高、按钮/表头/图例布局；两种语言下宽表和小屏都可操作。(2026-10-20 无头浏览器(playwright + 重建后的 wasm 内核)实测:zh-CN/en-US × analysis/parameters/designer/runs/exchange 五工作区 × 1440/1100 两档视口共 20 组,documentElement.scrollWidth≤clientWidth 全部无横向溢出;参数页/设计页截图目检——表头/按钮/图例/检查器中英排版正常,英文长标签未破格;截图存 /home/cui/.cache/sandtable-shots/{zh-CN,en-US}-*.png)
- [x] WB-11.25：检查词典缺 key/空字符串；开发环境报告缺失项，正式界面不直接展示翻译 key。(2026-10-20,词典缺 key/空串已有 WB-11.03 守卫(key 集合一致+非空)锁死;缺词双形态:t()/tPlural 经 reportMissing——正式界面回显当前语言的 `errors.missingText` 兜底文案绝不回显 key,开发环境回显原 key 可 grep 且按 `locale|key` 每键只 console.warn 一次;dev 判定默认 Vite import.meta.env.DEV,configureI18n 可覆盖(应用入口/测试用);守卫测试 14/14)
- [x] WB-11.26：检查首屏语言、手动切换、刷新恢复、设置不可写与未知 locale 的回退行为。(2026-10-20 无头浏览器 7 项实测全过:无存储+系统 en-US 首屏 en-US;无存储+系统 zh-CN 首屏 zh-CN;手动切换后 <html lang> 即时翻转且 window 对象保留=未整页重建,选择落 localStorage;刷新后恢复所选;localStorage.setItem 抛错(隐私模式模拟)→ 切换仍生效且无未捕获异常;坏存值 "garbage" 启动 → 回退 en-US。节点侧同口径已由 WB-11.06/.07/.29 测试锁定,浏览器侧为本条独立验收)
- [x] WB-11.27：在运行中切换语言，确认任务进度继续、取消仍命中原任务、结果没有被清空。(2026-10-20 无头浏览器实测全链:默认设计提交 A/B 任务入队(修复后,见下)→ 运行页任务行显示 Running·real execution(4/24)→ 切 zh-CN 任务条目仍在且文案即时换语言、进度继续推进 → 点取消 → 状态落「已取消 · 含部分结果 · 已在候选边界(已完成 2/6 候选)真正停止(取消请求→边界落地)」= 取消命中原任务且保留已完成产物 → 回切 en-US 任务与结果条目不丢。前置修复:本地 wasm pkg 过期(10-08 构建,registry 10-19 加 damage_model)导致内核校验误报,已 wasm-pack 重建;真 bug 两处并修——buildDefaultYaml 单独物化 model.loot.rate_mult 违反内核显式性契约(loot 在场必须整配,config.rs),新增 DEFAULT_YAML_OMITTED 不发该段(内核缺省 loot=None 时 rate_mult 隐式 1.0,行为等价);CommandSearch 传 dismissable={false} 把原生 dialog 的 Esc cancel preventDefault 掉,面板无法键盘退出,改回默认可关)
- [x] WB-11.28：以中文和英文分别走通五个工作区、关键错误路径、下载及键盘操作，保存两套关键截图。(2026-10-20 无头浏览器 52 检查 0 失败:两语言各走通 analysis/parameters/designer/runs/exchange 五工作区并全页截图 10 张(存 /home/cui/.cache/sandtable-shots/,两套完整);键盘 Ctrl+K 开命令面板/Esc 关闭(两语言);CSV 下载闭环——切合成演示源→导出对话框→确认→sandtable-demo-candidates.csv 落地(两语言各一);错误路径:11.27 的取消/部分结果文案与「运行错误:未知错误/恢复:调整后重新提交」恢复提示在双语下均正常呈现;命令面板 Esc 关闭缺陷已修(见 WB-11.27 条目),守卫测试锁死不得再传 dismissable={false})
- [x] WB-11.29：语言选择写入本地存储失败（隐私模式/配额满）不中断切换：正式形态静默生效，开发形态每会话只告警一次。(2026-10-20,接线 WB-11.07 时发现的新要求;`lib/i18n/session.ts`:persistLocale 包 try/catch,写失败只影响持久化不影响切换结果,dev 告警按会话去重;守卫测试锁降级行为)

验收：用户可随时在简体中文与 English 间切换并记住选择；切换不丢草稿、不打断任务、不改变数据或机器导出格式。

##### WB-03 · 真实数据类型、缺失桥接与执行适配

依赖：WB-01；与 WB-02/WB-11 并行。入口：`src/lib/{types,wasm}.ts`、`crates/sandtable-wasm`、`apps/desktop/src-tauri`、core `registry/experiment`。

- [x] WB-03.01：对照 Rust 实际序列化补全 TS 的参数定义、配置、KPI、候选、比较结果及错误类型。(2026-10-20,commit 见 git log「feat(web): align TS types with kernel serde contracts」:types.ts 六族补全——RunMetrics 6/25→27 键(retention 系可空、gacha/loot 键省略型)、DayStat+upgrades、PowerSnapshot、METRIC_KEYS=8、SimConfig 全嵌套族、ParamDefinition、Comparison、SensNote;errors.ts 绑定层前缀分类;tests/contracts.test.mjs 真跑 pkg-node 内核逐键锁漂移 9/9 绿,web 全套 26/26、tsc 0 错、build 绿;无桥接出口的族由存在性断言兜底,WB-03.04/10/11 落地后升级运行时锁)
- [x] WB-03.02：定义字段可空、指标 unavailable、候选 `config_error` 和缺失产物的表达，禁止用 0 填空。
  - 落点:可空字段按内核 `CandidateStatus` 原样透传(lib/types.ts 可空字段,零值≠缺值);指标 null → `formatMetric` 返回「不可用」不用 0 填空(analysis-results.test.mjs);候选 `config_error` 状态原样上报并在结果面板红字标注(ProjectPanels ProjectResultsPanel);缺失产物新增 `auditRunArtifacts`(state/projectDoc.ts):索引声称的 files 与在场文件(项目 files ∪ runArtifacts)逐条对照,缺失逐条点名返回 `{runId, file}`,UI 侧 RunRegistry 对缺失路径红字 + 警示图标标「缺失」,不静默跳过。
  - 测试:workbench-logic.test.mjs 18/18(新增 WB-03.02 审计 4 断言组:缺失点名/全在场为空/数组入参等价/空索引为空);i18n 30/30(新键 data.project.missingArtifact zh/en 对齐);tsc -b 0 错;oxlint 0 警;vite build ✓。
- [x] WB-03.03：明确内核比例值与 UI 百分比、绝对差与百分点的转换规则；存储和传输保持原始口径。
  - 规则落点:ratio 类(win_rate/retention/churn)内核原始值恒 0–1,×100 只发生在显示层(formatMetric 与 lib/i18n/fmtPercent,源码守卫禁 Intl 外逸);绝对差后缀 `pp`(百分点)且小数位 +1 收口;amount 类不缩放只附单位;存储/视图模型/CSV/SVG 导出/跨端传输保持原始口径(sweep-view:104、machine-export csvCell 原样断言既有)。
  - 破口修复:AnalysisPage 逐日表曾裸渲染内核 0–1 比例(day_stats.win_rate/inflation 直出)——现 win_rate 走 formatMetric、inflation 走 fmtPercent,null 显示「不可用」不用 0 填空;规则全文注释在 formatMetric(analysis/resultModel.ts)。
  - 测试:analysis-results 21/21(新增 WB-03.03 源码守卫:内核逐日值 ≤1 确认口径、daily 单元格必须走换算入口、禁止裸渲染);全套 196/196;tsc -b 0 错;oxlint 0 警;vite build ✓。
- [x] WB-03.04：补参数定义读取桥接，返回 path/kind/default/desc；可选元信息缺失保持空值。
  - 落点:core ParamSpec/ParamKind 派生 Serialize(kind serde 小写串=TS ParamKind 字面量);wasm 新导出 `param_registry()`(静态全量 `registry::all()`,JSON 字符串通道,无入参不会失败);Tauri 新命令 `param_registry`(core 直连,与 wasm 逐字段同构,已注册 invoke_handler);TS 服务层 `paramDefinitions()`(lib/wasm.ts,桌面 invoke / 浏览器 wasm 双路径同形状,返回 ParamDefinition[])。可选元信息:内核未提供的字段一概不出场(缺席保持缺席,消费方按空值处理),不造默认元信息。
  - 测试:contracts.test.mjs 10/10——参数定义族从 WB-03.01 存在性断言升级为真跑内核运行时锁:条数=注册表全量 64、恰四字段(path/kind/default/desc 全 string)、逐字段逐序与 TS 镜像(PARAM_REGISTRY,registry.rs 原文)一致、kind 不越界 ParamKind、wasm.ts 双路径接线源级守卫;全套 node 197/197;Rust core+wasm 179 过;desktop cargo check ✓;tsc -b 0 错;oxlint 0 警;vite build ✓(pkg/pkg-node 已重建含新导出)。
- [x] WB-03.05：补当前配置参数读取桥接，通过 core 读取真实有效值，不把 default 当当前值。
  - 落点:wasm 新导出 `param_values(yaml)`(load+validate 后逐数值注册路径 `registry::read_numeric`,返回 `{path: 当前生效值}`);Tauri 同构命令 `param_values`(已注册);TS 服务层 `paramValues(yaml)`(lib/wasm.ts 双路径)。已代决:只回数值槽(u32/u64/i64/f64/mix,58 项中的 57 数值路径),非数值槽(时长/公式/结构表)缺键 ≠ 0、有效形态即配置文本(归 WB-03.07);loot/gacha 未配置时返回内核真实生效缺省(read_numeric 的 unwrap_or),不是前端拿注册表 default 补值;u64 走 read_numeric 同精度边界(JS 安全整数面归 WB-03.08)。参数页基线列本就从打开 YAML 读真实值(cellOf),不经过注册表 default。
  - 测试:wasm Rust 13/13(新增 param_values_reads_effective_not_registry_default:改动值按当前值读出、loot 缺省=内核口径、非数值槽缺键、57 全覆盖、非法 YAML 配置错误前缀);contracts.test.mjs 11/11(新增 WB-03.05 运行时锁:seed/attack 生效值、loot 1.0、缺键断言、数量=数值路径数、错误分类 config、wasm.ts 双路径接线守卫);全套 node 198/198;desktop cargo check ✓;tsc -b 0 错;oxlint 0 警;vite build ✓。
- [x] WB-03.06：补数值参数应用桥接，复用 core 类型与参数寻址；未知路径、非数值结构和非法类型返回明确错误。
  - 落点:wasm 新导出 `param_apply(yaml,path,value)`(内核寻址 `registry::apply_numeric` 单条编辑 → **应用后重验** → read_numeric 回读,返回 `{config_hash,path,value}`,apply/read 镜像证明);Tauri 同构命令 `param_apply`(已注册);TS 服务层 `paramApply(yaml,path,value)`(wasm.ts 双路径)。已代决:单条编辑口径(批 = JS 循环;内核侧批量已有 sweep_candidate 通道),错误逐类明确——未知路径带相近路径建议、非数值槽「该参数不是数值」、u32/u64 为负「不能为负」,全部 `配置错误: ` 前缀走 classifyWasmError;重验把关显式性契约(未配置 loot 应用 rate_mult 会经 get_or_insert 物化半配置 loot,编辑期即报 on_victory 缺失,不等运行期)。文本层 applyParamEdits(保留注释)仍负责写回,归 WB-03.07 契约。
  - 测试:wasm Rust 14/14(新增 param_apply_uses_kernel_addressing_and_revalidates:回读值/hash 64 位/异值异 hash/未知路径/非数值槽/负值/loot 半配置重验);contracts.test.mjs 12/12(新增 WB-03.06 运行时锁同七断言组 + wasm.ts 双路径接线守卫);全套 node 199/199;desktop cargo check ✓;tsc -b 0 错;oxlint 0 警;vite build ✓。
- [x] WB-03.07：设计配置回写/序列化契约，保留枚举、公式、逐层表、loot 等未编辑的结构配置。
  - 落点:双通道契约成文于 docs/guide/22-web.md(绑定纪律节,中英双份)——①人工写回走 YAML 文本层(applyParamEdit token 级替换不重序列化,注释/键序/未编辑结构逐字节保留,serde 重序列化丢注释重排键禁作人工写回);②内核对象通道只出 hash 与回读值(param_apply 重验后回 {config_hash,path,value},永不回 YAML;config_hash 是内核 canonical SHA-256,YAML 文本不进哈希);③数值桥接对结构性参数一律「该参数不是数值」拒绝,结构配置只走文本编辑或专用结构编辑器。文本层既有实现(configYaml.ts)不改,契约是对既有行为的成文+锁死。
  - 测试:contracts.test.mjs 13/13(新增 WB-03.07 契约锁:param_apply 恰三字段不出 YAML;全结构段样本——枚举/公式/逐层表/loot/gacha/training——无关数值编辑后逐字节保留);params-config 22/22(WB-05.15 文本层 round-trip 原锁不动);docs:build ✓(全站 36.6s,VitePress 双语言路由过)。
- [x] WB-03.08：明确 u64/seed 等值的 JS 安全整数边界；不安全值采用无损表达或明确拒绝，不静默舍入。
  - 落点:内核 apply_numeric 加 exact_u64 门(seed/pity_hard/pity_soft_start 三 u64 槽):> 2^53−1 明确拒绝「超出安全整数上限 2^53−1…不静默舍入」;registry 新增 read_u64_raw 无损读通道(param_values/param_apply 双侧复用);桥接面:≤ 2^53−1 返回 JSON 数字,越界以**十进制字符串**无损表达(TS paramValues Record<string,number|string>、ParamApplyResult.value number|string);契约条目成文 22-web.md 双语言。
  - 测试:wasm Rust 16/16(新增 u64_beyond_safe_integer_is_lossless_or_rejected:越界读=字符串、范围内读=数字、越界写拒绝、pity 同门);contracts 16/16(新增 WB-03.08 锁:BigInt 字面量保证 YAML 精确且断言「2^53+1 在 JS number 下必舍入」前提、读写字两侧、类型面 string 分支);核心 165 全过(apply/read 镜像不受影响);desktop check ✓;tsc/oxlint/build ✓;全套 node 202/202。
- [x] WB-03.09：补 KPI 名称、可用性、统计口径与可展示格式的入口，区分内核 ID 和本地化显示名。
  - 落点:wasm/Tauri 新导出 `kpi_availability(yaml)`(内核 MetricKey::ALL 逐项 unavailable_reason,返回 [{metric, reason}](内核中文原文透传),空=全部可用);TS kpiAvailability(wasm.ts 双路径);metricMeta.ts METRIC_META 补 nullable 位(内核 extract Option 事实)并成文 KPI 入口汇总(ID/显示名分面、统计口径=SampleStats 内核直出、可展示格式=dimension/decimals/unit+formatMetric、可空=nullable+内核规则原文 kpiAvailability)。
  - 测试:contracts 16/16(新增 WB-03.09 锁:3d 无 gacha/loot → 恰 d7/gacha/loot 三项不可用且 reason 带 ID 前缀、配齐→空数组、非法 YAML 配置错误通道、2 天真跑内核→可空指标如实缺席(retention null/gacha/loot 键省略,WB-03.01 口径)、METRIC_META nullable 表与内核逐项对齐、metricLabel 两语言≠内核 ID、wasm.ts 接线守卫);wasm Rust 16/16(新增 kpi_availability_comes_from_kernel_rules);全套 node 202/202;desktop check ✓;tsc/oxlint/build ✓。
  - WB-03.10/.11/.12 证据(2026-10-20):内核 core 171/171(新增 compare_arms 五契约测试:与手工 extract+compare 逐字段一致/种子错位拒绝/不可用拒绝/长度非零拒绝/extract-None 拒绝 + results JSON roundtrip(序列化逐字节不变));wasm Rust 18/18(ab_compare 真双臂配对 + 五类显式拒绝);desktop 13/13(ab_compare 同构测试);contracts 16/16(新增 WB-03.10/11 锁:Comparison 8 键+CRN diff 口径+种子/可用性/未知指标/坏 JSON/不等长五类拒绝通道+wasm.ts/executor/worker 协议/DesignerPage 接线守卫);execution 20/20(compare=null 防御分支 bridge、注入真调新签名、worker 服务端 ab_compare 载荷转发+run 类透传);execution-kernel 5/5(pkg-node 真内核:双臂+ab_compare→succeeded 真实 Comparison、种子错位如实 failed run 双臂保留、未知指标参数错误);tsc/oxlint/vite build ✓。
- [x] WB-03.10：补 A/B 比较调用的完整输入契约：两侧快照、replicates、seed/配对策略、所选 KPI。(2026-10-20,输入契约 = 双臂 YAML(base+cand,内核校验同 base_seed 的 CRN 配对前提,种子错位→「双臂 base_seed 不一致…要求同种子」)+ 双臂**已跑** results JSON 数组(与 run_simulation 输出的 results 同构,回读内核不重跑)+ metric(内核 MetricKey::parse 判定,未知→「参数错误: 未知指标 …(可选:全表)」)+ replicate 等长非零(否则显式拒绝);内核入口 core::experiment::compare_arms(cfg_a,cfg_b,key,arm_a,arm_b)->Comparison:种子校验→双臂各自 unavailable_reason(指标在某臂不可用显式报错,不单臂跳过)→逐 replicate extract(None→「不用 0 填充」,WB-03.02 空值语义)→compare;执行侧 ExecSpec ab 增 metric 字段,DesignerPage 传 design.targets[0]?.metric ?? 'win_rate'(已代决:比较指标=设计目标首个 KPI,未勾选回退 win_rate,合法性由内核判定))
- [x] WB-03.11：A/B 后端复用 core 指标提取与 `experiment::compare`；配对差值、CI、效应量由内核输出，不在前端另算一套。(2026-10-20,统计判定全在内核:compare_arms 复用 MetricKey::extract + experiment::compare(配对差 B_r−A_r、CI95、pooled sd、effect_size_d、verdict 按 CI 符号),前端 Comparison 类型 = 内核序列化同构(contracts 运行时锁 8 键+diff_mean=两臂均值差 1e-9+verdict 三值);桥接调用点唯一=ExecBackends.compare(baseYaml,candYaml,metric,base,cand),桌面=abCompare(native 命令)、浏览器=worker 协议新 kind 'ab_compare'(载荷原样转发,内核拒绝=run 类结构化错误透传内核文案),compare=null 仅保留为假后端/防御分支(如实报 bridge 不冒充))
- [x] WB-03.12：将新增桥接同时接到 WASM 导出和 Tauri command，注册到各自入口并保持返回形状一致。(2026-10-20,wasm ab_compare_native/ab_compare(JSON 字符串通道)+Tauri ab_compare 命令(已注册 generate_handler),双端同调 core::experiment::compare_arms,错误通道同构:未知指标/results 解析失败=参数错误、YAML/种子/可用性/replicate 数=配置错误,classifyWasmError 直接分类;为使 results 可回读内核,RunMetrics/CohortStat/DayStat/PowerSnapshot 补 Deserialize 且 schema_version/model_version/cohort 由 &'static str 改 String(序列化 JSON 形状不变,黄金快照不受影响),roundtrip 测试锁死)
- [ ] WB-03.13：更新/构建 WASM JS 绑定和类型声明，避免 TS 包装调用尚未生成的导出。
- [ ] WB-03.14：在统一 TS 服务层选择 Web/桌面路径，组件不直接散落 `invoke` 或 WASM 初始化。
- [ ] WB-03.15：统一初始化中、初始化失败、解析失败、配置错误、运行错误与取消的错误分类；支持 locale 展示。
- [ ] WB-03.16：定义数据来源与版本标记，演示数据不能混入真实运行集合或报告。
- [ ] WB-03.17：为同一配置对照新增 WASM/native 输出、参数回写与 A/B 统计，验证两条路径的值与语义一致。

验收：五个页面需要的真实数据都有类型化入口；参数和 A/B 缺口已补；Web/桌面复用同源逻辑。

##### WB-04 · 项目打开、保存、草稿与运行快照

依赖：WB-02/WB-03。入口：`src/lib/project.ts`、现有 `App.tsx::importFile/pack`。

- [x] WB-04.01：将 YAML 与 `.sandtable` 文件选择迁入新应用栏/项目入口，保留取消选择的正常行为。(2026-10-20,AppBar 新增「打开项目…/保存项目」入口(components/AppBar.tsx:49-60);WorkbenchApp 隐藏 file input 打开系统选择器(WorkbenchApp.tsx:114-116,418-420),取消=无 change 事件=无事发生;readPickedFile 对空选择显式返回 cancel(state/projectDoc.ts:562),tests/workbench-logic.test.mjs WB-04.13 断言)
- [x] WB-04.02：复用 `unpackProject` 验证 manifest、路径、文件集合与 sha256；失败不替换当前项目。(2026-10-20,openProject 包装 unpackProject 并返回 {ok:false,error}(state/projectDoc.ts:91);store 仅记 project/open-failed,项目与草稿原样保留(workbenchStore.ts:315);坏档/纯结果归档拒绝断言 tests/workbench-logic.test.mjs WB-04.02)
- [x] WB-04.03：把归档内 scenario/experiment/result 列表映射到项目浏览器，支持选择多个配置。(2026-10-20,explorerGroupsFor 把三目录逐条映射为浏览器分组、路径当 ID(workbenchStore.ts:461);点选写 object/select + 深链选择键 designer:scenario/experiment(routing.ts:38-44);多配置归档全量映射断言 tests/workbench-logic.test.mjs WB-04.02/03/04)
- [x] WB-04.04：打开项目时加载其已保存结果，不只加载两个配置编辑器；未知结果版本给出可读提示。(2026-10-20,inspectResult 解析 report.json 的 meta.schema_version,未知版本生成可读 message 且条目按字节保留(state/projectDoc.ts:63);结果状态进 ProjectDoc.resultStatus,分析页 ProjectResultsPanel 列出(project/ProjectPanels.tsx:83);known/unknown/opaque 三态断言 tests/workbench-logic.test.mjs)
- [x] WB-04.05：建立只读基线与候选派生关系；新候选保存基线引用、当前值和修改状态。(2026-10-20,baselineOfProject 冻结只读基线(projectDoc.ts:176),deriveCandidate 产出 {candidateId,baselineId,values,modified,saved},候选 ID 沿用 WB-02.10 内容寻址(projectDoc.ts:186);冻结/引用/修改清单/同域恒等断言 tests/workbench-logic.test.mjs WB-04.05)
- [x] WB-04.06：为当前选中的场景/候选分别保留草稿，切换对象不覆盖另一对象的内容。(2026-10-20,ObjectDraft 按 归档路径 为键隔离:writeDraft/draftOf/undoDraft/resetDraft(projectDoc.ts:217-249),store 新 objectDrafts 与 object/draft|undo|reset 动作(workbenchStore.ts:318);互不覆盖+undo+reset 断言 tests/workbench-logic.test.mjs;编辑器 UI project/ProjectPanels.tsx:22)
- [x] WB-04.07：扩展当前打包只写单个 scenario/experiment 的输入，保存多配置时不丢未选中的条目。(2026-10-20,PackInput 增 configs.scenarios/experiments,与单配置字段合并、路径冲突即拒(lib/project.ts:113-150);buildProjectSave 把全部条目+既有结果一次进归档(projectDoc.ts:398);多配置闭环与未选中条目字节保真断言 tests/project.test.mjs + workbench-logic.test.mjs)
- [x] WB-04.08：按现有归档路径纪律保存多次运行与索引；需要扩展格式时先明确兼容性，不直接制造非法嵌套路径。(2026-10-20,产物平铺 results/<run_id>.<产物> 两段路径,索引 results/runs.json 为 kind:result 条目——旧读取端按契约「result 字节不解析」兼容,manifest 维持 schema '1'(projectDoc.ts:342-394 模块头有兼容性说明);索引 roundtrip/未知 schema 可读错误/三段路径即拒断言 tests/workbench-logic.test.mjs WB-04.08、project.test.mjs)
- [x] WB-04.09：运行提交时生成不可变输入快照，记录配置哈希、模型/schema 版本、seed 与实验条件。(2026-10-20,snapshotRun 生成 deep-freeze 快照:configHash=输入 YAML sha256、seed 取自 YAML、实验条件入册、runId 沿 runIdFor 内容派生;内核执行接入前 model/schema 如实标 unknown(projectDoc.ts:295-339);DesignerPage 提交时登记(DesignerPage.tsx:58,77),runs.json 随保存落档;不可变/哈希/同输入同 runId 断言 tests/workbench-logic.test.mjs)
- [x] WB-04.10：保存采用已选对象与完整产物；下载/写盘成功后才更新相应保存状态，失败保留草稿。(2026-10-20,saveProject:buildProjectSave+packProject+download 全部成功才 dispatch project/mark-saved,catch 保留草稿并报错(WorkbenchApp.tsx:177);markSaved 只置位写盘对象(projectDoc.ts:252);全量/失败路径断言 tests/workbench-logic.test.mjs WB-04.10)
- [x] WB-04.11：浏览器草稿与项目文件已保存分别记录；刷新恢复时按项目/对象区分，防止跨项目串数据。(2026-10-20,persistObjectDrafts/restoreObjectDrafts 按 projectId 隔离键,载荷 version/projectId 不符或损坏一律丢弃,只恢复本项目对象键(projectDoc.ts:489-537);dispatch 内草稿即改即存、saved 单独承载文件保存状态(workbenchStore.ts:362);跨项目/损坏/异项目载荷丢弃断言 tests/workbench-logic.test.mjs WB-04.11)
- [x] WB-04.12：处理打开其他项目、关闭文档、退出页面时的未保存变更与恢复动作。(2026-10-20,hasUnsavedWork(项目草稿+参数草稿+实验草稿)驱动三处守卫:打开其他项目前 ConfirmDialog(可取消)、关闭项目前确认(项目信息弹层入口)、beforeunload 拦截退出;浏览器草稿记录保留,重开同一项目可恢复(WorkbenchApp.tsx:100-111,149-169,201,531-570);unsavedKeys 断言 tests/workbench-logic.test.mjs)
- [x] WB-04.13：桌面文件对话框复用已有插件与下载处理；取消不报错，路径权限失败说明原因。(2026-10-20,打开走 webview 文件选择(桌面 WebView2/WebKit 同实现,取消语义一致),native 对话框(dialog:default 能力,桌面壳 lib.rs:64)继续用于路径型本地查询;下载复用既有 blob→壳层 on_download→~/Downloads 链路(demo/export.ts:105 扩展二进制);describeFileError 把权限/不可读/取消映射为可读文案(projectDoc.ts:562-576);断言 tests/workbench-logic.test.mjs WB-04.13)
- [x] WB-04.14：验证多配置归档保存再打开、历史结果恢复、损坏归档、保存失败和旧版本读取。(2026-10-20,tests/project.test.mjs:多配置保存→再打开闭环、路径冲突拒、runs.json 入档可读、旧 schema '2' 与未声明条目拒;tests/workbench-logic.test.mjs:坏档保留当前项目、保存失败(路径越界/打包失败)保草稿、结果版本三态、索引 roundtrip。web 全套 55/55 绿、tsc 0 错、oxlint 0 警、build 绿)

验收：修改、运行、保存并重开后，配置与结果关联完整；基线及旧运行快照未被覆盖。

##### WB-05 · 参数表接真实配置

依赖：WB-03/WB-04。

- [x] WB-05.01：参数表从注册表与当前配置读取全量适用项，移除原型 18 项硬编码定义和值。(2026-10-20,数据源 = params/paramRegistry.ts 全量 64 项注册镜像(逐字取自 crates/sandtable-core/src/registry.rs)+ params/configYaml.ts parseConfig 读当前 YAML;buildRowModels(params/paramsLogic.ts:39)产 64 行,缺值如实 present:false;tests/params-config.test.mjs 用 registry.rs 原文 spec() 逐条锁漂移(路径/kind/默认/描述四字段),曾抓出 base_rate 描述漏抄一字符并修正;sampleProject.ts 的 PARAM_DEFS/PARAM_GROUPS 导出已删,18 行数值域仅留作演示候选 ID 复现并注明非参数表数据源)
- [x] WB-05.02：按参数 kind 分配编辑方式；结构/公式等未支持的类型显示只读和高级编辑入口。(2026-10-20,editable = u32/u64/i64/f64/mix,= dur/expr/table(params/paramsLogic.ts buildRowModels);ParamTable.tsx:167 只读行显示原文 + :199「高级编辑」按钮打开候选 YAML 弹层;断言 tests/params-config.test.mjs WB-05.02)
- [x] WB-05.03：基线列读取真实基线，候选列读取当前候选，缺值不自动回退为默认值。(2026-10-20,基线 = 项目场景文件/演示注册默认 YAML,候选 = 场景草稿(state/workbenchStore.ts paramYamlView);configYaml.readText/readNumeric 缺值返回 null/undefined,单元格与详情显式「缺值」不显示注册表默认(默认值只在详情作参考标注);候选缺值/值消失 modified=true 断言 tests/params-config.test.mjs WB-05.03)
- [x] WB-05.04：建立单元格编辑缓冲，输入未提交、已提交、非法值和已修改状态分别显示。(2026-10-20,ParamRow 本地 buffer/error 缓冲(ParamTable.tsx:116),状态列四态互斥:编辑中(amber)/已修改(amber)/非法值(red+错误文本)/—,内核失败另有 red 徽标;parseCellInput 三态(empty/invalid/ok)断言 tests/params-config.test.mjs WB-05.04)
- [x] WB-05.05：处理 Enter 提交、Esc 撤销当前输入、失焦提交及焦点保留，避免重新渲染吞掉点击。(2026-10-20,ParamTable.tsx onKeyDown Enter→commit/Esc→清缓冲回已提交值(:176-185),onBlur=commit;行 key=注册路径稳定 ID,提交后重渲染不重建输入框,焦点保留;非法提交不清缓冲(保留待修复输入);提交/撤销路径断言 tests/params-config.test.mjs WB-05.05)
- [x] WB-05.06：在前端做整数/有限数/概率基础检查；最终应用调用内核完整校验。(2026-10-20,validateParam(params/paramsLogic.ts:95):有限数/整数域/u32 域/概率(.p_* 与 gacha.base_rate)/权重范围;kernelCheck(paramsLogic.ts:150)复用 lib/wasm validate_config(动态引入,节点侧可注入);u64 文本级大整数拒绝(2^53+1 明确报错,不静默舍入);断言 tests/params-config.test.mjs WB-05.06×3)
- [x] WB-05.07：校验失败定位参数与单元格，保留待修复输入和原始错误详情。(2026-10-20,locateKernelError(configYaml.ts:496)从内核消息取最长注册路径命中(定位不到如实 null);失败存 store.paramKernelError,表格状态列徽标 + 详情面板展示原始 message(ParamDetail.tsx「内核校验失败」节);单元格保留待修复缓冲(提交失败不清);断言 tests/params-config.test.mjs WB-05.07)
- [x] WB-05.08：计算基线差异、绝对变化和相对变化；基线为 0 时不给出无穷百分比。(2026-10-20,paramDelta(configYaml.ts:479)给绝对 + 相对(±x.x%),表格「变化(绝对/相对)」列;基线 0 只给绝对值(+5/-5,无百分比),缺值或无变化给 —;断言 tests/params-config.test.mjs WB-05.08)
- [x] WB-05.09：搜索同时匹配路径、原始描述和当前语言显示名，切换语言保留搜索输入。(2026-10-20,visibilityFilter(params/paramsLogic.ts:183)三字段小写包含:path + registry desc + displayParamName(locale);displayParamName(paramRegistry.ts:212)zh=注册表描述/en=英文表缺词回退;locale 经 lib/i18n 只读键读取(不写 WB-11 文件);搜索输入存 store,无任何动作重置它(切语言不丢);断言 tests/params-config.test.mjs WB-05.09)
- [x] WB-05.10：接系统分组、只看变更、只看错误与当前可见项全选。(2026-10-20,分组 = 注册表前缀派生 paramGroups();ParamFilterBar.tsx:17/74 增「仅错误」开关(计数 = 内核失败定位集合);全选只作用于可见行(ParametersPage.tsx:251-253 用 visible 集合);断言 tests/params-config.test.mjs WB-05.10)
- [x] WB-05.11：批量倍率先预览/校验整批结果，再一次性应用；任一项失败时不产生半批修改。(2026-10-20,bulkPreview(params/paramsLogic.ts:217)逐项 from→to+校验,BulkActionBar 两步:「预览整批」(前端逐项 + 整批草稿过 kernelCheck)→「应用整批」(仅全绿可点,applyParamEdits 一次写入 = 一条历史);任一失败显示定位错误且不改候选;断言 tests/params-config.test.mjs WB-05.11)
- [x] WB-05.12：将单项编辑、整批编辑、恢复单项/全部接入统一撤销/重做历史。(2026-10-20,store 侧 writeParamYaml/paramUndo/paramRedo(workbenchStore.ts:260/280/300)统一承载:演示模式 paramDraft 历史,项目模式写穿 objectDrafts(projectDoc.ts 增 future 栈 + redoDraft:248);单项/批量/恢复单项(reset-one,基线缺值时删键)/恢复全部(reset-all)/采纳(adopt)全部一条历史;重做线性语义(新修改清空栈);reducer 级四步撤销 + 两步重做断言 tests/params-config.test.mjs WB-05.12)
- [x] WB-05.13：将结构化编辑同步到 YAML；高级 YAML 成功解析后更新参数表，语法错误时保留原文。(2026-10-20,单元格提交 = configYaml.applyParamEdit(:365)跨度替换/定向插入(块节缺链自动补节、flow 内补键),不整体重序列化;ParametersPage.applyAdvancedEdit(:103)parseConfig 成功才 dispatch param/write,语法错误保留编辑框原文并给行号定位;断言 tests/params-config.test.mjs WB-05.13×2(含 pokemon.yaml 补 gacha 节/flow 补键))
- [x] WB-05.14：保存/运行时冻结已通过校验的配置版本，不从仍在变化的单元格即时读取。(2026-10-20,保存:WorkbenchApp.saveProject 对全部场景候选 kernelCheck,任一失败阻止保存并定位,所选场景冻结 config_hash(WorkbenchApp.tsx:195-205);运行:DesignerPage.enqueue 先校验后冻结再 snapshotRun 用冻结 YAML(DesignerPage.tsx:69-76),model/schema 版本改记内核实报值;冻结版本独立于后续编辑(reducer 断言 tests/params-config.test.mjs WB-05.14))
- [x] WB-05.15：验证编辑后 YAML round-trip 保留 `damage_model`、loot、公式及未编辑结构字段。(2026-10-20,外科手术式编辑不做重序列化:tests/params-config.test.mjs WB-05.15 组合配置(pokemon 口径)两处编辑后 damage_model: ratio/公式引号原文/loot tables+rewards/tier_table 逐行/全部注释逐字节保留(逐行 deepEqual);examples/*.yaml 全部零错解析;恢复单项写回基线文本或删键不伤相邻参数)

验收：参数修改真正改变下一次运行输入；基线不变，错误可修复，批量修改与撤销完整。

##### WB-06 · 实验表单接计划与运行输入

依赖：WB-03/WB-05。

- [x] WB-06.01：实验名、方法、场景、基线和候选引用接共享草稿，不继续使用固定样例对象。(2026-10-20,引用区 = paramYamlView 共享视图(项目=所选场景对象原文/编辑草稿,演示=参数草稿 YAML)+ 候选 ID 内容寻址 candidateIdFor;实验身份 experimentScopedId = hashId(exp,项目键,方法:名称) 内容派生(tests/experiment-form.test.mjs WB-06.01 断言同入参同 ID/异名异 ID/≠ DEMO_EXPERIMENT_ID),DesignerPage.tsx enqueues 与引用 note-block 均不再出现固定样例对象)
- [x] WB-06.02：A/B 表单选择真实双方快照，并展示本次比较的参数 diff。(2026-10-20,基线臂快照 = 项目场景打开时原文/注册表默认 YAML,候选臂 = 当前参数草稿(内容寻址候选 ID 上墙);diff = buildRowModels(base,cand)+diffRows 参数级表(WB-05 数据源), DesignerPage.tsx A/B 节显示双侧快照标识/CRN(共 seed)与 changedDraft.length;统计判定不冒充——界面旁注明内核 Comparison 桥接在 WB-03.10/11+WB-07.03)
- [x] WB-06.03：Grid 因子表接注册参数、类型、min/max/step 或离散水平，非法范围就地提示。(2026-10-20,因子行 = 参数注册表下拉(仅 u32/u64/i64/f64 数值通道)+ 类型/描述来自注册表;factorRowError(designerLogic.ts)按 kind 分档校验:非注册路径/不可扫类型/整数域含非整数/步长非正整数/max<min 逐行就地红字(FactorTable.tsx 行内 error span+aria-invalid);路径重复在 designErrors 捕获;断言 tests/experiment-form.test.mjs WB-06.03×8)
- [x] WB-06.04：Random 表单接真实 mode、范围、samples；序列化名称与内核契约一致。(2026-10-20,uniform → 内核序列化名 `mode: random`(∈ lib/types SWEEP_MODES 测试锁);Random 序列化只写 min/max 不写 step(内核 Random 不用 step);samples 写 sweep.samples ≥ 1(>10000 拒);tests/experiment-form.test.mjs WB-06.04 真跑 pkg-node sweep_plan 断 mode:random)
- [x] WB-06.05：LHS 表单接 `latin_hypercube`、范围与 samples；不把 LHS 当普通随机采样执行。(2026-10-20,lhc → `mode: latin_hypercube`;执行交给内核 planSweep,前端不自行采样;tests/experiment-form.test.mjs WB-06.05 内核真跑:单轴 0–100 n=8 各点落在独立层 [i·12.5,(i+1)·12.5)(分层的 LHS 证据),同 seed 同参 uniform 出现同层多点 = 非 LHS 对照)
- [x] WB-06.06：场景表单接玩家数、天数、cohort 配比、replicates、seed/CRN，区分规模与统计样本量。(2026-10-20,ScenarioForm 直读写 scenario YAML:population/duration(Nd 文字,编辑写 14d)/seed(文本提交防 u64 精度丢失)/population_mix(UI 百分数 ⇄ ÷100 比例);replicates = sweep.replicates 标「统计样本量」,与玩家数/天数「规模」就地标注区分;scenarioStats 缺值如实 null 不回退;applyScenarioLeaf 外科手术写回断言 tests/experiment-form.test.mjs WB-06.06)
- [x] WB-06.07：KPI 选择只允许当前配置可用的指标；不足 7 天时说明 D7 不可用并阻止相关任务提交。(2026-10-20,kpiAvailability(designerLogic.ts)镜内核 experiment.rs unavailable_reason:D7 days≥7/D3 days≥3/gacha 指标需 model.gacha/loot 指标需 model.loot;KpiConstraintTable.tsx 不可用行禁选并给内核同口径原因;选中后再改小 days → designErrors kpi 作用域报错 → 提交按钮禁用(RunPlanSidebar blockedReasons);断言 tests/experiment-form.test.mjs WB-06.07(6 天 D7 不可用、30 天通过))
- [x] WB-06.08：约束表接 hard/soft、min/max、单位与阈值转换，避免把 UI 百分数直接当底层比例。(2026-10-20,targets = {metric,kind:hard/soft,min?,max?} 对齐内核 Option 口径;比例类(retention/win_rate/churn_rate)UI 百分数输入、YAML 写比例(thresholdFromUi ÷100,0–100 越界拒;kernelToUiPercent ×100 显示含防浮点尾),绝对值类不换算;序列化证词 max: 0.2 而非 20;断言 tests/experiment-form.test.mjs WB-06.08)
- [x] WB-06.09：把结构化表单生成/更新为有效实验配置，保留用户未编辑的模型内容。(2026-10-20,experimentYaml.ts buildExperimentYaml:顶层 sweep 节整体替换/追加,其余行逐字节保留(含注释);更新路径(旧 sweep 节替换)与 readSweepDesign 读回(项目实验对象草稿进表单);生成 YAML 被 pkg-node sweep_plan 接受;tests/experiment-form.test.mjs WB-06.09 逐行保留断言 + round-trip)
- [x] WB-06.10：Grid/Random/LHS 通过 `planSweep` 取得候选列表、预算与实际运行数量；不靠前端猜测通过校验。(2026-10-20,DesignerPage useEffect → lib/wasm planSweep(实验 YAML,0) 为唯一计划来源;多轴 3×3=9 候选、候选×replicates=sims 全部来自返回;Web 预算(>200 sims)与规模预算(>400k player-days)拒绝由内核抛错上墙;前端校验只做输入 UX,不算账不放行;tests/experiment-form.test.mjs WB-06.10 真跑断言)
- [x] WB-06.11：预览请求加版本标识，快速改表单后晚返回的旧计划不能覆盖新输入。(2026-10-20,createPlanGate(designerLogic.ts):next() 发版/accept(seq) 只认最新;组件 effect 每次输入指纹变化发新请求,响应按 accept 校验,迟到请求整包丢弃;ok 结果以输入 YAML 指纹对齐;tests/experiment-form.test.mjs WB-06.11 交错断言)
- [x] WB-06.12：显示候选数、replicates、总运行数及 player-days；耗时无基准时显示未估算。(2026-10-20,RunPlanSidebar:候选数/candidates、replicates、总运行数(sims)、player-days = sims×players×days 全取 planSummary(plan);耗时固定「尚无性能基准(不估算)」;A/B 显示 2×reps 且标注演示;断言 tests/experiment-form.test.mjs WB-06.12)
- [x] WB-06.13：将 Web/桌面执行预算与错误原因接按钮禁用状态，提供缩小规模/改执行端的可行操作。(2026-10-20,plan error(status:'error')/pending/stale 全部进 RunPlanSidebar blockedReasons → 提交按钮禁用;planErrorLines 分行上墙(内核数字原文);budgetActions 对含「预算」的错误给可行操作:缩小因子范围/加大步长、减 replicates、改桌面端;非预算错误不误导;断言 tests/experiment-form.test.mjs WB-06.13)
- [x] WB-06.14：切换实验方法保存兼容输入，不适用字段明确隐藏；旧预览结果标为失效。(2026-10-20,setMethod 仅改 method:因子 min/max、samples、reps、targets、sampling 值全保留(preserveOnMethodSwitch + 组件按方法渲染);Random 隐藏步长、Grid 隐藏 sampling 与 samples(FactorTable/ScenarioForm 条件渲染);输入修改瞬间旧 ok 计划降级 status:'stale' → 侧栏「计划已失效」红标且按钮禁用;断言 tests/experiment-form.test.mjs WB-06.14)
- [x] WB-06.15：提交时绑定校验通过的输入快照、计划与实验 ID；双击只创建一个任务。(2026-10-20,提交重跑 planSweep(当时输入)为有效性凭据,kernelCheck 场景候选通过(WB-05.14 纪律)后 snapshotRun:configHash = 实验 YAML 字节 sha256,conditions 带 candidates/replicates/sims/plan_config_hash/base_seed;experimentId = experimentScopedId;createSubmitGuard 单飞 + 按钮提交中禁用:双击第二次返回 false 不建任务;断言 tests/experiment-form.test.mjs WB-06.11 guard + WB-06.15)
- [x] WB-06.16：验证同配置同 seed 的 Grid/Random/LHS 计划可复现，改变 seed 只影响应变化的采样。(2026-10-20,内核真跑(pkg-node sweep_plan):同 YAML 两次 → grid/random/latin_hypercube 候选逐项 deepEqual;换 scenario.seed → Grid 候选不变(确定性枚举),random/LHS 候选变化;断言 tests/experiment-form.test.mjs WB-06.16)

验收：表单生成的输入能被真实接口接受；运行计划、任务数与后续实际执行一致。

##### WB-07 · 执行、真实进度、取消与 Worker

依赖：WB-03/WB-06。

- [x] WB-07.01：定义任务状态机：queued/running/cancelling/cancelled/succeeded/failed，区分有部分结果的状态。(2026-10-20,execFsm.ts 迁移守卫表 canTransition(六态不变,cancelling→succeeded 留给取消/完成竞争)+终态三分 terminalOutcome: complete/partial/empty(保留 ok 候选/双臂/单次输出 = 部分结果;config_error 候选不算可用产物但留在结果集);断言 tests/execution.test.mjs WB-07.01×2)
- [x] WB-07.02：建立应用级运行管理器，绑定 job/experiment/run ID，切页不丢执行引用。(2026-10-20,runManager.enqueueRun 真实任务绑定 experimentId+runId(内容派生,同输入同 run 引用)+spec 执行输入快照自足(切页/切项目不读 store);模块级单例不变,断言 tests/execution.test.mjs WB-07.02/12/15 与 WB-07.13)
- [x] WB-07.03：A/B 调用真实比较桥接；扫描按已校验计划逐候选调用 `runSweepCandidate`。(2026-10-20,扫描侧全真:executor.runSweep 按提交时 planSweep 已校验计划逐候选调用 runSweepCandidate,完成后真实 recommendSweep(推荐失败如实记 recommendationError);A/B 侧=双臂 runSimulation 真跑+内核 Comparison 桥接唯一调用点 ExecBackends.compare,桥接导出由 WB-03.10/11/12 发布,pkg 未含前任务如实报 bridge 错误类并保留双臂输出(不冒充统计判定,不前端另算);真内核断言 tests/execution-kernel.test.mjs 3 条(pkg-node 真跑:3 候选全 ok/与直调逐值一致/双臂 config_hash=validate_config);A/B 桥接已于 2026-10-20 随 WB-03.10/11/12 发布,A/B 侧端到端真跑见 WB-03.11 证据与 execution-kernel 5/5)
- [x] WB-07.04：桌面仿真接 Channel 进度，显示实际 done/total，不使用原型定时器。(2026-10-20,真实任务无定时器:executor 单次/双臂桌面路径接 run_simulation 的 Channel onProgress,done 只随内核事件推进(断言 dones=[1..n] 且补丁数=事件数,演示队列定时器保留但演示任务明确标注「演示」);桌面契约 lib.rs Channel 逐 replicate 上报 + Rust 测试 12/12 绿)
- [x] WB-07.05：扫描进度按已完成候选与其 replicates 表达；内核未提供的候选内进度不得推算成真进度。(2026-10-20,扫描进度 = 已完成 ok 候选 × replicates 的边界跳变(dones=[2,4,6] 断言),候选内无中间值;progressKind=candidates 上墙「N/M 候选 × reps」;协议含 progress 事件形态但 Worker 端不伪造(内核未提供候选内进度,connection 丢弃 progress);断言 tests/execution.test.mjs WB-07.03/05)
- [x] WB-07.06：桌面取消接 `cancelRun`，区分“取消请求已发出”与“已在 replicate 边界停止”。(2026-10-20,executor.cancel 桌面接 cancelRun;classifyKernelCancel 锁内核错误串契约「已取消: 完成 X/Y replicate」→ 状态两段:running→cancelling(请求已发出)→cancelled(边界落地,done=内核真实计数);TaskCancelButton 文案区分两段并提示再点=升级终止;断言 tests/execution.test.mjs WB-07.06 + lib.rs 边界取消测试)
- [x] WB-07.07：扫描取消沿用候选边界检查，保留已完成候选，停止后不对不完整数据生成完整推荐。(2026-10-20,扫描取消 = 主线程候选边界检查(下一候选不再派发),已完成候选保留在 job.exec.results,outcome.boundary 记录真实边界计数;取消后不调 recommendSweep(不完整数据不出完整推荐);断言 tests/execution.test.mjs WB-07.07)
- [x] WB-07.08：建立浏览器 Worker 消息协议，包含请求/任务 ID、输入、结果、错误与可用的进度事件。(2026-10-20,workerProtocol.ts 版本化信封 protocol:1+taskId,四种请求 plan/sim/candidate/recommend(输入快照自足),result/error/progress 三种响应,error 带 errorClass+retryable;isWorkerRequest/isWorkerResponse 守卫逐字段校验(版本/空 taskId/未知 kind/scope 越界全拒);断言 tests/execution.test.mjs WB-07.08)
- [x] WB-07.09：在 Worker 内初始化并复用 WASM，主线程保持可交互；初始化失败可重试。(2026-10-20,sweepWorker.entry.ts 在 Worker 线程 init WASM,initPromise 缓存复用(同实例只 init 一次);失败清缓存+结构化 init 错误 retryable:true,下一请求重新初始化(重试真通);主线程仅经协议收发;断言 tests/execution.test.mjs WB-07.09×2)
- [x] WB-07.10：明确浏览器取消语义：边界停止或终止 Worker；无法返回中间状态时如实提示。(2026-10-20,浏览器取消默认 = 边界停止(主线程停止派发下一候选;在途候选真完成则保留);cancelling 中再点取消 = 升级终止 Worker;Worker 内同步 wasm 不可中断如实标注(progressKind=none 说明「此执行端无逐 replicate 进度面」,不伪造);断言 tests/execution.test.mjs WB-07.07/11)
- [x] WB-07.11：Worker 终止后清理执行上下文，下一次运行可重新初始化，旧消息不写入新任务。(2026-10-20,WorkerConnection.terminate 清 pending+拒绝在途请求+worker=null;下一次 request 重新创建实例重新初始化(creations 计数断言);响应按 taskId 路由,无主/旧消息丢弃(断言 stale taskId 与 garbage 均不写入);tests/execution.test.mjs WB-07.11)
- [x] WB-07.12：控制单次活动任务/并发与内存预算，遵守当前桌面取消令牌只对应活动任务的约束。(2026-10-20,单活动任务门 = runningCount>0 拒绝入队(真实与演示同门);内存预算 MAX_CANDIDATE_RESULTS_IN_MEMORY=1000 超限开跑前失败(budget 类,内核零调用);桌面 cancelRun 令牌纪律:仅 run_simulation 活动任务持有(lib.rs TaskRegistry 单槽),扫描取消绝不调用内核取消(断言 kernelCancel=0),未启动任务取消为本地终态不经内核)
- [x] WB-07.13：统一任务页、底部状态栏与抽屉进度，当前工作区切换后仍显示同一个任务。(2026-10-20,任务页(RunsPage)/状态栏(StatusBar)/抽屉(GlobalTaskDrawer)同订 runManager 单例 + 同一 activeJob 判定(execFsm.activeJob 最新非终态);抽屉当前任务置顶,状态栏显示同任务名+done/total,切工作区不换;断言 tests/execution.test.mjs WB-07.13)
- [x] WB-07.14：单候选配置错误留在结果集中；取消、运行错误、初始化错误采用不同展示和恢复动作。(2026-10-20,候选 config_error 留在结果集并计数展示(不是任务失败,done 只计 ok 的 replicates);错误四类分展示与恢复动作:ERROR_CLASS_LABEL+recoveryFor(init=重试初始化/run=修配置重提交(保留已完成候选)/budget=缩小规模/bridge=待 WB-03.10/11 或改扫描);失败任务出「重试」按钮(runManager.retryJob 同快照重入队);断言 tests/execution.test.mjs WB-07.14+WB-07.12)
- [x] WB-07.15：任务结束/失败/取消后清理 busy、监听器与令牌，支持再次提交。(2026-10-20,终局 applyOutcome:activeControls 清除、状态落终态(单向闸防再写)、toast 收尾;并发门随即解除(断言终态后再次 enqueueRun 成功);执行器 settled 后 update/cancel 全部 no-op;断言 tests/execution.test.mjs WB-07.02/12/15)
- [x] WB-07.16：处理取消与完成同时发生、重复取消、失败后重试、切项目时仍运行等竞争条件。(2026-10-20,竞争全收:取消 vs 完成 = 终态先到先得(cancelling→succeeded 合法迁移,全部候选完成后取消请求不改结局);重复取消幂等;入队即取消(queued)不触碰内核落 cancelled-empty;失败后重试同 spec ⇒ 同 run 引用新 job;切项目/切页 = spec 自足不受影响;断言 tests/execution.test.mjs WB-07.16×3)
- [x] WB-07.17：语言切换只更新显示文案，任务对象和执行 Promise/Worker 不被重建。(2026-10-20,状态层六个文件源级断言不 import lib/i18n;locale 状态不进 runManager/executor,任务身份与执行后端引用在语言切换(订阅重渲染)下不变(不重建任务/Promise/Worker);STATUS_LABEL 与徽标均为渲染期查表;断言 tests/execution.test.mjs WB-07.17)

验收：真实运行时界面可操作，进度真实，取消边界明确，切页/切语言不丢任务，结束后可再次运行。

##### WB-08 · 真实结果、图表与候选联动

依赖：WB-03/WB-07。

- [x] WB-08.01：建立扫描结果适配器，读取 values/status/metric_stats/target_outcomes，不使用合成样例结构。(2026-10-20,`lib/sweepView.ts`:candidateViews(plan, results, deriveId) 按位对齐计划候选,results 位可 null 表达部分返回;values/status/metric_stats/target_outcomes 忠实透传,config_error 候选保留不丢弃;metricStat 缺失指标 → null 非 0;口径原样不乘 100 不舍入(×100 唯一在 fmtPercent);候选 ID 注入 workbench/ids.candidateIdFor 同规则(WB-08.02 的稳定 ID 即此);结果数超计划数明确报错;守卫测试 6 条,与真 wasm 锁形的 types.ts 对齐)
- [x] WB-08.02：为计划内每个候选建立稳定结果 ID，排序/筛选/部分返回后选择仍对应同一候选。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.03：候选表动态生成指标列，分别展示均值、CI、约束判定及不可用/失败原因。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.04：主图读取真实参数坐标、指标均值与 CI，支持仅一个点、相同值和无结果的范围设置。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.05：目标线读取该实验的真实约束，基线线读取已运行的基线；没有基线结果时不画假参考线。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.06：辅助图按不同量纲分别绘制，共享候选选择，不把金币和百分比混到同一轴。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.07：点图、选表、键盘移动统一更新 selection；检查器读取当前候选快照与统计来源。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.08：接真实 pass/borderline/fail，并区分 hard/soft 与整体可行；前端展示不覆写内核判定。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.09：筛选/排序与选中候选跨图表同步；当前选择不在筛选中时有明确提示或可恢复操作。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.10：保留非法配置、失败候选与部分完成结果；不能把这些点画成 0 或无声删掉。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.11：主指标切换同步数值格式、单位、标签、tooltip、图例与目标边界。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.12：A/B 视图读取真实配对差值/CI/效应量，与扫描绝对值视图分别展示。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.13：若展示逐日数据，显式选择 run/replicate；`days_csv` 默认只代表 replicate 1，不增加虚构日级 CI。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.14：接 `recommendSweep` 的已有敏感性/单轴推荐，保留多轴与不完整结果限制；插值与观测明确区分。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.15：复制所选候选到新方案时保留其基线和参数域，仅创建草稿，旧结果与输入哈希不变。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.16：检查器显示真实模型/schema 版本、配置哈希、随机策略与统计单位；缺失字段不编造。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）
- [x] WB-08.17：删除运行页面中的合成数据常量与固定 11/20/65% 等数字；内置演示只在独立来源下打开。（2026-10-20 收编：WB-08 批实现入库，node --test 178 全绿、tsc -b 0 错、build 过；证据见该批 commit）

验收：真实运行结果驱动所有数值和图形；选中、筛选、复制候选与统计语义一致。

##### WB-09 · 真实导出、保存产物与数据交换

依赖：WB-04/WB-08。

- [ ] WB-09.01：导出对话框绑定当前 run，提供全部/筛选/所选候选范围，并显示实际数量。
- [ ] WB-09.02：CSV 生成稳定列名、单位、参数 ID、候选/实验 ID、统计量、CI 和判定；空值与失败原因明确。
- [ ] WB-09.03：处理 CSV 引号、逗号、换行和 UTF-8；明确百分比列的比例或 0–100 口径。
- [ ] WB-09.04：JSON 导出真实运行快照、版本、统计结果与来源；当前未运行草稿另存，不冒充该 run 输入。
- [ ] WB-09.05：SVG 导出当前指标和所选候选，内嵌所需样式、轴标签、单位、来源与导出 locale。
- [ ] WB-09.06：保留现有 `report.json`、`days.csv` 与 Parquet 产物语义；从数据工作区继续提供相应操作。
- [ ] WB-09.07：归档保存真实结果及关联配置；重开后可以继续分析并再次导出。
- [ ] WB-09.08：Web 下载与桌面文件处理分别验证，失败/取消不显示成功；使用真实时间与可追溯文件名。
- [ ] WB-09.09：中英文下机器列名、枚举、小数点与 JSON schema 保持一致；本地化标题仅用于可读图表/报告。
- [ ] WB-09.10：对照 UI、导出表与归档结果的候选数、数值、CI、配置版本，确认三者一致。

验收：导出内容与所选真实运行一致，可重开核对；商业软件通过已支持的文件格式使用数据。

##### WB-10 · 真实流程验收与交付记录

依赖：WB-02～WB-09、WB-11。

- [ ] WB-10.01：从真实 YAML 打开项目、编辑一个数值、运行、查看结果、导出并保存重开。
- [ ] WB-10.02：从真实 `.sandtable` 打开多配置项目，切换配置后分别编辑/保存，确认没有丢条目。
- [ ] WB-10.03：用同一基线派生两个候选完成 A/B，对照内核/CLI 的配对差值、CI 与效应量。
- [ ] WB-10.04：分别完成 Grid、Random、LHS 扫描，对照计划、参数组合、实际任务数与复现结果。
- [ ] WB-10.05：运行中切换页面和语言、打开抽屉并取消，核对真实进度、取消边界与产物保留。
- [ ] WB-10.06：选一个结果候选复制为草稿再运行；确认前一次结果和输入快照不被改写。
- [ ] WB-10.07：检查错误类型：非法参数、YAML 语法、缺指标、预算超限、单候选失败、Worker 失败、保存失败。
- [ ] WB-10.08：对照 CSV/JSON/SVG/项目归档与界面数字，验证来源、单位、空值、CI 和筛选范围。
- [ ] WB-10.09：中文与英文分别完成主流程；检查词条覆盖、刷新语言恢复、长标签和无障碍文字。
- [ ] WB-10.10：验证切换语言不改变配置内容、seed、实验哈希、选中项、运行状态及导出机器 schema。
- [ ] WB-10.11：检查桌面与浏览器的主要路径，保留原有查询、下载和项目文件功能。
- [ ] WB-10.12：覆盖桌面/小屏、键盘焦点、图表点选、表格导航、错误跳转与 reduced motion。
- [ ] WB-10.13：为关键状态、参数回写、桥接一致性和真实流程补必要的可重复检查，不以截图替代数据断言。
- [ ] WB-10.14：运行改动相关检查、Web 类型/lint/build、涉及的 Rust 检查；文档变化时核对文档构建。
- [ ] WB-10.15：更新能力对照表、设计稿、双语截图与本清单；逐项记录真实证据后勾选。

验收：完成“打开 → 编辑 → 运行/取消 → 分析 → 复制复跑 → 导出 → 保存重开”的真实闭环，且中英文切换可持续使用。


#### P1 · 日常策划工作效率

- [ ] **项目与场景管理**：项目创建/复制/归档、多个场景与配置版本、基线切换、多个候选并排比较、命名与改动备注；保留模型假设与适用边界。
- [ ] **参数元信息层**：建立可维护、可版本化的显示名、单位、建议范围、步长、系统分组、标签、来源与影响 KPI；缺失显示未定义。加入收藏、最近修改、缺元信息与校验错误筛选。
- [ ] **结构化编辑器**：成长曲线、公式、掉落/权重表、阶段规则；公式语法与引用提示、示例求值、概率/权重合计校验；支持批量粘贴，保存前预览 diff 与影响范围。
- [ ] **不可变实验历史**：归档输入快照、配置哈希、模型/指标版本、随机策略、场景规模、时间、产物与结论；支持搜索、复制、复跑和从历史候选继续编辑，禁止覆盖旧运行输入。
- [ ] **工作区效率**：面板尺寸调整与布局记忆、多文档切换、列排序/筛选/显隐/固定、多选复制、表格键盘导航、未保存变更提示和错误跳转。
- [ ] **CSV/XLSX 参数导入**：模板、字段字典、列映射、类型/单位转换、错误报告和导入差异预览；确认后写入候选，基线保持只读。复用已有 CSV 参数导入导出语义。
- [ ] **批量运行管理**：多实验队列、并发与内存预算、失败点重跑、取消策略和状态持久化；暂停/恢复需先明确执行能力，不提供仅改变按钮文案的假暂停。
- [ ] **策划结论与报告**：选取图表、参数差异、统计结果、运行条件、模型假设和结论，形成可追溯 HTML/PDF；复用现有报告产物并补齐面向策划的内容组织。

#### P2 · 专项数值分析

- [ ] **A/B 分析视图**：基线/候选均值、配对差值、绝对/相对变化、CI、效应量与约束判定；按 KPI 分面显示配对效应图，不能把不同单位共用一个轴。
- [ ] **多维扫描设计**：多因子边界、步长、离散水平、组合预算、Random/LHS 采样、重复候选处理、失败点追踪；复用现有扫描和推荐能力。
- [ ] **专业图型**：双轴 Grid 离散热图、Random/LHS 散点、OAT 敏感性矩阵、可行候选/Pareto 前沿；缺失候选留空，选点联动候选配置与运行记录。
- [ ] **逐日与 cohort 分析**：单次 run/replicate 的趋势曲线、群体分面、分布/分位数与长尾；逐日跨 replicate 均值和 CI 须先有内核聚合输出，禁止给单次 `days.csv` 套置信带。
- [ ] **经济、掉落与抽卡分析**：产出/消耗/存量、资源切片、掉落与抽卡概率/保底分布；每个视图明确来源、累计/快照口径及不可用指标原因。
- [ ] **优化与代理视图**：进化优化、Pareto 与 RF 训练/预测结果的独立标识；真实观测、插值、代理估计分别展示；RF 树间 spread 不标成统计 CI。
- [ ] **KPI 与模板**：指标字典、自定义 KPI、目标/约束管理、图表与报告模板；记录计算口径和版本，自定义表达式需校验与可复现。
- [ ] **图表性能**：先使用聚合数据和 SVG，测量大候选集/长序列的交互性能后再针对性加入降采样、Canvas 或 WebGL；图表提供同范围的数据表和精确值。

#### P3 · 成熟软件互通与团队能力

- [ ] **Excel / JMP / Origin 文件工作流**：稳定的参数、差异、结果与逐日/cohort 数据表；XLSX 多工作表、字段映射复用、透视/Power Query 友好结构，随附导入示例和字段字典。
- [ ] **MATLAB**：先提供真实数据的 CSV/JSON/Parquet 导出与 `.m` 分析脚本模板；有本机调用需求后评估 MATLAB Engine、任务状态、日志、输出目录及结果回收，不能让核心仿真或默认图表依赖商业授权。
- [ ] **JMP / Origin 自动化评估**：有明确使用场景后核对平台、授权、官方 API、脚本接口与本机安装条件；先做一个可运行的连接器示例，再决定直连范围。界面只显示已接通的能力。
- [ ] **Python 自动化**：稳定项目/实验/结果 schema 与 SDK，支持脚本建实验、批量运行和读取结果；记录脚本/依赖版本，失败不影响核心仿真。
- [ ] **Power BI / Tableau**：版本化数据包、字段字典、runs/metrics_daily/cohorts/parameters 分表与示例；企业发布、自动刷新和数据源连接按真实团队需求实施。
- [ ] **多人协作**：共享项目、权限、评论、审核与锁定/冲突处理；先明确服务端形态、版本模型与项目合并策略。

#### 各阶段验收纪律

- [ ] 数据可追溯：每个真实结果可定位输入快照和运行条件；原型演示、未运行草稿、观测、插值和代理预测均有明确来源。
- [ ] 统计正确：`win_rate` 为全程胜率；CI 与样本量按 replicate；不同单位分图；unavailable 指标不被当作 0；没有性能基准时不编造耗时。
- [ ] 编辑安全：基线只读、候选变更可撤销、导入先预览校验、保存失败可恢复；历史结果不被编辑覆盖。
- [ ] 操作完整：主要控件必须有实际行为或明确禁用原因；键盘、焦点、错误定位、忙碌/失败/取消状态可用，长任务不阻塞 UI。
- [ ] 每批实现附运行证据：关键真实流程检查、类型/lint/build、相关逻辑/集成检查与实际截图；更新设计稿和 TODO，不把“界面已画出”标成“正式能力已完成”。

### 近期其他已完成事项

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

- [ ] Windows 打包嵌入应用图标：desktop-package.yml 产出的 .exe 当前无 Icon 资源；需用户定 logo（提供源图 ≥256px 的 png/svg，按设计资产铁律不自造代餐）→ 打包链生成 .ico 并嵌入（rcedit/resource_hack 或 cargo/tauri 侧 winres 配置）〔阻塞=等用户 logo 资产｜解锁=资产到位即做〕


- [ ] **BLOCKED** 真实案例二期 + 模型校准。缺:用户提供的真实运营数据与外部对标基准;公开数值案例不能替代二期输入(2026-10-19 核查:仓内无该数据,open PR/issue=0)。已代决(2026-10-19 巡检授权):校准路径设计落 `docs/calibration-design.md`(数值通道自由变量 + 既有 sweep/optimize/RF 链 + ±10% 带与 retention 0.9 底线 + 尾段 hold-out 防过拟合;缺件即锚点 unmapped 不代数据)——设计解锁方法不解锁数据,仍 BLOCKED 于 §2 三个必需交付件
- [ ] **BLOCKED** 桌面端投入。缺:用户本机 GUI 环境完成并记录 native 文件对话框及 Windows / macOS 完整交互走查;自动化断言已尽。自动化链已覆盖:构建(run 38420221169 三腿绿)、启动(run 38436094647 20s 存活)、安装包安装+运行(run 38457041427,Windows 含 msi 腿 38488806732);证据 docs 18 Phase 7
  - 2026-10-19 Windows 侧核查（Windows 主机到位，HEAD=127ed5b）：**GUI 环境本身在**——真 Windows 11、WebView2 运行时 155.0.4283.62 在位、本会话有截图能力。**但仍拿不到可运行的桌面二进制**：①本机无 cargo/rustc/rustup，也无 MSVC cl.exe/link.exe 与 Windows SDK（Tauri 2 在 Windows 需 MSVC ABI，GNU 目标不支持 WebView2 COM 绑定），无法本机构建 apps/desktop/src-tauri；②远端无 release/tag 可下载预构建产物（GitHub API `/releases`、`/tags` 均空数组）；③GitHub Actions 的 msi 产物（run 38488806732）需 PAT 才能下载，无凭据不编造。native 文件对话框确认为 `tauri-plugin-dialog`（apps/desktop/src-tauri/src/lib.rs:64 `.plugin(tauri_plugin_dialog::init())`），只在桌面壳工作——浏览器跑 apps/web 无法走查该对话框，替代验证=假验证，不做。故 Windows 走查**仍未完成**，缺=MSVC+Windows SDK 构建工具链（或提供可下载的预构建 Windows 二进制/PAT）。macOS 那一半仍缺。
  - 2026-10-20:上面 ② 的解锁路径落地——desktop-package.yml 加每日 schedule + `nightly` 手动入参,三腿构建+安装冒烟全绿后重建单一滚动 nightly 预发布 Release(公开下载 Windows msi+nsis / macOS dmg / Linux deb,无需 PAT;无更新自动跳过,`--latest=false` 永不占正式版位)。Windows 真机走查可直接用 nightly 安装器开窗;macOS 主机仍缺,该条整体仍 BLOCKED。实证 run 39216865044(三腿全绿,nightly 预发布 4 资产 msi/nsis/dmg/deb;`releases/latest` 端点 404 证正式位空置;无凭据 curl nsis 安装器 302→200 公开可下载)。
  - 2026-10-20 peer 真机走查(hermes run `c4f3bbcfd9`):Step 0 全 PASS——nightly nsis 在真 Windows 11 下载(该机 `github.com:443` 超时,经 api.github.com 资产解析绕过)且 SHA-256 `e7dc5f8f…241f0` 与 GitHub digest 逐位一致,静默安装 exit 0 落 `C:\st-install`,启动渲染真窗口 1280×870、25 个可交互元素(标题/预设/replicates/运行仿真/打包/参数扫描/桌面本地查询含「选择结果文件」/footer),截图在案;Step 1-4(simulate→sweep→recommend→query+native 对话框)未执行——该主机 GUI 输入工具逐动作需人工批准,批准超时按「沉默非同意」止步未绕过。缺=用户在该主机批准 GUI 输入(或用户本机自行走查);macOS 半边仍缺。
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
