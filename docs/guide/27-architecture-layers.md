---
title: 27 · Architecture Layers
---

# 27 · Architecture Layers

[English](/guide/27-architecture-layers) | [中文](/zh/guide/27-architecture-layers)

This page records the responsibilities that already exist in the source tree. A layer is a responsibility boundary, not a directory label: a shell may contain presentation, execution orchestration, persistence, and query access, while the simulation core deliberately keeps those concerns out of `sandtable-core`.

## Layer map

| # | Layer | Responsibility | Representative anchor |
| --- | --- | --- | --- |
| 1 | Scenario & Config Compilation | Parse scenario/experiment YAML, validate it against the registry, and compile one immutable in-memory `SimConfig`. | `crates/sandtable-core/src/scenario.rs:98`; `crates/sandtable-core/src/config/mod.rs:36` |
| 2 | Simulation Core | Run deterministic event-driven systems over an in-memory world and produce per-replicate metrics. | `crates/sandtable-core/src/kernel.rs:123`; `crates/sandtable-core/src/world.rs:55` |
| 3 | Experiment & Statistics | Sweep, optimize, compare, fit surrogates, and turn samples into statistically interpreted decisions. | `crates/sandtable-core/src/experiment.rs:120`; `crates/sandtable-core/src/sweep.rs:174` |
| 4 | Output Contract & Interop | Define stable artifacts and convert between internal results, JSON/CSV/Parquet/Arrow, project archives, XLSX, and engine inputs. | `crates/sandtable-core/src/export.rs:13`; `crates/sandtable-engine/src/contract.rs:35` |
| 5 | Platform Bindings | Expose the same core capabilities through WASM, Python, MCP, and desktop-native commands. | `crates/sandtable-wasm/src/lib.rs:188`; `apps/desktop/src-tauri/src/sim.rs:66` |
| 6 | CLI Shell | Parse process arguments, orchestrate file I/O, run/report/query workflows, and emit command results. | `crates/sandtable-cli/src/args.rs:16`; `crates/sandtable-cli/src/args.rs:22` |
| 7 | Web Workbench | Maintain project drafts, execution jobs, progress, locales, and presentation in the browser/desktop UI. | `apps/web/src/workbench/WorkbenchApp.tsx:129`; `apps/web/src/workbench/state/executor.ts:131` |
| 8 | Data & Query | Load result artifacts into an in-process DuckDB surface and execute user SQL with output shaping. | `apps/web/src/lib/duck.ts:20`; `apps/desktop/src-tauri/src/query.rs:7` |

## Inventory, state, channels, configuration, and lifecycle

### 1. Scenario & Config Compilation

- **Modules:** `sandtable-core::scenario`, `sandtable-core::config`, `sandtable-core::registry`, and `sandtable-core::formula`.
- **State:** no Redis, MySQL, disk, network, or wall-clock dependency. Its product is a compiled `SimConfig` owned by the caller. The core crate declares only serialization and error dependencies (`crates/sandtable-core/Cargo.toml:8`) and documents its purity at `crates/sandtable-core/src/lib.rs:3`.
- **Call surface:** all shells call `scenario::load_str` or the experiment loaders before simulation; registry tree checks run inside loading (`crates/sandtable-core/src/scenario.rs:101`).
- **Configuration input:** `scenario` and `model` YAML map into `SimConfig` (`crates/sandtable-core/src/config/mod.rs:36`); experiment sections are accepted by validation and then dispatched by their own loaders (`crates/sandtable-core/src/scenario.rs:109`).
- **Lifecycle:** parse, validate, compile, hand off. The object is process-local and disappears with its owner.

### 2. Simulation Core

- **Modules:** `kernel`, `world`, deterministic `rng`, `sim`, and `systems/*`.
- **State:** in-memory `World`, actors, event queue, RNG streams, and metrics for one replicate (`crates/sandtable-core/src/world.rs:55`; `crates/sandtable-core/src/kernel.rs:69`). It has no database or service state.
- **Call surface:** systems subscribe to typed events and receive the mutable world (`crates/sandtable-core/src/kernel.rs:123`); `sim` schedules systems and aggregates each replicate (`crates/sandtable-core/src/sim.rs:41`).
- **Configuration input:** the compiled `SimConfig`; replicate `r` derives its deterministic stream from the base seed (`crates/sandtable-core/src/rng.rs:24`).
- **Lifecycle:** construct world → register systems → run scheduled events through the final day → return metrics and drop memory. Cancellation is at replicate/candidate boundaries in shells, not by a background daemon.

### 3. Experiment & Statistics

- **Modules:** `experiment`, `sweep`, `optimize`, `recommend`, `surrogate`, `sensitivity`, `kpi_dict`, `kpi_custom`, and `disttest`.
- **State:** pure sample structures and statistics in caller memory. Durable state belongs to invoking shells: CLI result files, browser queued jobs in `localStorage`, or desktop process state.
- **Call surface:** experiment/comparison code consumes result samples rather than reading a database (`crates/sandtable-core/src/experiment.rs:120`, `:364`); sweep specifications expand into candidates and statistics (`crates/sandtable-core/src/sweep.rs:174`).
- **Configuration input:** experiment YAML sections for sweep/optimize, target definitions, constraints, and selected KPI semantics. `kpi_dict`/`kpi_custom` define built-in versus formula-defined metric access.
- **Lifecycle:** load plan → expand/run candidates (typically through a shell) → accumulate samples → compare, recommend, optimize, or fit → return values. There is no resident scheduler in core.

### 4. Output Contract & Interop

- **Modules:** `sandtable-core::export`, `sandtable-engine`, CLI `project`, `xlsx`, and `workbook` support.
- **State:** files and in-memory byte buffers: JSON summaries, CSV/Parquet day tables, Arrow streams, project archives, XLSX workbooks, and engine adapter payloads. The engine contract declares its own schema/version boundary (`crates/sandtable-engine/src/contract.rs:35`), typed records around line `231`, and validation around line `400`.
- **Call surface:** producers call export functions; consumers/importers/backflow convert external artifacts toward internal values. Engine interop has a dedicated protocol module rather than ad-hoc JSON fields (`crates/sandtable-engine/src/contract.rs:35`).
- **Configuration input:** artifact selection, project archive format/version, optional engine adapter schema, and destination paths supplied by CLI/Web/Desktop.
- **Lifecycle:** write/export at completion of a run, or import/check/unpack on demand. Files created by CLI remain after process exit; browser buffers live in the page/worker session.

### 5. Platform Bindings

- **Modules:** `sandtable-wasm`, `sandtable-python`, `sandtable-mcp`, and Tauri commands in `apps/desktop/src-tauri`.
- **State:** bindings do not own simulation truth. WASM is intentionally thin (`crates/sandtable-wasm/src/lib.rs:3`); desktop connects directly to the core path rather than through WASM (`apps/desktop/src-tauri/src/lib.rs:3`). MCP enforces explicit response-size and run budgets (`crates/sandtable-mcp/src/main.rs:21`).
- **Call surface:** JavaScript→WASM, Python→PyO3, MCP client→stdio tool calls, WebWorkbench→Tauri IPC. Desktop progress crosses a Tauri channel (`apps/desktop/src-tauri/src/lib.rs:5`); the browser uses its own worker protocol (`apps/web/src/workbench/state/workerProtocol.ts:11`).
- **Configuration input:** the same YAML strings and numeric arguments as the core; binding-specific limits and serialization formats.
- **Lifecycle:** each binding lives with its host process—browser page, Python interpreter, MCP server, or desktop app. No binding has its own service database.

### 6. CLI Shell

- **Modules:** `sandtable-cli::main`, `analyze`, `report`, `scaffold`, `project`, `xlsx`, and `workbook`.
- **State:** files chosen by arguments plus process memory. There is no hidden server or local daemon; report and query read generated artifacts from disk (`crates/sandtable-cli/src/main.rs:127`, `:1074`).
- **Call surface:** argv → clap subcommands → core/interop/query functions → stdout, files, and exit code (`crates/sandtable-cli/src/args.rs:16`, `:22`).
- **Configuration input:** scenario/experiment YAML, output paths, report/query options, and command-level flags.
- **Lifecycle:** one command per process. It initializes only what the requested command needs and releases process memory at exit.

### 7. Web Workbench

- **Modules:** `WorkbenchApp`, workbench stores, executor/run manager, worker protocol/sweep worker, project documents, routing, panels, and i18n dictionaries.
- **State:** React memory for the active UI; browser `localStorage` for drafts/results/queue, locale, workspace layout, table preferences, and analysis preferences (`apps/web/src/workbench/state/workbenchStore.ts:35`; `apps/web/src/workbench/state/projectDoc.ts:672`; `apps/web/src/lib/i18n/localeStore.ts:9`). There is no application server or MySQL/Redis dependency.
- **Call surface:** a facade chooses desktop Tauri `invoke` or browser worker postMessage (`apps/web/src/lib/wasm.ts:48`, `:58`); worker requests/responses are versioned (`apps/web/src/workbench/state/workerProtocol.ts:11`); local-file query is desktop-only (`apps/web/src/lib/wasm.ts:376`).
- **Configuration input:** editor YAML, presets, experiment plans, locale/layout/table preferences, and archived project documents. UI copy is centralized in `apps/web/src/lib/i18n/dict/en.ts` and `apps/web/src/lib/i18n/dict/zh.ts`, keyed through the i18n layer.
- **Lifecycle:** app/session → restore persisted drafts/jobs → dispatch execution → retain completed artifacts and UI state → close or migrate through explicit protocol versions. Desktop execution stops at replicate boundaries; browser execution stops at candidate/worker boundaries.

### 8. Data & Query

- **Modules:** browser `lib/duck.ts` and DuckDB-Wasm; desktop `query` command with duckdb-rs; CLI `query` subcommand.
- **State:** DuckDB in-memory tables/files loaded from selected CSV/Parquet artifacts. The browser path registers buffers and creates session tables (`apps/web/src/lib/duck.ts:20`, `:84`); desktop exposes local paths through its shell command (`apps/desktop/src-tauri/src/query.rs:7`).
- **Call surface:** UI SQL input → query adapter → DuckDB → typed columns/tables. The desktop red line restricts local files to read-only `SELECT`/`WITH` SQL (`apps/desktop/src-tauri/src/query.rs:83`).
- **Configuration input:** file inputs, table naming rules, SQL text, and row/output limits supplied by the shell.
- **Lifecycle:** register/load → execute query → shape result → unregister or keep for the session. This layer never writes source configuration or experimental truth.

## Why the boundaries are split this way

1. **LAY-001 — Keep simulation logic independent of transport.** `sandtable-core` states its no-I/O, no-wall-clock rule at `crates/sandtable-core/src/lib.rs:3`, and its dependency list is limited to serialization/error support at `crates/sandtable-core/Cargo.toml:8`. This lets CLI, WASM, Python, MCP, and desktop call one tested core instead of duplicating simulation behavior.
2. **LAY-002 — Separate accepted text from compiled semantics.** YAML becomes a registry-checked tree before typed deserialization at `crates/sandtable-core/src/scenario.rs:98`, while the runtime consumes the compiled `SimConfig` at `crates/sandtable-core/src/config/mod.rs:36`. Experiments can therefore share one validation discipline without turning raw YAML into a runtime interface.
3. **LAY-003 — Make determinism an explicit kernel contract.** `EventQueue` orders by `(tick, sequence)` so same-tick scheduling remains FIFO (`crates/sandtable-core/src/kernel.rs:67`), and keyed RNG derives replicate streams from the seed (`crates/sandtable-core/src/rng.rs:24`). Mixing this with UI or I/O code would make replication and debugging depend on accidental execution order.
4. **LAY-004 — Isolate statistics from scenario mechanics.** Comparison is defined over result samples and metric statistics at `crates/sandtable-core/src/experiment.rs:120`, while sweep specs expand separately at `crates/sandtable-core/src/sweep.rs:174`. Changing combat, economy, or gacha rules does not require changing confidence/decision logic.
5. **LAY-005 — Own interchange formats at a boundary.** Export and engine-contract code define artifact shapes and validation separately from execution (`crates/sandtable-core/src/export.rs:13`; `crates/sandtable-engine/src/contract.rs:35`). Consumers can read stable files without importing kernel internals or re-running a simulation.
6. **LAY-006 — Keep bindings as capability facades.** WASM forwards validated calls to native functions instead of adding a second implementation (`crates/sandtable-wasm/src/lib.rs:3`), and desktop invokes core directly (`apps/desktop/src-tauri/src/lib.rs:3`). Transport, budgets, progress, and serialization stay host-specific and replaceable.
7. **LAY-007 — Separate short-lived processes from persistent UI sessions.** The CLI dispatches one argv command and dispatches (`crates/sandtable-cli/src/main.rs:87`), whereas the Web Workbench restores persisted jobs and drafts in `localStorage` (`apps/web/src/workbench/state/projectDoc.ts:672`). A resident UI state machine has cancellation, retry, and protocol-version needs that a one-shot command does not.
8. **LAY-008 — Put query behind a load/execute boundary.** Browser query registers CSV/Parquet buffers into DuckDB tables at `apps/web/src/lib/duck.ts:84`; desktop constrains local-file SQL to read-only `SELECT`/`WITH` at `apps/desktop/src-tauri/src/query.rs:83`. This contains arbitrary SQL access without giving analysis code authority to mutate source artifacts.

## Shell contract matrix

The five shells forward the same kernel, but each owns its own load entry,
defaults, error surface, and budget (recorded 2026-11-09, I-038). Changing any
cell is a contract change: update this table in the same commit.

| Shell | Load entry | `replicates` default | Error surface | Budget gates |
| --- | --- | --- | --- | --- |
| CLI | `scenario::load_str` everywhere | `simulate --replicates` = 1; `sweep --replicates` optional override | stderr, `配置错误:` / `参数错误:` prefix, exit code 2 for config errors | `MAX_CLI_REPLICATE_DAYS` (replicates × days) |
| WASM (web) | validate: `load_config_str` (accepts experiment YAML); run: `load_str` (scenario only) | required, passed by the JS caller | string rejection, same prefixes | `MAX_REPLICATES = 64`; sweep candidates × replicates ≤ 200 |
| Desktop (Tauri) | validate: `load_config_str`; run: `load_str` | required (`run_simulation(yaml, replicates, on_progress)`) | `Err(String)`, same prefixes | `MAX_DESKTOP_REPLICATE_DAYS` (replicates × days); per-run replicates upper bound aligned with WASM 64 (ST-AUD-11 / I-011) |
| Python | `scenario::load_str` | `replicates = 1` (`pyo3(signature)`) | `ValueError` | `MAX_PY_REPLICATE_DAYS` (replicates × days); `MAX_PY_SIM_WORK` (players × days × replicates) |
| MCP | `scenario::load_str` | required (tool schema) | tool-level error, message passthrough | `run` ≤ 4096 replicates; `plan_sweep` ≤ 1000 simulations; analyze results JSON ≤ 64 MiB |

Error-shape note: every shell prefixes kernel config errors with `配置错误:`
(`参数错误:` for argument validation) at the single `load` seam, then its
transport maps them — CLI to exit-code-2 stderr, Python to `ValueError`, MCP
to a tool-level error whose message passes through unchanged, WASM and desktop
to string rejections. The MCP docs' "passthrough" claim means the shell does
not rewrite kernel messages; the prefix is added once in `load`.
`to_tool_result` serializes each tool payload and reports a serialization
failure as an internal error rather than an empty string (I-038).

## Glossary

The companion term table is in [28 · Glossary](./28-glossary.md).
