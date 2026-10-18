---
title: 07 · Configuration and Formula Engine
---


# Configuration and Formula Engine

## Principles

::: tip Core principle
**Configuration describes data; code / scripts describe complex behavior.** Do not let YAML become a programming language.
:::

```yaml
# Data and simple rules go in config
stats:
  attack: 100
  defense: 80
formula:
  damage: "max(1, attack - defense)"
```

Complex behavior involving flow control or multi-step state goes through the System extension mechanism (see below) — do not stuff logic into YAML.

## Formats

| Format | Role |
| --- | --- |
| YAML | The primary format for human editing |
| JSON | Machine interchange and the **canonical authoritative format** (config_hash is computed from canonical JSON) |
| TOML | CLI / engineering configuration, optional |

### YAML Library Selection (Decision Record)

- `serde_yaml`: the maintainer archived it in March 2024, declaring it unmaintained — **rejected**;
- `serde_yml`: a popular fork that appeared afterward, now also unmaintained, and the community disputes its implementation quality — **rejected**;
- **`serde_yaml_ng` adopted** (the maintained fork of serde_yaml, API-compatible).

YAML has implicit-type traps of its own (e.g., unquoted `no` / `on` parse as booleans; `1.10` parses as float). Convention: **any string that is not semantically boolean must be quoted**; machine-to-machine exchange and hashing always go through JSON.

## Parameter Registry

Dot-path addressing like `warrior.attack` needs a central registry; otherwise sweep and override have nothing to validate against:

```text
Parameter registry: path → type / range / default / description
```

- Validated at load: unknown paths error, type mismatches error, out-of-range errors;
- The addressing of [Parameter Sweep](./12-parameter-sweep.md) and the output of [Recommendation](./15-recommendation.md) are both based on the registry;
- The registry is generated with Model compilation, with zero string lookup at runtime;
- Non-numeric slots (duration `Dur`, formula `Expr`, per-level tables `Table`) are registered for validation and hints but do not enter the numeric channel — not scannable, absent from the parameter table;
- Legacy fields (e.g., `model.dungeon.reward_growth` before the split) are allowed through YAML loading and mapped per the old semantics, likewise without entering the numeric channel — old configurations load with unchanged results, and the new spelling takes priority when explicitly given.

## Normalization and config_hash

::: warning The same configuration must yield the same hash
The input to config_hash is the **normalized configuration**: keys sorted lexicographically, comments and whitespace removed, numbers in a unified representation, serialized to canonical JSON, then hashed with SHA-256. Two YAML files with different key order or different comments must produce the same hash as long as their semantics are identical.
:::

The configuration root carries a `schema_version` field, used for compatibility judgment and migration as the configuration structure evolves.

## Formula Engine

### Scope (MVP)

Controlled expressions, not a general-purpose language:

```text
Arithmetic · Comparison · Boolean · Built-in functions (min / max / clamp / floor / ceil / abs / round) · Conditionals
```

Example: `damage = max(1, attack * skill_ratio - defense)`.

Table lookup is not at the expression layer — it is listed under "Follow-up Extensions" below; function semantics, operator precedence, and common curve shapes (the figure is sampled from the real evaluator) are in [Chapter 25](./25-formulas-and-curves.md).

### Execution Model: Compile at Load Time

Damage-type formulas are evaluated billions of times within one experiment — a hot path that must be compiled for execution:

```text
Load time:  parse AST → resolve variable names to indices → compile to closures / flat instructions
Runtime:    evaluate by index lookup, zero string lookup
```

### Evaluation of Existing Options (Decision Record)

| Option | Conclusion |
| --- | --- |
| evalexpr | Actively implemented, but since 13.x its license is **AGPL-3.0**, incompatible with this project's Apache-2.0 — **excluded**; the old MIT versions are no longer maintained, not adopted |
| rhai | Dual-licensed Apache-2.0 / MIT, actively maintained, offers a `no-float` integer mode that helps determinism. Kept as a **candidate for the complex-behavior scripting extension**, to be evaluated for introduction in a later phase |
| Built-in minimal evaluator | Adopted for the MVP: bounded capability scope (the five categories above), compile at load time, no external dependencies |

Note: the built-in minimal evaluator is a **bounded expression-evaluation implementation**, not a general-purpose scripting engine; when Turing-complete scripting is needed, evaluate rhai rather than expanding the expression syntax.

### Follow-up Extensions

Functions, table lookup, curves (Curve), piecewise (Piecewise), and distribution sampling are added incrementally as the MVP's built-in systems actually need them.

## Complex Behavior Extension Interface

MVP built-in systems are hardcoded in Rust in the `systems` module of `sandtable-core` ([crate layout](./08-tech-stack.md)). The minimal form of the extension interface:

```text
System trait
├── name()            system identifier
├── subscribed event types   respond only to declared events
├── update(world, event)  entry point for state changes
└── determinism constraints  state iteration must use ordered containers; random consumption must be keyed
```

External scripting (e.g., rhai) is one possible carrier of "custom System implementations"; the interface form is decided first, the carrier chosen later.

::: tip Carrier decided (2026-10-08)
The carrier for complex-behavior scripting is set to **Python** (many simple libraries, a mature simulation-analysis ecosystem); rhai is deferred. The embedding form, the three-form boundary, the performance red line, and the script security strategy are in the design document [scripts/scripting-design.md](https://github.com/cuihairu/sandtable/blob/main/scripts/scripting-design.md) (finalized; phases 0–3 landed — Python binding, batch orchestration, and read-only day-granularity hooks); the quantitative argument for keeping scripts out of the simulation hot path is in the [Time Model](./05-time-model.md).
:::

## MVP Scope

The MVP's minimal RPG runs the closed loop with hardcoded numbers ([MVP](./16-mvp.md)); the formula engine and the parameter registry are wired in after the closed loop is validated (see Phase 2 of the [Roadmap](./18-roadmap.md)).
