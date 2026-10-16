---
title: 15 · Balance Recommendation
---

[English](15-recommendation.en.md) | [中文](15-recommendation.md)

# Balance Recommendation

An upgrade from outputting "simulation results" to outputting "recommendations". Phase 1 involves no optimization algorithm — just [Sweep](./12-parameter-sweep.en) + [constraint verdicts](./13-kpi-metrics.en) + [sensitivity](./14-sensitivity.en).

## Output shape

```text
Current:
  warrior.attack = 100

Recommended:
  96 ~ 101

Reason:
  - Win rate currently exceeds the target ceiling; attack needs to come down
  - D7 progression stays inside the target range even after the reduction
  - Economic impact is minor

Confidence:
  High
```

## Where the interval comes from: interpolation

::: warning A continuous interval must come from interpolation
A grid with step 5 has only the three points 95 / 100 / 105; "96~101" cannot be read straight off grid points. Rules for generating the recommendation interval:

1. For each hard constraint, take the constraint metric's grid values along the parameter axis (mean ± CI);
2. When a constraint boundary (e.g. win_rate = 0.52) falls between two grid points, use **linear interpolation** (quadratic when the grid is dense or the curve is smooth) to find the parameter value at the boundary;
3. Intersect the feasible segments of all hard constraints to obtain the recommendation interval;
4. Interval endpoints are annotated "obtained by interpolation"; segments whose CI crosses the boundary are annotated BORDERLINE.

The MVP only does interpolation-based recommendation on a **single parameter axis**. The joint feasible region of multiple parameters needs a surrogate model or an optimizer — a later phase, promised no earlier.
:::

## Confidence definition

"Confidence: High" is not an adjective; it is a criterion:

| Level | Criterion |
| --- | --- |
| **High** | A feasible interval exists, no BORDERLINE on the axis, and every hard metric's elasticity is significant |
| **Medium** | Feasible, but a BORDERLINE constraint exists or endpoint elasticity is not significant |
| **Low** | No feasible point, or the intersection is empty |

Definitions of effect size and CI are in [KPI and metrics](./13-kpi-metrics.en).

## The recommendation layer does not score candidates

The recommendation layer only answers "where the feasible interval is" and neither ranks nor scores candidates: hard constraints define feasible segments, and the intersection of all of them yields the recommendation interval; soft targets do not join the feasible region (weighted ranking is a later phase, the same convention as [KPI and metrics](./13-kpi-metrics.en)). Candidate-level comparison is carried by the [Experiment pipeline](./11-experiment-pipeline.en)'s constraint verdicts and A/B paired differences.

## Non-goals

- **Automated optimization**: the upgrade from single-axis recommendation → multi-dimensional optimization is carried by the `optimize` subcommand (ignited Phase 8; the evolutionary algorithm has landed; Pareto multi-objective landed 2026-10-10 — constraint-aware non-dominated sorting, see the automated-optimization section of [Parameter sweep](./12-parameter-sweep.en); the random-forest surrogate has landed as the `surrogate` subcommand, see the random-forest-surrogate section of [Parameter sweep](./12-parameter-sweep.en));
- **No absolute prediction**: recommendation wording is "a feasible direction relative to the current parameters", not "the win rate will certainly be 50% after launch" (see [Positioning](./01-positioning.en)).
