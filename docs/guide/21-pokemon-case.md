---
title: '21 · Real-Config Validation: The Pokémon Case'
---


# 21 · Real-Config Validation: The Pokémon Case

P5c's acceptance question is: **can the public numbers of an external real game be plugged into sandtable without changing the model? And what expressiveness gaps does the integration expose?**

The sample chosen is Pokémon (Generation 1, Kanto region): the numbers are fully public, the community documentation is complete (formulas, base stats, gym-leader parties and prize money all have authoritative pages), and its combat/progression structure is isomorphic enough to sandtable's dungeon/progression — the divergences land exactly on the content of the friction list.

Configuration is documentation: [examples/pokemon.yaml](https://github.com/cuihairu/sandtable/blob/main/examples/pokemon.yaml) (baseline) and [examples/pokemon-sweep.yaml](https://github.com/cuihairu/sandtable/blob/main/examples/pokemon-sweep.yaml) (sweep experiment), with the source noted next to every number.

## Data-source tiers

The numbers in the case are graded on three confidence levels, and the document does not mix them:

| Level | Content | Source |
| --- | --- | --- |
| Formulas (authoritative) | Damage formula, stat formula, experience curve, experience yield formula | [Bulbapedia: Damage](https://bulbapedia.bulbagarden.net/wiki/Damage), [Stats](https://bulbapedia.bulbagarden.net/wiki/Stat), [Experience](https://bulbapedia.bulbagarden.net/wiki/Experience) |
| Anchors (page / disassembly verified) | Eight gym-leader prize payouts (RB), ace and level (per-gym party), ace base stats | [Gym Leader](https://bulbapedia.bulbagarden.net/wiki/Gym_Leader), each gym's page, Pokédex entries, [pokered disassembly](https://github.com/pret/pokered) (`data/trainers/parties.asm`: per-gym parties and levels) |
| Assumption layer (sandtable semantics) | behavior / cohort / churn parameters, upgrade spending chain, global scaling factor, absolute exchange rate | Supplied by this model (Pokémon has no corresponding structure) |

Core formulas (Generation 1):

- **Damage**: `((2L/5+2)·power·A/D/50 + 2) × STAB × type × critical × Random(0.85–1.00)` — A/D is a **ratio** model with ±15% random fluctuation;
- **Stats** (IV/EV = 0): `HP = floor(2B·L/100)+L+10`, the others = `floor(2B·L/100)+5`;
- **Progression curve** (Medium Fast): total experience to reach L = L³, i.e. one more level needs `3L²−3L+1`;
- **Experience yield** (Generation 1): `floor(base_exp × level / 7)`;
- **Gym-leader prize money** (RB): Brock ¥1,400 → Misty ¥1,900 → Lt. Surge ¥2,376 → … → Giovanni ¥7,000.

## Mapping

### Global scaling

The damage magnitude of the Pokémon 50-level range (~15–40 per round) differs from sandtable's default range (~80 per round). Take a **global linear factor ×5** to uniformly scale the player's three stats, monster HP/attack/defense, and experience yield, so the order of magnitude of combat rounds aligns (ratio-convention baseline t0: a player trained to the ace's level (~L14) clears Brock's Onix in 2–3 rounds). The factor is 5 rather than the exact equivalent value (5.33) purely for configuration readability; the round-count deviation is folded into the calibration margin.

### Combat convention (ratio, copied directly)

sandtable supports the ratio convention (`combat.damage_model: ratio`, root-fixing friction #1), so the Pokémon damage formula can be copied straight as `dmg = ratio_k·attack/(attack+defense)` with **zero conversion**. Calibrating `ratio_k`: Gen1 L50 power-60 expected damage `((2L/5+2)·60·A/D/50 + 2)`, taking the random midpoint 0.925, in the ×5 domain the A/D=1 anchor ≈ 131 → `k = 2×131 ≈ 262`, taking **260** (configuration readability, same precedent as the rounding behind the global ×5). The ratio structure aligns at the anchor; the original formula's nonlinear terms (power/level terms) are not bit-equivalent — same precedent as the delta conversion, folded into the calibration margin.

### Mapping table

| Pokémon concept | sandtable parameter | Value | Source level |
| --- | --- | --- | --- |
| Kanto's eight gyms | `dungeon.tiers` | 8 | Formula structure |
| tier0 = Brock's Onix@L14 | `m_hp / m_attack / m_defense` | 165 / 85 / 245 (anchor row) | Anchor (direct copy) |
| Gym-leader ladder shape per tier (Onix→Rhydon) | `dungeon.tier_table` | Three-dimensional 8 rows per tier (below) | Anchor (direct copy) |
| Composite-power-convention reference | `tier_growth` | 1.25 (geometric fit; not used when a per-tier table is given) | Anchor (direct copy) |
| First-gym prize ¥1,400 | `reward_gold` | 1400 (anchored 1:1) | Anchor |
| Onix@L14 yield 216 | `reward_xp` | 1080 (×5) | Formula + anchor |
| Prize growth rate (1400→7000) | `reward_gold_growth` | 1.26 | Formula + anchor |
| Experience growth rate (216→1457) | `reward_xp_growth` | 1.31 | Formula + anchor |
| Medium Fast `3L²−3L+1` | `xp_base / xp_pow` | 15 / 2.0 (power-law fit, ×5) | Formula |
| Charizard 84/78 base stats | `warrior.attack / defense / hp` | 30 / 30 / 60 (L1 stats ×5, real start) | Formula (direct copy) |
| Wild-mob training output (assumption-layer analogy) | `training.xp / gold` + `behavior.*.p_training` | 300 / 100 + cohort bands | Assumption layer |
| Per-level growth `B/50` | `level_*_gain` | 8 / 8 / 13 (×5 rounded) | Formula |
| Damage randomness 85–100% | `p_hit / dmg_var` | 0.95 / 7 | Formula |
| Ratio damage formula, A/D proportional structure | `combat.damage_model / ratio_k` | ratio / 260 (anchor-calibrated) | Formula + anchor |
| Session structure, churn (recalibrated), spending chain, cohorts | behavior / churn / upgrade_* | churn recalibrated for the training loop, the rest kept at defaults | Assumption layer |

### Per-tier table (the `tier_table` after root-fixing friction #3)

Each gym's ace level comes from pokered's `parties.asm`, base stats from the Pokédex; the three dimensions are the stat formula `floor(2B·L/100)+5` (HP is `+L+10`) ×5, copied directly, zero conversion:

| t | Leader | ace @ level | hp (×5) | attack (×5) | defense (×5) |
| --- | --- | --- | --- | --- | --- |
| 0 | Brock | Onix @14 | 165 | 85 | 245 |
| 1 | Misty | Starmie @21 | 280 | 180 | 200 |
| 2 | Lt. Surge | Raichu @24 | 310 | 240 | 155 |
| 3 | Erika | Victreebel @29 | 425 | 325 | 210 |
| 4 | Koga | Weezing @43 | 540 | 410 | 540 |
| 5 | Sabrina | Alakazam @43 | 500 | 240 | 215 |
| 6 | Blaine | Arcanine @47 | 705 | 540 | 400 |
| 7 | Giovanni | Rhydon @50 | 825 | 675 | 625 |

The jagged shape is real (it is determined by each ace's base stats): Raichu's 55 defense is a glass cannon (defense 155), Weezing's 120 defense is a wall (defense 540), Alakazam's 50 attack / 45 defense trails Weezing and turns fragile again (240/215). Against the composite-power-convention 1.25 geometric ladder, the per-tier deviation peaks at +34% (Weezing) and bottoms at −43% (Alakazam) — precisely the "shape rotation" a single `tier_growth` parameter cannot express, and the reason the per-tier table exists.

Output (gold / xp) does not enter the table: the **growth rates** of prize money and experience are already expressed exactly by the dual growth rates (see friction #2), the mid-section shape is approximated geometrically, and the per-slot prize/experience series can be appended to the table later (an omitted inline `gold / xp` falls back to the anchor geometry).

## Run-through record

`validate` → `simulate` (10,000 players × 30 days) → `sweep` → `recommend` → `report` all pass; the case runs on the ratio convention (`damage_model: ratio`) with players starting for real at L1 (the training output surface brings them to a first-gym-combat-ready level). The numbers below are on the convention after the two root fixes landed:

**Baseline tiers** (300 players × 2 replicates, sampled):

| Cohort | Mean level | Mean gold | churn |
| --- | --- | --- | --- |
| casual | 12.7 | 6,717 | 9.2% |
| core | 14.5 | 12,099 | 12.2% |
| whale | 36.7 | 60,611 | 9.7% |

The cohort progression gradient matches the "daily runs casual≈1 / core≈2 / whale≈5" behavior assumption; the 30-day-end equivalent badge counts are casual 0–1 / core 1–2 / whale 4–6 (first-gym threshold ≈ L14), and whales do not touch the original's 50-level cap — starting from L1 puts the endpoint lower than the old convention (nominal L14 start, 55.6) and the shape sits closer to the original's pacing. Behavior/churn is the recalibrated assumption layer (see friction #4).

**Single-axis sweep** (`model.warrior.attack` 20→220, i.e. the mismatch between "initial training" and "the gym-leader curve", 4 replicates; the hard constraints became churn ≤ 0.2 and retention_d7 ≥ 0.9 — the win_rate aggregate includes training-period losses and is no longer suitable as a hard constraint):

| attack | win_rate | churn_rate | power_p50 | Verdict |
| --- | --- | --- | --- | --- |
| 20 | 0.335 | 0.123 | 545 | PASS |
| 60 | 0.640 | 0.106 | 720 | PASS |
| 100 | 0.719 | 0.105 | 809 | PASS |
| 140 | 0.754 | 0.103 | 891 | PASS |
| 180 | 0.754 | 0.103 | 971 | PASS |
| 220 | 0.754 | 0.103 | 1051 | PASS |

- **Initial training no longer decides life or death**: attack 20 (less than two-thirds of baseline) still has churn of only 0.123 — the training loop catches the fall, and a weakly started player goes back to training instead of spiraling into death. Compared with the old convention (under the delta convention, the same axis's low point was win 0.53 / churn 0.45, both FAIL), this is exactly the semantic difference from jointly root-fixing friction #1 + #4;
- win_rate rises with initial training and saturates at 0.754: the more trained, the earlier the high tiers unlock, and high-tier losses enter the denominator — the bottleneck shifts from "can't beat it" to "climbs fast";
- Elasticity (OAT): `churn_rate −0.106`, `win_rate +0.556`, `power_p50 +0.223`, `gold +0.437`, all significant;
- **Recommended interval [20, 220]** (the whole range is feasible), Confidence Medium.

**report**: a single-file HTML merging multiple sources, with the sweep line chart (SVG, with CI whiskers and a recommendation band), KPIs, and the recommendation block.

## Friction list (expressiveness gaps exposed by the integration)

1. **Delta vs ratio combat model**: the ratio model lets damage shrink smoothly toward zero when A/D ≪ 1, while the delta model clamps at 1 — the root cause of the day-one wipeout. Any "player far weaker than the level" scenario (the normal state in real games) needs a delta-equivalent conversion to express, and single-parameter scaling cannot save a negative delta. **Resolved** (2026-10-09, root fix): the `combat.damage_model` explicit convention switch landed — default `difference` (delta convention, old configuration semantics bit-for-bit unchanged, golden snapshots unchanged); `ratio` switches to the ratio convention `dmg = ratio_k·attack/(attack+defense) + var` (same lower bound of 1 and same floating addition point as the delta convention; when A ≪ D the damage shrinks smoothly with no floor). `ratio_k` is a registry numeric parameter (sweepable) and **only takes effect under the ratio convention** — supplying it explicitly while the convention is unswitched makes `validate` error (preventing sweeps of dead parameters, same precedent as the #2 old/new field split: old configurations never silently change semantics, and new behavior requires an explicit opt-in). Once the convention switches, attack/defense values can be copied directly from external formulas, and this case's delta-equivalent conversion layer was deleted wholesale (see the rewritten Mapping section).
2. **gold and xp shared `reward_growth`**: the real curves grow at 1.26 (prize money) and 1.31 (experience) respectively, and a shared parameter can only take one. **Resolved** (2026-10-07): split into `reward_gold_growth / reward_xp_growth`; the legacy spelling `reward_growth` is only permitted at load time and acts on both under the old convention (old configurations never silently change semantics; explicit new fields take precedence), it is not sweepable, and it does not enter the parameter table. This case uses gold 1.26 / xp 1.31, and the last-gym prize's +35% overstatement disappeared with it.
3. **A single `tier_growth` cannot express shape rotation**: a single geometric parameter can only fit the composite-power convention. **Resolved** (2026-10-07): the `dungeon.tier_table` per-tier explicit array landed — three dimensions cover the geometric derivation per slot, an omitted inline `gold / xp` falls back to the anchor geometry, and its length must equal `tiers` (not in the numeric channel: changing the tier shape goes through YAML editing, and sweepable numeric parameters are unaffected). This case has switched to the per-tier table (see the Mapping section): hp 1.26 / attack 1.34 / defense 1.14 (endpoint geometric fit), the defense series 245→200→155→210→540→215→400→625, with composite-power deviations against the 1.25 geometric ladder peaking at +34% (Weezing) and bottoming at −43% (Alakazam). Note: two cells in the first draft's defense series 61→126→49→…→335 failed recomputation (Raichu's level is 24 not 26, Rhydon's base defense is 120 not 130), corrected cell by cell against pokered's `parties.asm` and the Pokédex.
4. **No wild-mob training loop**: the first mapping anchored tier0 at Onix@L14, simulated players started at level 1 and ground through max(1, −31) all game, and everyone was wiped within 30 days — the real game's two-tier strength structure "wild mob → gym leader" was flattened by a single-tier ladder. This case's workaround was **players starting at a nominal L14**. **Resolved** (2026-10-10, root fix): the core landed the **training output surface** — `model.training { xp, gold }` output plus each cohort's `p_training` behavior band; the training band fires between upgrading and exploring, gold and XP are credited, leveling advances, and it does not enter combat statistics (the win-rate denominator excludes training); a zero output `{0,0}` is legal and inert (the parameter-template back-derivation shape); supplying only the output side or only the behavior band makes `validate` error (the coupling is not silent). The two strength layers (wild tier / gym tier) were not built — the training output surface is cheaper to implement and solves the same problem: players start for real at L1, and the training band brings them to a first-gym-combat-ready level (casual ≈ L14 equivalent in about 20 days, whales in about 5), and the nominal-start workaround was deleted. The case switched in sync: warrior 30/30/60 (L1 stats ×5), churn recalibrated (`p_stall` 0.05→0.02, `stall_days` 2→3: the original parameters were calibrated for everyone starting at L14, so late-game days with no leveling no longer bleed at 5%/day), and training xp 300 as the assumption layer "one trip = aggregated wild encounters in a session" (a single original creature yields too little, and the 30-day pacing does not line up).
5. **The gold sink is too shallow**: Pokémon has no gold recovery loop, and after applying the upgrade chain (`50·1.25^k`) 30 days stockpiles 200k gold per capita — the upgrade economy has zero tension in this scenario. This conversely shows sandtable's sink parameters (`upgrade_cost_*`) need a calibration flow coupled with the output curves, which the case keeps as-is on the assumption layer.
6. **Behavior/churn is a pure assumption layer**: Pokémon has no session or churn concept, and `behavior.* / churn.*` all stay at defaults — the case only validates that the model structure can be integrated, not that these parameters are reasonable.

## Conclusion

**Integration is feasible**: formula- and anchor-level numbers (progression / prize money / base stats) can drop directly into the existing parameter table; after `damage_model` explicitly switches to the ratio convention, attack/defense are copied directly with zero conversion; players starting for real at L1 are brought to the first-gym threshold by the training output surface and the whole chain passes; the conclusions the sweep and recommendation give on the real-shaped curves (initial training no longer decides life or death, the bottleneck shifting from "can't beat it" to "climbs fast") are semantically interpretable.

**The conversion layer is deleted**: the first version, because the model only had the delta convention, could not copy attack/defense directly and needed a delta-equivalent pass at every anchor; once the `damage_model` ratio switch landed, that layer was deleted wholesale, and attack/defense values became direct copies of the stat formula — the cost of the convention difference moved from the configuration side to the model side, paid once.

**Two small and two large expressiveness gaps, all four root-fixed**: #2 (splitting the dual growth rates) and #3 (the per-tier array) were root-fixed with small changes (2026-10-07); #1 (combat convention) was root-fixed on the ratio convention (2026-10-09, the explicit `damage_model` switch, the conversion layer deleted with it); #4 (the training loop) was root-fixed by the training output surface (2026-10-10, `model.training` + `p_training`, real L1 start, the nominal-start workaround deleted).

## Designer workflow: from changing one number to seeing the impact

The closed five-step loop as exemplified by this case (each step's full convention is in the corresponding chapter):

| Step | Action | Command / entry | See |
| --- | --- | --- | --- |
| 1 | Change numbers | Edit the case YAML (numeric parameters, behavior bands, per-tier table) | [07 Config and formulas](./07-config-formula.md) |
| 2 | Validate + single run | `sandtable validate` → `sandtable simulate` (produces KPIs and cohort tiers) | [10 CLI](./10-cli.md) |
| 3 | Single-axis sweep | `sandtable sweep` (KPI curves along the parameter axis + hard-constraint adjudication) | [12 Parameter sweeping](./12-parameter-sweep.md) |
| 4 | Get the recommendation | `sandtable recommend` (feasible interval + confidence) | [15 Recommendation interval](./15-recommendation.md) |
| 5 | Look at the artifacts | `sandtable report` (single-file HTML: curves + KPIs + recommendation block); data-file convention | [09 Data output](./09-data-output.md), [13 KPI](./13-kpi-metrics.md) |

After finishing step 1, return to step 2; after several iterations, the settled case values that enter the repo have their level anchored by the CI case tests (see [19 Testing](./19-testing.md) — changing case values = an intentional change, and the anchors must be updated in sync).
