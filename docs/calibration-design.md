# Real-Data Calibration Design (phase-two intake)

Status: **design prepared, not chartered** — this page is the in-repo half of todo item "真实案例二期 + 模型校准". The item stays **BLOCKED** on the user-side deliverables (real operating data + benchmark baseline); landing this design does not unblock it. Substitution red line: public numeric cases ([Pokémon case](./guide/21-pokemon-case.md) and friends) can never stand in for real ops data — they are structure references, not calibration inputs.

## 1. What calibration means here

Calibration = choosing the values of the model's **free numeric channels** so that the simulation's KPI outputs reproduce the observed real-world KPIs within stated tolerances. It is **not** model expansion: no new systems, no new mechanics, no KPI invented without a real-side observable to match (see [scope](./guide/02-scope.md)).

The free variables are exactly the `F64` / `U64` numeric slots of the params table (56 by default, 57 with loot configured — see [random functions](./guide/24-random-functions.md) §config surface). Structural parameters (weighted tables, formulas, pity layout) stay hand-authored; this keeps every fitted value sweepable and re-runnable through the existing experiment machinery.

## 2. Intake contract (the minimum that unblocks fitting)

Real-side data arrives as three CSV/YAML artifacts plus one optional. Column names are fixed so a loader can be written once; dates are calendar days, cohort indices are day-grain.

| Artifact | Columns (fixed) | Calibrates (existing KPI) |
| --- | --- | --- |
| `cohort_day.csv` (required) | `date, cohort_day, cohort, retained_players, active_players` | `retention_d3`, `retention_d7`, `churn_rate` |
| `economy_day.csv` (required) | `date, gold_granted_total, gold_spent_total, active_players` | `gold_per_player`; loot slice → `loot_gold_per_player` only if granted_total is separable by source |
| `meta.yaml` (required) | population, observation window days, cohort mix shares, win definition + `win_rate` series if tracked | anchors `win_rate`; documents the semantic alignment ("what counts as a win" real-side vs sim-side) |
| `gacha_pulls.csv` (optional) | `account_id, pulls_to_first_hit` | `gacha_pulls_to_hit` (only if the real case has gacha; the public closed-form reconciliation already covers the synthetic case) |

**Open mapping, decided only when data arrives**: `power_p50` (the final-day power p50) has no universal real-side observable (power is a model construct). If the real game has a progression proxy (level, stage, battle power), the mapping is fixed at intake time in `meta.yaml`; if not, the anchor is marked **unmapped** and excluded — never estimated from a public case.

A missing required artifact ⇒ its anchors are marked unmapped. Missing anchors narrow the fit; they never get substituted.

**Self-service contract readers landed (2026-10-27, todo「数据分析面」step ③)**: `scripts/templates/calibrate_win_rate.py` and `calibrate_economy.py` consume the `cohort_day.csv` / `economy_day.csv` / `meta.yaml` columns above to produce a per-anchor sim-vs-obs residual table (same ±10% + retention-floor-0.9 acceptance band as §3.4), for quick pre-fit checks. These are **not** the production loader — the MCP `sandtable_calibrate` loader (step ①) stays gated on real data and remains the authority once data arrives; the templates are a self-service start, verified only on synthetic self-consistent data (their residual mechanics, not any calibration claim).

## 3. Fit method (uses only what exists)

1. **Freeze structure** — hand-author structural params; free set = selected numeric channels recorded in the fit config (with bounds), so every step is reproducible by `sweep` / `optimize` alone.
2. **Coarse grid** — `sandtable sweep` over the free channels. Objective per candidate: `Σᵢ wᵢ · ((sim_midᵢ − obsᵢ) / obsᵢ)²`, with `sim_mid` the CI₉₅ midpoint and `wᵢ = 1 / rel_varᵢ` from the observed side's own confidence interval (a wide real-side CI naturally weighs less).
3. **Refine** — `sandtable optimize` (constraint-aware evolutionary; [parameter sweep](./guide/12-parameter-sweep.md)) seeded from the best grid point; the random-forest `surrogate` screens larger grids. GP stays rejected (2026-10-10 decision: no linear-algebra dependency, deterministic, interpretable — unchanged by this design).
4. **Accept or report honestly** — per anchor `|sim_mid − obs| / obs ≤ 10%` (same band as the CI balance regression), retention keeps its absolute floor 0.9 (a −10% dip off a high retention would cross the documented health line — same reasoning as `cases.rs`). Anchors that cannot be met are reported unmet with residuals; the model is not bent to force a pass.

Determinism: fixed seed set; a rerun of the same fit config yields bit-identical fitted values (the CI₉₅ / hash discipline of [data output](./guide/09-data-output.md) applies unchanged).

**Overfitting guard**: day-window hold-out — fit on the first ~70% of the observation window, judge on the tail. Curve-shaped series (retention decay, economy accumulation) make a tail hold-out the cheapest effective check; it needs no new machinery.

## 4. Decision points (delegated 2026-10-19, patrol clause; record also in [方向项定义草案](./方向项定义草案.md) §4)

| Decision point | Choice | Reason (one line) | Rejected |
| --- | --- | --- | --- |
| 1. Free variables | numeric channels only | keeps fitted values sweepable and the determinism story intact | free-form model edits inside the fit loop |
| 2. Fit machinery | existing `sweep` + `optimize` + RF surrogate | zero new dependencies; same pipeline as production experiments | GP surrogate (rejected 2026-10-10, unchanged); external optimizer crates |
| 3. Objective | weighted relative residuals on KPI midpoints | rates and gold differ by orders of magnitude; relative + observed-CI weights neutralize scale | absolute residuals (gold dominates); full likelihood/Bayesian fit (distributional assumptions the intake may not support — revisit with real data) |
| 4. Acceptance band | ±10% relative + retention floor 0.9 + tail hold-out | matches the CI balance discipline; no bespoke bands before seeing data | per-anchor bespoke tolerances invented pre-data |
| 5. Missing artifact | anchors marked unmapped | honesty over coverage | substituting public numeric cases (ledger red line) |

## 5. Explicitly out of scope

New KPIs without a real-side observable, model/system expansion, Web API, versioned release triggers, and the four user-reserved categories (version numbers / release, license, paid procurement, asset licensing) — none of these are calibration work.

## 6. Trigger

The item unblocks when the user hands over the §2 artifacts. Then the implementation order is: loader (CSV → obs table + `meta.yaml` parse) → fit-config surface (free set + bounds) → objective wiring into sweep/optimize scoring → acceptance report (per-anchor residuals table). Tests first at each step, per the house rule.
