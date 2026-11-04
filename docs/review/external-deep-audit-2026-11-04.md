# 外部深度审核落地 · Sandtable 源码级 Issues(2026-11-04)

> **来源**:外部静态审查《Sandtable 源码级深度分析 · Issues》,38 条(P0 1 / P1 12 / P2 19 / P3 6),提取于 2026-11-04。
> **审核基准**:9aeb4e4(2026-11-04 15:25 GMT+8,540 commits)。**落地重核 HEAD**:1d9ccb2(基准后 +2:6578d14「loot 可测口径 + 比率告警去重」、1d9ccb2「docs: pin audit evidence commits」)。
> **限定语全程保留**:审核者声明「本次为静态审查,**未执行 cargo test / cargo build / pnpm build**」;原文标 `✅ 已复核` 为审核者人工回读确认、`⚠ 待实跑` 为静态可达成立但需运行时验证——重核后这些限定语原样保留,**不得升格为已验证结论**。**外部建议非仓内事实**。
> **重核方法**:38 条逐条对 HEAD grep/回读源码重定位(证据 file:line 为 HEAD 1d9ccb2 实测);原文行号对应基准 9aeb4e4,漂移已在对照表更新。
> **重核结论**:属实 36(其中绝大多数行号漂移已重定位)/ 部分属实 2(I-031 量级低估、I-034 机制位置错记)/ 不属实 0 / 重复已挂账 0。
> **基准后变化对本文的影响**:6578d14 只改 `LootConfig::has_gold_reward` 可测口径与前端比率告警去重,未触及 38 条中任何一条的主体;1d9ccb2 仅 todo.md 勾证。故无一条因基准后工作而「已修复」。
> **跟踪**:todo.md「外部深度审核跟踪(ST-AUD-01..38)」节全量映射,派修顺序按审核者建议优先级(I-001 → I-009/I-010 → I-002/I-003/I-011 → I-012)。

## 重核对照表(38 条 × HEAD 1d9ccb2)

| 原编号 | 级别 | 判态 | HEAD 重定位证据(重核实测) | 备注 |
|---|---|---|---|---|
| I-001 | P0 | 属实 | `experiment.rs:44,57-67`(n==1→sd=0/half=0,注释自认点估计)、`:136-142`(verdict 不查退化);`sweep.rs:179`(只拦 replicates==0);`cli main.rs:948-949`(仅 compare 拦 R<2)、`:882-897`(simulate 放行 R=1) | R≥2 且 ss=0 同得零宽 CI;修复须同步黄金快照(docs 8 节口径) |
| I-002 | P1 | 属实 | `config.rs:652,655`(仅非零门);`world.rs:71`(with_capacity(players));`metrics.rs:196`(vec![0;days+1]);`scenario.rs:496-508`(parse_duration 仅拦 ≥1;原引 :502 → :502-504) | 行号漂移已更新 |
| I-003 | P1 | 属实 | `systems/gacha.rs:44-53`(loop 无迭代上限);`config.rs:758-760`(base_rate∈(0,1] 无下限,注释自认)、`:356`(pity_hard 默认 0) | 行号漂移已更新 |
| I-004 | P1 | 属实 | `config.rs:667`(拦 reward_gold<0);`whale_gain_mult`(:610)/`upgrade_cost_base`(:517)全文无符号校验;`sim.rs:320-345`(gold_gain i64 → `as u64`);`progression.rs:47` | 行号漂移已更新 |
| I-005 | P1 | 属实 | `experiment.rs:123-127`(独立双样本 pooled_sd)、`:9,:111`(注释自认 d=Δ/pooled_sd) | docs 13/15 章行号未逐条复核,结论不受影响 |
| I-006 | P1 | 属实 | `sweep.rs:392-394,400-413,417`(与原引 :388-420 吻合) | optimize.rs:226-230 同型未逐行复演,机制已证 |
| I-007 | P1 | 属实 | `sensitivity.rs:239`(stat_at)、`:249`(find 首个同值候选) | 行号漂移(:186-215,:238-254 → :239,:249) |
| I-008 | P1 | 属实 | `metrics.rs:297`(prev_supply.max(1));`golden_report.json:94-95`(**gold_supply 4800 / inflation 4800.0 实测确认**);`experiment.rs:572`(day==1→None 聚合掩盖) | 黄金快照伪值实证 |
| I-009 | P1 | 属实 | `calibrate.rs:130-133`(黑名单+join 无包含校验;`:125` canonicalize 仅对 dir 本身)、`:158,:170`({raw:?} 回显) | Windows 盘符逃逸静态成立;原引文准确 |
| I-010 | P1 | 属实 | `tauri lib.rs:604`(read_csv_auto DDL 拼接)、`:614,:624`(prepare(sql));`is_ident` :594/:659 仅护视图名 | CLI 同源 :1071(run_query)行号漂移 |
| I-011 | P1 | 属实 | `tauri lib.rs:8-9`(注释自认无门)、`:420`(with_capacity)、`:439,:523`(仅拦 0) | 行号漂移已更新 |
| I-012 | P1 | 属实 | `runManager.ts:332`(promise.then 无 .catch/.finally,全文件 grep 零命中)、`:317`(并发闸)、`:334`(未删 jobBackends) | 行号漂移(:317 精确,:327-338→:329-338) |
| I-013 | P1 | 属实 | `projectDoc.ts:828-847`(isRestorableJob 不校验 exec.results/arms/sim/comparisons/recommendation);`runManager.ts:449-456`(恢复透传 exec) | projectDoc 原引 :774-780 段已移位,守卫体 :828-847 吻合 |
| I-014 | P2 | 属实 | `config.rs`:tier_growth(:155 等)无 finite 门、stall_days(:570,:578)无校验、cohort_weights(:793-797)仅每项有限+和>0、max_rounds(:658)仅拦 >MAX_ROUND_SLOTS;config_hash(:889)serde_json 序列化;`registry.rs:900` 注释自认 | 6578d14 未补任何门;NaN/Inf→同 config_hash 保持 ⚠ |
| I-015 | P2 | 属实(⚠ 待实跑) | `world.rs:46`;`combat.rs:67`;`sim.rs:331`;`Cargo.toml:18-20`(profile.release 无 overflow-checks) | 限定语保留:溢出行为需运行时确认 |
| I-016 | P2 | 属实 | `kpi_custom.rs:103`(unwrap_or(NAN));`formula.rs:550-556`(Div)、`:594-605`(max/min/clamp)、`:457`(is_finite filter) | 行号漂移已更新 |
| I-017 | P2 | 属实 | `sweep.rs:179`(replicates 无上界)、`:201`(只查 min/max finite,未查 (max−min) finite → ±1e308 可 inf);`optimize.rs:188-189`(total_candidates 未乘 R);wasm `lib.rs:92,:118,:494`(scale 门仅 sweep/optimize) | 行号漂移已更新 |
| I-018 | P2 | 属实 | `surrogate.rs:59-62`(只拦 <1)、`:167`(with_capacity(trees))、`:392`(row[*feature] 无宽度校验)、`:341-367`(未中心化 Σy²−(Σy)²/n 确认) | 行号漂移已更新 |
| I-019 | P2 | 属实 | wasm `lib.rs:58-79`(native 无 scale 门;MAX_REPLICATES :24/:62);mcp `main.rs:122`(plan 在前)、`:128`(MAX_SWEEP_SIMS 在后) | 行号漂移已更新 |
| I-020 | P2 | 属实 | `runManager.ts:299-300`(双 resolveBackends)、jobBackends 仅 :114(resetForTest)清;`executor.ts:380-382`(terminate 仅 escalate) | 行号漂移已更新 |
| I-021 | P2 | 属实 | `runManager.ts:160-165`(终态闸仅对带 status 的补丁生效) | 行号漂移(:157-172→:160-165) |
| I-022 | P2 | 属实 | `routing.ts:59`(decodeURIComponent 无 try/catch,函数体 :48-63 确认无兜底);`workbenchStore.ts:536`(模块顶层 initialState(),函数体 :97) | 行号漂移已更新 |
| I-023 | P2 | 属实 | `apps/web/package.json:19`;`docs/guide/22-web.md:57`;`ci.yml:130,:140`(仅存在性检查,无 frozen-lockfile、无 hash 比对);todo.md 2026-11-02 事故记录在案 | 行号漂移已更新 |
| I-024 | P2 | 属实 | `wasm.ts:239`(optimizeBinding 同步 JSON.parse)、`:309`(注释自认主线程占满);`workerProtocol.ts:21-27`(仅 5 类 kind) | 行号漂移已更新 |
| I-025 | P2 | 属实 | `WorkbenchApp.tsx:517`(demoMode=true 硬编码);`sampleProject.ts:11`(DATA_SOURCE=DEMO_SOURCE);`StatusBar.tsx:59`(恒真分支);`AppBar.tsx:37,:84` | 行号漂移已更新 |
| I-026 | P2 | 属实 | `report.rs:307`(n=results.len())、`:339`(fsum("churned")/n) | 行号漂移已更新 |
| I-027 | P2 | 属实 | `project.rs:243`(read_to_end 无上限,全文无 .take());`:69,:285,:310`(check_entry_path 路径纪律健全) | 「未发现 zip slip」正面结论成立 |
| I-028 | P2 | 属实 | `analyze.rs:10`(头注承诺「杀整个进程组」)、`:87-90`(windows 裸 spawn)、`:101-104`(仅 child.kill());unix :79-99(process_group+kill(-pid)) | 行号漂移已更新 |
| I-029 | P2 | 属实 | `python lib.rs:236-283`(py_to_value 无 MAX_DEPTH/visited,全文 grep 零命中)、`:82`(unwrap)、`:213`(expect) | 行号漂移已更新 |
| I-030 | P2 | 属实 | `cli Cargo.toml:23-27`(arrow/parquet 59.3 + duckdb 1.20000.1);`Cargo.lock:130,:148`(arrow 双版本);`core Cargo.toml:16` | 行号漂移已更新 |
| I-031 | P2 | 部分属实 | `ci.yml:149-153`(手写清单 34 个)vs `apps/web/tests/` 实有 **61** 个 *.test.mjs → **约 27 个未入 CI**(原文称「约十余个」——量级低估,机制属实);`:138` npm ci + apps/web 双 lockfile(package-lock.json/pnpm-lock.yaml 并存);根 `package.json:16-23`(overrides 无 workspaces,无 pnpm-workspace.yaml → 只作用 docs 树);`paths-ignore` :7/:15 + `scaffold.rs:19-21`(include_str README_TEMPLATE) | 未入 CI 数量按实测修正为 ~27 |
| I-032 | P2 | 属实 | `App.tsx:32-34`(dayMetric 直取 m.day_stats)、`:152`(avg 除 rs.length,空 results→NaN 且 `!out` 守卫不拦)、`:328-331`(无守卫传 results[0] → TypeError) | 行号漂移已更新 |
| I-033 | P3 | 属实 | `scenario.rs:947-949`(注释「未接入仿真/加载期被拒」)vs `:953`(同测试体注释「已接入,加载通过」)vs `sim.rs:322-339`(实际接入);`config.rs:1048-1050`(同款过时注释;原引 :1042-1043 漂移);`disttest.rs:59`(注释「左优先」)vs `:76`(min_by 期望最小);`:43`(chi_square 缺 is_infinite) | 行号漂移已更新 |
| I-034 | P3 | 部分属实 | **机制位置错记**:特例放行在 `registry.rs:408`(check_section,非原文所称 scenario.rs check_tree);`scenario.rs:55-69`(ModelSection 无 stage_rules 字段、全文无 deny_unknown_fields)→ 「YAML 静默丢弃成死配置」结论成立 | 结论属实、位置修正 |
| I-035 | P3 | 属实 | `WorkbenchApp.tsx:149-150`(hashchange);`routing.ts:54-62`(selection 恢复面) | 守卫拦截→URL/state 漂移细节未逐行复演,静态结论保留 |
| I-036 | P3 | 属实 | `executor.ts:419`(err.wClass=errorClass);`StatusBar.tsx:53`(aria-expanded="false" 硬编码);`WorkbenchApp.tsx:935`(快捷键表声明 Ctrl/⌘+C)vs `keyboard.ts:26`(globalShortcutFor 无 KeyC 接管,全 src grep 无实现) | 行号漂移已更新 |
| I-037 | P3 | 属实(⚠ 待实跑/意图待确认) | `desktop-package.yml:390`(cargo build --release -p sandtable-cli 无 --features → query/--parquet 不入发布件);`Cargo.toml:18-20`(release 无 opt-level=z/strip;wasm-pack --release 无 wasm-opt 定制);`main.rs:1036,:1695-1698`(csv_field 及其测试无 =+-@ 前缀防护用例) | 限定语保留:是否有意瘦身、CSV 可利用性待验证 |
| I-038 | P3 | 属实 | wasm `lib.rs:27,:40`、tauri `lib.rs:169,:181`(load_str/load_config_str 双入口);mcp `main.rs:48`、python `lib.rs:31,:324`、cli `main.rs:412`(load_str);replicates 默认:CLI :41 =1、Python :331 =1、Tauri/MCP 必填;各壳层「配置错误: 」前缀;`to_tool_result` :60(unwrap_or_default);mcp 全文无 println(正面成立) | 行号漂移已更新 |

> **判态口径**:「属实」含行号漂移(证据符号全部在 HEAD 命中、行为描述与源码一致);「部分属实」写明哪半不实。原文中 `⚠ 待实跑` 条目(I-015、I-014 的 config_hash 身份、I-037)重核后**仍未实跑**,限定语保留。

---

## 原文(清洗后全文照录,行号对应基准 9aeb4e4)

> 以下为外部审查原文全文(仅标题降一级以保持本文档单 H1,内容零删改;原文限定语原样保留)。

## Sandtable 源码级深度分析 · Issues

> 分析对象：`D:\workspaces\sandtable`，HEAD `9aeb4e4`（2026-11-04），Apache-2.0，540 commits。
> 分析时间：2026-11-04 15:25 GMT+8。
> 方法：四路分层只读源码审查（内核仿真 / 实验统计 / 多形态桥接 / 前端与工程配置）+ 对高严重度条目逐条回读源码抽样复核（共复核 14 处关键代码位置）。
> 口径：本文只收录**可定位到 file:line 的真实代码事实**；`✅ 已复核` 表示本次人工回读源码确认，`⚠ 待实跑` 表示静态可达性成立但需运行时验证。
> 局限：**本次为静态审查，未执行 `cargo test` / `cargo build` / `pnpm build`**。涉及 OOM / 死循环的条目请勿直接在生产机复现，见第 8 节的安全复现方式。
> 路径均为相对项目根；行号对应上述 commit。

---

### 0. 结论摘要

这是一个**工程纪律罕见严格**的项目（带键 RNG、CRN 配对、五形态同源等价测试、 honesty 口径的复盘文档），但在源码层面存在三条**结构性**缺口，不是零散 bug：

1. **配置校验是「逐字段补丁式」，不是类型级统一门禁。** `config::validate` 逐个补洞（概率有限性、负奖励、成本比率非零……），但 `whale_gain_mult`、`upgrade_cost_base`、`stall_days`、`tier_growth`、`reward_*_growth`、`players/days` 上界、`i64` 槽范围仍无门。已有防线可被**单个合法 YAML 字段**绕过，造成 `u64` 回绕、`i64` 溢出、无界循环与 OOM。
2. **统计结论层在退化输入下会给出「看似有效」的假结论。** `R=1`/`sd=0` 的零宽 CI 仍判定显著、配对设计却用独立样本 `pooled_sd` 算效应量、第 1 天通胀是绝对存量、运行级指标缺席时硬约束被 `filter_map` 静默删掉、多维网格 OAT 取错切片。对一个「相对比较」定位的工具，这类无声失真比崩溃更危险。
3. **多形态预算是逐层放宽的阶梯，而最宽松的两层恰好接不可信输入。** WASM(64/200/400k) < MCP(4096 次/无规模门) < CLI/Tauri/Python(基本无门)；MCP 从 AI 代理收 YAML、Tauri 从 WebView 收任意 `sql`/`inputs`，二者都在最薄弱处。

收录 **38 条**：P0 1 / P1 12 / P2 19 / P3 6。最优先处理：`I-001`（统计结论）、`I-009`/`I-010`（不可信输入面）、`I-002`/`I-003`/`I-011`（单输入打挂进程）、`I-012`（前端队列永久卡死）。

> 更正上一轮口头结论：`todo.md` 中 7 个未勾选项**全部是已裁决搁置的 BLOCKED 挂闸项**，不是 WB-05~WB-10 的实施欠账；V2 工作台 WB-01~WB-11 已全部勾选并附证据。详见第 10 节。

---

### 1. 源码地图与执行链

#### 1.1 Workspace 结构（行数按 `find -name '*.rs' | xargs wc -l` 粗算）

| 层 | 路径 | Rust 行数 | 职责 |
|---|---|---:|---|
| 内核 | `crates/sandtable-core/` | 15,536 | 配置编译、带键 RNG、离散事件仿真、在线 KPI、实验编排 |
| CLI | `crates/sandtable-cli/` | 7,793 | 27 子命令、报告/归档/query/scaffold |
| WASM | `crates/sandtable-wasm/` | 1,365 | `wasm-bindgen` 桥接，Web 形态 |
| MCP | `crates/sandtable-mcp/` | 1,255 | rmcp + stdio，5 枚工具，AI 代理入口 |
| Python | `crates/sandtable-python/` | 862 | pyo3/maturin，`sandtable-sim` wheel |
| Engine | `crates/sandtable-engine/` | 1,251 | 引擎无关 `.engine.json` 契约 |
| Desktop | `apps/desktop/src-tauri/` | — | Tauri 2 原生壳、DuckDB 本地查询、取消令牌 |
| Web | `apps/web/src/` | 28,544 (TS/TSX) | React 19 单页 + V2 专业工作台 |
| Docs | `docs/` | 26 章 × 2 语 | VitePress 双语站 |

#### 1.2 内核执行链（已回读确认）

```
scenario::load_str / load_config_str            (scenario.rs:98)
  → registry::check_tree → check_schema_version → ScenarioFile 反序列化
  → into_config（duration / population_mix）→ config::validate (config.rs:644)
  → config_hash = SHA256(canonical serde_json) (config.rs:885)
sim::run(&cfg, r)  → run_impl (sim.rs:59)
  → replicate_seed(base_seed, r) → World::new（按 (seed, actor_id, 0, Cohort) 派生有序 actors）
  → formula::compile(xp_needed) → build_systems（4 个 System）
  → EventQueue：(tick, seq) 全序 BinaryHeap (kernel.rs:60-65)
      tick 0: GachaRoll；schedule_day 排 1..=days 的 DayOpen / PlayerDay / DayClose
  → PlayerDaySystem：behavior::n_sessions/choose_action → combat::pick_tier/monster_of/settle_battle
      → progression::gain_xp/apply_upgrade → churn::churn_probability
  → DayCloseSystem：RunAggregator::end_day (metrics.rs:289)
  → RunAggregator::finish (metrics.rs:352) → RunMetrics
```

#### 1.3 实验统计链

```
sweep::plan (sweep.rs:223, Grid/Random/LHS，SplitMix64 派生)
  → run_candidate (sweep.rs:360)：R 次 sim::run → MetricKey::extract → experiment::summarize
  → judge (sweep.rs:149)：CI 完全在内 / 相交 / 完全在外 → PASS/BORDERLINE/FAIL
  → oat_elasticity (sensitivity.rs:89) / recommend_axis (recommend.rs:71)
  → optimize (optimize.rs:654) / RandomForest::train (surrogate.rs:142)
  → compare / compare_arms (experiment.rs:117/294) / daily_aggregate_metrics (experiment.rs:477)
  → export.rs / export/arrow.rs（只渲染，不重算）
```

#### 1.4 确定性核查结论（正面）

`core` 无 rayon、无 `HashMap`（配置面全 `BTreeMap`，`actors` 为按 id 升序 `Vec`），并行仅在 CLI `main.rs:472-477` 用 `IndexedParallelIterator`（保序、纯函数、无共享状态），float 累加顺序固定，`rng.rs:379-398` 有键正交性测试。**并行归约顺序不影响结果**。剩余风险是 `rng.rs:228` 的 u32 计数器 `wrapping_add` 回绕、`settle_battle` 直连面越过 `MAX_ROUND_SLOTS` 造成同 purpose 键重叠（I-014 表）。

#### 1.5 前端数据链

```
main.tsx 按 hash 二选一（旧 App.tsx / V2 WorkbenchApp.tsx）
V2 三套模块级单例：workbenchStore（reducer + useSyncExternalStore）/ runManager（队列 + 调度 + 存档）/ analysisStore
真实链：DesignerPage 冻结 ExecSpec → enqueueRun → startNextQueued → resolveBackends()
       （桌面 Tauri invoke / 浏览器 Worker 五类 kind）→ startExec → patchJob → applyOutcome
       → WorkbenchApp effect 写 runArtifacts → saveProject → packProject → .sandtable
演示链：sampleProject.ts 的 DEMO_RESULT 常量，靠 selection.source / data_source 字段隔离
```

---

### 2. 分级定义

| 级别 | 含义 |
|---|---|
| **P0** | 静默产出错误统计结论 / 破坏「相对比较」可信度，用户无从察觉 |
| **P1** | 单个合法输入可触发崩溃、挂死、越权读、错误结论或永久卡死 |
| **P2** | 边界条件、契约漂移、资源泄漏、需特定输入才暴露的错误 |
| **P3** | 文档/注释/可访问性不一致、待验证的防御细节 |

---

### 3. P0 · 统计结论失真（1 条）

#### I-001 `R=1` / `sd=0` 的零宽 CI 仍被当作有效置信区间，输出「配对 CI 不含 0」的显著判定 ✅ 已复核

- **位置**：`crates/sandtable-core/src/experiment.rs:43-76, 117-142`；`sweep.rs:149-158, 178-181`；`crates/sandtable-cli/src/main.rs:948-951, 449-455, 553-559`
- **证据**：
  ```rust
  // experiment.rs:57-68
  let sd   = if n == 1 { 0.0 } else { (ss / (n - 1) as f64).sqrt() };
  let half = if n == 1 { 0.0 } else { t_critical_975(n - 1) * sd / (n as f64).sqrt() };
  // → CI = [mean, mean]
  // experiment.rs:136-142
  let verdict = if diff.ci95_lo > 0.0 { Verdict::BHigher }
                else if diff.ci95_hi < 0.0 { Verdict::AHigher }
                else { Verdict::NoDifference };
  ```
  `summarize` 的注释自认「CI 退化为点估计(报告侧应提示加 replicates)」，但 `compare` / `judge` 均不检查；`SweepSpec::validate` 只拦 `replicates == 0`；CLI 只在 `compare` 子命令拦 `R<2`，`sweep`/`optimize`/WASM`/MCP` 放行 `R=1`。`R≥2` 但序列全同（`ss=0`）同样得到零宽 CI。`effect_size_d` 因 `len>2` 不成立被静默置 0。
- **触发/影响**：任何 `R=1` 的 sweep / optimize / A-B 桥；单个观测被宣称统计显著、约束 `PASS`，违背 `docs/zh/guide/13-kpi-metrics.md:116-126`「判定基于置信区间，不是点估计」。这是本仓**最严重**的问题：错的是结论而非程序行为。
- **建议**：`summarize` 返回显式退化标记或 `Result`；`compare`/`judge` 在 `n<2 || sd==0` 时拒绝判定并输出「证据不足」；所有入口统一 `R≥2` 红线（CLI 既有口径上提到 `core`）。

---

### 4. P1 · 高严重度（12 条）

#### I-002 `players` / `days` 只有非零门，单个 u32 即可 OOM ✅ 已复核
- **位置**：`config.rs:645-650`；`world.rs:71, 113`；`metrics.rs:196`；`sim.rs:117-122`；`scenario.rs:502`
- **证据**：`if cfg.players == 0 { ... }` / `if cfg.days == 0 { ... }`；`Vec::with_capacity(config.players as usize)`、`vec![0; days as usize + 1]`；`duration` 由 `parse::<u32>()` 接受。
- **影响**：`population: 4294967295` 或 `duration: "4294967295d"` 通过全部校验 → 预分配约 4.3e9 个 `Actor` + 32GB `Vec<u64>`，进程 abort；`schedule_day` 再空转数十亿次。WASM 的 400k 规模门只覆盖 sweep/optimize（见 I-019）。
- **建议**：`validate` 增加 `players ≤ N`、`days ≤ N` 与 `players × days` 预算上界；所有壳层共用同一常量。

#### I-003 抽卡 `loop` 无迭代上限，`base_rate` 无下限 + `pity_hard` 默认 0 → 实质死循环 ✅ 已复核
- **位置**：`config.rs:349, 750-755`；`systems/gacha.rs:42-53`；`rng.rs:228`
- **证据**：
  ```rust
  // gacha.rs:44-53
  loop {
      let p = hit_rate(cfg, actor.gacha_since_hit);
      actor.gacha_pulls += 1;
      if rng.chance(Purpose::Gacha, p) { ...; return ...; }
      actor.gacha_since_hit += 1;
  }
  ```
  `validate` 只要求 `base_rate ∈ (0,1]`（注释自己写「≤0 会让抽卡永不终止」），`pity_hard` 默认 0。
- **影响**：`base_rate: 1e-9`（合法）→ 期望 1e9 抽 × 10000 玩家 ≈ 1e13 次迭代；`1e-300` 近似永不出结果，无超时无取消。
- **建议**：`pity_hard > 0` 或 `base_rate` 设下限；`pull_until_hit` / `pull_until_featured` 增加最大抽数保护并返回 `Result`。

#### I-004 负强化成本与 `whale_gain_mult` 绕过「负奖励防回绕」防线，污染全部经济指标 ✅ 已复核（validate 全文）
- **位置**：`config.rs:660-663, 783`；`systems/progression.rs:47,50`；`sim.rs:274,320,345`；`metrics.rs:254`
- **证据**：`validate` 明确拦 `reward_gold < 0`（注释「负奖励会让经济面 u64 回绕」），却**没有**校验 `whale_gain_mult`、`upgrade_cost_base` 的符号、`upgrade_cost_num/den` 的符号（只拦 `==0`）。`sim.rs:320` `let mut gold_gain = out.gold * mult;` → `:345` `agg.record_battle(true, gold_gain as u64, ...)`；`progression.rs:47` `actor.gold -= actor.upgrade_cost_next;`。
- **影响**：`upgrade_cost_base: -100` → 强化反而加钱，`-100i64 as u64` = 18446744073709551516，`gold_spent` / `sink_ratio` / 金币守恒全崩；`whale_gain_mult: -1` 或 `i64::MAX` 同样回绕/溢出。
- **建议**：所有 i64 数值字段设范围门；`gold_gain` 用 `try_into::<u64>()` 或饱和转换；`record_upgrade` 对负 cost 报错。

#### I-005 CRN 配对设计的效应量 d 用独立双样本 `pooled_sd`，与配对差值 CI 口径不一致 ✅ 已复核
- **位置**：`experiment.rs:117-135`；`docs/zh/guide/13-kpi-metrics.md:114`；`docs/zh/guide/11-experiment-pipeline.md:37`
- **证据**：
  ```rust
  let diffs: Vec<f64> = arm_a.iter().zip(arm_b.iter()).map(|(a,b)| b-a).collect();
  let diff = summarize(&diffs);                 // 结论基于 sd(d_i)
  let num = (na-1.0)*sa.sd.powi(2) + (nb-1.0)*sb.sd.powi(2);
  (num/(na+nb-2.0)).sqrt()                      // 独立双样本 s_pooled
  ```
- **公式核对**：配对设计正确口径 `d_z = Δ/s_d`，`s_d² = sa²+sb²−2ρ·sa·sb`。ρ=0 时代码高估 ≈41%（`d_code = √2·d_z`）；ρ→1（CRN 本意）时 `s_d→|sa−sb|`、`d_z→∞`，代码却仍有限。文档公式与实现一致，但文档公式本身与配对纪律冲突。
- **影响**：所有 A/B 比较；`|d|` 还参与 `docs/zh/guide/15-recommendation.md:48` 的置信度判据。
- **建议**：改用 `d_z = diff.mean/diff.sd`（或 `d_av`），同步修订 docs 13 章公式与黄金快照。

#### I-006 运行级 `extract() == None` 时指标被丢弃，硬约束凭空消失、候选仍报 `Ok` ✅ 已复核
- **位置**：`sweep.rs:388-420`；`metrics.rs:388-392`；`optimize.rs:226-230, 558`
- **证据**：
  ```rust
  let vals: Vec<f64> = runs.iter().filter_map(|m| key.extract(m)).collect();
  if vals.len() == spec.replicates as usize { metric_stats.push((key, summarize(&vals))); }
  ...
  .filter_map(|t| stat_of(t.metric).map(|s| TargetOutcome { ... }))   // 缺统计 → 约束消失
  ...
  status: CandidateStatus::Ok,
  ```
  加载期的 `unavailable_reason` 预检（`scenario.rs:400-407`）只挡配置级缺席，挡不住运行级（如 `gacha_hits_total == 0` → `gacha_pulls_to_hit: None`）。
- **影响**：保底期望抽数等约束无声失效，`Fitness::hard_pass` / `feasible` 偏低；`experiment.rs:234-236` 注释正是描述同一问题，但整改只覆盖加载期。
- **建议**：缺失显式标 `missing` 或返回 `ConfigError`；断言 `target_outcomes.len() == targets.len()`。

#### I-007 `stat_at` 只按轴值 `find`，多维 Grid 下 OAT 弹性/推荐读到非基线切片 ✅ 已复核
- **位置**：`sensitivity.rs:186-215, 238-254`；`sweep.rs:245-256`；`recommend.rs:236, 339-351`
- **证据**：`results.iter().find(|r| r.values.get(path).is_some_and(|x| approx(*x, v)))?` —— `baseline_slice` 虽筛出「其余维≈基线」的**轴值**，但传给 `stat_at` 的是**全量 results**，命中 plan 笛卡尔积序中第一个该轴值候选。现有测试 `elasticity_other_dim_at_baseline_separable` 恰好把基线设为网格最小值，故未暴露。
- **影响**：≥2 维 Grid + OAT / `recommend_axis`：弹性、可行段、推荐区间整体错误且无告警。
- **建议**：`stat_at` 增加基线向量参数，校验所有非轴维 `≈ baseline` 再取统计；补一条「基线不是网格端点」的测试。

#### I-008 第 1 天 `inflation` = 绝对存量（黄金快照实测 4800.0），不是文档定义的「无定义」 ✅ 已复核
- **位置**：`metrics.rs:207, 297`；`experiment.rs:388, 572-576`；`crates/sandtable-core/tests/fixtures/golden_report.json`
- **证据**：`let inflation = (supply - self.prev_supply) as f64 / self.prev_supply.max(1) as f64;`（`prev_supply` 初始 0）→ day1 = `supply/1`。逐日聚合 `if *day == 1 { None }` 只掩盖了聚合视图，`report.json` / `days.csv` / Arrow `day_stats_batch` 全带伪值；`days=1` 时 `inflation_last` 亦然。
- **影响**：所有运行的第 1 天「日增长率」是黄金存量（如 4800 = 480000%），单份报告未掩盖。
- **建议**：`end_day` 在 `day==1` 记「无定义」显式语义，`inflation_last` 跳过 day1；同步更新黄金快照。

#### I-009 MCP `sandtable_calibrate` 的 CSV 路径可借 Windows 盘符逃出 `data_dir`，且原始单元格值经 tool error 外发 ✅ 已复核
- **位置**：`crates/sandtable-mcp/src/calibrate.rs:115-135, 156-171`
- **证据**：
  ```rust
  if file.contains("..") || file.starts_with('/') || file.starts_with('\\') { return Err(...); }
  let path = dir.join(file);            // 未 canonicalize，未校验包含关系
  ...
  .map_err(|_| format!("{file}: 日轴必须是 ≥ 1 的整数,得到 {raw:?}"))
  ```
  `mapping.series.*.file = "C:/Users/x/secret.csv"` 不含 `..`、不以分隔符开头，但 Windows 上 `Path::is_absolute()` 为真，`dir.join()` 整体替换基路径 → 读任意本地文件；`parse_day`/`parse_f64` 把 `{raw:?}` 回显到 MCP tool error，可把文件内容带出，违反 README「原始观测行不外发」。
- **建议**：join 后 `canonicalize()` 并断言 `starts_with(dir)`；显式拒绝 `is_absolute()` / `Prefix`；错误信息不回显单元格原值。

#### I-010 Tauri `query` 把 WebView 传入的 `sql` 与 `inputs` 原样执行，是任意本地文件读/写面 ✅ 已复核
- **位置**：`apps/desktop/src-tauri/src/lib.rs:578-625`（CLI `crates/sandtable-cli/src/main.rs:1086-1104` 同源）
- **证据**：`format!("CREATE VIEW {stem} AS SELECT * FROM read_csv_auto('{p}', header = true)")`；`conn.prepare(&format!("DESCRIBE {sql}"))`；`conn.prepare(sql)`。视图名有 `is_ident` 白名单（视图名拼接注入不成立），但 **`sql` 本身是任意语句、`inputs` 是任意路径**，与注释「DuckDB 只读结果数据集」红线矛盾。
- **影响**：`invoke("query", { inputs: [...], sql: "SELECT * FROM read_csv_auto('C:/…/id_rsa', header=false)" })` 可读任意文件回传 WebView；`COPY … TO` 类语句亦可能落盘。
- **建议**：只读连接 + 语句白名单（仅 SELECT + 已注册视图），禁止 `read_csv_auto` / `read_parquet` / `COPY` 等文件函数；`inputs` 限定应用数据目录并 canonicalize。

#### I-011 Tauri / CLI `replicates` 无上界，`Vec::with_capacity` 可被打崩 ✅ 已复核
- **位置**：`apps/desktop/src-tauri/src/lib.rs:8-9, 414-441`（注释自认「native 无 WASM 的 64 replicates / 200 预算门」）
- **证据**：`let mut results = Vec::with_capacity(replicates as usize);`；唯一校验 `if replicates == 0 { ... }`。
- **影响**：`invoke("run_simulation", { replicates: 4294967295 })` 立即申请数十 GB，分配失败即 abort（不可捕获）。WASM 有 `MAX_REPLICATES=64`、MCP 有 4096，桌面无门。
- **建议**：设上限；改按需 `push` / `try_reserve` 返回错误。

#### I-012 `runManager` 终局 `promise.then` 无 `.catch`，一次 reject 永久占死并发槽 ✅ 已复核
- **位置**：`apps/web/src/workbench/state/runManager.ts:317, 327-338`
- **证据**：
  ```ts
  void controls.promise.then((out) => {
    activeControls.delete(job.id)
    queuedBackends.delete(job.id)     // 注意：没有 jobBackends.delete(job.id)
    applyOutcome(job.id, out)
  })
  ```
  `startNextQueued` 开头判 `activeControls.size >= scheduling.concurrency` 直接 return。
- **影响**：`startExec` 内部任何未捕获异常（`hooks.update` 抛错、backend reject）都会让 `.then` 不执行，`activeControls` 永不删除 → **整个队列永久卡死**，任务停在 running，模块级单例无法自愈。
- **建议**：`.then(ok, err)` 或 `.finally`；失败分支强制删除控制引用 + 落 `failed` 终态 + `startNextQueued()`。

#### I-013 队列存档恢复不校验 `exec.results`，伪造「内核结果」可经 localStorage 注入并落档
- **位置**：`apps/web/src/workbench/state/projectDoc.ts:774-780, 828-847`；`runManager.ts:449-456`；`resultModel.ts:57`；`exportScope.ts:97`；`WorkbenchApp.tsx:173-191`
- **证据**：`isRestorableJob` 只校验 `id/experimentId/name/method/total/done/status/demo/createdAt` 与 `exec.runId/kind/spec`，`exec.results` / `arms` / `sim` / `comparisons` / `recommendation` **原样透传**；`candidateViews(..., exec.results, ...)` 直接出图，导出信封恒为 `data_source: 'kernel'`，终态真实作业还会自动落 `results/<runId>.report.json` 并打包进 `.sandtable`。
- **影响**：localStorage 被篡改 / 旧版残留 → 非内核结果被当作真实 run 展示、导出、归档，`dataSource.ts` 的读写闸不覆盖这条通道。
- **建议**：恢复时丢弃全部结果类字段（只保留 spec/done/status，由执行槽重建），或做完整形状/签名校验。

---

### 5. P2 · 中严重度（19 条）

#### I-014 配置校验缺口总表（结构性欠账）✅ 部分复核（`validate` 全文 644-879 已回读）

| 字段 | 现状 | 后果 |
|---|---|---|
| `whale_gain_mult` (i64) | 无符号/范围校验 | 负倍率绕过 `reward_gold>=0` 防线（I-004） |
| `upgrade_cost_base` / `num` / `den` | 仅拦 `num/den == 0` | 负成本 → `as u64` 回绕（I-004） |
| `warrior.attack/defense/hp` | 无上界 | `power_of` 的 `attack*2` 溢出（I-015） |
| `tier_growth` / `reward_*_growth` (f64) | 无 `is_finite`/符号检查 | `powi` → NaN/Inf → `as i64` 塌陷 |
| `stall_days` (u32) | 无校验 | `0` 使 `idle_streak >= 0` 恒真，流失率约放大 17 倍 |
| `combat.max_rounds` | 只拦 `> MAX_ROUND_SLOTS` | `0` 使全部战斗判负；直连 API 越界时键碰撞 |
| `cohort_weights` | 只要求每项有限、和 `>0` | `[0.5,0.5,0.5]` → whale 恒 0；`[-0.5,1.0,0.5]` 经数值通道合法但分群失真；`1e308×3` 和为 `Inf` 亦通过 |
| `loot.rate_mult` | 只拦入口有限/正 | `1e308` → 乘积 `Inf` → 饱和 `i64::MAX` |
| `gacha.pity_hard` | 默认 0 | 配合 I-003 死循环 |

另：`config_hash`（`config.rs:885-886`）用 `serde_json::to_string`；非有限 f64 序列化为 `null`，`.nan` 与 `.inf` 会得到同一份 JSON → **同一 config_hash**，破坏配置身份与 A/B 缓存语义（⚠ 待实跑确认 YAML 解析路径）。
**建议**：在 `validate` 顶部对**所有** f64/i64/u32 数值槽统一 `is_finite()` + 区间门（与 `registry::apply_numeric` 的 `finite_nonneg` 同口径），而非逐字段补丁；`config_hash` 前显式拒绝非有限值。`registry.rs:900-901` 的注释已自认「validate 未覆盖的槽由此获得数值通道防线」，说明作者知道这个缺口，但两条入口口径仍不一致。

#### I-015 数值溢出面：`power_of` / `settle_battle` / `rate_mult` 运算结果 ⚠ 待实跑
- **位置**：`world.rs:45-46, 104`；`systems/combat.rs:24, 62-71`；`sim.rs:331-332`
- **证据**：`attack * 2 + defense + hp / 10 + level as i64 * 10`；`(d.m_hp as f64 * g) as i64`；`((r.gold as f64) * loot.rate_mult).round() as i64 * mult`。
- **影响**：debug 构建 panic、release 静默回绕（workspace `profile.release` 未开 `overflow-checks`），战力/掉落/分位数全错；门禁只覆盖「入口值」不覆盖「运算结果」。
- **建议**：上界门 + `checked_*` / `saturating` / `try_from`。

#### I-016 自定义 KPI 缺席以 NaN 入 env，被 `max/min/clamp`/除零洗成有效有限值
- **位置**：`kpi_custom.rs:8-10, 101-107`；`formula.rs:550-556, 566, 594-605`
- **证据**：`MetricKey::ALL.iter().map(|key| key.extract(run).unwrap_or(f64::NAN))`；`Expr::Div` 遇 0 返回 `0.0`；`Builtin::Max => a(0).max(a(1))`（Rust `f64::max` 忽略 NaN）；`Some(value).filter(|v| v.is_finite())`。
- **影响**：`max(gacha_pulls_to_hit, 0)` 在该指标运行级缺席时得 `0.0` 并计入 `n_used`；`1/win_rate`（win_rate=0）得 0；`NaN^0` 可能得 1.0。违背 `kpi_custom.rs:8-10`「缺席不填 0」的明确口径。
- **建议**：求值前逐个检查 `used_vars` 的 `extract`，任一 None 直接记 None；`formula::eval` 对非有限输入显式传播、除零返回 NaN。

#### I-017 预算账不含 `×replicates` 与 `players×days`，且 `replicates` 无上界
- **位置**：`sweep.rs:178-181, 388-390`；`optimize.rs:96-100, 187-193`；`crates/sandtable-wasm/src/lib.rs:111-114, 487-492`；`docs/zh/guide/12-parameter-sweep.md:29, 89`
- **证据**：`if self.replicates == 0 { return Err(...) }`（无上界）；`let total_candidates = population * (generations+1); if total_candidates > MAX_CANDIDATES`（未乘 R）；`let runs: Vec<_> = (0..spec.replicates).map(|r| sim::run(&cfg, r)).collect()`。WASM 做了 ×replicates，`core` 没做；桌面路径无门。
- **影响**：CLI `sweep/optimize --replicates N` 或直连 API 传大 R → `Vec<RunMetrics>` OOM；文档声称的成本账与实际校验不符。另 `ParamRange::check` 未校验 `(max-min).is_finite()`，`±1e308` 使 Random/LHS 产出 inf/NaN 候选。
- **建议**：把「候选数 × R × players × days」统一为 `core` 层单一预算函数，所有壳层调用。

#### I-018 `surrogate` 的 `model.json` 反序列化无上界，`predict_row` 不校验行宽
- **位置**：`surrogate.rs:58-69, 167, 222-230, 299-300, 383-399`
- **证据**：`validate` 只查 `trees < 1` / `max_depth < 1`；`Vec::with_capacity(spec.trees as usize)`（u32 可达 4.29e9）；递归 `build_tree` 深度由 `max_depth` 控制；`let next = if row[*feature] <= *threshold`（越界 panic）。`model.json` 是 `surrogate train` 产出、`predict` 回读的外部输入面。
- **建议**：`trees ≤ 1024`、`max_depth ≤ 32`；`predict_row` 改 `Result` 并校验 `row.len() == features.len()`。另 `surrogate.rs:341-344, 365-367` 用未中心化 `Σy²−(Σy)²/n` 算方差削减，大均值小方差时相消（与 `experiment::summarize` 的中心化口径不一致），建议改 Welford/前缀和并加最小削减阈值。

#### I-019 WASM `run_simulation_native` 漏规模门；MCP sweep 预算「先展开后检查」 ✅ 部分复核
- **位置**：`crates/sandtable-wasm/src/lib.rs:58-79, 117-122, 487-492`；`crates/sandtable-mcp/src/main.rs:85-132, 280-287`
- **证据**：`run_simulation_native` 只检查 `replicates == 0` 与 `> MAX_REPLICATES`，直接 `load(yaml)` → `sim::run`，**没有** `sweep_plan_native`/`optimize_native` 都有的 `players*days > MAX_SWEEP_SIM_SCALE` 检查；MCP `let candidates = spec.plan(...)` 在前，`if sims > MAX_SWEEP_SIMS` 在后（core 的 `MAX_CANDIDATES=10_000` 缓解了 OOM），`sandtable_analyze` 的 `results_json` 无字节/条数上限。
- **影响**：Web 单参数绕开「Web 定位小中型仿真」；MCP 一次大 `results_json` 可撑爆进程且无取消面。
- **建议**：把 scale 检查提到统一 `load` 之后；MCP 在 `plan()` 前判定预算并对输入加字节上限。

#### I-020 `jobBackends` 正常路径从不删除、`resolveBackends()` 调用两次、Worker 终局不 terminate ✅ 已复核（清理缺失）
- **位置**：`apps/web/src/workbench/state/runManager.ts:299-300, 327-337, 416`；`executor.ts:380-383, 490-506`
- **证据**：`queuedBackends.set(job.id, input.backends ?? resolveBackends())` 与 `jobBackends.set(job.id, input.backends ?? resolveBackends())` 各自调一次 `resolveBackends()`（浏览器分支每次 `new WorkerConnection(...)`）；终局只删 `activeControls` / `queuedBackends`；`jobBackends` 仅在 `resetForTest()` 清理；`be.terminate?.()` 只在 escalate 取消时触发。
- **影响**：每个真实 run 泄漏一个 Map 条目 + 一个 Worker；`retryJob` 又取第二个后端再 spawn 一个 Worker。
- **建议**：复用同一个 backends Promise；终局统一删除并 terminate，或改常驻 Worker 池。

#### I-021 终态单向闸只对「带 status 的补丁」生效 → 取消后仍写进度与结果
- **位置**：`runManager.ts:157-172, 478-486`；`executor.ts:203-206`
- **证据**：`if (patch.status !== undefined) { if (logic.isTerminal(j.status)) return j; ... }` —— queued 取消把任务置终态后，`startExec` 的中途更新 `{ done, exec: { candidatesDone, results: [...] } }` **不带 status**，绕过守卫继续改写并每次 `emit()` 写 localStorage；`applyOutcome` 的终态守卫只挡终局覆盖。
- **建议**：终态检查移到 `patch.status` 条件之外，无条件 `if (logic.isTerminal(j.status)) return j`。

#### I-022 畸形 hash 深链在模块求值期抛 `URIError` → 整页白屏，ErrorBoundary 拦不住 ✅ 已复核
- **位置**：`apps/web/src/workbench/routing.ts:59`；`workbenchStore.ts:99, 536`；`main.tsx:17`
- **证据**：`const value = eq === -1 ? '' : decodeURIComponent(pair.slice(eq + 1))`；`let state = initialState()` 位于模块顶层，其中调用 `parseHash(window.location.hash)`；`ErrorBoundary` 在渲染期才生效。
- **触发**：`#/workbench/analysis?metric=%E0%A4%A`。
- **建议**：`parseHash` 整体 try/catch，非法值按「忽略该键」降级。

#### I-023 pnpm `file:` 拷贝语义无机器门禁（已发生真实事故）✅ 已复核
- **位置**：`apps/web/package.json:19`；`docs/guide/22-web.md:57`；`.github/workflows/ci.yml:127-140`；`todo.md:9`
- **证据**：`"sandtable-wasm": "file:../../crates/sandtable-wasm/pkg"`；文档原文承认「绑定 guard 检查的是新鲜 pkg，不是 installed copy，构建会静默跑旧内核」；CI 只做 `test -f .../bg.wasm` 与 `ls dist/assets/*.wasm` 的存在性检查，不比对字节/hash，也不跑 `pnpm install --frozen-lockfile`。`todo.md:9` 记录了 2026-11-02 事故：重建 pkg 未重跑 install → 旧内核判 `model.gacha.featured_rate` 为未知参数 → 提交按钮永久禁用。
- **建议**：prebuild 脚本比对 `node_modules/sandtable-wasm/*_bg.wasm` 与 `pkg/` 的 hash，不一致直接 fail；CI 增加 pnpm 路径 + wasm asset hash 断言。

#### I-024 重量级 WASM 调用仍在主线程同步执行，Worker 协议只覆盖 5 类
- **位置**：`apps/web/src/lib/wasm.ts:230-240, 252-281, 309`；`workbench/state/workerProtocol.ts:20-37`；`OptimizeSurrogateSection.tsx:213, 226, 261`；`CrossReplicateSection.tsx:120`；`CustomKpiSection.tsx:51-53`
- **证据**：`return JSON.parse(optimizeBinding(yaml) as unknown as string)`；`workerProtocol` 仅 `plan|sim|candidate|recommend|ab_compare`；`wasm.ts:309` 注释自认「浏览器 wasm 是同步调用,主线程被占满」。`optimize` 单次调用跑完整个「种群 × (代数+1) × replicates」，`setOptimizing(true)` 的 loading 都无法绘制。`todo.md:41` 的「Web 迁 Worker」只落实到队列任务。
- **建议**：扩展 Worker 协议覆盖 optimize/surrogate/aggregate/kpi；短期至少让出一帧并明示计算中。

#### I-025 来源标注三处矛盾：真实 kernel run 下仍显示「演示数据」 ✅ 已复核
- **位置**：`WorkbenchApp.tsx:517`；`components/StatusBar.tsx:59`；`components/AppBar.tsx:84-90`；`demo/sampleProject.ts:11`；`AnalysisPage.tsx:133, 245`
- **证据**：`const demoMode = true`（硬编码）；`DATA_SOURCE = DEMO_SOURCE`（常量）→ `DATA_SOURCE === 'synthetic_demo'` 分支**恒真**；同时 `AnalysisPage` 打 `KERNEL` 徽标并打印 `kernel · run …`。
- **影响**：打开真实 `.sandtable`、跑完真实 run 后，应用栏/状态栏仍宣称「内置演示结果」，与 V2「演示/真实数据来源清晰」的验收目标冲突。
- **建议**：由 `state.project` / `selection.source` / `jobs` 派生，去掉常量。

#### I-026 CLI 报告层自己重算分群统计，且除数用 `results.len()` 而非实际样本数
- **位置**：`crates/sandtable-cli/src/report.rs:307, 315, 324-345`
- **证据**：`let n = results.len();` → `let per: Vec<&Value> = ...filter_map(...).filter(...).collect();` → `fsum("churned") / n as f64` 等。违反 README「壳层零重算」；`per.len() < n` 时均值系统性压低，HTML 报告与 `report.json` / `summary.csv` 不一致。
- **建议**：改读内核已产出的聚合结果（或调 `core::experiment::summarize`），除数用 `per.len()`。

#### I-027 `.sandtable` 解包无解压体积上限（zip bomb）；**未发现 zip slip**（正面）
- **位置**：`crates/sandtable-cli/src/project.rs:238-246, 250-303, 315-322`
- **证据**：`zr.read_to_end(&mut buf)` 无字节上限；manifest 全部条目解压后才做 sha256 校验；`Kind::Result` 不校验内容/扩展名。`check_entry_path`（:69-91）用 `Component::Normal` 白名单 + 目录约束 + 归档集合与清单严格相等，**路径纪律健全**。
- **建议**：`Read::take(MAX_ENTRY_BYTES)`、限制条目数与总解压字节、manifest 单独限长。

#### I-028 Windows 下超时不杀进程组，与注释承诺不符
- **位置**：`crates/sandtable-cli/src/analyze.rs:10-11, 79-104, 168`
- **证据**：`//! - 超时(缺省 600s)杀整个进程组…不留孤儿进程`，但 `#[cfg(windows)] fn spawn_in_group` 只是 `command.spawn()`（无 `CREATE_NEW_PROCESS_GROUP` / Job Object），`kill_group` 只 `child.kill()`；unix 分支才用 `process_group(0)` + `kill(-pid, SIGKILL)`。当前用户平台即 Windows。
- **建议**：Job Object 或 `taskkill /T /F`；文档标注平台差异。

#### I-029 Python `py_to_value` 递归无深度上限，循环引用可打挂宿主解释器；库代码含 `expect`/`unwrap`
- **位置**：`crates/sandtable-python/src/lib.rs:82, 213, 236-283, 404`
- **证据**：`for item in list.iter() { out.push(py_to_value(&item)?); }` 无 depth/visited；Python 侧 `l=[]; l.append(l)` 传入 `recommend` 即无限递归 → 栈溢出 abort（不可捕获 `PyErr`）。另 `u32::try_from(...).unwrap()` 在 `PyDayHook::on_day` 路径、`n.as_f64().expect(...)` 在 Value→Python 转换路径。
- **建议**：加 `MAX_DEPTH` 或 `id()` visited 检测；`expect/unwrap` 换 `PyErr`。

#### I-030 Workspace 内 Arrow 双版本并存（59.3 / 60.1）
- **位置**：`Cargo.lock:130-131, 148-149, 1380, 3754`；`crates/sandtable-cli/Cargo.toml:23-27`；`crates/sandtable-core/Cargo.toml`
- **证据**：CLI 钉 `parquet/arrow 59.3`，`duckdb 1.20000.1` 依赖 `arrow 60.1.0`；`thiserror` 1.0.69 / 2.0.21 亦并存。
- **影响**：`cargo test -p sandtable-cli --features duckdb,parquet` 编译两套完整 Arrow 栈；`core` 导出的 `RecordBatch`(59.3) 与 duckdb 内部(60.1) 类型不兼容，未来把 Parquet 结果经 DuckDB 视图查询会直接冲突。
- **建议**：统一到 60.x 或禁用 duckdb 的 `parquet` feature；`cargo tree -d` 纳入 CI。

#### I-031 CI 手工枚举测试文件、双 lockfile、`.md` 过滤漏掉编译期模板 ✅ 部分复核
- **位置**：`.github/workflows/ci.yml:6-12, 149-153`；`crates/sandtable-cli/src/scaffold.rs:19-21`；`apps/web/package-lock.json` / `apps/web/pnpm-lock.yaml`；根 `package.json:16-23`
- **证据**：`node --test apps/web/tests/columns.test.mjs tokens.test.mjs ...` 手写清单，约十余个 `*.test.mjs`（`workspace-dom`、`optimize-surrogate`、`cross-replicate-agg`、`entry-routing` 等）未进 CI；CI 用 `npm ci`（package-lock），本地用 pnpm（pnpm-lock）；根 `pnpm.overrides` 无 `workspaces` 字段，只作用于 docs 树，apps/web 独立 lock 实际解析为 `esbuild 0.28.2` / `vite 8.3.5`；`paths-ignore: '**.md'` 会跳过只改 `README_TEMPLATE`（`include_str!` 编译期嵌入）的 PR，`cargo build` 失败不会在合并前暴露。
- **建议**：`node --test apps/web/tests/*.test.mjs` 自动发现；统一包管理器与一份 lock + `--frozen-lockfile`；把 `crates/**/src/scaffold/templates/**` 加入 `paths` 白名单。

#### I-032 空 `results` 时旧单页渲染期抛错 / 除零 NaN
- **位置**：`apps/web/src/App.tsx:32-34, 152, 172, 269, 328-331`
- **证据**：`const avg = (f) => rs.reduce(...)/rs.length`；`out && mean` 在 `rs.length===0` 时仍为真（对象各字段 NaN）；`dayMetric(out.results[0], ...)` 传 `undefined` → 访问 `m.day_stats` 抛 TypeError，只能由整页 ErrorBoundary 兜底。
- **影响**：内核返回空 results 或导入被篡改归档 → 结果区全丢。
- **建议**：`rs.length === 0` 显示空态并跳过图表区。

---

### 6. P3 · 低严重度 / 一致性（6 条）

| ID | 位置 | 问题 |
|---|---|---|
| I-033 | `scenario.rs:947-951`、`config.rs:1042-1043`、`disttest.rs:59, 72-77, 43` | 注释自相矛盾：两处仍写「掉落结算未接入仿真、加载期被拒」，但 `sim.rs:326-340` 已接入、测试断言可加载；`merge_buckets` 注释称「左优先」，实现是「按期望值最小优先」；`chi_square` 漏 `e.is_infinite()` 检查，`+Inf` 期望得到无诊断的失败 |
| I-034 | `registry.rs:408-410`、`scenario.rs:57-69` | `model.stage_rules` 被 `check_tree` 特例放行，但 `ModelSection` 无该字段且未 `deny_unknown_fields` → YAML 静默丢弃，用户以为生效（死配置） |
| I-035 | `WorkbenchApp.tsx:145-148, 135-141`、`routing.ts:31-35` | `hashchange` 只恢复 page、丢弃 `link.selection`；被未保存守卫拦截时 hash 已变但 state 未变 → URL/页面漂移 |
| I-036 | `executor.ts:418-421, 195-200`、`sweepWorker.ts:53`、`StatusBar.tsx:53`、`keyboard.ts:26-36` | Worker 结构化 `errorClass:'init'`（可重试）在执行域被降级成不可重试的 `run` 错误；`aria-expanded="false"` 硬编码；快捷键表声明 Ctrl/Cmd+C 但 `globalShortcutFor` 未实现 |
| I-037 | `crates/sandtable-cli/src/main.rs:1035-1042`、`Cargo.toml:18-20`、`crates/sandtable-cli/Cargo.toml:36-38` | 发布构建不带 `--features`，headless CLI 实际不含 `query` / `--parquet`（⚠ 待验证是否有意瘦身）；release 未做 WASM 体积优化（`opt-level="z"` / `strip` / `wasm-opt`）；`csv_field` 未防 `= + - @` 公式前缀（⚠ 可利用性待验证） |
| I-038 | `crates/sandtable-wasm/src/lib.rs:40`、`apps/desktop/src-tauri/src/lib.rs:181, 991-993`、`crates/sandtable-mcp/src/main.rs:47-50, 60, 245-250`、`crates/sandtable-python/src/lib.rs:31, 331`、`crates/sandtable-cli/src/main.rs:41, 398, 412` | 五壳层契约漂移：WASM/Tauri 用 `load_config_str`（接受实验 YAML），MCP/Python/CLI 用 `load_str`（拒绝顶层 sweep）；`replicates` 默认值 CLI/Python=1、其余必填；错误形状各加前缀，并非 MCP README 声称的「原文透传」；`to_tool_result` 的 `unwrap_or_default()` 序列化失败时静默返回空串。正面：MCP `main()` 全程无 `println!`，stdio 帧纪律落实 |

---

### 7. 横切主题（三张对照表）

#### 7.1 输入校验：哪些门有、哪些门没有

| 入口 | 已设门 | 缺口 |
|---|---|---|
| YAML `scenario::load_str` → `validate` | 概率有限性/区间、负奖励、`tiers`、加权表权重有限性、`xp_needed` 1..=512 求值探针、`cohort_weights` 每项有限 | 上界、i64 符号与范围、f64 增长/幂槽、抽卡迭代上限、`stall_days`、`max_rounds==0`、NaN/Inf 的 `config_hash` 身份 |
| `registry::apply_numeric`（参数表/CSV 回写） | f64 概率槽有 `finite_nonneg`；`registry.rs:900-901` 注释承认「validate 未覆盖的槽由数值通道兜底」 | i64 槽 `value.round() as i64` 无 `is_finite`：`NaN→0`、`inf→i64::MAX`（`registry.rs:577-585`）；负 `cohort_weights` 被显式放行（`registry.rs:554-555, 954`），与 YAML 入口口径不一致 |
| MCP / Tauri / Python | MCP 次数上限、WASM 规模门 | 路径逃逸（I-009）、任意 SQL（I-010）、递归深度（I-029）、replicates（I-011） |

**根因**：校验按「发现一个洞补一个洞」演进（`config.rs` 里多处「审核整改 P1」注释可见），缺少类型级统一收口。建议一次重构：定义 `NumericSlot { min, max, finite, integer }` 元数据表，让 `validate` / `apply_numeric` / `params.rs` 共用同一份描述，并加一条「遍历 `SimConfig` 所有 f64 字段拒绝非有限值」的回归测试。

#### 7.2 预算矩阵（逐层放宽，且最松的两层接不可信输入）

| 壳层 | replicates | 候选数 | `players×days` | 输入来源 |
|---|---|---|---|---|
| WASM | ≤64 | ≤200 | ≤400,000（仅 sweep/optimize，**run 漏**） | 浏览器 UI |
| MCP | ≤4096 | ×R ≤1000 次仿真 | **无** | AI 代理（任意 YAML / results_json） |
| Tauri | **无** | **无** | **无** | WebView（任意 invoke 参数） |
| CLI / Python | **无** | core 层 `MAX_CANDIDATES=10_000` | **无** | 本地命令行/脚本 |

建议：把预算函数下沉到 `core`，签名 `estimate_cost(spec, cfg) -> Result<Cost, Error>`，五壳层共用；MCP/Tauri 额外做「输入字节上限 + 路径白名单」。

#### 7.3 统计口径错配清单

| 主题 | 实现 | 应有口径 | 条目 |
|---|---|---|---|
| 退化 CI | zero-width 仍判显著 | `n<2 || sd==0` → 证据不足 | I-001 |
| 效应量 | 独立样本 `Δ/s_pooled` | 配对 `d_z=Δ/s_d` | I-005 |
| 通胀 day1 | `G(1)/1` | 无定义 | I-008 |
| sink_ratio 分母 0 | `spent/max(earned,1)` → 绝对量 | 无定义 / None | `metrics.rs:298` |
| 空 Power 快照 | `percentile([]) → 0.0` | 不 push / None | `metrics.rs:128-130, 333-342` |
| 运行级指标缺席 | `filter_map` 静默删约束 | 显式 `missing` | I-006 |
| 自定义 KPI 缺席 | NaN 被洗成 0/1 | 记 None | I-016 |
| OAT 切片 | `find` 首个同值候选 | 校验非轴维=基线 | I-007 |
| `compare` 两臂不等长 | `debug_assert_eq!` + `zip` 截断 | 运行时 `Result` 校验 | `experiment.rs:118-119` |
| `crossing` 缺统计 | `unwrap_or(NaN)` → 回退格点仍标 `interpolated` | 中止并写 reason | `recommend.rs:339-351` |

---

### 8. 复现与验证方式（谨慎）

> OOM / 死循环类条目**不要**用上述极端值直接跑，先在上界内验证行为，再用「先检查后分配」的修复做回归。

1. **统计结论类（安全）**：无需编译全仓，用现有夹具即可。
   ```bash
   cargo test -p sandtable-core --test golden        # 现有黄金快照
   # 新增回归：R=1 / sd=0 / day1 inflation / 运行级 None / 二维基线非端点
   cargo test -p sandtable-core --lib experiment
   cargo test -p sandtable-core --lib sensitivity
   ```
   对 I-001/I-005 的最小复现是构造 `compare("m", &[1.0], &[2.0])`，断言当前版本返回 `BHigher` 与 `CI=[1,1]`；修复后应返回「证据不足」。
2. **配置门禁类（安全）**：`cargo test -p sandtable-core --lib config`，新增「恶意 YAML」表驱动用例：`whale_gain_mult:-1`、`upgrade_cost_base:-100`、`stall_days:0`、`max_rounds:0`、`tier_growth:.nan`、`cohort_weights:[0.5,0.5,0.5]`、`rate_mult:1e308`。断言全部 `Err(Error::Config)` 且 `config_hash` 对非有限值拒绝。
3. **不可信输入类（隔离环境）**：`cargo test -p sandtable-mcp` 增加 `file = "C:/..."` 与 `results_json` 超长用例；Tauri `query` 需要桌面壳 invoke，建议在 `tests/` 里对 `query()` 抽出的纯逻辑加白名单单测。
4. **前端类**：`node --test apps/web/tests/`（注意 I-031：CI 目前只跑手写清单）；对 I-012 注入一个 reject 的 backend，断言队列仍能继续；对 I-022 用 `#/workbench/analysis?metric=%E0%A4%A` 做 jsdom 模块加载测试。
5. **修复后全量门禁**：按 README「本地测试口径」——改 `core` 需 `cargo test -p sandtable-core` + 五形态等价测试（`web_parity` / `py_parity` / `mcp_stdio` / `parallel_determinism`）全部重跑；统计口径改动（I-001/I-005/I-008）**必须同步更新黄金快照**，否则 `golden` 测试会因正确修复而失败，需在提交说明里写清口径变更。

---

### 9. 修复路线图（按依赖顺序）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **阶段 0 · 结论可信度** | I-001、I-005、I-006、I-007、I-008、I-016 | 新增退化输入/多维网格/缺席指标回归测试；黄金快照按新口径更新并写明变更 |
| **阶段 1 · 不可信输入与单输入崩溃** | I-009、I-010、I-011、I-002、I-003、I-004、I-012 | 恶意 YAML / MCP mapping / Tauri invoke 全部返回结构化错误而非挂死；`cargo test --workspace` 五形态等价测试仍绿 |
| **阶段 2 · 统一门禁与预算** | I-014（数值槽元数据表）、I-017（统一预算函数）、I-015、I-018、I-019 | 「遍历 SimConfig 所有 f64 拒绝非有限值」测试；预算矩阵收敛为单一常量表并写进 docs 22 |
| **阶段 3 · 前端状态与工程化** | I-013、I-020~I-025、I-031、I-032 | `node --test apps/web/tests/*.test.mjs` 自动发现全绿；prebuild wasm hash 门禁；CI 双路径构建 |
| **阶段 4 · 一致性收尾** | I-026~I-030、I-033~I-038 | 跨壳层契约文档（validate 入口/默认值/错误形状/预算）成文；`cargo tree -d` 无重复大版本 |

**风险提示**：阶段 0 改变统计输出，会让现有黄金快照、已归档 `.sandtable` 结果、文档 13/15 章公式同时失效；建议按 `SCHEMA_VERSION` 提升一个版本，或在报告 `meta` 里增加 `stats_version` 字段，避免新旧结果混在同一实验里比较。

---

### 10. 附录：`todo.md` 中 7 个未勾选项（均为已裁决搁置，不是实施欠账）

| 行号 | 条目 | 挂闸原因（摘要） |
|---:|---|---|
| 402 | JMP / Origin 自动化评估 | 缺使用场景与本机安装；方向已决「文件交付优先」，真实工具导入试点待用户 |
| 405 | Power BI / Tableau | 缺真实团队消费需求；本机无目标软件 |
| 406 | 多人协作 | 缺服务端形态/版本模型/合并策略的用户决策；local-first 不预设 |
| 455 | Windows 交互走查（macOS 仍 BLOCKED） | 自动化链已覆盖构建/启动/安装，缺 GUI 人工走查取证 |
| 459 | 随机函数扩展后续（Poisson） | 无真实品类需求及 System 立项输入 |
| 463 | Web API | 无真实服务端需求；启动闸门需至少一个明确调用方 + 完整 I/O 案例 |
| 464 | GP 优化 | 需先证 RF 代理漏候选或预算不可接受；第一个真实优化任务待用户 |

V2 工作台 `WB-01`~`WB-11` 全部已勾选并附 commit/测试证据；当前产品的真实剩余风险不在这份清单里，而在本文第 3~5 节的源码级问题。

---

### 11. 已验证的工程强项（避免只看到问题）

- `t_critical_975` 表（df 1..30）、样本方差 `n−1`、CI = mean ± t·sd/√n、`df=R−1` 公式实现**正确**；`judge` 的三态（CI 完全在内/相交/完全在外、边界相切归 BORDERLINE）与 docs 13 章表格一致。
- 内核零平台依赖、无 rayon/HashMap、配置面全 `BTreeMap`、累加顺序固定，并行用 `IndexedParallelIterator` 保序且有 `parallel_determinism` 测试——确定性是硬契约。
- `.sandtable` 解包的路径纪律健全（`Component::Normal` 白名单 + 清单/归档严格相等），**未发现 zip slip**；MCP `main()` 无 stdout 污染。
- `sweep::plan` 的 Grid/Random/LHS 均由 `base_seed` 派生，候选数上限在物化前检查（`sweep.rs:227-236`），是修得不错的一处。
- V2 reducer 全部 `{...state}` / 新数组，无原地修改；`applyOutcome` 终态先到先得、`startNextQueued` 单趟扫描 + `activeControls.has` 幂等；稳定 ID 内容寻址（`ids.ts`）设计到位。

---

### 12. 方法与局限再说明

- 38 条中，`✅ 已复核` 的 14 处关键代码位置为：`experiment.rs:40-155`、`sweep.rs:385-421`、`metrics.rs:285-310`、`sensitivity.rs:238-254`、`config.rs:640-690 / 745-890`、`systems/gacha.rs:35-65`、`calibrate.rs:125-171`、`runManager.ts:325-338`、`tauri/lib.rs:410-445 / 578-628`、`routing.ts:50-63`、`sandtable-wasm/src/lib.rs:55-80`、`WorkbenchApp.tsx:517`（常量）、`todo.md` 未勾选项。其余条目来自分层审查并附 file:line，标注 `⚠ 待实跑` 者需运行时确认。
- 未执行编译与测试；「可达性」判断基于调用链静态分析，可能存在上游已有拦截但本次未覆盖的路径（尤其 I-006/I-007 的运行级触发条件）。
- 本文不修改任何源码、配置或测试；`issues.md` 本身是新增文件，如需据此开工，建议先按第 9 节阶段 0 立 3~5 个最小回归测试再动实现。
