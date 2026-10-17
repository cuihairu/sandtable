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
    details: No per-player per-step storage. Day-granularity integer counters and incremental statistics, plus fixed snapshot days (D1 / 3 / 7 / 14 / 30) with quantiles computed directly — even 100,000 players × 90 days stays inside the memory budget.
  - title: Relative comparison position
    details: Player behavior probabilities are set by hand, so absolute outputs are not trustworthy. Sandtable's value is in A/B deltas (things like ΔD7 Power), not in absolute forecasts.
  - title: One kernel, three forms
    details: The same Rust kernel runs as CLI / Web (WASM) / Desktop (Tauri 2). core compiling for wasm32 is a Phase 1 CI gate; the browser runs small and medium sims, desktop and CLI run the large ones; local-first, no server.
footer:
  message: "This is the English home; use the language selector in the navigation bar for the Chinese site."
  copyright: MIT
---

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

