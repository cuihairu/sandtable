---
title: 23 · Genre × Simulation Function Catalog
---


# Genre × Simulation Function Catalog

sandtable is a horizontal sandbox: the kernel (time / events / keyed randomness / online aggregation) and the experiment layer (sweep / sensitivity / recommendation / CI95) are genre-agnostic, and all genre knowledge lives in the configuration (see the [Pokémon case](./21-pokemon-case.md)). This page turns the view around for a **vertical survey**: organized by mainstream genre, a "catalog of the simulation functions commonly used when doing numeric simulation", compared item by item against sandtable's current state — which are generic building blocks (already present), which can be expressed through mapping, and which are gaps (extension directions).

This is directly linked to the research in [hello-game](https://github.com/cuihairu/hello-game): its [genre-coverage.md (coverage mapping from gameplay category to functional component)](https://github.com/cuihairu/hello-game/blob/main/docs/system/genre-coverage.md) (retrieved 2026-10-08) draws a coverage grid of **21 genres × 46 components** — each row of the genre list gives the core loop / the functional component demanded first / the dominant problem model, answering "what components does this kind of game need" from the **server-component side**; the `24-game-types-architecture` tree answers "how they are carried" from the **architecture side**; the `numerical` tree answers "how the numbers get decided" from the **design side**; this page answers "how are the numeric decisions for this kind of game validated in the sandbox and then written to disk" from the **simulation side**. The four views share one vocabulary of genres; the mapping between this page's six families and the 21 genres is at the end of the page.

## Status marker conventions

| Marker | Meaning |
| --- | --- |
| ✅ Have | Already in the kernel / experiment layer; configuration is all it takes |
| 🔶 Expressible | Expressible by mapping with no model change, or with a clear workaround (such as a nominal starting level) |
| ⛔ Gap | Needs a new System / new mechanics; listed as an extension direction |

## MMORPG (world-based, long lifecycle)

Typical simulation questions: does the output-spend closed loop inflate; does the dungeon difficulty ladder stall progress; do drop expectations pay off; are cohort behavior differences controllable.

| Simulation function | What problem it solves | Typical convention | Status |
| --- | --- | --- | --- |
| Combat-round expectation model | Win/loss and duration for player vs stage | Difference / ratio damage formula + hit variation | ✅ `combat.*` has both conventions: `damage_model` difference (default) / ratio (blocker #1 root-caused, [Pokémon case](./21-pokemon-case.md)) |
| Difficulty ladder (layer by layer) | Stage curve shape (sawtooth, not proportional) | Explicit per-layer HP / attack / defense table | ✅ `dungeon.tier_table` (blocker #3 root-caused) |
| Growth curve | Level-up pace and training accumulation | Power law `xp_base·L^xp_pow` | ✅ `progression.*` |
| Wild-monster training loop | Experience / gold source outside stages | Separate output band × behavior probability | ✅ `model.training` + `p_training` (blocker #4 root-caused, [Pokémon case](./21-pokemon-case.md) a true L1 start) |
| Economy output / spend / sink | Inflation and gold hoarding | Online aggregation `gold_earned/spent/sink_ratio` | ✅ `economy` aggregation ([KPI](./13-kpi-metrics.md)) |
| Loot tables (weighted) | Rarity distribution and expected output | Weighted roulette / alias | ✅ primitive + settlement landed (`WeightedTable` + `disttest` + victory-time draw scaled by `rate_mult`, KPI `loot_gold_per_player`; see [Random functions](./24-random-functions.md) and the [loot settlement design](../loot-settlement-design.md)) |
| Upgrade / star-rank pricing chain | Sink depth and currency recovery | Proportional cost chain | ✅ `upgrade_cost_*` (the lesson of blocker #5 in the Pokémon case: it must be calibrated in coupling with output) |
| Auction-house price dynamics | Pricing equilibrium between players | Supply-demand elasticity / stock-based game | ⛔ Gap (long term) |
| Cohort behavior and sessions | Spending depth ↔ progress differences | Three-cohort behavior parameters | ✅ `behavior.*` |
| Churn | Being stuck / long-term retention | Base churn + stall-condition churn | ✅ `churn.*` |

Architecture-side counterpart: the world-based long lifecycle and the layering of state services and persistence are in hello-game `24-game-types-architecture` (three chapters: standalone server / world-based / data-based); on the design side, the economy loop is in its `numerical/04`.

## FPS / MOBA (room-based, strongly real-time)

Typical simulation questions: TTK feel, weapon / hero balance, matchmaking quality and how the rank distribution evolves, in-match economy curves.

| Simulation function | What problem it solves | Typical convention | Status |
| --- | --- | --- | --- |
| TTK / hit-damage model | Firefight pace and balance | Hit probability × per-shot damage × rate of fire; the expected round count is sandtable's combat round | ✅ The skeleton is isomorphic (`combat.*` expected round count = TTK); ballistics / distance falloff 🔶 (via formula slots) |
| Hero / weapon balance sweep | The effect of parameter perturbation on win rate | sweep + sensitivity + recommendation | ✅ The full chain ([12](./12-parameter-sweep.md)/[14](./14-sensitivity.md)/[15](./15-recommendation.md)) |
| Skill rating and matchmaking | Segment convergence speed and wait time | ELO / Glicko-2 | ⛔ Gap (the rating algorithm is pure computation; what you want to simulate is "the score distribution evolving with matches", which needs a match-generation System) |
| Rank distribution evolution | Season reset / inflationary deflation | Markov chain / multi-replicate match streams | ⛔ Gap (depends on the rating algorithm) |
| In-match economy (kill rewards) | Comeback compensation / snowballing | Event-driven gold flow | 🔶 The event kernel exists; the economy System must be written per scenario |
| Network condition simulation | Lockstep vs state-sync behavior | Latency / packet-loss injection | ⛔ This belongs to architecture-side simulation (the territory of hello-game `24-game-types-architecture/04-network`); sandtable does not do it |

Authoritative reference for the rating algorithms: the original papers on Glicko and Glicko-2 are [published by the inventor Mark E. Glickman](http://www.glicko.net/glicko.html).

## Card games / auto-battlers (including pity-based monetization)

Typical simulation questions: gacha expectation and variance, the rate at which key deck cards come into hand, the ladder meta cycle, season-pass pacing.

| Simulation function | What problem it solves | Typical convention | Status |
| --- | --- | --- | --- |
| Gacha pity (hard / soft) | Expected number of pulls and a worst-case floor | Truncation / increasing-probability state machine | ✅ R2 has landed (`model.gacha` hard/soft pity state machine + closed-form reconciliation, see [Random functions](./24-random-functions.md)) |
| Deck sampling | Rate of getting key cards, opening-hand mulligan | Hypergeometric distribution / sampling without replacement | ✅ R1 has landed (`rng::shuffle` / `sample` / `sample_weighted`, see [Random functions](./24-random-functions.md)) |
| Matchup win-rate matrix | Meta counter relationships (rock-paper-scissors cycles) | A matrix of conventions + mixed strategies | 🔶 Single-match win rate is expressible (the combat model); matrix evolution needs a match-generation layer |
| Ladder distribution | Health of the rank structure | Same as the FPS matchmaking entry | ⛔ Same |
| Season pass / season pacing | Daily quest output vs pass pricing | Output curve + churn coupling | ✅ The output side is expressible (economy aggregation), the quest system 🔶 |
| Monetization numbers | First-purchase bonus / bundle value for money | Expected price model | On the design side see hello-game `numerical/06`; on the simulation side reuse economy aggregation 🔶 |

The design-side conventions (expectation = Σ result × probability, the recomputable arithmetic by which hard pity moves the 50-pull expectation forward to about 31.6 pulls, the smoothed version of soft pity's increasing probability) are all quoted from hello-game [numerical/05 Loot and probability design](https://github.com/cuihairu/hello-game/blob/main/docs/numerical/05.md) — the value of sandtable's simulation layer is upgrading this kind of hand-computed arithmetic into machine acceptance by **ten thousand samples + confidence intervals** (see the pity section of [chapter 24](./24-random-functions.md)).

## SLG / strategy (marches and aggregated combat)

Typical simulation questions: resource output rate and speed-ups, march / rally time windows, aggregated combat formulas, alliance power aggregation.

| Simulation function | What problem it solves | Typical convention | Status |
| --- | --- | --- | --- |
| Resource output rate and speed-ups | The output-spend closed loop | Rate model + currency conversion | ✅ Isomorphic with economy aggregation (output / spend / stock) |
| March / rally time windows | Map pacing and preventing sneak attacks | Distance / speed / bonuses | ⛔ Gap (needs a map / distance model; sandtable's layered time model is at "day" granularity, and minute-level marches belong to the extension) |
| Aggregated combat | The exchange ratio in a multi-army battle | Power ratios + weighted buffs | 🔶 The exchange ratio of a single battle is expressible in both conventions; the aggregation semantics (merging multiple units) ⛔ |
| Casualty / recruitment loop | The recovery pace after battle losses | Queues + rates | 🔶 The event kernel can host a System, but none exists off the shelf |
| Alliance aggregation | The payoff of collective action | Aggregation function + contribution score | ⛔ Gap |
| Territory / weather and other environmental parameters | Strategic-layer variables | State modifier table | 🔶 Registry numeric parameters can carry them, but the system logic needs an extension |

The architecture side (all-server / cross-server, sharded-server operations) corresponds to the three scale-classification chapters of hello-game `24-game-types-architecture`; its `numerical/02` choice among damage formula families (subtractive / multiplicative / hybrid) and this repo's blocker #1 (difference vs ratio) are the same problem stated from two sides — the latter has been root-caused with the dual-convention `damage_model` configuration (2026-10-09, see the blocker list in the [Pokémon case](./21-pokemon-case.md)).

## Idle games (offline growth)

Typical simulation questions: the feel curve of power-law growth, offline earnings caps, the speed of re-growth after a prestige reset, numeric-domain overflow.

| Simulation function | What problem it solves | Typical convention | Status |
| --- | --- | --- | --- |
| Power-law / exponential growth | Pacing control of "the numbers getting bigger" | `base·L^pow`, `a·b^k` | ✅ `progression.*` is exactly the power-law fit form |
| Offline earnings settlement | Return-player rewards and idle efficiency | Duration × rate × decay factor | 🔶 Day-granularity simulation naturally expresses "N days offline"; minute-level precision ⛔ |
| Prestige loop | The optimal cadence for trading a reset for permanent bonuses | Reset-point optimization (marginal return) | ⛔ Gap (reset semantics are not in the model) |
| Ad / speed-up rewards | How monetization points disturb the pace | Rate-multiplier events | 🔶 Writable as an event System |
| Big numbers and numeric overflow | Representation at the 10^30 level | Big-number library / logarithmic domain | ⛔ Gap (the core f64 domain, see [Tech stack](./08-tech-stack.md); revisit if an idle game becomes a case) |

Systematic references for idle numeric design: the Kongregate developer blog "The Math of Idle Games" series and the GDC talk on the same topic (Anthony Pecorella) are the community-recognized entry points (link stability is poor — search by title); the weak real-time / asynchronous section of hello-game `24-game-types-architecture` covers its architecture side.

## Simulation / management games (production lines and supply-demand)

Typical simulation questions: production-line throughput bottlenecks, supply-demand price equilibrium, staff / facility growth, quest reward pacing.

| Simulation function | What problem it solves | Typical convention | Status |
| --- | --- | --- | --- |
| Production-line throughput | The bottleneck stage and the pace of capacity expansion | Queueing theory / rate chain | 🔶 The event kernel (queue primitives already exist) can host a production-line System, but none exists off the shelf |
| Supply-demand price elasticity | Whether dynamic pricing converges | Inventory model / cobweb model | ⛔ Gap |
| NPC customer behavior | Foot traffic and spending distribution | Arrival process (Poisson) + preferences | ⛔ The arrival process is missing (the normal distribution has landed with chapter 24's R3; Poisson is not chartered — chapter 24's capability list stops at R3, and the follow-up extensions of the random primitives hang off the root todo.md entry "Follow-up random function extensions"; the candidate is registered in the closing paragraph of the introduction to that page's phasing plan) |
| Facility / staff growth | The payback period on investment | Cost-output payback period | ✅ Isomorphic with the upgrade chain + economy aggregation |

## Cross-cutting summary: generic building blocks vs genre-specific

Deduplicating the six tables gives a clear conclusion:

| Layer | Contents | sandtable positioning |
| --- | --- | --- |
| Generic building blocks | Combat-round expectation, growth curves, economy output / spend / sink, cohort behavior, churn, keyed randomness, replicates / CI95, sweep / sensitivity / recommendation | **Kernel + experiment layer, shared by every genre** (landed) |
| Semi-generic | Loot tables / pity / shuffle, difficulty ladders, aggregated combat, offline settlement | The random primitives are complete (all 7 items of [chapter 24](./24-random-functions.md) have landed); new primitives hang off todo.md as needed; the rest go through mapping or an extended System 🔶 |
| Genre-specific | Matchmaking / ladder, march / rally, auction house / supply-demand, prestige, production lines | One System extension per genre ([Complex behavior extension interface](./07-config-formula.md)); not part of the kernel; on the random-primitive side they correspond to chapter 24's landed list and the gated entries in todo.md |

This is exactly the argument behind sandtable's choice of a "horizontal sandbox": **six genres of game share about sixty percent of their simulation needs; the shared part becomes the kernel and the differing part becomes plugins** — the value of this catalog is pinning down "sixty percent" and "forty percent" item by item, so that genre logic never gets stuffed into the kernel.

## Mapping to hello-game's 21 genres

This page's six families are grouped by "simulation function family" (functions and conventions within a family are largely shared), and map onto the genre list in genre-coverage as follows; read the "typical simulation questions" row of each of the six families against the "core loop / dominant problem model" columns of the genre rows there:

| This page's six families | genre-coverage genres |
| --- | --- |
| MMORPG | MMORPG and open worlds |
| FPS / MOBA | MOBA; FPS / TPS and tactical shooters |
| Card games / auto-battlers | Card games and CCGs; auto-battlers (adjacent to turn-based RPG and wargames) |
| SLG / strategy | SLG and 4X season sandboxes |
| Idle games | Idle games and afk progression |
| Simulation / management games | Simulation / management and life sims |

The simulation demands of the remaining genres (card & board matches, party games, match-three, music rhythm, fighting, racing sports, RTS, tower defense, ARPG, survival building, roguelike, UGC) are largely subsets or combinations of the six families' functions (card & board = shuffle / sampling without replacement; ARPG = combat rounds + loot table + layer-by-layer table); add families in the same table format when needed, without pre-empting it.

Also note that the two gap lists sit on **different axes**: the 11 gaps in genre-coverage are on the server **component side** (quests, achievements, upgrade / star rank, battle pass, …), while the ⛔ marks on this page are on the **simulation-function side** (gacha pity, matchmaking rating, supply-demand equilibrium, …) — component gaps are solved by supplementary chapters on that tree, simulation gaps are solved by this repo's extension phases; the two do not point at each other.

## Sources and grading

| Level | Contents | Source |
| --- | --- | --- |
| This repo (formulas) | Every ✅/🔶 verdict in the status column | Chapters 04–15 and 21 of these docs, plus the repo code |
| Cross-reference | Genre vocabulary and the genre-list baseline (21 genres × 46 components, the six-family mapping), design-side conventions (expectation / pity / formula families), architecture-side counterparts | hello-game [genre-coverage.md](https://github.com/cuihairu/hello-game/blob/main/docs/system/genre-coverage.md), the `24-game-types-architecture` tree and the `numerical` tree |
| External (algorithms) | The original Glicko / Glicko-2 papers | [glicko.net (Mark E. Glickman)](http://www.glicko.net/glicko.html) |
| External (survey) | Idle math design material | The "The Math of Idle Games" series (Kongregate blog / GDC, Anthony Pecorella; search by title) |
| Organization | Genre grouping, the "sixty / forty percent" summary, the catalog's table structure | Synthesized by this page's author; not an industry standard |
