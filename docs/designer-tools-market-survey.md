# Designer-Facing Tools: Market Survey and Sandtable Positioning

> Status: research (2026-11-08). This page records what the market already offers for game-economy / balance design tools, and where sandtable fits. It does not claim any of these tools are inferior — it places them on a capability map so the positioning decision is evidence-based.

## The Problem Being Solved

Every design discipline has dedicated tooling (UI → Figma, project → Jira, code → IDE). Economy and balance designers largely work in spreadsheets their lead designer built years ago. The job a complete tool must do:

| Capability | What it means |
| --- | --- |
| Modeling | Represent currencies, items, sources, sinks, and their relationships |
| Simulation | Run player behavior over time to see how the economy evolves |
| Balancing | Tune earn rates, costs, and progression curves |
| LiveOps planning | Test what events / bundles / balance changes do before shipping |
| Collaboration | Make the model readable and shareable with the whole team |

## Market Landscape (2026)

### Spreadsheets (Google Sheets / Excel)

The universal default. Static math — EV checks, upgrade cost tables, currency conversion ratios, progression plots.

- **Good at**: early-stage math, simple economies, quick ratio checks. Fast and free.
- **Falls short**: they calculate, they don't simulate. No behavioral distribution across a population. Cannot model 30-day currency accumulation, percentile extremes of a randomized loot system, or a seasonal event's effect on equilibrium. At scale they become unmaintainable systems no single person fully understands.

### Machinations.io

Node-based visual design + simulation platform, born from Dormans' PhD ("Engineering Emergence"), ~15 years old, the teaching standard.

- **Good at**: making systems *visible*; Monte Carlo simulation; widely used in game design education; early-stage resource-flow logic.
- **Falls short**: abstracts heavily — works at "resource flows," not real game items, named currencies, seasonal event structures, or IAP bundles. Representing a real game's economy accurately is time-consuming; output is more useful for system thinking than production-ready balancing. Learning curve is steeper than it looks.
- **Pricing**: free tier; Starter $15/user/mo, Pro $150/user/mo (annual).

### itembase

Purpose-built economy design + simulation platform (2026 reviews recommend it for F2P / mobile / live-service).

- **Good at**: real currencies/items/sources/sinks, player-behavior simulation over time, LiveOps scenario testing (events, bundles, balance changes), progression/reward simulation, visual game-design-native interface.
- **Falls short**: newer; the reviews are its own marketing plus third-party roundups; production track record shorter than Machinations.

### Free single-point tools

Loot-table generators, gacha pity calculators, Monte Carlo loot simulators, drop-rate calculators — numerous, free, browser-based. Each does one narrow job (a loot table or a gacha banner), none models a whole economy.

### Custom internal tools

Large studios build their own. Perfect fit, but expensive to build and maintain, age with the game, and lose institutional knowledge when the designer who built them leaves.

## The Capability Map

| Tool | Modeling | Simulation | Balancing | LiveOps | Designer-usable | Statistical rigor |
| --- | --- | --- | --- | --- | --- | --- |
| Spreadsheet | Partial | No | Partial | No | Yes | Static EV only |
| Machinations | Abstract (flows) | Yes (MC) | Partial | Partial | Moderate (steep curve) | MC mean |
| itembase | Yes (items) | Yes | Yes | Yes | Yes | MC mean |
| Free single-point | One table | One draw | No | No | Yes | No |
| **sandtable** | **Yes (scenario YAML)** | **Yes (deterministic)** | **Yes (sweep/optimize)** | **Yes (event systems)** | **No (YAML/CLI today)** | **CRN + CI95 + deterministic** |

The gap sandtable sits in: **it has the most rigorous simulation core in the list (deterministic, replayable, CRN-paired, CI95) but the worst designer-facing surface (YAML + CLI).** Machinations/itembase have the designer-facing surface but only Monte Carlo mean statistics.

## Positioning Decision (2026-11-08)

User decision: **build the designer-friendly face of sandtable, not a new tool.** Rationale:

1. The tool market is saturated — Machinations (15 yrs), itembase (positioned precisely), free single-point tools. Head-on competition is not the move.
2. sandtable's differentiation is its **kernel rigor**: deterministic keyed RNG, CRN-paired comparison, CI95 confidence intervals, closed-form reconciliation. None of the incumbent design tools offer this — they report Monte Carlo means.
3. The right product is **sandtable + a designer-facing layer**, reusing the kernel with zero changes: form/graph editing over scenario YAML, live distribution charts (histogram + CI95 + CRN diff), drag-drop dependency graph for economy/combat flows.

The work item: `ST-WB-011` (see `todo.md`) — upgrade the existing Web workbench (`apps/web/src/workbench/`) so a designer can build a loot+gacha scenario without writing YAML and see comparison reports.

## What sandtable Must NOT Become

- A **new economy-design platform** competing head-on with Machinations/itembase — that is a different product with different marketing, support, and ecosystem costs.
- A **spreadsheet replacement** — spreadsheets remain the fastest static-math surface; sandtable should consume their output, not replace them.
- An **analytics dashboard** — analytics is retrospective (post-launch data), sandtable is prospective (pre-launch design). Different jobs.

## References

- [Machinations.io](https://machinations.io/) · [pricing](https://machinations.io/pricing)
- [Machinations vs spreadsheets (their own comparison)](https://machinations.io/articles/the-right-tool-for-the-right-task-machinations-vs-spreadsheets)
- [Dormans, *Engineering Emergence* (Machinations origin)](https://pure.uva.nl/ws/files/1167835/102091_09.pdf)
- [GEEvo: Game Economy Generation and Balancing with Evolutionary Algorithms (arXiv 2404.18574)](https://arxiv.org/pdf/2404.18574)
- [Best Game Economy Design Tools for Modern Game Teams (DEV Community, 2026)](https://dev.to/hiroshi_takamura_c851fe71/best-game-economy-design-tools-for-modern-game-teams-30kp)
- [Free Loot Table Generator + Gacha Pity Calculator (single-point example)](https://tools.puida.com/creative/gamedesign/loot-table-designer/)
