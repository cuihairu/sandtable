# sandtable Game Engine Adapter Design

[English](engine-adapter-design.en.md) | [中文](engine-adapter-design.md)

**Status: decided via patrol delegation and landed.** All five decision points were decided per §5.1; phases 0–2 are fully implemented in `crates/sandtable-engine` (2026-10-14): contract export + reference importer + backflow convention. Contract specification in §7.
Supporting engineering evidence: the cross-platform CI chain is in place (2026-10-13, `desktop-package.yml` three-platform matrix actually runs the bundler), see §4.

## 0. Positioning (carries over existing architecture terms)

- The sandtable's core asset is **configuration semantics** (seven concepts + value tables + formulas/curves + behavior config) — not any engine's runtime.
- Goal: **configure once, reuse on the engine side** — parameters and curves validated inside the sandtable can be handed to the engine side in machine-readable form, reducing drift from "one set of numbers in the sandtable, another on the live build".
- What we do not do: no engine-side runtime, no copy of core logic into the engine, no letting the engine become a reverse dependency of core. The engine is a **consumer**, not an isomorphic implementation.

## 1. Requirement Scenarios (by priority)

1. Sandtable-validated numbers (drop rates, growth curves, gacha expectations) sync to the engine side so designers do not re-enter them.
2. Reverse validation on the engine side: before changing an engine parameter, first check in the sandtable whether the distribution is healthy.
3. Real engine run results flow back and are compared against the sandtable distribution as an A/B check (depends on the scenario 1 contract).
4. Multiple engines in parallel (one sandtable config fed to two engines for a selection comparison).

Scenarios 1–3 need a contract that "can be produced"; scenario 4 requires the contract to be **engine-agnostic** — which decides §2's recommendation.

## 2. Form Comparison and Decision

| Form | Approach | Upside | Cost | Verdict |
| --- | --- | --- | --- | --- |
| **A. Engine-agnostic JSON contract** | Define a neutral JSON schema, export the sandtable config; each engine writes **its own importer** | One export reused across engines; the contract is versionable, diffable, committable; zero engine dependency in the sandtable | One importer per engine wired up (thin, but real work) | **Recommended**. The sandtable stays engine-agnostic and only the contract needs to be stable; the importer is thin engine-side glue and can be community-owned |
| B. Built-in per-engine importer | sandtable generates Unity/Unreal assets directly (scriptable/scene) | Zero engine-side glue | The sandtable is pinned to engine APIs and breaks on every upgrade; each engine means another full round of work; core is forced to take platform dependencies | Not done. Violates §0 positioning; maintenance cost grows linearly with the engine count |
| C. Engine reads the sandtable source dir | Engine reads the `*.yaml` / `*.json` config directory directly | Zero conversion | No contract version, no validation; paths and naming become implicit conventions | Not recommended. Usable as a temporary bridge for scenario 1, not as a contract |

**Decision: go with A.** Engine-side importers are maintained by the engine side or by delegation; the sandtable only supplies the contract and (optionally) a reference importer.

## 3. Contract Surface (option A details)

1. **Export scope**: only the sandtable semantics layer — value tables, formulas/curves, loot tables, gacha config, behavior config. No UI, layout, animation or other engine-side concepts; the sandtable does not pretend to produce what it never had.
2. **Version field**: the contract carries `schema_version`; semantic changes are additive; removals or redefinitions require a major bump plus a migration note.
3. **Determinism**: export output has stable ordering (fixed key order, fixed list order) so diffs and code review are meaningful — consistent with core's existing determinism discipline.
4. **Validation**: `validate_config` runs through the same-source check before export, so we never emit a contract "the sandtable itself cannot run"; `config_hash` ships with the contract so the engine side can point back at a sandtable run result.
5. **Reference importer**: optionally provide a pure JSON→data reference implementation (the engine side may roll its own), used for examples and regression.
6. **No reverse write-back**: the contract is a one-way sandtable→engine output; backflow (scenario 3) uses a separate backflow file and never writes back into the contract.

## 4. Landing Point (confirmed per §5.1 decision 3: standalone crate)

- **Landing point**: standalone `sandtable-engine` crate (thin shell, same pattern as `sandtable-python`: core path dependency, exporter as pure function, covered directly by cargo test) vs. a feature-gated CLI subcommand — **decided: standalone crate**, keeping core untouched;
- **Feature gate**: not compiled into the main CLI binary by default (same feature discipline as arrow / parquet), with CI build and test gates added;
- **Cross-platform CI (set up 2026-10-13)**: `.github/workflows/desktop-package.yml` runs the bundler chain on a three-platform matrix (ubuntu-24.04 / windows-2025 / macos-15) — an adapter layer as a standalone crate can reuse the same matrix as its build gate; a WASM artifact form (exporter is a pure function and would compile for wasm32 in theory) could reuse it too, with no new workflow needed. No new CI entry is added now; the reuse point is only registered;
- **WASM gate**: the exporter is a pure function with no platform binding; if shipped in WASM form it must pass core's wasm32 compile gate (existing CI already covers the same discipline).

## 5. Decision Points (decided 2026-10-14, see §5.1; the original pending-sign-off record is kept)

1. Which target engine (decides schema trade-offs and whether a reference importer is needed);
2. Contract schema version start and naming domain (package name / file extension / JSON naming style);
3. Landing point: standalone `sandtable-engine` crate, or a feature-gated CLI subcommand;
4. Whether the sandtable repo maintains the reference importer (involves long-term maintenance responsibility);
5. Whether scenario 3 backflow enters phase 1 (affects whether the contract must reserve back-reference fields).

## 5.1 Delegation Record (patrol R1, 2026-10-14)

All five are product-direction / design trade-offs with clear recommendations; none touch version release, License, paid features, asset licensing, or human acceptance. Decided under patrol delegation:

1. **Target engine: none preset.** Option A's thesis is engine-agnostic (§2), so the schema is chosen for a "neutral semantics layer": land the contract first, then wait for a real engine integration — no fields specialized for a hypothetical engine.
2. **Naming domain: schema_version starts at `"0.1.0"`; package name `sandtable-engine`; extension `.engine.json`; JSON keys snake_case** (matches the sandtable YAML config key style, unambiguous for cross-language consumers).
3. **Landing point: standalone `sandtable-engine` crate** (same thin-shell pattern as `sandtable-python`: core path dependency, exporter as pure function, covered directly by cargo test). A CLI subcommand is deferred until a real integration request appears.
4. **Reference importer: maintained by the sandtable repo.** Loading is the contract regression oracle (an export must be reloadable and equivalent — `tests/roundtrip.rs`, 19 tests); isomorphic to the py_parity / web_parity precedent.
5. **Backflow: included in phase 1.** `config_hash` already ships with the contract, and the backflow file only points back at the hash plus metric points — very low cost, and it is the only channel for scenario 3 (A/B comparison); skipping it leaves scenario 3 permanently absent.

## 6. Phasing (all complete, 2026-10-14)

- **Phase 0**: contract v0 draft (export schema + example artifact + validation); export only, no engine wired up. ✅
- **Phase 1**: reference importer + regression tests (export artifacts reload and validate equivalently). ✅
- **Phase 2**: scenario 3 backflow file convention and validation (approved for inclusion). ✅

Implementation: `crates/sandtable-engine` (contract.rs exporter + importer.rs reference importer + backflow.rs backflow convention; tests/roundtrip.rs, 19 tests; examples/export_pokemon.rs minimal runnable; README.md with the three-step integration guide).

## 7. Contract Specification v0.1 (sandtable-engine landing terms)

- **Top level**: `kind` (`sandtable-engine-contract`) / `schema_version` (`0.1.0`) / `config_hash` (64 hex chars, shipped with the contract) / `model`.
- **model surface**: warrior, whale_gain_mult, combat, dungeon (geometric parameters always emitted + optional tier_table), behavior (three cohorts), training (optional), progression, formula, churn, loot (optional), gacha (optional).
- **Effective-value export**: scalars with unambiguous defaults export their effective values (`damage_model` default → `"difference"`, `ratio_k` default → `1.0`); missing gold/xp inside a tier_table row is truncated to an effective integer per `reward · growth^tier` (same formula as core `monster_of`).
- **Determinism**: field order = declaration order, BTreeMap key order fixed; `config::validate` runs through the same-source check before export, so we never emit a contract the sandtable itself cannot run.
- **Backflow**: `kind`=`sandtable-engine-backflow` + `config_hash` back-reference + metric points (keys must pass `MetricKey::parse`, means must be finite, CI lower bound ≤ upper bound); one-way, never written back into the contract.

### Three-Step Integration

1. **Get the contract**: YAML scenario → `export_from_yaml` (or `export(&SimConfig)`) → write `*.engine.json`.
2. **Validate + load**: `importer::load(json)` checks kind / schema_version / the 64-char hash / domain values (hit rate ∈ [0,1], tier_table row count == tiers, etc.).
3. **Backflow comparison**: the engine side writes a backflow file (pointing back at the same `config_hash`) → `backflow_load` validates → `backflow_matches` compares the contract against it as an A/B check.
