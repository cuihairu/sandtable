---
title: 17 · Project Structure
---


# Project Structure

## Crate Layout

The MVP splits into just two crates (avoiding over-engineering; rationale in [tech stack](./08-tech-stack.md)); platform shells are added per phase, with directories reserved up front:

```text
sandtable/
├── crates/
│   ├── sandtable-core/
│   │   └── src/
│   │       ├── config.rs      # Config load / validate / normalize / config_hash
│   │       ├── registry.rs    # Parameter registry (path / kind / default / desc)
│   │       ├── scenario.rs    # YAML scenario and experiment file loading (scenario+model/sweep/optimize sections)
│   │       ├── formula.rs     # Bounded expression evaluator (compiled at load time)
│   │       ├── rng.rs         # Keyed random derivation (SplitMix64)
│   │       ├── kernel.rs      # Clock / EventQueue / System trait (discrete-event skeleton)
│   │       ├── world.rs       # World and entity storage
│   │       ├── systems/       # Built-in game systems (behavior / combat / progression / churn / gacha)
│   │       ├── metrics.rs     # RunMetrics and online aggregation
│   │       ├── sim.rs         # Main simulation loop (event-driven)
│   │       ├── experiment.rs  # Replicates, CRN paired comparison, statistics
│   │       ├── sweep.rs       # Grid / random / LHS sweep engine
│   │       ├── sensitivity.rs # OAT elasticity
│   │       ├── recommend.rs   # Single-axis interpolation recommendation
│   │       ├── optimize.rs    # Evolutionary + Pareto optimization
│   │       ├── surrogate.rs   # Random-forest surrogate (read-only over sweep artifacts)
│   │       ├── disttest.rs    # χ² distribution test (data plane of the disttest subcommand)
│   │       ├── export.rs      # Output rendering (JSON / CSV / human-readable; Arrow lives in export/arrow.rs)
│   │       └── lib.rs
│   ├── sandtable-cli/
│   │   └── src/main.rs       # clap subcommands, thin wrapper over core (MVP)
│   ├── sandtable-wasm/       # wasm-bindgen thin bindings (landed: validate_config / run_simulation; native pure functions carry the logic, the wasm layer only wraps — equivalence with the CLI locked by tests)
│   ├── sandtable-python/     # pyo3 thin bindings (landed: load / run / sweep / recommend / params read-only surface + the phase-3 day-granularity read-state callback run_with_day_hook; same two-layer structure as wasm, independently implemented, wheel built with maturin, py_parity locked against the CLI)
│   ├── sandtable-engine/     # Engine-agnostic JSON contract thin shell (landed: contract export with the effective-value discipline / reference importer / backflow convention; core path depends on pure functions, roundtrip regression locked, examples/export_pokemon.rs minimal runnable)
│   └── sandtable-mcp/        # MCP server in Rust (landed: official rmcp SDK over stdio, calls core natively — no wasm/Node hop; tools sandtable_validate / sandtable_run / sandtable_plan_sweep / sandtable_analyze / sandtable_calibrate; kernel errors pass through as tool-level errors, interaction budget caps reject oversized runs)
│
├── apps/
│   ├── web/                  # React + TS + Vite (landed: config editing → local simulation → KPI/curves/cohort table, zero chart libraries; project multi-config selector landed)
│   └── desktop/              # Tauri 2 shell (Phase 7: src-tauri + direct core path connection, all 7 commands wired, native query already in the UI; Linux local machine first)
│
├── examples/                 # Scenario and experiment YAML (pokemon / gacha-pity / pokemon-sweep etc.)
│   └── python/               # Sidecar-mode examples (phase 0: kpi_report / daily_curves / parquet_analysis; zero-Rust-dependency fallback path)
├── docs/                     # This documentation site (VitePress)
├── scripts/                  # scripting-design.md + scripting-perf-report.md (phase 3 measurements) + templates/ (phase 2 official orchestration templates) + desktop_smoke.sh (headless desktop smoke, same recipe as the CI desktop-smoke job)
├── .github/workflows/        # CI (incl. the wasm32 gate) and Pages deployment
└── README.md
```

## Dependency Direction

```text
sandtable-cli     ─┐
sandtable-wasm    ─┼→ sandtable-core
sandtable-python  ─┤
sandtable-engine  ─┤
sandtable-mcp     ─┤
apps/desktop      ─┘
Inside core: experiment / sweep / optimize → sim → systems → world/kernel
config / scenario / registry / formula are depended on by every layer
The analysis layer (DuckDB / Arrow) is called only by shells, never enters core
```

Core depends on no shell; systems does not depend on experiment; kernel depends on nothing above it.

## Platform Boundary Rules

| Rule | Where it lands |
| --- | --- |
| `cargo check --target wasm32-unknown-unknown` in CI from Phase 1 on | [Roadmap](./18-roadmap.md) Phase 1 |
| core forbids `duckdb` / `web-sys` / `tokio` / file and network I/O / wall clock | [Simulation kernel](./04-kernel.md) platform boundaries |
| Parallelism (rayon) is a feature; core algorithms are serial and deterministic; degrades to single thread under WASM | [Tech stack](./08-tech-stack.md) |

## Module Responsibility Cheat Sheet

| Module | Responsibility | Key constraint |
| --- | --- | --- |
| config / scenario | YAML loading, validation, normalization, config_hash | Same-semantics config, same hash |
| registry / formula | Parameter registry, formula evaluation | Unknown paths get edit-distance suggestions |
| rng | (seed, actor_id, day, event_index, purpose) derivation | Pure function, no shared state |
| kernel / world | Discrete-event queue, entity storage | Ordered containers (BTreeMap / IndexMap) |
| systems | Combat / economy / progression / reward / behavior / pity | Deterministic; keyed random consumption |
| metrics | Online aggregation (day-granularity counters / snapshot-day quantiles) | No per-actor detail is persisted |
| experiment / sweep / optimize | Orchestration, comparison, sweeping and optimization | Statistical unit = replicate |

## Naming Audit Conclusions (2026-10)

| Platform | Conclusion |
| --- | --- |
| GitHub | `cuihairu/sandtable` free (this repo) |
| crates.io | No conflict recorded so far for the `sandtable` prefix; **recheck before any official release** |
| PyPI | `sandtable` is taken; the Python binding **has been named separately (landed)** (2026-10-11 phase 1: distribution name `sandtable-sim`, import name `sandtable_sim`, not occupying the sandtable name; **recheck once more per this chapter's discipline before official release**) — carrier and phasing in [scripts/scripting-design.md](https://github.com/cuihairu/sandtable/blob/main/scripts/scripting-design.md) |

The built-in system modules are named `systems`; if they ever become a standalone crate it will be `sandtable-systems`, not `sandtable-model` (avoids confusion with the conceptual Model — see [tech stack](./08-tech-stack.md)).

## Divergence from the Original Plan

The original plan listed six crates (core / model / config / experiment / report / cli). Reasons for the merges and adjustments:

- At MVP scale, config and experiment don't justify standalone crates — splitting only adds interface maintenance cost;
- `sandtable-model` collided with the conceptual Model; its content (combat, economy systems) is actually systems;
- report becomes standalone when a real need appears in the HTML phase (Phase 5);
- Web / Desktop are shells (apps/), not crates — a shell's job is to carry core onto a target platform and carries no simulation semantics.

Expansion principle: **split when there is a real reuse or compile-isolation need**, never preemptively.
