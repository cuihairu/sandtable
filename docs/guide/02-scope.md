---
title: 02 · Product Boundaries
---


# Product Boundaries

## What Phase 1 Builds

- Configuration-driven game model
- Long-horizon time advancement (discrete events primarily, see the [Time model](./05-time-model.md))
- Player / actor simulation
- Combat (starting with analytic resolution)
- Resource economy
- Progression systems
- Player cohort segmentation
- KPI / metrics (formulaically defined, see [KPI and metrics](./13-kpi-metrics.md))
- Monte Carlo (multi-seed reruns)
- Parameter sweep
- Experiment result comparison
- Parameter sensitivity analysis
- Reproducible experiments
- JSON / CSV reports (Parquet behind a feature flag, see [Data output](./09-data-output.md))

## Product Forms: One Kernel, Three Shells

Sandtable plans three run forms sharing **the same Rust Core** — there is no JS re-implementation:

| Form | Position | Phase |
| --- | --- | --- |
| **CLI** | CI, large-scale experiments, developer automation | MVP (first delivery form) |
| **Web** (WASM + React) | Small-to-medium simulations in the browser, "try it in your browser" demos and teaching | Phase 6 |
| **Desktop** (Tauri 2) | Primary form for Windows and similar platforms: local files + native analysis, no Node / Python backend | Phase 7 |

Three shared constraints:

- **Local-first**: configuration, experiments, simulation, results, and analysis all happen locally — no account, server, database, or network needed;
- **Single kernel**: CLI / Web / Desktop all link `sandtable-core`; writing a separate JS simulation for the web is strictly forbidden — otherwise "web results differ from desktop results" will happen sooner or later, and the reproducibility promise is broken;
- **Architecture first, features later**: from Phase 1 the Core has been hard-constrained to be "compilable for WASM, reusable by Tauri, and decoupled from the analysis engine" (platform boundary in the [Simulation kernel](./04-kernel.md)); Web / Desktop have landed per phases 6 / 7.

## Follow-up Directions

- Game engine Adapter (**decided via delegation and landed**, patrol R1, 2026-10-14): an engine-agnostic JSON contract in `crates/sandtable-engine` (export + reference importer + backflow convention); decision record and spec in [Engine Adapter design](../engine-adapter-design.md))
- CI balance regression (**decided via delegation and landed**, patrol delegation, 2026-10-15): case KPI level assertions in the CLI tests; decision record in [Direction draft](../方向项定义草案.md) §4)
- Visualization system graph & designer workflow (**decided via delegation and landed**, patrol delegation, 2026-10-15): program-generated system graph in chapter 04, designer workflow tour in chapter 21; decision record in [Direction draft](../方向项定义草案.md) §4)
- Bayesian / GP optimization (on demand; Evolutionary / Pareto and the random-forest surrogate have landed, see [Parameter sweep](./12-parameter-sweep.md))

## Explicitly Not in the MVP

Keeping the project from losing control at the start:

- General-purpose MMORPG engine
- Game server runtime
- Full Machinations clone
- Unity / Unreal / Godot editor
- LLM players, reinforcement-learning players
- Complex behavior-tree editor
- Online SaaS, multi-user collaboration platform
- Complex automated-optimization UI

::: tip Core principle
**Get the Simulation Kernel and Experiment Loop right first, then build the product interfaces.**
:::

## Relation to the Modeling Assumptions

The PvP, guilds, and markets in the "not doing" list were not omitted casually — they correspond one-to-one with the modeling assumptions in [Project positioning](./01-positioning.md): independent players, PvE only, economy as aggregates. These three assumptions together form the MVP's feasible set; items beyond them (inter-player interaction) are architecture-level changes, filed as follow-up directions rather than MVP patches.

## License

The project ships under **Apache-2.0**, already established with the repo. Third-party dependency selection must consider license compatibility — for example evalexpr moved to AGPL-3.0 from 13.x, which is incompatible with Apache-2.0 projects, so it was excluded from formula-engine candidates (details in [Configuration and formula engine](./07-config-formula.md)).
