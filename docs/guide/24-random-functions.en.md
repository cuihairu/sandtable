---
title: 24 · Random Functions and Probability Systems
---

[English](24-random-functions.en.md) | [中文](24-random-functions.md)

# Random Functions and Probability Systems

The [Pokémon case](./21-pokemon-case.en) exposed a pattern: the "feel" of a numeric design is largely decided by its random structure — hit variance, drop surprises, gacha pity — yet sandtable currently ships only the narrowest layer (uniform + Bernoulli). This page organizes the random capability system **as a whole design blueprint**: each capability gets its applicable scenarios, where the deterministic key and the state belong, the API shape, and how it hooks into the existing experiment mechanisms (sweep / CI95 / golden snapshots). The design-side conventions (how the expectation is computed, how pity is set, how the variance is tuned) and hello-game [numerical/05 drop and probability design](https://github.com/cuihairu/hello-game/blob/main/docs/numerical/05.md) are two sides of the same coin: that page is about "how the design side decides", this page is about "how the simulation side verifies".

## Three iron rules (inheriting [deterministic RNG](./06-deterministic-rng.en))

::: tip Any random capability clears three rules before entering the kernel
1. **Keyed and reproducible**: every draw goes through keyed derivation `key = (seed, actor_id, day, event_index, purpose)`, the purpose enum is centrally registered, and systems that randomize in a bypass are forbidden;
2. **Configurable and sweepable**: probability / weight / pity parameters enter the parameter registry and can serve the sweep as a numeric axis (distribution-shape parameters go into `Table` slots, following the `tier_table` precedent, and do not enter the numeric channel);
3. **Verifiable**: every implementation must ship with one statistical acceptance — mean-type uses the replicates' CI95, distribution-type uses the chi-square test (see "Choosing the verification mechanism" below).
:::

## Capability Inventory Overview

| # | Capability | Typical scenario | Key and state | Status |
| --- | --- | --- | --- | --- |
| 1 | Uniform / Bernoulli | Hits, damage variance, everyday dice rolls | The key is the draw itself, stateless | ✅ Exists |
| 2 | Normal distribution | Population initial attributes, session length, rating noise | The key is the draw itself (consumes two uniforms), stateless | ✅ R3 landed (2026-10-10) |
| 3 | Weighted table (with replacement) | Drop tables, quality roll | The table is compiled at load time; the key is the draw itself | ✅ R1 landed (2026-10-10) |
| 4 | Shuffle / weighted sampling without replacement | Card deck draws, limited-pool de-duplication, team sampling | The key is the draw itself, stateless | ✅ R1 landed (2026-10-10) |
| 5 | Pity sequence (hard / soft) | Gacha, rare-drop fallback | **The counter is deterministic actor state**; the draw still goes through the key | ✅ R2 landed (2026-10-10) |
| 6 | Replay seed | Reproduce any single run / the same A/B path | The key structure is the design; the seed is the experiment identity | ✅ Exists (docs 06) |
| 7 | Distribution test (chi-square) | Verify that the implementations of 1–4 match their configuration (disclosure compliance) | A pure statistical tool, never enters the simulation path | ✅ R1 landed (2026-10-10) |

## API Design per Capability

### 1. Uniform / Bernoulli (exists, conventions archived)

```text
rng.uniform(lo, hi)      # [lo, hi) uniform; combat.dmg_var is its application
rng.bernoulli(p)         # P(true) = p; combat.p_hit is its application
```

Stateless, O(1). The only discipline: ranges and probabilities go into the registry (`F64` slots, sweepable).

### 2. Normal distribution Normal(μ, σ) ✅ R3 landed

**Scenario**: perturbation of player initial attributes, daily session length, matchmaking rating noise — any population quantity that "jitters around a center".

```text
rng.normal(purpose, mu, sigma) -> f64            # Box–Muller: two keyed uniforms -> one normal draw
rng.normal_clamped(purpose, mu, sigma, lo, hi)   # clamped variant (deterministic post-processing, consumes no draw)

sandtable disttest normal --samples 100000 --buckets 20 --spread 3 --mu 0 --sigma 1
# or (core API): normal_buckets + merge_buckets + chi_square; normal_cdf via the incomplete gamma P(½, x²/2)
```

- Box–Muller (1958) is the classic transform; one generation consumes two independent uniforms. The key discipline is unchanged (`purpose` separates use cases) — what changes is only that **one logical draw consumes two uniform values**: `event_index` counts logical draws, guaranteeing that changing a parameter between A/B arms does not move the key (inheriting the CRN boundary from docs 06);
- The normal distribution is unbounded, so attribute-type uses must be paired with a `clamp` (`normal_clamped`; clamping is deterministic post-processing). When a configuration surface is introduced, the clamp bounds go into the registry; documentation and reports must state honestly that this is a "truncated normal";
- Reference implementation conventions: [NumPy Generator.normal](https://numpy.org/doc/stable/reference/random/generator.html) (semantic comparison, not an implementation dependency).

### 3. Weighted table WeightedTable (with replacement) ✅ R1 landed

**Scenario**: drop tables (70/25/5 three tiers), quality roll, NPC behavior branches.

```yaml
# Configuration surface (landed form: tables live under model.loot.tables; load-time validation: weights non-negative, at least one positive)
model:
  loot:
    rate_mult: 1.0        # global drop-rate multiplier (numeric slot, sweepable; scales drop yield, does not change table shape)
    tables:
      chest:
        weights: { gold_small: 70, gold_mid: 25, gem: 5 }
```

```text
Load time: weights → WeightedTable{names, cums, total} (CDF prefix sums, compiled at load time)
Run time: rng.weighted(Purpose::Loot, &table) -> item index   # one uniform draw + CDF binary search, O(log n)
```

- The roulette linear scan at O(n) is the naive implementation; the alias method (Walker 1977; Vose 1991 gives O(n) construction / O(1) sampling) is a **hot-path optimization item** — the construction cost is paid once, and it is enabled only when a table is referenced a million times in a single day. The MVP uses CDF binary search, readability first;
- A table entry's **weight** does not enter the numeric channel (`model.loot.tables` goes through `ParamKind::Table`, following the `tier_table` precedent: changing the shape is done by editing YAML); the "global drop-rate multiplier" lands as the numeric parameter `model.loot.rate_mult` (**sweeping it = sweeping output intensity**; distribution tests do not touch it — a multiplier scaling quantity does not change the distribution shape);
- Weights are not probabilities: expected share = wᵢ/Σw, and the reporting layer is responsible for converting it into "expected count per hundred draws" for designers to read.

### 4. Shuffle and sampling without replacement ✅ R1 landed

**Scenario**: card deck draws (without replacement), limited-pool de-duplicating drops (weighted without replacement), random team sampling.

```text
rng.shuffle(purpose, &mut xs)                  # Fisher–Yates, O(n), consumes n−1 draws
rng.sample(purpose, &xs, k) -> Vec<T>          # partial Fisher–Yates, shuffles only the first k slots, O(k)
rng.sample_weighted(purpose, &xs, &table, k)   # A-Res key-ordered method, O(n log n)
```

- Fisher–Yates (the classic solution, see Knuth TAOCP Vol. 2) is the standard answer to a uniform shuffle; a **partial shuffle** of k items is naturally equivalent to uniform sampling without replacement;
- Weighted sampling without replacement uses the A-Res key-ordered method (Efraimidis & Spirakis 2006: compute a key u^(1/w) per item and take the k largest) — one-shot and streaming, independent of weight scale;
- Shuffling / sampling uses a dedicated purpose `Shuffle` (appended at the tail of the enum, not moving old keys) plus the streaming draw `draw_stream` (reads the counter once, advances it by n, derives by `base+i`) — a batch draw only moves that purpose's counter, and the key space of other use cases is unaffected;
- For deck-type scenarios, note: **the shuffle result depends on the input card order** — the card order goes into the configuration (the array order is the pre-shuffle order); if the key is unchanged the shuffle is unchanged, and CRN holds.

### 5. Pity sequence (hard pity / soft pity) ✅ R2 landed

**Scenario**: gacha (single-pull probability p, a guaranteed hit on pull N, rising probability after consecutive misses), a fallback for rare drops.

::: warning State and draw are separated
The pity **counter is the actor's deterministic state** (it enters World and travels with the snapshot); **the draw itself still goes through the keyed uniform** — the key contains no pity count. This keeps the CRN boundary unchanged: changing pity parameters changes no key, the random stream does not move, and the comparison stays clean.
:::

```yaml
model:
  gacha:
    base_rate: 0.02        # base single-pull probability
    pity_hard: 50          # hard pity: pull 50 is a guaranteed hit (0 = none)
    pity_soft_start: 0     # soft-pity starting pull count (0 = none)
    pity_soft_step: 0.0    # per-pull probability increment after that start (0 = no soft pity)
```

- State machine: every actor maintains `since_last_hit`; the single-pull success rate is `p' = min(1, base_rate + max(0, k − pity_soft_start) · pity_soft_step)`, and when `since_last_hit + 1 ≥ pity_hard > 0`, `p' = 1` (implementation: `systems::gacha::hit_rate`);
- All four parameters are `F64`/`U64` numeric slots (registry `model.gacha.*`): **the sweep can sweep the pity length** (it directly changes the expected subsidy, see below); `base_rate ≤ 0` is rejected by `validate` (otherwise gacha never terminates);
- Execution form: when `model.gacha` is configured, every actor runs one "stop at first hit" session at **tick 0 (before day 1)** (`systems::gacha::pull_until_hit`, consuming a `Purpose::Gacha` key pull by pull until a hit) — an account-creation semantic, entering no day's statistics;
- **Acceptance conventions (design side ↔ simulation side reconciliation)**: the hand-computed account in hello-game numerical/05 — a single pull at 2% with no pity expects 50 pulls; with a hard pity of 50 pulls the expectation is ≈ **31.8 pulls** (closed form `E[T] = (1 − (1−p)^H)/p = (1 − 0.98⁵⁰)/0.02 = 31.79`; the probability that the first 49 pulls all miss is 0.98⁴⁹ ≈ 37.2%, and truncation chops off the long tail). The simulation's machine acceptance = mean over 10,000 samples ± CI95; passing means landing within the closed-form value ± CI (the core test `抽卡_期望抽数对齐解析解` reconciles with 2,000 players, tolerance 1.0). Soft pity has no closed form, so the sample mean itself is the acceptance instrument (same conventions on this page);
- Expected pulls to hit is a **new KPI**: `MetricKey::GachaPullsToHit` (`gacha_pulls_to_hit`), riding the existing full chain of replicates → `summarize` → CI95 — comparable, sweepable, recommendable. When gacha is not configured it is `None`, and `#[serde(skip_serializing_if)]` keeps it out of the JSON (golden snapshots stay byte-for-byte identical).

### 6. Replay seed (exists, conventions archived)

`base_seed + r` (the r-th replicate) is the replay mechanism: same seed + same configuration → bit-identical results (`web_parity` / golden snapshots lock this down, see [Testing strategy](./19-testing.en)). This page only adds one design convention: **the experiment report must record `base_seed`** (already recorded in the meta of report.json / sweep.json), so that any run can be re-run with `--seed` — "replay" needs no new mechanism, what it needs is a traceable report (already satisfied).

### 7. Distribution test (chi-square) ✅ R1 landed

::: tip Positioning red line
Distribution tests are the **test bench for random primitives**; they never enter the simulation path (the same discipline as DuckDB: after-the-fact verification).
:::

**Scenario**: verifying that the weighted-table implementation matches its configuration (disclosure convention compliance: the red line in hello-game numerical/05 — "the probability you publish is the probability players will make decisions with"), and verifying the statistical correctness of uniform / normal.

```text
sandtable disttest uniform --samples 100000 --buckets 10 --alpha 0.01
sandtable disttest weighted <scenario.yaml> chest --samples 100000 --alpha 0.01
# or (core API): chi_square(&observed, &expected) -> (stat, df, p); merge_buckets does Cochran merging
```

- Conventions: Pearson χ² = Σ(Oᵢ−Eᵢ)²/Eᵢ, df = number of independent buckets − 1; p ≥ α passes. Reference semantics: [SciPy `stats.chisquare`](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chisquare.html) (for cross-validation, not a runtime dependency);
- Bucket sample rule: expected count per bucket ≥ 5 (the classic Cochran rule); if a bucket falls short, merge buckets — otherwise χ² is distorted and the test result is invalid;
- **Markov-chain structures like pity cannot be tested directly with a χ² single-pull frequency** (draws are not independent): acceptance takes two routes — a state distribution test (the stationary distribution of `since_last_hit`) and the expected-pulls CI95 (previous section) — written down at the design-document stage to prevent the pseudo-acceptance of "forcing χ² onto pity".

## Choosing the Verification Mechanism (hookup to the existing experiment mechanisms)

| Question type | Mechanism | Exists? |
| --- | --- | --- |
| "How large a mean difference counts as significant" (retention / win rate / output) | replicates → CI95 / A/B paired difference | ✅ docs 13/11 |
| "How much does this parameter matter" | sweep + OAT sensitivity + recommendation interval | ✅ docs 12/14/15 |
| "What is the economic impact of the drop-rate multiplier" | `loot.rate_mult` / `gacha.*` enter the registry → sweep as the numeric axis | ✅ R1/R2 landed |
| "Does the random implementation match its configuration" | **chi-square distribution test** (primitive level) | ✅ R1/R3 landed (`disttest`) |
| "Is this run reproducible" | base_seed + golden snapshots + web_parity | ✅ docs 06/19 |

In one sentence: **CI95 governs the noise of measurement, chi-square governs the correctness of the implementation, golden snapshots govern the invariance of regressions** — each covers one segment; do not let them substitute for one another.

## Phasing Plan

| Phase | Content | Acceptance |
| --- | --- | --- |
| R1 ✅ landed (2026-10-10) | Weighted table (load-time CDF + the YAML surface + `ParamKind::Table`) + shuffle / sampling without replacement + the `disttest` subcommand (uniform / weighted) | The new purpose does not move old keys (golden snapshots stay bit-for-bit identical); χ² all passes on 10,000 samples; params table count +1 (rate_mult) |
| R2 ✅ landed (2026-10-10) | The pity state machine (hard / soft) + the expected-pulls KPI + gacha case YAMLs | Numeric reconciliation (2% / 50 pity → closed form 31.79 ± CI); sweeping the pity length yields a recommendation interval (10 ~ 44.6, upper end interpolated); params table count +4 (`model.gacha.*`); golden snapshots stay bit-for-bit identical |
| R3 ✅ landed (2026-10-10) | Normal (with clamp) + χ² extended with normal bucketing | Mean / variance aligned to the analytic solution (inside the CI of 100k samples); Box–Muller double-consumption key stable (changing μ/σ does not move keys); χ² all passes on 100k samples across 20 buckets; `disttest normal` landed; golden snapshots stay bit-for-bit identical |

R1 / R2 / R3 are all kernel extensions that touch `rng.rs` and the registry — **before implementation, take this page as the conventions baseline, and merge only after each phase runs the full test suite green** (one independent commit per phase).

**Follow-up candidate (not chartered, registered by the 2026-10-14 reconciliation)**: the NPC customer-behavior gap in [Chapter 23](./23-genre-simulation.en) names the arrival process (Poisson) as a need — it is currently the only recorded random-primitive candidate. It also needs a "customer System" alongside it, so it is not a single-point primitive; whether to charter it depends on the root todo.md entry "random function extension follow-ups" (started only once a real category demand appears); this page does not schedule it.

### R1 Delivery Record (2026-10-10)

- **purpose key discipline**: `Purpose::Shuffle = 6` is appended at the tail of the enum (the locked test asserts 0–6 are bit-for-bit unchanged); weighted-table draws reuse the existing, still-unused `Purpose::Loot = 3`; the R2 / R3 purposes will keep appending at the tail. The golden snapshot (`tests/golden.rs`) passes byte-for-byte, and `config_hash` is unchanged.
- **Configuration surface**: the landed shape has one more layer than the design draft — `model.loot: {rate_mult, tables: {table_name: {weights: {...}}}}`. `tables` goes through `ParamKind::Table` (a structural parameter, not entering the numeric channel), while `rate_mult` is an F64 numeric slot (params table count +1: 52 → 53). `loot: Option<LootConfig>` + `skip_serializing_if` (same precedent as the training field); when unconfigured, config_hash is byte-for-byte identical to the old version.
- **Draw primitives** (`rng.rs`): `WeightedTable` (from_weights validation / probabilities / pick via binary search), `Draw::weighted`, `DayRng::weighted` / `draw_stream` (streaming, advances n in one go) / `shuffle` (Fisher–Yates, n−1 draws) / `sample` (partial shuffle taking the first k) / `sample_weighted` (A-Res key-ordered method, `u^(1/w)` taking the k largest, total_cmp ordering + index tiebreak).
- **Distribution test** (`disttest.rs`, not in the simulation path): Pearson χ², Cochran bucket merging (expected ≥ 5), the p value via the regularized incomplete gamma (series + Lentz continued fraction, Lanczos ln Γ); CLI `disttest uniform | weighted`; a failed test exits with code 1, a configuration error with 2.

### R2 Delivery Record (2026-10-10)

- **purpose key discipline**: `Purpose::Gacha = 7` continues the tail append (the locked test asserts 0–7 bit-for-bit); the golden snapshot passes byte-for-byte, and `config_hash` is unchanged for configurations without gacha configured.
- **State and draw separated** (R2's payoff on the iron rules): the pity counter `gacha_since_hit` (together with `gacha_pulls` / `gacha_hits`) is an `Actor` field and **does not enter the RNG key**; every pull consumes a `Purpose::Gacha` key. The CRN test locks this down: an A/B pair that changes only `pity_hard` produces bit-for-bit identical daily statistics, with only the gacha KPI differing.
- **State machine** (`systems::gacha`): `hit_rate(cfg, k)` = `min(1, base_rate + max(0, k − pity_soft_start)·pity_soft_step)`, hard pity clamps to 1 when `k+1 ≥ pity_hard > 0` (soft pity only takes effect when `step > 0`); the `pull_until_hit` session semantic = "stop at first hit". `validate` rejects `base_rate ≤ 0 / > 1` and a non-positive step (≤ 0 would make the session never terminate).
- **Execution form**: `SimEvent::GachaRoll` is scheduled at tick 0 (Clock origin, before day 1) — the account-creation session enters no day's daily statistics; `RunMetrics.gacha_pulls_to_hit = total pulls / total hits`, an `Option` + `skip_serializing_if` (the training-field precedent); when unconfigured, the JSON is unchanged.
- **KPI full chain connected**: `MetricKey::GachaPullsToHit` enters the comparison / sweep / recommendation chain; params table count +4 (53 → 57, `model.gacha.{base_rate, pity_hard, pity_soft_start, pity_soft_step}`). The CLI simulate summary conditionally prints a gacha line.
- **Numeric reconciliation**: closed form `E[T] = (1 − (1−p)^H)/p` (truncated geometric), 2% / 50 → 31.79 (the design draft's hand computation of 31.6 was a rough estimate; the closed form governs); the core test reconciles with tolerance 1.0 (2,000 players). The no-pity degenerate case `1/p = 50` is covered by the same test.
- **Recommendation interval acceptance**: `examples/gacha-pity-sweep.yaml` sweeps `pity_hard ∈ {10..50}`; the hard constraint "E[T] ≤ 30" → feasible segment [10, 44.6] (the upper endpoint is interpolated; the analytic intersection is H = ln(0.4)/ln(0.98) ≈ 45.7, within ±1 of the CI jitter). The core test `抽卡_扫保底长度出推荐区间` locks the same conventions.
- **Disclosure convention consistency** (R2's form of the third acceptance item): "published = implemented" for the weighted table is carried by R1's `disttest weighted`; pity is a Markov chain structure (draws are not independent), so per the discipline in section 7 of this page **no χ² single-pull frequency is done** — reconciliation goes through the closed form E[T] ± CI95 (the two items above); the reporting layer outputting the mean and CI95 of `gacha_pulls_to_hit` is itself the consistency evidence.

### R3 Delivery Record (2026-10-10)

- **purpose key discipline**: `Purpose::Normal = 8` is appended at the tail (the locked test asserts 0–8 bit-for-bit); the golden snapshot passes byte-for-byte. With this, all 7 items on chapter 24's capability list have landed, and this page turns from a "design blueprint" into a "conventions archive".
- **Draw primitives** (`rng.rs`): the pure function `box_muller(u1, u2, mu, sigma)` (u1 sets the radius, u2 the angle; `u1 ≤ 0` is clamped to `f64::MIN_POSITIVE` to avoid ln 0) + `DayRng::normal` (consumes two uniforms back to back, counter +2) + `normal_clamped` (clamping is deterministic post-processing, consumes no draw, breaks no key). `sigma < 0` takes the absolute value; `sigma = 0` degenerates to a constant.
- **Double-consumption key stability (R3 acceptance)**: two arms with the same key each call `normal` with a different μ/σ, consuming the same pair of uniform values — subsequent draws are bit-for-bit identical (test `正态_双消耗键稳定`); changing μ/σ only changes the value and never moves the key, consistent with the CRN boundary in docs 06.
- **Statistical reconciliation (R3 acceptance)**: the mean over 100k samples lands within μ ± 4σ/√N, and the variance's relative deviation is < 4√(2/N) (`正态_均值方差对齐解析解`); χ² bucketing: `normal_buckets` (uniform buckets over ±k·σ, with samples outside the interval folded into the first and last buckets — **the end buckets' expectations absorb the tail mass**; otherwise the expectations do not sum to n, χ² carries a systematic bias, and the measured deviation is exactly the root of the 184.9 false positive) + `normal_cdf` (via the incomplete gamma P(½, x²/2), zero new approximation, Φ(1.96)=0.975 checked against the standard table). χ² passes across all 20 buckets on 100k samples, and feeding uniform samples into a normal must be caught at α=0.01.
- **CLI**: `disttest normal --samples/--buckets/--spread/--mu/--sigma/--alpha/--seed`, printing the measured mean and variance against μ/σ² plus the χ² report; a failure exits with code 1, a configuration error such as σ ≤ 0 exits with 2 (same conventions as uniform / weighted).

## Sources and Tiers

| Tier | Content | Source |
| --- | --- | --- |
| This repo (formulas) | Keyed structure, purpose registration, CRN boundaries, golden snapshots | [Chapter 06](./06-deterministic-rng.en), [Chapter 19](./19-testing.en), `crates/sandtable-core/src/rng.rs` |
| Cross-reference | The design-side conventions for expectation / hard pity / soft pity / variance / disclosure compliance | hello-game [numerical/05](https://github.com/cuihairu/hello-game/blob/main/docs/numerical/05.md) |
| Algorithm (weighted table) | alias method | A. J. Walker (1977); M. D. Vose, "A linear algorithm for generating random numbers with a given distribution", *IEEE Trans. Software Eng.* 17(9), 1991 |
| Algorithm (weighted without replacement) | A-Res key-ordered method | Efraimidis & Spirakis, "Weighted random sampling with a reservoir", *Inf. Process. Lett.* 97(5), 2006 |
| Algorithm (classic) | Fisher–Yates | Knuth, *TAOCP* Vol. 2 (the shuffle section under half-open addressing); Box–Muller: G. E. P. Box & M. E. Muller (1958) |
| Tooling documentation | Semantic comparison and cross-validation | [NumPy Generator](https://numpy.org/doc/stable/reference/random/generator.html), [SciPy chisquare](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chisquare.html) |
| Statistical rule | Expected count per bucket ≥ 5 | Cochran (1954) classic approximation rule |
| Organization | The three iron rules, state / draw separation, the verification selection table, the phasing | Synthesized by this page's author (design derivation under the docs 06 constraints) |
