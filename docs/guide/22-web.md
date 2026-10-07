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

## 绑定纪律

[`sandtable-wasm`](https://github.com/cuihairu/sandtable/tree/main/crates/sandtable-wasm) 是**薄绑定**:

- 只转发 core(load → validate → run),**不放仿真逻辑**;真实逻辑在 native 纯函数(`*_native`),cargo test 直接覆盖;
- wasm 入口返回 **JSON 字符串**,前端 `JSON.parse`——不经过 serde-wasm-bindgen 的 JsValue 协议(实测与 wasm-bindgen 新版存在静默不兼容:to_value 产出空对象;字符串是 wasm ABI 最稳通道);
- `meta` 只带 `schema_version / model_version`;`generated_at_unix / git_sha` 属环境字段,由前端构建注入,绑定层不伪造;
- replicates 上限 64(Web 定位小中型,WASM 内存 4GB 上限、单线程,文档 [数据输出](./09-data-output)),更大的实验引导走 CLI / 桌面。

## 等价验收

路线图的 Phase 6 验收:**浏览器与 CLI 用同一配置同 seed,结果统计等价**。由 `crates/sandtable-cli/tests/web_parity.rs` 锁死——同配置同 seed 下,CLI `simulate` 的 report.json 与绑定 `run_simulation_native` 的 results **逐值一致**(不只统计近似;`serde_json` 已开 `float_roundtrip`,写盘读回的 f64 逐位一致)。

## CI 门

`.github/workflows/ci.yml` 两个入口都盖到 wasm 面:

- `test` job:WASM 编译门(core,wasm32)+ WASM 绑定构建门(wasm-pack `--dev` 出 pkg);
- `web` job:wasm-pack `--release` 出 pkg → `npm ci` → `npm run build`(类型检查 + 打包,断言产物含 .wasm)。

## 本地运行

见 [apps/web/README](https://github.com/cuihairu/sandtable/tree/main/apps/web):先 `wasm-pack build crates/sandtable-wasm --target web`,再 `npm install && npm run dev`。

## 后续

- DuckDB-Wasm 本地查询结果数据集(路线图 Phase 6 余项):随结果携带的 CSV/Parquet 进 DuckDB-Wasm,SQL 本地执行后出图;
- sweep 前端化(参数扫描的网格编辑与推荐带可视化);
- 结果导出(与 [项目文件](./09-data-output) 契约对齐,CLI 可继续分析)。
