---
title: 06 · Deterministic RNG
---

[English](/guide/06-deterministic-rng) | [中文](/zh/guide/06-deterministic-rng)

# Deterministic RNG

Reproducibility is a core capability, not an add-on. There are two goals:

1. **Reproducible**: same configuration + same seed + same version → bit-identical results;
2. **Common Random Numbers**: before and after changing one parameter, the two experiments should follow the same random path as much as possible, so that the A/B difference reflects the parameter effect rather than random noise.

## Experiment Identity

A run is jointly determined by the following five-tuple, which is written into every output:

```text
seed · model_version · config_hash · scenario_hash · experiment_id
```

config_hash and scenario_hash are computed from the **normalized configuration** (key-order-independent, see [Configuration and Formula Engine](./07-config-formula.md)).

## Why "One Stream per System" Is Not Enough

The intuitive approach is to give each system its own independent stream (combat / loot / economy / behavior / world). But it fails to meet the goal:

> Suppose the combat stream and the loot stream are separate. Change attack from 100 to 95, and a battle that took 3 rounds now takes 4 — the combat stream has been drawn from once more; every subsequent draw in the combat stream is now misaligned — every hit check in later battles uses a different random number. "Stream misalignment" noise floods the A/B difference, and Common Random Numbers exists in name only.

**Root cause: the stream's advancement depends on the number of calls, and the number of calls is itself affected by parameters.**

## Approach: Keyed Random Numbers

Random numbers do not come from an "advance-one-by-one stream" but are **derived directly from a key**:

```text
key = (seed, actor_id, day, event_index, purpose)
random_values = derive(key)   // pure function, independent of call order
```

| Key component | Meaning |
| --- | --- |
| `seed` | Experiment seed |
| `actor_id` | Player (or monster, etc.) identifier |
| `day` | Simulation day |
| `event_index` | The nth draw for that actor, that day, under that purpose (counting from 0) |
| `purpose` | Draw purpose: `behavior` / `combat_hit` / `combat_damage` / `loot` / `churn` / … |

The implementation is counter-based derivation: hash the key into an initial state (something in the SplitMix64 / Philox family), then produce the required number of random values.

This structure solves the misalignment problem directly: an attack change that makes the 3rd battle take one more round only consumes more `event_index` within that battle — **the 4th battle still uses its own (day, battle ordinal) key, unaffected**. Changes in draw count stay inside the event and do not contaminate subsequent events.

No shared state and no call-order dependency bring two further benefits:

- **Naturally parallel-safe**: derivation is a pure function — no locks needed, and no need for an agreement on "which thread draws first";
- **Locally replayable**: to debug one player's one day, replay the random numbers directly from the key — no need to run from the start.

## The Boundary of Common Random Numbers

Under the keyed structure, draws whose key does not contain the changed parameter (typically the behavior stream) have identical keys across the A/B runs → identical random values → identical paths.

::: note An honest boundary
CRN **reduces noise, it does not eliminate it**. If behavior decisions depend on state (for example, "level ≥ 10 to unlock some behavior"), changing a parameter indirectly changes state, and later behavior paths diverge — this is a real effect and should be preserved. Principle: draws directly affected by the parameter (combat checks) are allowed to differ; draws not directly affected by the parameter that diverge only because of a state change — the divergence itself is part of the experimental result.
:::

## Parallel Determinism Rules

Deterministic random derivation is only a necessary condition; aggregation and iteration must also be deterministic:

| Pitfall | Rule |
| --- | --- |
| Rust `HashMap` iteration order is random | Use `BTreeMap` or `IndexMap` for entity storage and registries, not `HashMap` |
| rayon floating-point reduction order is not fixed | Use a fixed reduction tree (sort by a deterministic key, then reduce pairwise), or sort first and aggregate serially |
| Floating-point summation error varies with order | Prefer integers / fixed-point for metric aggregation (e.g., gold counted as integers); floating-point summation follows a fixed order |

**Cross-platform floating-point note**: compiler optimizations (FMA, vectorized reassociation) and libm differences can make the same code produce different floating-point results on different CPUs / build options. Therefore:

- **Commitment**: same version + same platform + same seed → bit-identical (snapshot tests, see [Testing Strategy](./19-testing.md));
- **Best effort**: cross-platform agreement is a goal, not a commitment; cross-platform comparison uses statistical regression rather than bitwise comparison.

The gap between native and wasm32 is also "cross-platform": addition, subtraction, multiplication, division, and sqrt follow IEEE-754 and are bit-identical on both ends; transcendental functions like `powf` / `ln` / `sin` go through different libm implementations and can differ at ULP level — for any threshold comparison that affects a decision result, prefer expressing it with integers / fixed-point, and use floating-point only for display (the integer aggregation rules of [Metrics](./13-kpi-metrics.md) exist precisely for this).

## Forbidden

- Do not bring `rand::thread_rng()` or any non-deterministic source into the simulation path;
- Do not create a "streaming" RNG instance inside a System and hold it across events (that reintroduces call-order dependency);
- All random consumption must go through keyed derivation, with the purpose enum centrally registered to prevent same-name-different-meaning drift.
