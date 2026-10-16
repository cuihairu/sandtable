---
title: 19 · Testing Strategy
---

[English](19-testing.en.md) | [中文](19-testing.md)

# Testing Strategy

## Layered Overview

| Layer | What it guarantees | Criterion |
| --- | --- | --- |
| Unit tests | Components behave correctly | Assertions |
| **Analytic cross-check** | **The simulator is not miswritten** (mechanism correctness) | Simulation mean falls inside the closed-form CI |
| Deterministic snapshot | Reproducible on the same version and platform | Bit-for-bit identical |
| Statistical regression | Distributions unchanged across versions / refactors | Mean ± CI compatible |
| Case KPI level assertions (**built**, 2026-10-15) | Case value changes do not silently drift balance levels | Anchor value ±10% band |
| Parallel determinism (**built**, 2026-10-15) | Thread count does not affect results | Bit-for-bit identical |
| Performance smoke (**coarse-grained built** + criterion fine benchmarks built, 2026-10-15) | The compute budget does not drift | Duration threshold / baseline comparison |
| Generated-asset freshness (**built**, 2026-10-15) | Charts committed into the repo stay consistent with reality | Per-edge reconciliation against the subscription matrix |

**The analytic cross-check is the most powerful layer**: unit tests prove "each part meets spec"; analytic solutions prove "the answer the whole machine computes is objectively right".

## Unit Tests

Coverage: RNG derivation (same key → same value; any differing key component → different value), Clock / event queue (ordering), formula evaluation (against hand computation), combat resolution, economic aggregation, progression curves, metric aggregators (against naive implementations).

## Analytic Cross-Check

The most powerful way to confirm the simulator is not miswritten: construct scenarios that have **closed-form solutions** and compare simulation results against mathematical expectations.

Example 1 — expected damage: with hit probability p and hit damage constant at a − d, the expected total damage over N battles is N·p·(a−d), and the variance is closed-form computable. The simulation mean must fall within the closed-form value ± 3σ.

Example 2 — expected income: a player runs exactly k dungeon runs per day with expected drop g, so expected total gold income over 30 days is 30·k·g. Cross-check the same way.

Example 3 — churn model: under a constant churn probability p_c, expected D7 retention is (1−p_c)⁷ (cross-checked after aligning with the simulation's accounting).

Requirement: at least one analytic-solution test enters Phase 1 acceptance ([roadmap](./18-roadmap.en)); whenever a new system is added, every mechanism with a closed-form solution must ship with a cross-check test.

## Determinism Tests: Snapshot vs Statistical Regression

::: warning Don't mix the two layers
**Snapshot tests**: same version + same platform + same seed → results **bit-for-bit identical**. Implemented as hash snapshots of the result summary (normalized JSON), compared in CI; any byte-level deviation is a regression.

**Statistical regression**: across versions or after refactors, floating-point results **are allowed** to differ (optimizers and dependency upgrades can both change floating-point details), so the comparison shifts to whether metric means ± CI are compatible.

| Scenario | Which layer |
| --- | --- |
| Daily CI (same platform) | Snapshot (bit-for-bit) |
| After upgrading the Rust version / dependencies / refactoring | Snapshot update + statistical regression to confirm the distribution has not drifted |
| native ↔ wasm comparison (same config, same seed) | Statistical regression (basic arithmetic is bit-for-bit identical; transcendental functions allow ULP-level differences — see [deterministic RNG](./06-deterministic-rng.en)) |
| Cross-platform comparison | Statistical regression (floating point does not promise cross-platform bit-for-bit identity) |
:::

## Parallel Determinism Tests

The same experiment runs under `rayon` with thread counts = 1 / 4 / all cores, and the result summaries must be bit-for-bit identical. This is the guard test for the [parallel determinism rules](./06-deterministic-rng.en) (ordered containers, fixed reduction).

**Built** (2026-10-15): `crates/sandtable-cli/tests/parallel_determinism.rs` runs the same experiment for `sandtable sweep` (the only surface parallelized with par_iter across candidates) under `RAYON_NUM_THREADS` = 1 / 4 / all cores; `candidates.csv` and `summary.csv` come out bit-for-bit equal — `run_candidate` is a pure function, `collect` preserves order, and the sampling stream is bound to base_seed independent of threads; it enters CI with `cargo test --workspace`.

## Monte Carlo Statistical Tests

End-to-end properties involving randomness use statistical assertions: after multi-seed reruns, check whether means, variances, confidence intervals, and quantiles fall within theoretical or historical baselines. Bit-for-bit floating-point identity is **not required** for these tests.

## Case KPI Level Assertions

Golden snapshots anchor the **default configuration** (kernel behavior changes → CI red), not case configurations; the level assertions in `crates/sandtable-cli/tests/cases.rs` fill that gap: against `examples/pokemon.yaml` (200 players × 30 days × 1 replicate, deterministic) they anchor the absolute levels of churn / retention_d7 / win_rate / mean level with a ±10% tolerance, and retention_d7 takes the docs-21 hard-constraint floor of 0.9 rather than a band (a −10% dip from 0.985 would cross the health line). **Changing case values = an intentional change**: the anchors must be updated in sync, so the balance-surface shift shows up in review instead of being caught by human review alone. The anchor convention is in [real-config validation](./21-pokemon-case.en).

## Performance Guards

**Built (coarse-grained, 2026-10-15)**: `crates/sandtable-cli/tests/perf_smoke.rs` — the full pipeline of 10,000 players × 30 days (simulate + export) completes in < 120s in debug (roughly 50× headroom over the measured 2.4s baseline; it only catches order-of-magnitude regressions, and shared-runner jitter stays out of the verdict); it enters CI with `cargo test --workspace`.

**Built (criterion fine benchmarks, 2026-10-15, adopted on the user's decision)**: `crates/sandtable-core/benches/hot_paths.rs` covers four hot paths — formula evaluation (`formula_eval_xp_needed`, evaluating the default xp_needed formula on typical variables), keyed random derivation (`rng_derive_u64`), analytic combat resolution (`combat_settle_battle`), and the full event-loop pipeline including online aggregation (`sim_pipeline_200x30`, same convention as the case KPI anchors: 200 players × 30 days × 1 replicate).

**Run** (from the repo root, manually triggered, not part of the regular CI gate — benchmarks are slow and shared runners are noisy):

```sh
cargo bench -p sandtable-core --bench hot_paths
```

**Interpreting output and the regression criterion**: each run prints a `[lower mean upper]` confidence interval; after the first run criterion keeps a baseline automatically, and later runs give `change: [x% y% z%] (p = …)` with a direction verdict. The rule: **a mean change >10% with p < 0.05 counts as a regression signal**, and only as a triage signal, never a gate (shared-machine noise of ±10-20% is common, and a single output read alone will mislead). For rigorous comparisons, manage baselines explicitly: before a change, `cargo bench -p sandtable-core --bench hot_paths -- --save-baseline before`; after the change, compare with `--baseline before`; re-record the baseline after intentional changes to hot-path structure (a new System / a changed aggregation path). The HTML report lives in `target/criterion/report/`.

**Dependency policy**: criterion is only a dev-dependency of `sandtable-core` and never enters the release dependency tree; `cargo test --workspace` compiles but does not run the benchmarks (the compile cost is amortized by CI rust-cache).

## Generated-Asset Freshness Guard

"Generated by program" only guarantees the **generator** shares a source with reality — not that **the copy committed into the repo** was regenerated: add a System or change the subscription matrix but forget to run the example, and the chart silently goes stale while the body text still reads "same source as the code". `crates/sandtable-core/tests/doc_assets.rs` closes this gap — it reverse-parses the row grid of every subscription edge in `docs/assets/systems/system-graph.svg` and reconciles each edge against the live `system_registry` (missing box labels, mismatched edge counts, or re-pointed subscriptions all turn red), the `crate::systems` module referenced by the bottom note must really exist, and the failure message gives the rerun command directly.

::: tip The honest boundary of coverage
The formula curve charts (`docs/assets/formulas/*.svg`) are **not under the guard**: the coordinate-mapping logic exists only in `formula_curves.rs`, and reproducing a reverse-parser inside the test would be a second implementation guaranteed to drift. Their freshness still relies on the generator panicking (an expression that fails to compile fails the run) + manual redraws.
:::

## CI Integration

GitHub Actions: every push runs unit + snapshot + analytic cross-checks, plus the **`cargo check --target wasm32-unknown-unknown` platform gate** (core pulling in a platform dependency fails immediately, see [simulation kernel](./04-kernel.en)); statistical regression is triggered manually on dependency upgrades and before releases; the parallel determinism guard, the coarse-grained performance guard, and the generated-asset freshness guard are built (they run with the full test suite — see the three sections above); the criterion fine benchmarks are built but **do not enter the regular CI gate**, triggered manually via `cargo bench -p sandtable-core --bench hot_paths` (see the performance guards section).
