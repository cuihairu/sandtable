---
layout: home

hero:
  name: Sandtable
  text: A configuration-driven simulation and experimentation framework for game systems
  tagline: Put game systems into a digital sandtable — tune parameters, run 7 / 30 / 90 days, compare differences with metrics and confidence intervals to support balance decisions.
  actions:
    - theme: brand
      text: Start with project positioning
      link: /guide/01-positioning
    - theme: alt
      text: Roadmap
      link: /guide/18-roadmap
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
    details: No per-player per-step storage. Day-granularity integer counters and incremental statistics, plus fixed snapshot days (D1 / 3 / 7 / 14 / 30) with quantiles computed directly; the event queue schedules one day at a time — even 100,000 players × 90 days stays inside the memory budget.
  - title: Relative comparison position
    details: Player behavior probabilities are set by hand, so absolute outputs are not trustworthy. Sandtable's value is in A/B deltas (things like ΔD7 Power), not in absolute forecasts.
  - title: One kernel, three forms
    details: The same Rust kernel runs as CLI / Web (WASM) / Desktop (Tauri 2). core compiling for wasm32 is a Phase 1 CI gate; the browser runs small and medium sims, desktop and CLI run the large ones; local-first, no server.
footer:
  message: "This is the English home; use the language selector in the navigation bar for the Chinese site."
  copyright: Apache-2.0
---

## Workbench preview

The five workspaces of the V2 numerical-experiment workbench (`apps/web` interactive prototype, built-in synthetic sample data). The same design is the baseline for the desktop (Tauri) implementation (see the [desktop alignment baseline](./专业工作台桌面对齐基准.md), Chinese):

<div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:8px">
  <figure style="flex:1 1 460px;margin:0">
    <img src="./assets/screenshots/analysis.png" alt="Result analysis workspace" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>Result analysis</strong> — parameter response chart with 95% CI, candidate table, and inspector working in sync; scan outcomes and constraint verdicts at a glance.</figcaption>
  </figure>
  <figure style="flex:1 1 460px;margin:0">
    <img src="./assets/screenshots/parameters.png" alt="Parameter editing workspace" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>Parameter editing</strong> — registry-driven parameter grid: read-only baseline, editable candidate values, bulk edits and type validation.</figcaption>
  </figure>
  <figure style="flex:1 1 460px;margin:0">
    <img src="./assets/screenshots/designer.png" alt="Experiment design workspace" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>Experiment design</strong> — A/B / Grid / Random-LHS method choice, run budget, and pre-flight checks.</figcaption>
  </figure>
  <figure style="flex:1 1 460px;margin:0">
    <img src="./assets/screenshots/runs.png" alt="Run tasks workspace" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>Run tasks</strong> — queue progress and cancellation; existing sample results stay independent.</figcaption>
  </figure>
  <figure style="flex:1 1 460px;margin:0">
    <img src="./assets/screenshots/exchange.png" alt="Data and export workspace" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>Data and export</strong> — CSV / JSON / SVG downloads that keep parameter IDs, metric conventions, and CIs.</figcaption>
  </figure>
  <figure style="flex:1 1 460px;margin:0">
    <img src="./assets/screenshots/analysis-768.png" alt="Result analysis workspace at 768px width" loading="lazy" style="max-width:100%;border:1px solid #d8e0e3;border-radius:6px"/>
    <figcaption><strong>Narrow screens</strong> — at 768px the chart, candidate table, and inspector still fit on screen.</figcaption>
  </figure>
</div>


<script setup lang="ts">
// 首次访问按浏览器语言选择文档语言（vitepress 无此能力，GitHub Pages 不支持 _redirects）
// 优先级：localStorage 手动选择 > navigator.language > 保持当前 locale
import { onBeforeMount } from 'vue'
const KEY = 'sandtable-lang-auto-picked'
const BASE = '/sandtable/'
const ROOT_PATH = BASE
const ZH_PATH = BASE + 'zh/'
onBeforeMount(() => {{
  if (typeof window === 'undefined') return
  const p = window.location.pathname
  if (p !== ROOT_PATH && p !== ROOT_PATH.slice(0, -1)) return
  const picked = localStorage.getItem(KEY)
  if (picked) {{ if (picked !== p) window.location.replace(picked); return }}
  const langs = (navigator.languages?.length ? navigator.languages : [navigator.language]).map(l => l.toLowerCase())
  if (langs.some(l => l.startsWith('zh'))) window.location.replace(ZH_PATH)
}})
if (typeof window !== 'undefined') {{
  window.addEventListener('click', (e) => {{
    const a = (e.target as HTMLElement)?.closest?.('a') as HTMLAnchorElement | null
    const href = a?.getAttribute('href') || ''
    if (href.startsWith(ZH_PATH) || href.startsWith('zh/')) localStorage.setItem(KEY, ZH_PATH)
    else if (href === ROOT_PATH || href === ROOT_PATH.slice(0, -1)) localStorage.setItem(KEY, ROOT_PATH)
  }}, true)
}}
</script>

