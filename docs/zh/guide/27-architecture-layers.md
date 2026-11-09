---
title: 27 · 架构分层
---

# 27 · 架构分层

[English](/guide/27-architecture-layers) | [中文](/zh/guide/27-architecture-layers)

本页记录源码中已经存在的职责边界。层是职责边界，不是目录名：外壳可以同时包含界面、执行编排、持久化与查询访问；仿真核心则有意把这些关注点留在 `sandtable-core` 之外。

## 分层地图

| 层 | 名称 | 职责 | 代表锚点 |
| --- | --- | --- | --- |
| 1 | 场景与配置编译 | 解析场景/实验 YAML，按注册表校验，并编译出一次运行使用的内存态 `SimConfig`。 | `crates/sandtable-core/src/scenario.rs:98`; `crates/sandtable-core/src/config/mod.rs:36` |
| 2 | 仿真核心 | 在内存 World 上运行确定性事件系统，并产出每个 replicate 的指标。 | `crates/sandtable-core/src/kernel.rs:123`; `crates/sandtable-core/src/world.rs:55` |
| 3 | 实验与统计 | 扫描、优化、对照、代理模型和敏感性分析，把样本转化为可解释的统计决策。 | `crates/sandtable-core/src/experiment.rs:120`; `crates/sandtable-core/src/sweep.rs:174` |
| 4 | 输出契约与互操作 | 定义稳定产物，并在内部结果与 JSON/CSV/Parquet/Arrow、项目包、XLSX、引擎输入之间转换。 | `crates/sandtable-core/src/export.rs:13`; `crates/sandtable-engine/src/contract.rs:35` |
| 5 | 平台绑定 | 通过 WASM、Python、MCP 和桌面原生命令暴露同一套核心能力。 | `crates/sandtable-wasm/src/lib.rs:188`; `apps/desktop/src-tauri/src/lib.rs:71` |
| 6 | CLI 外壳 | 解析进程参数，编排文件 I/O，执行 run/report/query 工作流并输出命令结果。 | `crates/sandtable-cli/src/main.rs:33`; `crates/sandtable-cli/src/main.rs:210` |
| 7 | Web 工作台 | 在浏览器/桌面 UI 中维护项目草稿、执行任务、进度、语言和展示状态。 | `apps/web/src/workbench/WorkbenchApp.tsx:129`; `apps/web/src/workbench/state/executor.ts:131` |
| 8 | 数据与查询 | 把结果产物加载进进程内 DuckDB，执行用户 SQL 并整形输出。 | `apps/web/src/lib/duck.ts:20`; `apps/desktop/src-tauri/src/lib.rs:600` |

## 模块清单、状态、通道、配置与生命周期

### 1. 场景与配置编译

- **模块：** `sandtable-core::scenario`、`config`、`registry`、`formula`。
- **状态：** 无 Redis、MySQL、磁盘、网络或墙钟依赖；产物是由调用方持有的内存态 `SimConfig`。核心 crate 只声明序列化和错误依赖（`crates/sandtable-core/Cargo.toml:8`），并在 `crates/sandtable-core/src/lib.rs:3` 明确纯度规则。
- **调用面：** 各外壳先调用 `scenario::load_str` 或实验加载器再仿真；注册表树检查发生在加载内（`crates/sandtable-core/src/scenario.rs:101`）。
- **配置输入：** `scenario` 与 `model` YAML 映射为 `SimConfig`（`crates/sandtable-core/src/config/mod.rs:36`）；实验节可进入校验入口，再由各自加载器处理（`crates/sandtable-core/src/scenario.rs:109`）。
- **生命周期：** 解析 → 校验 → 编译 → 交付。对象属于当前进程/调用方，随其所有者释放。

### 2. 仿真核心

- **模块：** `kernel`、`world`、确定性 `rng`、`sim`、`systems/*`。
- **状态：** 单个 replicate 的内存 `World`、Actor、事件队列、RNG 流和指标（`crates/sandtable-core/src/world.rs:55`；`crates/sandtable-core/src/kernel.rs:69`）。没有数据库或服务状态。
- **调用面：** System 声明订阅事件并接收可变 World（`crates/sandtable-core/src/kernel.rs:123`）；`sim` 调度系统并聚合每个 replicate（`crates/sandtable-core/src/sim.rs:41`）。
- **配置输入：** 编译后的 `SimConfig`；replicate `r` 从基础种子派生确定性流（`crates/sandtable-core/src/rng.rs:24`）。
- **生命周期：** 构造 World → 注册 System → 执行事件到末日 → 返回指标并释放内存。取消发生在 shells 的 replicate/candidate 边界，核心内没有后台常驻任务。

### 3. 实验与统计

- **模块：** `experiment`、`sweep`、`optimize`、`recommend`、`surrogate`、`sensitivity`、`kpi_dict`、`kpi_custom`、`disttest`。
- **状态：** 调用方内存中的样本结构与统计量。持久状态归 shells 所有：CLI 结果文件、浏览器 `localStorage` 任务队列，或桌面进程状态。
- **调用面：** 实验/对照代码消费结果样本，不读数据库（`crates/sandtable-core/src/experiment.rs:120`、`:364`）；扫描规格展开为候选和统计（`crates/sandtable-core/src/sweep.rs:174`）。
- **配置输入：** 实验 YAML 的 sweep/optimize 节、目标定义、约束以及内置/自定义 KPI 语义。
- **生命周期：** 加载计划 → 展开/运行候选（通常由 shell 驱动）→ 聚合样本 → 比较、推荐、优化或拟合 → 返回值。核心内无常驻调度器。

### 4. 输出契约与互操作

- **模块：** `sandtable-core::export`、`sandtable-engine`，以及 CLI 的 `project`、`xlsx`、`workbook` 支持。
- **状态：** 文件与内存字节缓冲：JSON 汇总、CSV/Parquet 日表、Arrow 流、项目包、XLSX 工作簿、引擎适配载荷。引擎契约声明独立的 schema/version 边界（`crates/sandtable-engine/src/contract.rs:35`）、类型化记录（约 `:231`）和校验（约 `:400`）。
- **调用面：** 生产方向调用导出函数；消费方向由 importer/backflow 把外部产物转回内部值。引擎互操作有专属协议模块，而不是散落的临时 JSON 字段（`crates/sandtable-engine/src/contract.rs:35`）。
- **配置输入：** 产物选择、项目包格式/版本、可选引擎 adapter schema，以及 CLI/Web/Desktop 提供的目标路径。
- **生命周期：** 运行完成时写出/导出，或按需导入/检查/解包。CLI 创建的文件在进程退出后保留；浏览器缓冲只活在页面/worker 会话中。

### 5. 平台绑定

- **模块：** `sandtable-wasm`、`sandtable-python`、`sandtable-mcp`、`apps/desktop/src-tauri` 的 Tauri commands。
- **状态：** 绑定不持有仿真真值。WASM 有意保持薄层（`crates/sandtable-wasm/src/lib.rs:3`）；桌面直接走 core 依赖而非 WASM（`apps/desktop/src-tauri/src/lib.rs:3`）；MCP 明确限制响应与运行预算（`crates/sandtable-mcp/src/main.rs:21`）。
- **调用面：** JavaScript→WASM、Python→PyO3、MCP client→stdio 工具调用、WebWorkbench→Tauri IPC。桌面进度经 Tauri Channel（`apps/desktop/src-tauri/src/lib.rs:5`）；浏览器使用自己的 Worker 协议（`apps/web/src/workbench/state/workerProtocol.ts:11`）。
- **配置输入：** 与核心相同的 YAML 字符串和数值参数；绑定侧额外有预算限制与序列化格式。
- **生命周期：** 随宿主进程存在——浏览器页面、Python 解释器、MCP server 或桌面应用。绑定自身没有服务数据库。

### 6. CLI 外壳

- **模块：** `sandtable-cli::main`、`analyze`、`report`、`scaffold`、`project`、`xlsx`、`workbook`。
- **状态：** 参数选择的目标文件与进程内存。没有隐藏 server 或本地 daemon；report/query 按命令读取磁盘产物（`crates/sandtable-cli/src/main.rs:127`、`:1074`）。
- **调用面：** argv → clap 子命令 → core/interop/query 函数 → stdout、文件和退出码（`crates/sandtable-cli/src/main.rs:33`、`:210`）。
- **配置输入：** 场景/实验 YAML、输出路径、报告/查询选项和命令级 flags。
- **生命周期：** 一条命令一个进程；只初始化该命令需要的能力，退出即释放进程内存。

### 7. Web 工作台

- **模块：** `WorkbenchApp`、workbench stores、executor/run manager、worker protocol/sweep worker、project documents、routing、panels、i18n dictionaries。
- **状态：** React 内存保存活动 UI；浏览器 `localStorage` 保存草稿/结果/队列、语言、工作区布局、表格偏好和分析偏好（`apps/web/src/workbench/state/workbenchStore.ts:35`；`apps/web/src/workbench/state/projectDoc.ts:672`；`apps/web/src/lib/i18n/localeStore.ts:9`）。没有应用 server 或 MySQL/Redis。
- **调用面：** 门面按宿主选择桌面 Tauri `invoke` 或浏览器 worker postMessage（`apps/web/src/lib/wasm.ts:48`、`:58`）；worker 请求/响应带版本（`apps/web/src/workbench/state/workerProtocol.ts:11`）；本地文件查询仅桌面可用（`apps/web/src/lib/wasm.ts:376`）。
- **配置输入：** 编辑器 YAML、预设、实验计划、语言/布局/表格偏好和项目归档。UI 文案集中在 `apps/web/src/lib/i18n/dict/en.ts` 与 `apps/web/src/lib/i18n/dict/zh.ts`，由 i18n 层按键分发。
- **生命周期：** 应用/会话 → 恢复持久草稿与任务 → 派发执行 → 保留完成产物和 UI 状态 → 关闭或按显式协议版本迁移。桌面执行在 replicate 边界停止；浏览器执行在 candidate/worker 边界停止。

### 8. 数据与查询

- **模块：** 浏览器 `lib/duck.ts` + DuckDB-Wasm；桌面 `query` command + duckdb-rs；CLI `query` 子命令。
- **状态：** 从所选 CSV/Parquet 产物加载的 DuckDB 内存表或文件。浏览器注册字节缓冲并创建会话表（`apps/web/src/lib/duck.ts:20`、`:84`）；桌面通过 shell command 暴露本地路径（`apps/desktop/src-tauri/src/lib.rs:600`）。
- **调用面：** UI SQL 输入 → 查询适配器 → DuckDB → 类型化列/表。桌面红线限制本地文件只读 `SELECT`/`WITH`（`apps/desktop/src-tauri/src/lib.rs:562`）。
- **配置输入：** 文件输入、表名规则、SQL 文本，以及 shell 提供的行数/输出限制。
- **生命周期：** 注册/加载 → 执行查询 → 整形结果 → 注销或保留到会话结束。该层不改写源配置或实验真值。

## 拆分理由

1. **LAY-001：仿真逻辑与传输面解耦。** `sandtable-core` 在 `crates/sandtable-core/src/lib.rs:3` 声明无 I/O、无墙钟；`crates/sandtable-core/Cargo.toml:8` 只保留序列化/错误依赖。CLI、WASM、Python、MCP 和桌面因此共享同一套可测试核心，而不是复制仿真行为。
2. **LAY-002：接受文本与编译语义分离。** YAML 在 `crates/sandtable-core/src/scenario.rs:98` 先做注册表树检查再类型化反序列化；运行时消费 `crates/sandtable-core/src/config/mod.rs:36` 的编译产物。实验入口可以共享同一校验纪律，而不必把原始 YAML 当运行时接口。
3. **LAY-003：确定性是内核显式契约。** `EventQueue` 按 `(tick, sequence)` 排序，同 tick 调度保持 FIFO（`crates/sandtable-core/src/kernel.rs:67`）；键控 RNG 从种子派生 replicate 流（`crates/sandtable-core/src/rng.rs:24`）。若与 UI 或 I/O 混层，复现和调试会依赖偶然执行顺序。
4. **LAY-004：统计与场景机制分离。** 对照定义在结果样本和指标统计上（`crates/sandtable-core/src/experiment.rs:120`），扫描规格独立展开（`crates/sandtable-core/src/sweep.rs:174`）。改战斗、经济或抽卡规则时，不需要同步改置信区间/决策逻辑。
5. **LAY-005：交换格式在边界集中所有。** 导出与 engine contract 独立于执行定义产物形状和校验（`crates/sandtable-core/src/export.rs:13`；`crates/sandtable-engine/src/contract.rs:35`）。消费者读取稳定文件时不需要引入内核内部或重跑仿真。
6. **LAY-006：绑定是能力门面。** WASM 把校验后的调用转发给 native 函数，不维护第二套实现（`crates/sandtable-wasm/src/lib.rs:3`）；桌面直接调 core（`apps/desktop/src-tauri/src/lib.rs:3`）。传输、预算、进度和序列化留在宿主侧，可分别替换。
7. **LAY-007：短命进程与持久 UI 会话分离。** CLI 在 `crates/sandtable-cli/src/main.rs:33` 分发单条 argv 命令后返回；Web Workbench 在 `apps/web/src/workbench/state/projectDoc.ts:672` 恢复 `localStorage` 中的任务/草稿。常驻 UI 状态机需要取消、重试和协议版本，而一次性命令不需要。
8. **LAY-008：查询有独立加载/执行边界。** 浏览器在 `apps/web/src/lib/duck.ts:84` 把 CSV/Parquet 缓冲注册为 DuckDB 表；桌面在 `apps/desktop/src-tauri/src/lib.rs:562` 限制本地文件 SQL 为只读 `SELECT`/`WITH`。这样既允许分析查询，又不给分析代码改写源产物的权限。

## 五壳层契约矩阵

五个壳层转发同一内核,但各自的装载入口、缺省值、错误面与预算互不相同
(2026-11-09 记录,I-038)。改这张表的任何一格都是契约变更:同一 commit
内同步本表。

| 壳层 | 装载入口 | `replicates` 缺省 | 错误面 | 预算门 |
| --- | --- | --- | --- | --- |
| CLI | 一律 `scenario::load_str` | `simulate --replicates` = 1;`sweep --replicates` 可选覆盖 | stderr,`配置错误:` / `参数错误:` 前缀,配置错误退出码 2 | `MAX_CLI_REPLICATE_DAYS`(replicates × days) |
| WASM(Web) | 校验:`load_config_str`(接受实验 YAML);执行:`load_str`(只收场景 YAML) | 必填,由 JS 调用方传入 | 字符串 reject,同前缀 | `MAX_REPLICATES = 64`;sweep 候选 × replicates ≤ 200 |
| 桌面(Tauri) | 校验:`load_config_str`;执行:`load_str` | 必填(`run_simulation(yaml, replicates, on_progress)`) | `Err(String)`,同前缀 | `MAX_DESKTOP_REPLICATE_DAYS`(replicates × days);单次 replicates 上界与 WASM 64 对齐(ST-AUD-11 / I-011) |
| Python | `scenario::load_str` | `replicates = 1`(`pyo3(signature)`) | `ValueError` | `MAX_PY_REPLICATE_DAYS`(replicates × days);`MAX_PY_SIM_WORK`(players × days × replicates) |
| MCP | `scenario::load_str` | 必填(tool schema) | tool-level error,消息原文透传 | `run` ≤ 4096 replicates;`plan_sweep` ≤ 1000 次仿真;analyze 的 results JSON ≤ 64 MiB |

错误形状说明:各壳层在唯一的 `load` 接缝给内核配置错误加 `配置错误:`
前缀(参数校验为 `参数错误:`),再由各自传输层映射——CLI 落退出码 2 的
stderr,Python 落 `ValueError`,MCP 落 tool-level error 且消息不改写,
WASM 与桌面落字符串 reject。MCP 文档所称「原文透传」指壳层不改写内核
消息;前缀在 `load` 一处添加。`to_tool_result` 对每次工具载荷序列化,
序列化失败按内部错误如实上报,不再返回空串(I-038)。

## 术语表

配套术语表见 [28 · 术语表](./28-glossary.md)。
