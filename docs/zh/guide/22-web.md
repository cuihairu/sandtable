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

## 等价验收

路线图的 Phase 6 验收:**浏览器与 CLI 用同一配置同 seed,结果统计等价**。由 `crates/sandtable-cli/tests/web_parity.rs` 锁死——同配置同 seed 下,CLI `simulate` 的 report.json 与绑定 `run_simulation_native` 的 results **逐值一致**(不只统计近似;`serde_json` 已开 `float_roundtrip`,写盘读回的 f64 逐位一致)。

脚本层阶段 1(2026-10-11)补齐第三条边:`crates/sandtable-python/tests/test_parity.py` 以同一范式锁 py↔CLI(simulate / sweep / recommend 逐值一致,`days_csv` 与 CLI `days.csv` 逐字节一致)——core 唯一真源、三份独立薄转发的 pairwise 等价闭环(web_parity + py_parity + 桌面等价测试)完成。

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
