---
title: 22 · Web 端
---

[English](/guide/22-web) | [中文](/zh/guide/22-web)

# 22 · Web 端

Phase 6 的交付(文档 [路线图](./18-roadmap)):**"Try in your browser"**——打开页面、改配置、本地跑小中型仿真、图表直接出,零安装,数据不出浏览器。

## 形态

`apps/web`:Vite + React + TS 前端,消费 `sandtable-wasm` 绑定产物(`file:` 依赖,不经 npm registry)。零图表库——按天曲线由前端手绘 SVG(与 CLI `report` 子命令同一视觉纪律:无 CDN、无外链、无 JS 图表运行时)。

页面能力(当前增量):

- 预设配置(最小 RPG / 宝可梦案例)一键载入,或导入本地 `.yaml` 配置文件,编辑器直接改;
- `replicates` 1–8,本地执行 `run_simulation`;
- KPI 卡(D3/D7 留存、日胜率、总流失率、人均金币、人均战力)与 `config_hash`;
- 按天曲线(日活跃 / 日胜率 / 金币存量 / 升级次数);
- 分群表(casual / core / whale 的等级、金币、战力、流失);
- **SQL 查询面板(DuckDB-Wasm)**:仿真产物装入内存表 `days`,任意 SQL 本地执行(结果表 + 按天数值列一键画线)。零外链——worker 与 wasm 都经 vite `?url` 本地打包,不经 CDN;mvp 单线程构建按需加载(39 MB 资产,打开查询才下载)。
- **结果导出**:`days.csv`(replicate 1,与 CLI `simulate --out` 写盘产物逐字节一致)、`report.json`(结构同构,`results` 逐值一致)与 `days.parquet`(同一份按天数据经 DuckDB `COPY ... (FORMAT PARQUET)` 落 Parquet,零新依赖)一键下载——放进一个目录即可被 `sandtable report` / `sandtable query` 继续分析([数据输出](./09-data-output) 契约)。
- **项目打包与手输路径(2026-10-13)**:工具栏「打包项目(.sandtable)」把两个编辑器内容 + 当前结果打成 `.sandtable`(fflate,manifest v1、条目按路径排序、逐条 sha256 走 WebCrypto、固定归档时间戳 1980-01-01,与 CLI `project pack` 同规),`sandtable project check` / `unpack` 直接读;「本地结果文件分析」面板除原生对话框(多选)外有手输路径入口(单条追加去重,视图仍按文件词根注册)——native 对话框无法无头自动化时的等价路,功能同 duckdb-rs 查询。桌面下载经壳 `on_download` 接线落 `~/Downloads`(同名自动加 (n) 后缀,见[路线图 Phase 7](./18-roadmap))。
- **参数扫描(网格 / Random + 推荐带 + 联合可行域)**:实验文件(scenario + model + sweep 三节,[文档 12 章](./12-parameter-sweep))本地扫描——经 YAML 编辑或预设选择器(单轴网格 / 单轴随机 / 双轴网格),JS 逐候选驱动(单线程下候选并行不可用,候选间让出主线程,进度可渲染);出候选 × 指标表(约束判定 PASS / BORDERLINE / FAIL,失败候选标注不静默丢弃)、单轴图(网格折线 / Random 散点,CI95 须、判定着色、推荐带与基线标记)、双轴联合可行域矩阵(逐目标三色判定,Random 稀疏格留空)、OAT 敏感性矩阵与推荐块——与 CLI `sweep` / `recommend` 同源(core 纯函数);预算门:候选 × replicates ≤ 200、players × days ≤ 40 万,超出引导走 CLI。

## 绑定纪律

[`sandtable-wasm`](https://github.com/cuihairu/sandtable/tree/main/crates/sandtable-wasm) 是**薄绑定**:

- 只转发 core(load → validate → run),**不放仿真逻辑**;真实逻辑在 native 纯函数(`*_native`),cargo test 直接覆盖;
- wasm 入口返回 **JSON 字符串**,前端 `JSON.parse`——不经过 serde-wasm-bindgen 的 JsValue 协议(实测与 wasm-bindgen 新版存在静默不兼容:to_value 产出空对象;字符串是 wasm ABI 最稳通道);
- `run_simulation` 输出附 `days_csv`(replicate 1,`core::export::day_csv` 直出)——CSV 由 Rust 渲染,浏览器下载与 CLI 写盘**逐字节一致**(`web_parity` 锁死),不在 JS 侧重拼浮点;
- 扫描三绑定(`sweep_plan / sweep_candidate / sweep_recommend`)同为纯转发;单线程下候选并行(rayon)不可用,由 **JS 逐候选驱动**、候选间让出主线程——`replicates` 由 plan 统一给出,candidate / recommend 不各自解释;推荐仅单参数轴(MVP 红线,[文档 15 章](./15-recommendation)同源拒绝);扫描取消在候选循环边界中止(主线程候选间已让出,web 与桌面均可点),取消后已完成的候选保留在表中但不出推荐;
- `meta` 只带 `schema_version / model_version`;`generated_at_unix / git_sha` 属环境字段,由前端构建注入(`VITE_GIT_SHA`,CI 构建期注入;未注入回退 `unknown`,与 CLI 未设 `SANDTABLE_GIT_SHA` 时同),绑定层不伪造;
- replicates 上限 64(Web 定位小中型,WASM 内存 4GB 上限、单线程,文档 [数据输出](./09-data-output)),更大的实验引导走 CLI / 桌面。

### 配置回写/序列化契约(WB-03.07)

配置在前端有两条通道,职责不重叠:

- **人工写回走 YAML 文本层**:`applyParamEdit(s)` 做 token 级替换,不重序列化——注释、键序、未编辑的结构性配置(枚举 `damage_model`、公式 `xp_needed`、逐层 `tier_table`、loot `tables/rewards/on_victory`、`gacha`、`training`)逐字节保留(工作台测试锁);`serde` 重序列化会丢注释、重排键,**禁止**作为人工写回通道。
- **内核对象通道只出 hash 与回读值**:`param_apply` 按 `registry::apply_numeric` 应用后重验(显式性契约——如 loot 在场必须整配——在编辑期把关),返回 `{config_hash, path, value}`,**不返回 YAML**;`config_hash` 是内核 canonical SHA-256,YAML 文本本身不进哈希。
- 数值桥接对结构性参数(时长 / 公式 / 结构表 / 枚举开关)一律「该参数不是数值」拒绝——结构配置只能经文本编辑或专用结构编辑器修改。
- **u64 安全整数边界(WB-03.08)**:seed / 保底抽数等 u64 槽位读取时,≤ 2^53−1 返回 JSON 数字,超出 JS 安全整数以**十进制字符串**无损表达;写入越界值内核明确拒绝(「超出安全整数上限 2^53−1」)——两侧都不静默舍入。

### A/B 统计比较桥(WB-03.10/.11/.12)

A/B 双臂比较的输入契约与统计判定全部在内核,前端不另算一套:

- **入口** `ab_compare(base_yaml, cand_yaml, metric, results_a_json, results_b_json)`:双臂 YAML + 双臂**已跑** results 数组(与 `run_simulation` 输出的 `results` 同构,回读内核,不重跑);内核入口 `core::experiment::compare_arms`。
- **成对前提显式拒绝**(不静默降级):双臂 `base_seed` 不一致(CRN 按 replicate 序号配对,种子错位则成对差值无意义)、replicate 数不等长或为 0、指标在任一臂不可用(`unavailable_reason`,不做单臂跳过)、某 replicate `extract` 为 None(不 0 填充)。错误通道:未知指标 / results 解析失败 = `参数错误: `,其余 = `配置错误: `。
- **统计口径 = 内核 `experiment::compare` 直出**:配对差(B_r − A_r)、CI95、合并 sd、效应量 d、verdict(CI 符号判定三值),前端 `Comparison` 类型与序列化同构(contracts 运行时锁)。
- **比较指标** = 设计目标的首个 KPI(未勾选回退 `win_rate`),合法性由内核 `MetricKey::parse` 判定。

### 绑定生成守卫(WB-03.13)

wasm 导出面变更后必须**重建两份 pkg** 再做类型检查 / 跑测试:`wasm-pack build crates/sandtable-wasm --target web --release`(浏览器 + tsc)与 `--target nodejs --out-dir pkg-node --dev`(节点测试)。漏建的症状是运行时 `does not provide an export named …`。contracts 里的**绑定生成守卫**把这条纪律自动化:收集 TS 包装(wasm.ts 服务层 + Worker 入口)从 `sandtable-wasm` 的全部命名导入,逐名校验 pkg-node 运行时导出、web pkg 的 JS 导出与 `.d.ts` 声明三面齐备——包装调用未生成导出即红。pkg / pkg-node 是构建产物,不进 git。

### 统一错误分类与 locale 展示(WB-03.15)

绑定层错误以**稳定通道前缀**为契约(`配置错误: ` / `参数错误: ` / `候选结果序列化失败: `,与 CLI stderr 同源),展示层在其上统一为六类:**解析失败**是独立类——内核把 YAML 解析并进 `配置错误` 通道、双臂 results 解析失败带 `参数错误` 前缀(通道前缀契约不动),展示层按「解析失败」事实升级为 `parse` 码(改配置与没解析过是两件事);**配置 / 参数 / 序列化**照前缀归类;**初始化中 / 初始化失败 / 运行错误 / 超出内存预算 / 内核桥接未接入**走执行侧 `ExecErrorClass`(init/run/budget/bridge,初始化中以 running 展示、不伪造进度);**取消**不是错误,走状态机 `cancelled/cancelling`。locale 展示:`localizeWasmError` 把可识别消息换成稳定错误码 + 词典模板(`errors.*`,中英模板不同、错误码相同),内核原文逐字保留在 `detail` 供定位;任务列表正文走 `execErrorText`——剥通道前缀再套模板,避免「配置错误：配置错误: …」重复。`state/` 执行域不 import i18n(WB-07.17 守卫),词典文案集中在纯显示层 `taskText.ts`,contracts 用六行分类表 + 双语模板断言锁死。

### 数据来源与版本标记(WB-03.16)

`lib/dataSource.ts` 是来源标记的**单一出处**:`kernel` 与 `synthetic_demo`。真实运行集合只收 `kernel`,三道闸都在索引代码面——**快照入口**(`snapshotRun` 显式传 `synthetic_demo` 即拒,缺省 `kernel`)、**索引写闸**(`runsIndexFile` 对 demo / 来源缺失 / 非法来源显式拒绝,不静默修正)、**读闸**(`readRunsIndex` 对 demo 条目与非法来源给可读错误;v1 时代条目缺席 `data_source` 按 `kernel` 推断——演示数据自始就没有进入索引的通道,缺席即 kernel 是事实推断而非猜测)。标记落位:`RunSnapshot.dataSource`、`RunIndexEntry.data_source`(提交登记时透传)、报告导出 `machineJson({ data_source: 'kernel', … })`;演示侧导出(候选 CSV 列 / 演示快照 `data-source` 属性)自带 `synthetic_demo`。版本标记沿用既有口径:运行条目 `model_version` / `schema_version` / `seed` + 索引自身 `RUNS_INDEX_SCHEMA`(`'1'`,新增字段是加法变更,旧索引仍可读)、报告 `meta.schema_version`(文档 09 章)。分析页真实/演示两条通道互斥:真实运行列表过滤掉 `demo` 任务,演示视图需显式选择来源(`selection.source === 'synthetic_demo'`)并挂来源横幅。contracts 的 WB-03.16 结构守卫锁:来源两值 + `isDataSource` 非法值 + 演示项目标记取自单一出处 + 运行集合与执行引擎代码面不 import 演示模块 + 登记链/报告/三道闸接线。

### 导出绑定真实 run（WB-09.01）

导出对话框有两种互斥上下文：演示上下文（导出内置样例，产物标注 `synthetic_demo`）与真实 run 上下文（分析页真实视图打开）。真实上下文里，范围计数与产物一律派生自当前 run——解析口径（会话选中 job → 选择器 runId → 最新真实 job）由 `analysis/exportScope.ts` 的 `currentRealJob` 单点提供，分析页与对话框共用；范围 = 全部计划内候选 / 分析页当前筛选（overall 判定同一口径）/ 当前选中候选，选项显示实际数量，所选为空时该项禁用、无候选时下载禁用。产物 JSON 信封：`data_source=kernel`、`run_id`、`spec`、`status`、`results`（按计划下标对位保留范围行，未进入范围的候选不出现在产物里）、`recommendation` 与 `export_scope` 证据（scope/candidates/total；部分返回的运行只导出已返回槽位，证据仍记全集计划数）；未运行的草稿与演示数据绝不进入这份产物。机器输出口径（WB-11.19）：数字走 `machineJson` 规范十进制，locale 无关。真实上下文先只放 JSON 格式，CSV / SVG 随 WB-09.02/.05 落地后放开。

## 等价验收

路线图的 Phase 6 验收:**浏览器与 CLI 用同一配置同 seed,结果统计等价**。由 `crates/sandtable-cli/tests/web_parity.rs` 锁死——同配置同 seed 下,CLI `simulate` 的 report.json 与绑定 `run_simulation_native` 的 results **逐值一致**(不只统计近似;`serde_json` 已开 `float_roundtrip`,写盘读回的 f64 逐位一致)。

脚本层阶段 1(2026-10-11)补齐第三条边:`crates/sandtable-python/tests/test_parity.py` 以同一范式锁 py↔CLI(simulate / sweep / recommend 逐值一致,`days_csv` 与 CLI `days.csv` 逐字节一致)——core 唯一真源、三份独立薄转发的 pairwise 等价闭环(web_parity + py_parity + 桌面等价测试)完成。

桌面命令层与 wasm 绑定层的**参数回写与 A/B 统计**也锁在同一三角口径里(WB-03.17,2026-10-20,desktop 测试两枚):`param_writeback_parity_wasm_native`——同一配置(宝可梦案例)上数值读取全表逐键一致(含 u64 无损通道)、`param_apply` 回写 config_hash + 回读值逐值一致、`kpi_availability` 同表,非法路径错误文案逐字一致;`ab_stats_parity_wasm_native`——同一双臂 results 上,桌面 `ab_compare` 与 wasm `ab_compare_native` 的 Comparison 逐字段一致(verdict / CI / 效应量),未知指标与种子错位的错误通道同构、文案逐字一致。同配置同 seed 的运行输出另有 `run_wasm_parity_same_config_seed`(results / config_hash / days_csv)锁定。

## CI 门

`.github/workflows/ci.yml` 三个 job 都盖到 wasm 面:

- `test` job:WASM 编译门(core,wasm32)+ WASM 绑定构建门(wasm-pack `--dev` 出 pkg);
- `web` job:wasm-pack `--release` 出 pkg → `npm ci` → `npm run build`(类型检查 + 打包,断言产物含 .wasm)→ **`node --test` 前端守卫**(`tests/columns.test.mjs` 列归一含 BigInt、`tests/presets.test.mjs` 预设过真实 wasm 内核、`tests/project.test.mjs` 打包/解包闭环 + 路径纪律 + 打包产物过真实内核,后两条需 pkg-node);
- `desktop-smoke` job(2026-10-13):wasm-pack `--target web --dev` 出 pkg(桌面壳 custom-protocol 编译期内嵌 `web/dist`,tsc 也要解析 file:pkg 类型)→ 前端构建 → Xvfb 无头拉起壳截屏判定(启动链门,配方见 `scripts/desktop_smoke.sh`)。

独立工作流 `.github/workflows/desktop-package.yml`(2026-10-13,`workflow_dispatch` 手动触发):同一 wasm pkg + 前端产物前置 → `tauri-action` 打包三平台安装制品(Windows msi+nsis / macOS dmg+app / Linux deb)上传 artifacts——**不打 tag、不建 Release**,未验收的二进制不进 Releases 页面(版本号只由用户手动给出)。前端产物同样先行(custom-protocol 内联),故这条链也顺带覆盖 wasm 类型解析与前端打包。

## 本地运行

见 [apps/web/README](https://github.com/cuihairu/sandtable/tree/main/apps/web):先 `wasm-pack build crates/sandtable-wasm --target web`,再 `npm install && npm run dev`。

桌面安装包本地构建:`cd apps/desktop/src-tauri && tauri build --features custom-protocol`(需先备好 `apps/web/dist`,见上);仅验编译链时可加 `--bundles deb` 跳过 AppImage 下载。图标重生成见 [src-tauri/assets/README](https://github.com/cuihairu/sandtable/tree/main/apps/desktop/src-tauri/assets)。

## 后续

- ~~查询面板改为加载随结果携带的 CSV / Parquet 文件~~ **CSV 与项目文件已落地(2026-10-09,a47ad10 + 9edca3f)**:查询面板可载入 `.sandtable`(fflate 本地解包,校验同 CLI `project check`——manifest v1、路径纪律、逐条 sha256 走 WebCrypto、归档集合与清单严格相等)或散装 CSV,产物注册为 DuckDB 内存表直接 SQL;顶部「导入配置文件」支持 `.sandtable`,scenario / experiment 各取路径序首个接进仿真与扫描编辑器(打开项目文件即可复现实验,文档 09 章闭环)。**余项均已落地(2026-10-10)**:项目多配置选择器——`.sandtable` 内多个 scenario / experiment 时 toolbar 出下拉切换(默认路径序首个,单个不占位);Parquet 直读——查询面板接受 `.parquet` 散装文件与项目内 Parquet 产物,duckdb-wasm `read_parquet` 装表(读入函数按扩展名二选一,CSV 走 `read_csv_auto` 不变)。仿真按天数据仍同时可查(`days` 表)。
- ~~扫描的多参数轴联合可行域与 Random 搜索前端化~~ **已完成(2026-10-09,1952308 + 9b75565)**:Random 预设 + 散点图(采样点不连线、刻度抽稀);双轴联合可行域矩阵(SweepMatrix,逐目标三色判定,Random 稀疏格如实留空,单轴取值过多降级提示);单轴推荐带红线不变,≥3 轴仍仅候选表。
- **桌面原生本地查询迁入工作台(WB-02.18,2026-10-20)**:数据交换页新增「本机文件直查(桌面)」段(仅 `isDesktop` 渲染):原生对话框多选或手输路径(回车追加、去重)选本机 CSV / Parquet 产物,桌面壳 `query` 命令(duckdb-rs,与 CLI `query` 同源)按文件名词根只读注册视图跑 SQL——万级行不经前端内存。纯逻辑出壳 `lib/localQuery.ts`(视图名 / 路径合并 / native 结果列整形,`tests/columns.test.mjs` 锁定);词条走词典 `data.exchange.local*`(i18n 测试锁双语与插值占位);plugin-dialog 动态导入不进浏览器包,数据通道经服务层 `lib/wasm.ts` 的 `queryLocal`(contracts 结构守卫)。原型 `components/LocalQuery.tsx` 保留至原型下线项处理。
