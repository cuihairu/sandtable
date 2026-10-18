# sandtable Loot Settlement System Design

**Status: decided via patrol delegation (2026-10-20, order r0240).** This is the design-first step the 2026-10-18 independent review mandates for Table-3 batch 2 ("design first, implement after"); the delegation record is §4. Implementation follows test-first in the same batch; ledger tracking lives in `todo.md`. Anchors below are against `3d04e1a`.

## 0. Positioning

- The review's stopgap (P1-6) rejects any `model.loot` config at load and keeps the `rate_mult` numeric channel closed, so no silently ineffective knob exists today. This design gives that surface a consumer: a settlement step that draws from a weighted table on battle victory and grants currency/xp — turning the planned shape of chapter 24 §3 into live semantics.
- Non-goals: no item/inventory system (drops are currency grants only); no per-tier binding table (dungeon tier config already carries gold/xp — loot is a bonus layer on top); no alias-method hot path (chapter 24 already defers it until a table is referenced ~10⁶ times/day).

## 1. Current state (code anchors)

- `Purpose::Loot = 3` exists, unused in the sim path (`rng.rs:22-47`; only `disttest weighted` consumes it, `main.rs:1290-1293`); the append-only lock test covers 0–8 (`rng.rs:361-395`).
- Battles are not queue events: `settle_battle` returns `BattleOutcome { win, rounds, damage_dealt, gold, xp }` (`combat.rs:123-131`); the victory branch sits inline in `PlayerDaySystem::update` (`sim.rs:299-316`) with the local `DayRng::new(seed, actor.id, day)` at `sim.rs:255`.
- Existing faucets: battle gold `sim.rs:312` (× whale mult), training gold/xp `sim.rs:281-291`; xp via `progression::gain_xp` (`progression.rs:15-36`). No other `gold +=` in the kernel.
- `LootConfig { rate_mult, tables }` already parses and passes per-item validation (`config.rs:614-636`) before the unconditional P1-6 rejection (`config.rs:638-644`); `loot` is `Option` + `skip_serializing_if` (`config.rs:542-543`), so unconfigured configs keep `config_hash` byte-identical (`config.rs:892`, test `952-953`).
- Registry specs retained (`registry.rs:243-253`); the numeric channel is closed both ways (`registry.rs:449-453`, `567-571`) with a mirror-test exemption (`registry.rs:673-695`); params table = 56 rows.
- `disttest weighted` already reads loot tables from a scenario YAML (`main.rs:1265-1293`) but is unreachable for loot-bearing files today (load rejects first).
- `WeightedTable` primitives are landed and χ²-verified (`rng.rs:130-192`, acceptance `rng.rs:453-470`).

## 2. Requirement

Designers maintain drop tables as YAML structure (the Excel→CSV channel covers numerics only; tables follow the `tier_table` precedent — shape changes are YAML edits, not numeric-channel writes). The sim must grant table amounts on victory so that sweep / recommendation / report can answer the review row's question — "the economic impact of the drop-rate multiplier" — with numbers instead of a rejected config.

## 3. Design

### 3.1 Configuration surface (extends the documented planned shape by one sibling map)

```yaml
model:
  loot:
    rate_mult: 1.0       # numeric channel re-opens (params table 56 → 57)
    on_victory: chest    # the table drawn once per battle victory
    tables:
      chest:
        weights: { gold_small: 70, gold_mid: 25, xp_charm: 5 }  # draw distribution (unchanged shape)
    rewards:             # NEW: entry name → granted amounts (structural, tier_table precedent)
      gold_small: { gold: 10, xp: 0 }
      gold_mid:  { gold: 50, xp: 0 }
      xp_charm:  { gold: 0,  xp: 20 }
```

### 3.2 Settlement semantics

- Hook: inline in the victory branch (`sim.rs:309-316`), after the base reward accounting — one `DayRng::weighted(Purpose::Loot, &table)` draw per victory (CDF binary search), then `round(amount × rate_mult)` per currency; the gold grant follows the battle-gold whale-mult discipline and xp goes through `progression::gain_xp` (level-up cascade included).
- Determinism: battles resolve in player-id order with sequential event indices, so loot draws reproduce exactly.
- Unconfigured configs consume zero loot draws — nothing else moves.

### 3.3 RNG key discipline

- Consumes the reserved `Purpose::Loot = 3` through the local `DayRng`; no new purpose, no key-shape change, and no loot state exists (state/key separation holds trivially).
- Purpose is a key dimension, so loot draws cannot disturb the CombatHit / CombatDamage / Churn / … streams; A/B comparability on non-loot axes is preserved by construction and locked by a CRN isolation test (§5).

### 3.4 Numeric channel, params, config_hash, metrics

- Re-open `model.loot.rate_mult` read/apply (delete the two `Err` arms and the mirror-test exemption); spec descriptions drop the "reserved slot" wording; params table 56 → 57.
- `model.loot.tables` stays `ParamKind::Table` (structural; not in the numeric channel).
- `config_hash`: unconfigured → unchanged (existing Option-skip + test); configured → the loot section enters the hash (intended; BTreeMap ordering keeps it stable, `config.rs:233`).
- New `MetricKey::LootGoldPerPlayer` appended at the tail (`ALL` 7 → 8, `experiment.rs:157-183`), Option-metric per the gacha precedent: `None` + `unavailable_reason` "loot 未配置" when unconfigured (P1-5 mechanism), `skip_serializing_if` on the JSON field; CLI summary gains a conditional loot line and the metric lists in compare / sweep / optimize / surrogate help text gain the name.

### 3.5 disttest: no new kind

The weighted kind already covers table draws end-to-end (χ² via the shared helpers); re-opening load makes it reachable on loot-bearing YAMLs again, which becomes part of acceptance. `rate_mult` scales quantity, not shape, so distribution tests do not touch it (chapter 24 discipline).

## 4. Decision points (delegation record, 2026-10-20)

| # | Decision point | Choice | Reason (one line) | Rejected |
| --- | --- | --- | --- | --- |
| 1 | Hook point | Inline in the victory branch (`sim.rs:309-316`) | `BattleOutcome` is local data; battles are not queue events | New `SimEvent` variant (probe/register discipline cost, zero gain; gacha's tick-0 event doesn't transfer — it is account-creation-time) |
| 2 | Table entry semantics | Flat `weights` + sibling `rewards` map | Keeps the chapter-24 documented shape; amounts are structural per the tier_table precedent | Entry = `{weight, gold, xp}` inner map (shape divergence); kernel-fixed catalog (not calibratable — against the repo's purpose) |
| 3 | Table binding | `on_victory` names the table; one draw per victory | Explicit and auditable; extensible later | Per-tier bindings map (tier config already carries gold/xp; YAGNI); drawing all tables (implicit, un-auditable) |
| 4 | Amount arithmetic | `round(amount × rate_mult)`, whale mult as battle gold | Matches the existing faucet discipline; deterministic | Floor (down-bias, breaks expectation math); bypassing whale mult (inconsistent faucet treatment) |
| 5 | RNG keys | Existing `Purpose::Loot = 3` via the local `DayRng` | The slot was reserved for exactly this; the append-only lock stays untouched | New tail purpose (key-space growth, no need) |
| 6 | Metric | `LootGoldPerPlayer` tail-append, Option / unavailable_reason | The review row's question needs a number; gacha precedent fits exactly | No metric (impact invisible); share-of-gold metric (derivable in the report layer from the two gold metrics) |
| 7 | disttest | No new kind | Weighted χ² already covers the primitive end-to-end; it just becomes reachable again | A dedicated "loot" kind (duplicate machinery) |
| 8 | Load rejection | Remove the P1-6 rejection; keep and extend per-item validation | The stopgap's purpose — no silent knobs — is fulfilled by having a consumer | Keep rejection behind a flag (two truth sources) |

## 5. Phasing and acceptance

Phase A (this batch, test-first — red before each step's code):

1. Config validation tests: missing reward name for a weight entry; unreferenced reward entry; `on_victory` not naming a table; negative amount; all-zero amount entry; unconfigured invariants.
2. Registry: remove the mirror-test exemption → `rate_mult` read/apply Ok; params count 57.
3. CRN isolation: an A/B pair differing only in loot config → non-loot daily statistics bit-identical, loot KPI differs (gacha precedent).
4. Golden: unconfigured snapshots byte-for-bit; purpose lock 0–8 unchanged.
5. disttest weighted on a loot-bearing YAML reachable again, χ² passes.
6. Metric: `unavailable_reason` when unconfigured; value present when configured.
7. Implementation order: config struct + validate → registry re-open → sim settlement → metrics → CLI summary line.
8. Engine contract: `LootContract::validate` (`engine/importer.rs:270-291`) learns `rewards` / `on_victory`; the 19 roundtrip tests stay green.

Acceptance gates: `cargo test --workspace` green; clippy `--all-targets` zero warnings; `cargo fmt --check`; `pnpm docs:build`; `params export` prints 57 项; KPI anchor cases stay green (case configs do not configure loot).

Phase B (deferred, on demand): alias method hot path; per-tier bindings; non-currency item counts (inventory-adjacent).

## 6. Sync checklist (implementation must touch)

- docs: chapter 23 loot row 🔶 → ✅; chapter 24 warning box → delivery record with updated params counts; audit doc B4 annotation.
- ledger: `todo.md` item with evidence (commands + numbers + file:line).
- status line of this document: updated to "landed" in the implementation commit.
