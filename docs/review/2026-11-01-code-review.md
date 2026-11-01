# 代码深审报告（2026-11-01）

目标仓：sandtable。范围：全仓代码面。方法：安全静态扫描 → 隐藏 bug 猎捕 → 质量门禁 → 分级修复。
调用 `requesting-code-review` 技能流程；该技能为游戏引擎导向（Unity/Godot/Unreal 专家面），本仓为
Rust workspace + React/Vite + Tauri 壳，引擎面不适用，按任务书六步执行。**扫描覆盖如实记录**：
Rust `crates/sandtable-{core,cli,wasm,python,engine,mcp}/src` + `apps/desktop/src-tauri/src`（全量 .rs）、
Web `apps/web/src`（XSS/门禁/异步执行器）、Python `scripts/` + `scripts/templates/` + pyo3 绑定、
`.github/workflows/*.yml` 的 `run:` 步骤注入面。**未覆盖**：React 组件级状态/渲染逐组件深审（本报告
只做 XSS + 门禁 + 异步执行器竞态，属另一深度面，如实标注）。

## 一、安全静态扫描（①）

逐类扫描，阴性结论以「扫描覆盖 X」标注——空 grep 只在这时才是证据。

| 类 | 结果 | 证据/扫描面 |
|---|---|---|
| 硬编码密钥 | **无** | 全仓 grep `api_key/secret/password/PRIVATE KEY/sk-/AKIA/ghp_`，src 无命中（排除测试/夹具/示例） |
| SQL 拼接 | **无** | DuckDB 查询面无字符串拼接 `format!(SELECT...FROM...)`（analyze/calibrate 面） |
| eval / new Function / exec | **无** | 命中均为 `RegExp.exec`/命名函数 `exec()`，非代码注入 |
| shell 注入 | **无** | `sh -c`/`bash -c`/`shell=True`/`os.system` 零命中；`analyze` 子进程为 `Command::new(interp).arg(script)`（无 shell） |
| 不安全反序列化 | **无** | `yaml.load`/`pickle.load`/`unsafe_load` 零命中；serde 均为强类型 |
| 路径穿越 | **无** | CLI 路径为命令契约；zip 解包 `check_entry_path` 拦截 `..`（`project.rs` 注释） |
| GH Actions `run:` 注入 | **无** | `github.event.*`/`inputs.*` 不作插值进 run 步骤，只经 env（`$GITHUB_SHA`/`$GH_REPO`） |
| Python subprocess | **无** | `config_effects.py:141` 为 list 形态 `subprocess.run([bin, ...])`，无 shell |

`unsafe` 唯一站点：`crates/sandtable-cli/src/analyze.rs:95` `libc::kill(-(child.id() as i32), SIGKILL)`——
合法 Unix 进程组 kill，pid 来自刚 spawn 的子进程（非用户输入），**无漏洞**（进程组隔离是特性非风险）。

## 二、隐藏 bug 猎捕（②）

### 发现（按严重度排序）

**P0：0 项。P1：0 项。**（2026-11-02 复核：C1 撤回，见 §七勘误）

| ID | 严重度 | 位置（file:line） | 问题 | 修法 |
|---|---|---|---|---|
| C1 | P2（撤回） | `crates/sandtable-cli/src/report.rs:1162`（`let n = c.xs.len()`）、`:1310`（`c.xs[0]`）、`:1315`（`c.xs[n-1]`） | ~~图表轴标注渲染器假定 `xs` 非空；空数据时 `c.xs[0]` 先 panic~~ —— **误报**：`svg_chart`（`report.rs:1152`）首行守卫 `c.xs.is_empty() || c.series.is_empty() || ...`（`report.rs:1159`）提前返回「无数据」，索引位于守卫之后不可达空数据 | 无需修（守卫已在，7920cd4 起即存在） |
| C2 | P2 | `crates/sandtable-core/src/registry.rs:516-523`（`unsigned` 闭包仅拒负）、`:536/549/562/572/579/586/616`（`.round() as u32`） | u32 槽位（`population`/`max_rounds`/`tiers`/`sessions_int`/`stall_days`）**无上限检查**；值 > u32::MAX 经 `as u32` 静默饱和（自 Rust 1.45 饱和不 UB，但违反本仓 `exact_u64` 注释「明确拒绝不静默」原则） | `unsigned` 增上界校验（`v ≤ u32::MAX`）或改用 checked 转换；P2 → todo.md（延迟） |

### 核验干净（非发现的防御点，均证明安全）

| 点 | 证据 | 判定 |
|---|---|---|
| 生产 unwrap/expect（4 候选） | `recommend.rs:155`（仅 `seg.empty` 置 None 且随即 `break`）；`scaffold.rs:30`（前置 `name.is_empty()` 检查）；`project.rs:367`（前一行 `.context()?` 已保 Some）；`workbook.rs:477`（Arrow `data_type()` 与数组类型一致 + match 分派） | 全部不变式守卫、失败即大声 panic（带清晰消息），非静默错误 |
| 其余 unwrap/expect | `export.rs:14`/`config.rs:869`/`params.rs:147,154`/`backflow.rs:98`/`contract.rs:390`（纯数据序列化不可失败）；`sim.rs:65,142,201`（`validate` 已保证公式可编译的不变式断言）；`python/lib.rs:82,213`（cohort index/JSON number 类型保证） | 安全 |
| OOB/off-by-one | `experiment.rs:23`（`df==0` 守卫返回 INFINITY，`T975[df-1]` 在 1..=30）；`rng.rs:173,306,320`（Fisher–Yates `draws[i-1]` 索引上界 = n-2 < len）；`optimize.rs:383`（`by_front[w±1]`，front 长度 ≥1 由构造保证）；`main.rs:1639`（`idx` 来自同 vec enumerate） | 无越界 |
| 竞态/并发 | `apps/desktop/src-tauri/src/lib.rs:32-50`（`TaskRegistry(Mutex<Option<CancelFlag>>)`，短持锁，`Arc<AtomicBool>` 传任务，无锁跨 await，`into_inner` 中毒恢复）；`main.rs:472`/`mcp/main.rs:136` rayon `par_iter` collect（确定性由 parallel_determinism 测试锁定）；`sim.rs:390-403`（gacha 定轨接线 hits 差值累计，actor_id 有界，RNG 键确定性） | 无竞态 |
| 资源泄漏 | `workbook.rs:244` `zw.finish()?` 已收尾；ArrowWriter/zip 失败路径由 `drop` 关闭文件句柄 | 无泄漏 |
| 吞错 | `export.rs` 大量 `let _ = writeln!(s,...)`（写入 String 不可失败） | 正确 |
| 软保底 off-by-one | `gacha.rs:31` 用 `n - soft + 1`（i128），`n = since_hit+1`，第 1 个获加成抽数 = `soft` | 已正确（b064ba4 修复，本次复核无回归） |

## 三、质量门禁（③，基线）

| 门禁 | 结果 |
|---|---|
| `cargo fmt --all --check` | 净 |
| `cargo clippy --workspace --all-targets -- -D warnings` | exit 0（零告警） |
| `cargo test --workspace` | 全绿（core 202 等，0 失败） |
| `tsc -b --noEmit`（apps/web） | exit 0 |
| `oxlint`（apps/web） | exit 0 |
| `python3 -m py_compile`（仓内 .py） | OK |

基线全绿——无既有质量回退；本次仅记录，无代码改动。

## 四、发现汇总（④，按严重度）

| 严重度 | 数 | 明细 |
|---|---|---|
| P0 | 0 | — |
| P1 | 0 | — |
| P2 | 1 | C2（registry u32 饱和）；C1 撤回（见 §七） |
| P3 | 0 | — |

## 五、修复状态（⑤）

- **P0/P1 当场修**：无（0 项）——本轮无 P0/P1 发现。
- **P2/P3 → todo.md**：C2（registry u32 饱和）已记 todo.md（见 §七）。C1 为误报、无需入 todo。
- **无代码改动**（未发现需修的真实缺陷；C2 为防御性缺口，留 todo）。

## 六、汇报（⑥）

- **发现数**：1 确认（C2 P2）；1 撤回（C1 误报，见 §七）。**已修**：0（无 P0/P1）。**剩余**：1（C2，待修，已入 todo）。
- **commit**：本报告 `docs(review): add 2026-11-01 full-repo code review`（本轮无代码修复 commit）。
- **门禁**：全部绿（见 §三）。**扫描覆盖**：见 §首段（Rust 全量、Web 门禁+XSS+执行器、Python、GH Actions）。

## 七、勘误（2026-11-02）

复核 C1 时发现误报，如实更正：

- **C1 撤回**：报告初稿称 `report.rs` 图表轴渲染器（`let n = c.xs.len()` @ 1162、`c.xs[0]` @ 1310、`c.xs[n-1]` @ 1315）在空数据时会 panic。实测 `fn svg_chart`（`report.rs:1152`）**首行守卫** `if c.xs.is_empty() || c.series.is_empty() || c.series.iter().all(|s| s.ys.is_empty()) { return "…无数据" }`（`report.rs:1159-1161`）提前返回空态，三处索引全在守卫之后、同函数内无其他 fn 边界，空数据时不可达。该守卫自 `svg_chart` 首个 commit（7920cd4）即在，非新修。故 C1 不成立，撤回。
- **C2 保留**：复核 `crates/sandtable-core/src/registry.rs:516-523` 的 `unsigned` 闭包当前 HEAD 仍只拒负、无上界校验，`.round() as u32` 在值 > u32::MAX 时静默饱和（自 Rust 1.45 起不 UB，但违背本仓 `exact_u64`「明确拒绝不静默」原则）。C2 成立，已补 todo.md（条目「审核发现：u32 槽位无上限检查」）。
- **计数更正**：P2 由 2 改为 1（C2）。
