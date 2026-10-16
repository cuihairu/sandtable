---
title: 12 · Parameter Sweep
---

[English](12-parameter-sweep.en.md) | [中文](12-parameter-sweep.md)

# Parameter Sweep

## Grid Search

```yaml
parameters:
  model.warrior.attack:
    min: 90
    max: 110
    step: 5
  model.dungeon.reward_gold:
    min: 100
    max: 200
    step: 20
```

The Cartesian product is generated automatically:

```text
90/100 · 90/120 · 90/140 · … · 110/200
```

**Scale formula**: total runs = ∏((max − min) / step + 1) × R (replicates). The example above gives 5 × 6 = 30 candidates; times R = 5, that is 150 simulations. Run this arithmetic before designing the grid.

Addressing paths are validated against the [parameter registry](./07-config-formula.en); candidates execute in parallel and determinism is unaffected by thread count ([parallel determinism](./06-deterministic-rng.en)).

## Random Search

For high-dimensional parameter spaces: sampling by distribution within the ranges declared in the registry.

## Latin Hypercube (`mode: latin_hypercube`, landed 2026-10-09)

A stratified refinement of Random: each dimension's [min, max] is split into `samples` strata with one point sampled uniformly inside each, and dimensions are then paired by independent Fisher–Yates shuffles — with the same N samples, per-dimension coverage is more uniform than pure random (every dimension is guaranteed no empty strata and no pile-ups), a good fit for budget-limited sampling in high-dimensional spaces.

```yaml
sweep:
  mode: latin_hypercube
  samples: 24        # candidate count = samples (same field as Random)
  replicates: 4
```

- Candidate count = `samples`, total runs = samples × R; the scale cap is the same gate as Random (MAX_CANDIDATES as the backstop);
- The sampling stream is bound to `base_seed`: same configuration, same samples, independent of thread count (the same discipline as the [Random mode](#random-search));
- The shuffle only permutes the pairing of strata, never the values inside them — after sorting, each stratum still holds exactly one point;
- `step` takes no part (consistent with Random; kept only as range metadata).

## Automated optimization (`optimize`, ignited Phase 8, 2026-10-10)

A sweep answers "which points on this curve are feasible"; optimization answers "let the machine find feasible points for me in a multi-dimensional space" — this picks up what [Balance recommendation](./15-recommendation.en) left open, that "the joint feasible region of multiple parameters needs a surrogate model or an optimizer". The experiment file's third section becomes `optimize`:

```yaml
optimize:
  mode: evolutionary
  population: 8        # population size
  generations: 5       # number of generations
  elite: 2             # elites carried verbatim into the next generation
  mutation_rate: 0.3   # per-dimension mutation probability
  mutation_scale: 0.2  # mutation magnitude (relative to each dimension's [min,max] width)
  replicates: 4
  parameters:          # same shape as sweep.parameters (step takes no part)
    model.warrior.attack: { min: 20, max: 220 }
    model.dungeon.reward_gold: { min: 800, max: 2000, step: 100 }
  targets:             # hard constraints define the feasible region (same shape as sweep.targets)
    - { metric: churn_rate, min: 0.0, max: 0.2, kind: hard }
  objective:           # ranking goal within feasible points (optional; if omitted, any feasible point passes)
    metric: power_p50
    direction: maximize
```

**Fitness is lexicographic, not a weighted score** (interpretability first):

1. Primary key: the hard-constraint pass count (reusing the [constraint verdict](./13-kpi-metrics.en) tri-state; PASS counts as 1);
2. Secondary key: the objective metric value (direction already folded into larger-is-better; if omitted, everything ties and first-come wins);
3. Configuration-error candidates sink to the bottom — nothing silenced, no crash.

**Evolutionary algorithm** (pure kernel, single-threaded, generation-by-generation dependency — serializing across generations is algorithm semantics, not a performance debt):

- Initial population: uniform sampling over each dimension's [min, max]; the sampling stream is bound to `base_seed` — same configuration, same result, independent of thread count;
- Each generation: elites carried over verbatim → the remainder produced by tournament selection (size 2) × per-dimension uniform crossover × uniform mutation;
- Mutation uses uniform perturbation rather than Gaussian — normal randoms belong to the [random functions](./24-random-functions.en) R3 phase, and optimization does not jump the queue for that dependency;
- The best solution is tracked across generations (ties keep the earlier one), and all historical candidates land on disk, traceable.

**Cost accounting**: total simulations = [population + generations × (population − elite)] × replicates (elites are not re-evaluated; the coarse upper bound population × (generations + 1) × replicates is used for budget checks). The cap stays MAX_CANDIDATES — do the arithmetic before running.

**Output**: same directory contract as sweep — `opt.json` (meta + spec + best + per-generation statistics), `candidates.csv` (all historical candidates × metrics + verdicts).

**Non-goal**: this section delivers a working evolutionary optimization first and pre-builds no interfaces for later algorithms.

**Follow-up increment rulings (2026-10-10, decided per the in-repo decision record)**:

1. **Bayesian surrogate model choice = random forest (RF)**. The pending decision point was above (GP / random forest); the ruling follows the project's iron rules: ① RF is pure discrete trees with no linear-algebra dependency and good wasm32 compatibility (GP needs dense matrix inversion, which would saddle the core with numerical linear-algebra code); ② RF's bootstrap and feature sampling reuse the existing SplitMix64 keyed-derivation stream, structurally identical to the determinism discipline; ③ feature importance directly answers "which parameters drive the metric", in line with the interpretability discipline of "lexicographic fitness, not weighted" (GP kernel length-scales are black-box hyperparameters); ④ this project's typical 36–152 candidates are well within RF's reach; GP's strong suits (expensive evaluations + predictive-uncertainty quantification) have no current demand and are left for later evaluation.
2. **Pareto / multi-objective = constraint-aware non-dominated sorting** (NSGA-II style: non-domination ranks + crowding distance to break ties). Weighted sums are explicitly rejected by the fitness design ("lexicographic, not a weighted score"); the Pareto front itself is the answer, not compressed into a single value. Implementation started right after the ruling (see the next section).

## Pareto multi-objective (`mode: pareto`, landed 2026-10-10)

Multi-objective is not compressed into a weighted single value — the front itself is the answer. The third section becomes `objectives` (≥2 of them; mutually exclusive with `objective`):

```yaml
optimize:
  mode: pareto
  objectives:          # ≥2 of them
    - { metric: power_p50, direction: maximize }
    - { metric: gold_per_player, direction: minimize }
  targets:             # hard constraints, same as evolutionary mode
    - { metric: churn_rate, min: 0.0, max: 0.2, kind: hard }
  # population / generations / elite / mutation_* / parameters same as evolutionary mode
```

**Fitness is a three-level lexicographic order** (interpretability under the same discipline as evolutionary mode):

1. Primary key: the hard-constraint pass count (feasible-region semantics unchanged — dominating on every objective at a lower level still cannot beat a higher level);
2. Within a level, non-dominated sorting (NSGA-II style): A dominates B only if it is no worse on every objective and strictly better on at least one;
3. Ties within a level: crowding distance (the sum of normalized per-objective spacing, ∞ for boundary points), keeping the front diverse.

Elitism / tournament / the final-generation answer all follow the same order. **The "best" = the point with the largest crowding distance in the last generation's front 0** (the representative point); the full front lands in `opt.json`'s `front0` (descending crowding distance), the per-generation statistics carry the `front0` size, and `candidates.csv` remains the full, traceable history as always. Configuration-error candidates sink to the bottom of the ranks and never enter the front. The RNG consumption order matches evolutionary mode (the sampling stream is likewise bound to `base_seed` derivation; the two modes are isomorphic).

The cost accounting uses the same formula as evolutionary mode (population × (generations + 1) × replicates; elites not re-evaluated). Example: `examples/pokemon-pareto.yaml` (same bill as `pokemon-optimize.yaml`; the tension between the two objectives is left to the front to show).

## Random-forest surrogate (the `surrogate` subcommand, landed 2026-10-10)

The random forest from ruling 1 two sections up lands as a standalone subcommand — the surrogate **only reads sweep artifacts and never enters the simulation path** (the chapter 09 red line):

```bash
sandtable surrogate train sweep-out --metric power_p50   # → model.json (in-training MAE + importance table)
sandtable surrogate predict model.json --params '{"model.warrior.attack": 105}'
sandtable surrogate importance model.json                # parameter importance ranking table
```

- Training data = the Ok candidates in sweep.json (parameter sets must be identical; configuration-error candidates never enter the surrogate; missing metrics / inconsistent parameter sets are errors, exit code 2);
- Forest: bootstrap sampling (the t-th tree's stream = `seed ^ t·0x9E37…` — same seed, same forest, independent of thread count) × CART regression trees (scan every feature for midpoints of adjacent distinct values, minimum weighted variance, both sides satisfying min_samples_leaf; leaf out at max depth / constant target / no valid split);
- Importance = variance reduction at splits, normalized (sums to 1), directly answering "which parameters drive the metric";
- Prediction = the mean over all trees, with the all-tree min / max spread (forest disagreement); hyperparameters (tree count / depth / leaf minimum / seed) land explicitly in model.json;
- Positioning: an interpretable surrogate for small data of 36–152 candidates; GP (dense matrix inversion + black-box kernel hyperparameters) is left for on-demand evaluation later.

Monte Carlo in this project means **multi-seed reruns** (replicates): the same candidate runs R times with different seeds to estimate a metric's sampling noise and produce confidence intervals. It is a statistical device, not a parameter-optimization method.

## The grid is discrete; the recommendation is continuous

::: warning The gaps between grid points
A grid with step 5 has only the points 95 / 100 / 105. If the experiment's conclusion needs a **continuous interval** like "recommend 96~101", it cannot be read straight off the grid points — the grid results must go through **interpolation or a surrogate model** (linear / quadratic interpolation at constraint boundaries), a step defined in [Balance recommendation](./15-recommendation.en). The sweep layer only supplies grid-point data and does not pretend to have continuous resolution.
:::

## Output

Each candidate writes a [standard result directory](./09-data-output.en); the sweep layer adds:

- a candidate list (parameter combinations + experiment identity);
- a summary table: candidates × metrics (mean ± CI), output as CSV;
- annotations on failed candidates (configuration error / run failure); nothing silently dropped.
