---
title: 01 · Project Positioning
---

[English](01-positioning.en.md) | [中文](01-positioning.md)

# Project Positioning

> **Sandtable —— A configuration-driven simulation and experimentation framework for game systems.**
>
> Chinese positioning: **面向游戏系统的配置驱动仿真与实验框架 / 游戏数字沙盘**.

## The Core Question

Sandtable is neither a pure combat simulator nor a pure economy-flow tool. It provides a framework for dropping game systems into a "digital sandtable" and running them forward over the long term:

```text
Game Configuration → Game Model → Players / Actors
→ Combat / Economy / Progression → Simulation
→ Metrics / KPI → Experiment
→ Parameter Analysis / Optimization → Balance Recommendation
```

The question it answers:

> If a game parameter is adjusted, and a large population of different player types runs for 7 days, 30 days, or longer, what ultimately happens to the whole game system?

Typical questions include:

- After a character's attack is changed from 100 to 95 / 105, how does the win rate move?
- After gold drops increase by 10%, does the economy inflate over 30 days?
- After the level-up cost curve changes, how do players' power distributions on day 7 / 14 / 30 shift?
- Do Casual / Core / Whale players develop clearly different progression paths?
- Which parameters are most sensitive with respect to the target KPIs?
- Subject to several KPI constraints at once, which parameter combinations are more reasonable?

## Modeling Assumption

::: warning The largest modeling assumption; it decides the overall architecture
In the MVP phase, players are **mutually independent**:

1. **PvE content only** — combat opponents are monsters, not other players;
2. **No inter-player interaction** such as markets, auctions, or guilds;
3. **Economy metrics are aggregates** — inflation and the like are only aggregate statistics of all players' resource output and spend, with no resource transfer between players.
:::

This assumption matters most because it is the prerequisite for the parallel architecture: players independent of each other can be split and advanced in parallel per player. Once markets or PvP are introduced, player states depend on one another and a different architecture (global ordering by event) is required — the two cannot be mixed. Every "10,000 players run in parallel" statement in the plan rests on this assumption.

If inter-player interaction is needed later, it should be designed as a separate phase rather than patched onto the MVP.

## Position: Relative Comparison, Not Absolute Prediction

The probabilities in the player behavior model (login probability, dungeon probability, level-up probability) are set by hand, not fitted from real data. Therefore:

- **Absolute numbers out of the simulation are not trustworthy** — the 12,357 in "average day-7 power 12,357" carries no real-world meaning;
- **Relative differences are valuable** — under the same behavior model, the delta between parameter A and parameter B (ΔD7 Power, ΔWinRate) reflects the parameter's own effect.

Sandtable's product position is **assisting relative comparison and balance exploration**, not predicting the behavior of real players after launch. The MVP experiments use delta metrics like ΔD7 Power for exactly this reason.

## Reading Guide

This site has 25 chapters: [Core concepts](./03-concepts.en) and the [Simulation kernel](./04-kernel.en) define "what is simulated"; the [Time model](./05-time-model.en) and [Deterministic RNG](./06-deterministic-rng.en) define "how to advance it reproducibly"; [Experiment pipeline](./11-experiment-pipeline.en) through [Balance recommendation](./15-recommendation.en) define "how to run experiments and draw conclusions"; the [MVP](./16-mvp.en) and the [Roadmap](./18-roadmap.en) define "what comes first and what comes later".
