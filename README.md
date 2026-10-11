[English](README.md) | [中文](README.zh.md)

<div align="center">

<img src="docs/public/logo.svg" width="64" alt="Sandtable logo" />

# Sandtable

[![Docs](https://img.shields.io/badge/docs-online-2c6e63)](https://cuihairu.github.io/sandtable/)
[![Deploy Docs](https://github.com/cuihairu/sandtable/actions/workflows/deploy-docs.yml/badge.svg)](https://github.com/cuihairu/sandtable/actions/workflows/deploy-docs.yml)
[![CI](https://github.com/cuihairu/sandtable/actions/workflows/ci.yml/badge.svg)](https://github.com/cuihairu/sandtable/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

<!-- crates.io / codecov badges to be added after the first release -->

**Sandtable is a configuration-driven simulation and experimentation framework for game systems.**

</div>

**Sandtable** is a configuration-driven simulation and experimentation framework for game systems. It is used to simulate players, combat, the economy, and progression over long time horizons, and to support game-balance work through experiments and metric analysis.

## Positioning (read this first)

- **Relative comparison, not absolute prediction.** Player behavior probabilities are set by hand, so the absolute numbers produced by the simulation are not to be trusted on their own. Sandtable's value lies in comparison: the difference between parameter A and parameter B when both run the same experiment (e.g. ΔD7 Power, ΔWinRate), together with confidence intervals.
- **Modeling assumptions:** at the MVP stage, players are mutually independent, only PvE content exists, and economy metrics are aggregates of resource income and spending across all players. This is the largest modeling assumption, and it drives the "parallelize by player" architecture. Introducing markets, PvP, or guilds would change the architecture and is out of MVP scope.
- **Forms:** CLI (MVP) / Web (Rust→WASM + React) / Desktop (Tauri 2); all three forms share the same Rust kernel; local-first, no server. Result data goes through Arrow / Parquet, with DuckDB (native and DuckDB-Wasm) as the analysis layer.

## Current status

**The planned slices through Phase 8 are implemented** (crates: `sandtable-core` + `sandtable-cli`; all three forms — CLI, Web (Rust→WASM + React) and a Linux-first Desktop shell (Tauri 2) — link the same kernel, which has zero platform dependencies and continuously passes the `wasm32-unknown-unknown` compile gate):

- Keyed RNG: derived directly from `(seed, actor_id, day, event_index, purpose)`; combat uses explicit sequence keys so that A/B arms share keys and remain comparable (CRN)
- A YAML-configured RPG loop: behavior → resolved combat → rewards → progression → stagnation → churn, advancing as day-granularity discrete events
- Experiment statistics: the replicate is the statistical unit; t-distribution CI₉₅, paired differences + effect size d, and CI verdicts under the PASS/BORDERLINE/FAIL convention
- Experiment layer: grid / random / Latin-hypercube sweeps, OAT sensitivity, interpolated single-axis recommendations, and optimization (evolutionary and Pareto multi-objective) backed by a random-forest surrogate model
- Online metric aggregation: retention / win rate / inflation / sink_ratio / power percentile snapshots, sliced by cohort; pulls-to-hit for pity-driven gacha
- Random-function extension: weighted tables (compile-time CDF), shuffling and weighted sampling without replacement, pity state machines, Box–Muller normals, and a chi-square `disttest` for distribution checks
- Reporting and exchange: single-file HTML reports, `.sandtable` project archives, a two-way CSV parameter table, and Arrow / Parquet behind a feature flag
- Testing: closed-form cross-checks, byte-for-byte determinism under the same seed, golden snapshots, and equivalence tests locking CLI ↔ Web (WASM) ↔ Desktop to one kernel

```bash
cargo install --path crates/sandtable-cli
sandtable simulate --players 10000 --days 30 --out out/     # single run
sandtable compare --attack-a 100 --attack-b 105 --replicates 12 --out out/  # A/B comparison
sandtable validate --days 30                                # validate parameters
```

A single run of 10k players × 30 days takes about 0.5 s (release build). The full plan lives in the documentation site (sources under [`docs/`](docs/)); for the roadmap see [18 · Roadmap](docs/guide/18-roadmap.md).

- Documentation site: https://cuihairu.github.io/sandtable/
- Local documentation build: `pnpm install && pnpm docs:dev`

## Documentation structure

The original plan was a single monolithic document (archived at `docs/计划-原始.md`), later split into 20 chapters, with four more chapters added for the Pokémon case study, the Web form, the genre matrix and the random-function extension. The mapping from chapters to the original plan:

| Chapter | Contents | Original plan |
| --- | --- | --- |
| [01 Positioning](docs/guide/01-positioning.md) | Core problem, modeling assumptions, relative-comparison stance | §1 |
| [02 Scope](docs/guide/02-scope.md) | What is included, what is excluded, license | §2 |
| [03 Core concepts](docs/guide/03-concepts.md) | The seven concepts, the Model/World split | §3 |
| [04 Simulation kernel](docs/guide/04-kernel.md) | World composition, execution loop, parallelism model | §4 |
| [05 Time model](docs/guide/05-time-model.md) | Layered nesting: discrete events + in-combat ticks | §4.1, §21 |
| [06 Deterministic RNG](docs/guide/06-deterministic-rng.md) | Keyed randomness, parallel determinism rules | §5 |
| [07 Configuration and formula engine](docs/guide/07-config-formula.md) | Parameter registry, config_hash, expression compilation | §6 |
| [08 Tech stack](docs/guide/08-tech-stack.md) | Selection table and dependency decision records | §7, §8 |
| [09 Data output](docs/guide/09-data-output.md) | JSON/CSV first; Parquet behind a feature flag | §9 |
| [10 CLI](docs/guide/10-cli.md) | Subcommands and output conventions | §10 |
| [11 Experiment pipeline](docs/guide/11-experiment-pipeline.md) | Full workflow and replicates | §11 |
| [12 Parameter sweep](docs/guide/12-parameter-sweep.md) | Grid / Random / Monte Carlo | §12 |
| [13 KPIs and metrics](docs/guide/13-kpi-metrics.md) | Metric formulas, online aggregation, CI-based verdicts | §13 |
| [14 Sensitivity analysis](docs/guide/14-sensitivity.md) | OAT elasticities (selected method) | §14 |
| [15 Balance recommendation](docs/guide/15-recommendation.md) | Interpolated intervals, confidence definitions | §15 |
| [16 MVP](docs/guide/16-mvp.md) | Minimal RPG loop, A/B comparison, acceptance criteria | §16, §17, §26 |
| [17 Project structure](docs/guide/17-project-structure.md) | Crate split and naming checks | §18 |
| [18 Roadmap](docs/guide/18-roadmap.md) | Vertical slices + verification nodes | §19 |
| [19 Testing strategy](docs/guide/19-testing.md) | Layered: closed-form checks, snapshots, statistical regression | §20 |
| [20 Design principles and vision](docs/guide/20-principles-vision.md) | Principles, product forms, vision | §22–§25 |
| [21 Real-configuration validation](docs/guide/21-pokemon-case.md) | Pokémon (Gen 1 Kanto) case study and the friction list | — |
| [22 Web](docs/guide/22-web.md) | Browser form, scale boundaries, query and export | — |
| [23 Genre × simulation functions](docs/guide/23-genre-simulation.md) | Six genre families vs. generic blocks / genre-specific gaps | — |
| [24 Random functions](docs/guide/24-random-functions.md) | Weighted tables, pity, normals, chi-square and staging | — |

## License

[Apache-2.0](LICENSE).
