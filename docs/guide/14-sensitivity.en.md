---
title: 14 · Sensitivity Analysis
---

[English](14-sensitivity.en.md) | [中文](14-sensitivity.md)

# Sensitivity Analysis

Sensitivity analysis answers: which parameters are actually worth adjusting.

## Method choice: the MVP uses OAT elasticity

::: tip Decision
A parameter-importance number only means something when it is bound to a method ("0.72 of what?"). **The MVP picks One-at-a-time (OAT) elasticity**; standardized regression, Morris, and Sobol join later as upgrade paths on demand (below).
:::

### Definition

For baseline parameter p₀ and metric Y, take a relative step δ (default 5%) and central-difference:

```text
elasticity E(p → Y) = (∂Y / ∂p) · (p₀ / Y₀) ≈ [Y(p₀+δp₀) − Y(p₀−δp₀)] / (2δ · Y₀)
```

Meaning: **p changing by 1% moves Y by roughly E%** — dimensionless, so parameters and metrics of different units compare directly.

### Data source

Elasticity is extracted directly from [Grid sweep](./12-parameter-sweep.en) data (grid points in the baseline's neighborhood) at **zero extra simulation cost**. That is exactly why the MVP picked OAT: the sweep runs anyway.

### Output form

Importance is defined **per metric**; the output is a "parameters × metrics" matrix, not one global ranking:

```text
E(→ win_rate)      E(→ day_7_power)    E(→ inflation)
warrior.attack        1.8               1.4               0.1
monster.defense       0.9               0.6               0.0
gold.reward           0.2               0.5               2.1
upgrade_cost          0.1               0.4               0.3
```

Sorting by |E| for a given metric yields that metric's "how much each parameter is worth adjusting". Elasticity values are presented together with [confidence intervals](./13-kpi-metrics.en): an elasticity whose interval spans zero is marked "not significant".

## Upgrade paths

| Method | Fits | When |
| --- | --- | --- |
| OAT elasticity | Baseline neighborhood, few parameters, grid data already at hand | **MVP** |
| Standardized regression coefficients | When a global linear approximation is wanted, paired with random-sampling designs | Phase 4, optional |
| Morris | Many parameters; screening for an important subset | Evaluate when parameters > 15 |
| Sobol | Variance decomposition; quantifying interactions | After a clear need arises |

## Limitations (stated, not hidden)

- **OAT cannot see interactions**: two parameters with small individual elasticities but a large joint effect will be missed; on suspected interactions, upgrade to Morris / Sobol;
- **Locally valid**: elasticity holds only near the baseline point; conclusions far from the baseline cannot be extrapolated;
- **Metric-bound**: there is no "global importance" — switch the metric and recompute.
