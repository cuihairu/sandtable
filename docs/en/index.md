---
layout: home

hero:
  name: Sandtable
  text: A configuration-driven simulation and experimentation framework for game systems
  tagline: Put game systems into a digital sandtable — tune parameters, run 7 / 30 / 90 days, compare differences with metrics and confidence intervals to support balance decisions.
  actions:
    - theme: brand
      text: Start with project positioning
      link: /guide/01-positioning.en
    - theme: alt
      text: Roadmap
      link: /guide/18-roadmap.en
    - theme: alt
      text: GitHub
      link: https://github.com/cuihairu/sandtable

features:
  - title: Configuration driven
    details: Model and Scenario are separated. Game numbers, formulas, and rules live in configuration; the experiment environment is described separately, so changing parameters never means changing code.
  - title: Layered time model
    details: The macro timeline advances on discrete events; fixed ticks are an optional inner mechanism inside a single battle. MVP combat uses analytic resolution, avoiding the compute trap of ticking everything.
  - title: Determinism first
    details: Keyed random numbers (seed, actor_id, day, event_index, purpose), independent of call order. Same config and same seed give bit-identical results; random paths stay comparable after a parameter change.
  - title: Experiments are first-class
    details: Grid / random sweeps, multi-seed reruns, and candidate comparison are part of the core model, not bolted-on scripts. Constraints are judged on confidence intervals, not point estimates.
  - title: Online-aggregated metrics
    details: No per-player per-step storage. Day-granularity integer counters and incremental statistics, plus fixed snapshot days (D1 / 3 / 7 / 14 / 30) with quantiles computed directly — even 100,000 players × 90 days stays inside the memory budget.
  - title: Relative comparison position
    details: Player behavior probabilities are set by hand, so absolute outputs are not trustworthy. Sandtable's value is in A/B deltas (things like ΔD7 Power), not in absolute forecasts.
  - title: One kernel, three forms
    details: The same Rust kernel runs as CLI / Web (WASM) / Desktop (Tauri 2). core compiling for wasm32 is a Phase 1 CI gate; the browser runs small and medium sims, desktop and CLI run the large ones; local-first, no server.
footer:
  message: "This is the English home; the Chinese home is at [/](/). Every guide chapter and every docs/ root document has a Chinese counterpart (.md beside each .en.md), and each English page carries a language switcher at the top of its body."
  copyright: MIT
---
