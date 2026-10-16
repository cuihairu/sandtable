---
title: 13 · KPI and Metrics
---

[English](13-kpi-metrics.en.md) | [中文](13-kpi-metrics.md)

# KPI and Metrics

Metrics answer "is the system running well". This chapter gives every metric an **explicit formula**, a collection method, and a statistical convention — without formulas there are no constraints, and without constraints there are no recommendations.

## Metric types

```text
Retention (D1 / D3 / D7 / D14 / D30) · win rate · churn rate
inflation · sink_ratio · gold (earned / spent / stock / per player)
power (daily mean + snapshot-day P50 / P90 / P99) · level-up count · expected gacha pulls to hit (when gacha is configured)
```

## Collection architecture: online aggregation

At the scale of 100k players × 90 days, it is **not** viable to store every player's per-step detail and compute statistics afterwards. Metrics aggregate incrementally while events are processed:

| Structure | Purpose |
| --- | --- |
| Integer counters | Count-type metrics (battles, wins, churns, level-ups) — countable resources like gold stay integer, never float |
| Incremental accumulators | Per-day sums for inflation and sink_ratio (daily granularity) |
| Full sort on snapshot days + linear interpolation | Power P50 / P90 / P99 on fixed snapshot days (D1 / D3 / D7 / D14 / D30) |
| Two-pass mean / variance + t-distribution CI | Replicate-level statistics (experiment-level `summarize`, not Welford) |

Memory scale: counters and accumulators are independent of the player count; snapshot days store only that day's full Power set (just 5 days), keeping the footprint bounded.

## Metric definitions (formulas)

Below, `a` ranges over that day's active players; `active(a, d)` means player a logged in at least once on day d.

### Combat

```text
win_rate(d)  = winning battles(d) / total battles(d)
death_rate(d) = player defeat count(d) / total battles(d)
```

### Growth

```text
Dn_power  = distribution of Power at end-of-day n (reported as P50 / P90)
Dn_level  = distribution of Level at end-of-day n
```

### Economy

```text
earned(d)    = total gold gained by all players that day (combat drops + rewards)
spent(d)     = total gold consumed by all players that day (level-ups + other sinks)
G(d)         = total gold held by all surviving players at end-of-day d

inflation(d)  = (G(d) − G(d−1)) / max(G(d−1), 1)        —— primary convention: daily growth rate of the stock
sink_ratio(d) = spent(d) / max(earned(d), 1)             —— auxiliary convention: spend-to-earn ratio; < 1 means the economy is net-minting
```

The MVP has no price system, so inflation is defined as the **daily growth rate of total gold** (the primary convention), with sink_ratio output alongside as a diagnostic. Constraints (e.g. `inflation ≤ 0.05`) bind to the primary convention. The reporting window uses two numbers: the 30-day cumulative growth rate and the daily average growth rate.

### Retention and churn

```text
retention_Dn = |{a : active(a, n)}| / |{a : active(a, 1)}|     —— D1 / D7 / D14 / D30 retention

churn(a, d) ⟺ player a has been inactive for K consecutive days (K defaults to 3, configurable)
churn_rate(d) = newly churned(d) / active at start of period(d)
```

::: warning Churn must have a mechanistic source
If retention metrics are mere statistical conventions, difficulty adjustments will never influence whether players stay, and "long-term simulation" is meaningless. The MVP ships a minimal churn mechanism that ties the metric to behavior:

```text
stalled: the player's level and Power have both failed to grow for S consecutive days (S defaults to 2)
churn check: one Bernoulli trial per day
  p_churn = p_base            (not stalled)
  p_churn = p_stall           (stalled; p_stall > p_base)
```

With this, the chain "change difficulty → win rate shifts → growth pace shifts → stall rate shifts → retention shifts" is fully connected inside the MVP.
:::

### Income and spending

```text
income(d)    = per-player average of earned(d)
spending(d)  = per-player average of spent(d)
```

### The MVP definition of Whale

The MVP has no payment system, hence no purchase events. In the MVP, Whale is defined as **high activity + growth multiplier**: session frequency and resource acquisition are scaled up by a multiplier (a hard-coded constant), and the output is annotated "no payment semantics". Introducing minimal payment events is a later extension, at which point the Whale definition migrates to a payment-based convention.

### Gacha (expected pulls to hit)

Pity-style gameplay is measured by **expected pulls to hit**, `gacha_pulls_to_hit`: the pull count aggregated over a "stop at first hit" session — the most direct read on "how deep the pit is" for a designer. The hard / soft pity state machine and its closed-form reconciliation (truncated geometric `E[T](H) = (1 − (1−p)^H)/p`, H being the hard-pity pull count) are in [Random functions and probability systems](./24-random-functions.en); this metric rides the same CI₉₅ verdict chain as the others, with constraints written like `gacha_pulls_to_hit max 30`.

## Statistical conventions and confidence intervals

**The statistical unit is the replicate, not the player** (rationale in [Experiment pipeline](./11-experiment-pipeline.en)). Suppose a candidate ran R replicates and the r-th replicate's aggregated value of some metric is m_r:

```text
mean  = (1/R) · Σ m_r
sd    = sample standard deviation (m_r)
CI₉₅  = mean ± t(0.975, R−1) · sd / √R
```

**Effect size**: A/B comparisons report Δ = mean_B − mean_A together with both sides' CIs, plus the standardized effect d = Δ / pooled_sd. The combination of |d| and the CIs forms the criteria for [recommendation confidence](./15-recommendation.en).

## Constraint verdicts: confidence-interval based, not point estimates

::: warning Point-estimate verdicts crash on noise
For a hard constraint like `win_rate ∈ [0.48, 0.52]`, the sampling noise of a single experiment can already reach ±0.02 — the difference between point estimates 0.519 and 0.521 means nothing. Verdict rules:

| Position of the CI₉₅ vs. the constraint interval | Verdict |
| --- | --- |
| CI entirely inside the constraint interval | **PASS** |
| CI crossing a constraint boundary | **BORDERLINE** (treated as FAIL in recommendation scenarios, or add replicates to narrow the CI) |
| CI entirely outside the constraint interval | **FAIL** |
:::

## Targets configuration

```yaml
targets:
  - metric: combat.win_rate
    min: 0.48
    max: 0.52
    kind: hard          # defaults to hard and may be omitted; soft does not join the feasible region
  - metric: economy.inflation
    max: 0.05
  - metric: progression.day_7_power
    min: 10000          # intervals only; target/tolerance belong to the Rust side
    max: 15000          # Target::centered constructor and never enter the YAML surface
```

Supported: `min / max` (a missing side means no bound there) and `kind` (defaults to `hard`); `hard` is a one-vote veto and `soft` does not join the feasible region (weighted ranking belongs to a later phase, see [Balance recommendation](./15-recommendation.en)). Example verdict output:

```text
Candidate A    Win Rate PASS · Inflation FAIL · D7 Power PASS
Candidate B    Win Rate PASS · Inflation PASS · D7 Power PASS
```

BORDERLINE is annotated separately in reports and never merged into PASS.

## Cohort slicing

All of the metrics above support sliced output by cohort (Casual / Core / Whale); whether a constraint binds to the aggregate convention or a slice convention is declared explicitly in targets, so that "passes globally, collapses for one cohort" cannot hide behind the average.
