[0m
我会只读检查：先定位 TODO、项目文档与代码入口，再沿关键实现核对；不改文件、不提交。输出中的判断会附 `file:line`，无法确认的会标「未核实」。
[0m✱ [0mGlob "**/*" [90m300 matches[0m
[0m✱ [0mGrep "TODO|todo" [90min . · 54 matches[0m
[0m$ [0mgit status --short && git log -1 --oneline
250ce30 docs: record locale autodetect in todo
[0m→ [0mRead todo.md 
[0m→ [0mRead Cargo.toml 
[0m→ [0mRead README.md 
[0m→ [0mRead docs/审计-文档一致性.md 
[0m→ [0mRead docs/index.md 
[0m→ [0mRead README.zh.md 
[0m✱ [0mGlob "crates/*/src/**/*.rs" [90m36 matches[0m
[0m✱ [0mGlob "docs/.vitepress/**" [90m100 matches[0m
[0m✱ [0mGlob ".github/workflows/*" [90m3 matches[0m
[0m✱ [0mGlob "apps/web/src/**/*" [90m16 matches[0m
[0m✱ [0mGrep "ignore|paths:|paths-ignore|cargo test|docs:build" [90min .github · 10 matches[0m
[0m✱ [0mGrep "unwrap\(|expect\(|panic!|TODO|FIXME|unimplemented!|todo!" [90min crates · 300 matches[0m
[0m→ [0mRead crates/sandtable-core/src/sim.rs 
[0m→ [0mRead crates/sandtable-core/src/config.rs 
[0m→ [0mRead crates/sandtable-core/src/metrics.rs 
[0m→ [0mRead crates/sandtable-core/src/scenario.rs 
[0m→ [0mRead crates/sandtable-core/src/rng.rs 
[0m→ [0mRead crates/sandtable-core/src/formula.rs 
[0m→ [0mRead crates/sandtable-core/src/systems/combat.rs 
[0m→ [0mRead crates/sandtable-core/src/kernel.rs 
[0m→ [0mRead crates/sandtable-core/src/systems/gacha.rs 
[0m→ [0mRead crates/sandtable-core/src/systems/behavior.rs 
[0m→ [0mRead crates/sandtable-core/src/systems/progression.rs 
[0m→ [0mRead crates/sandtable-core/src/systems/churn.rs 
[0m→ [0mRead crates/sandtable-core/src/registry.rs 
[0m→ [0mRead crates/sandtable-core/src/sweep.rs 
[0m→ [0mRead crates/sandtable-core/src/optimize.rs 
[0m→ [0mRead docs/.vitepress/config.mts 
[0m→ [0mRead crates/sandtable-core/src/experiment.rs 
[0m→ [0mRead package.json 
[0m✱ [0mGrep "loot|LootTable|rate_mult|sample_weighted|weighted\(" [90min crates/sandtable-core/src · 79 matches[0m
[0m→ [0mRead docs/guide/24-random-functions.md 
[0m→ [0mRead docs/zh/guide/24-random-functions.md 
[0m→ [0mRead crates/sandtable-core/src/world.rs 
[0m→ [0mRead crates/sandtable-python/src/lib.rs [90m[offset=1, limit=450][0m
[0m✱ [0mGrep "Python|脚本层|Script Layer|DuckDB|Parquet|Arrow|footer|MIT|Apache|phase|Phase" [90min docs · 250 matches[0m
[0m→ [0mRead crates/sandtable-cli/src/project.rs 
[0m→ [0mRead apps/web/src/lib/project.ts 
[0m→ [0mRead crates/sandtable-cli/src/main.rs [90m[offset=1, limit=270][0m
[0m→ [0mRead apps/desktop/src-tauri/src/lib.rs 
[0m→ [0mRead docs/guide/07-config-formula.md [90m[offset=105, limit=25][0m
[0m→ [0mRead apps/web/src/lib/wasm.ts 
[0m→ [0mRead docs/guide/17-project-structure.md [90m[offset=1, limit=80][0m
[0m→ [0mRead LICENSE [90m[limit=8][0m
[0m→ [0mRead scripts/scripting-design.md [90m[offset=1, limit=55][0m
[0m→ [0mRead crates/sandtable-engine/Cargo.toml 
[0m→ [0mRead docs/zh/index.md [90m[offset=30, limit=10][0m
[0m✱ [0mGrep "sandtable-engine|engine-adapter" [90min docs/guide/17-project-structure.md · 2 matches[0m
### 表一 缺陷

| 问题 | file:line | 为什么是问题 | 建议动作 |
|---|---|---|---|
| **P1：合法公式可令仿真无限循环** | `crates/sandtable-core/src/config.rs:717-720`；`crates/sandtable-core/src/systems/progression.rs:9-29` | 校验只编译公式，不检查求值结果；例如 `xp_needed: "0"` 能通过校验。获得经验后 `gain_xp` 因所需经验为 0 而持续升级，无法结束。 | 校验公式在合理等级区间内始终产生正的有限值；运行时为升级循环增加防护。 |
| **P1：配置概率校验不完整，非法值会静默改变仿真** | `crates/sandtable-core/src/config.rs:651-675`；`crates/sandtable-core/src/systems/behavior.rs:21-27` | 流失概率只比较 `p_stall < p_base`，未要求有限且在 `[0,1]`；行为概率的比较也会漏过 NaN，`sessions_frac` 未见范围校验。越界概率会变成总触发或永不触发，NaN 则可能静默改写行为。 | 对所有概率字段统一校验有限性与取值区间，并补齐 NaN、负值和大于 1 的测试。 |
| **P1：扫描预算上限检查太晚，可能先耗尽内存** | `crates/sandtable-core/src/sweep.rs:54-70`；`crates/sandtable-core/src/sweep.rs:208-221` | `plan` 先为每个维度完整生成 `grid_points`，之后才检查 `MAX_CANDIDATES`。超大范围会在触发 10,000 候选上限前分配巨型向量。 | 先用有上限的计数计算网格规模；超过预算立即拒绝，再生成候选。 |
| **P1：仿真一次性排入所有玩家、所有天的事件** | `crates/sandtable-core/src/sim.rs:71-85` | 事件队列规模随 `players × days` 增长；例如 100,000 人 × 90 天会预先排入约 900 万个玩家日事件，可能造成高内存占用或 OOM。 | 改为按日生成/消费事件，或加入明确的资源预算与输入规模上限。 |
| **P1：不可用指标对应的约束被静默跳过** | `crates/sandtable-core/src/experiment.rs:210-219`；`crates/sandtable-core/src/sweep.rs:363-391` | 例如仿真不足 7 天时，`retention_d7` 无值；`run_candidate` 会省略该指标及其目标判定，但候选仍可显示成功，用户可能误以为约束已执行。 | 在加载实验时按天数及配置校验目标可用性；不可用时明确报错或输出显式的未定义状态。 |
| **P1：配置接受掉落表，但它们没有进入仿真** | `crates/sandtable-core/src/config.rs:541-546`；`crates/sandtable-core/src/sim.rs:117-126,279-307` | `loot` 被解析/校验，但仿真系统未订阅掉落事件；战斗奖励直接使用 `out.gold` / `out.xp`，没有应用掉落表或 `rate_mult`。用户调整这些参数可能只改变配置哈希，不改变结果。 | 将掉落表与倍率接入实际奖励结算；若尚未实现，则拒绝或明确标记这些配置不参与仿真。 |
| **P2：Pareto 寻优在所有候选都配置错误时会 panic** | `crates/sandtable-core/src/optimize.rs:627-647,739-747` | 所有候选均为配置错误时，Pareto 排序没有有效前沿，`pareto_front()` 返回 `None`，随后被 `expect` 触发 panic。可用全为负数的奖励扫描范围复现。 | 将“没有有效候选”作为正常结果或返回可读错误，不用 `expect`。 |

### 表二 文档与实现不一致

| 文档说法 | 文档位置 | 代码实际 | 代码位置 |
|---|---|---|---|
| “目前只提供最窄一层（均匀 + 伯努利）” | `docs/guide/24-random-functions.md:8`；中文：`docs/zh/guide/24-random-functions.md:9` | 已实现正态、加权抽样、洗牌/无放回抽样等随机原语；本页后续清单也将其标为已落地。 | `crates/sandtable-core/src/rng.rs:111-193,250-350` |
| `model.loot.rate_mult` 可扫描并改变掉落产出强度；权重表加载时编译为 CDF | `docs/guide/24-random-functions.md:61-78`；中文：`docs/zh/guide/24-random-functions.md:63-79` | 配置和参数通道存在，但运行时没有应用倍率，也没有把配置表编译后用于仿真；加权表目前是独立原语。 | `crates/sandtable-core/src/config.rs:229-247,614-638`；`crates/sandtable-core/src/sim.rs:117-126,279-307`；`crates/sandtable-core/src/rng.rs:128-153` |
| 日粒度指标聚合、不存玩家逐步数据，并称 100,000 人 × 90 天仍在内存预算内 | `docs/index.md:28-29`；中文：`docs/zh/index.md:28-29` | 聚合器是在线的，但主循环仍预先将全部玩家日事件放入队列；文档的内存承诺没有覆盖这部分开销。 | `crates/sandtable-core/src/sim.rs:71-85` |
| 脚本设计“定稿，待分期实施” | `docs/guide/07-config-formula.md:114-115`；中文：`docs/zh/guide/07-config-formula.md:115-116` | 脚本阶段 0–3 已落地，Python 绑定和日粒度回调均有实现。 | `scripts/scripting-design.md:3`；`crates/sandtable-python/src/lib.rs:16-18` |
| 首页页脚版权标为 MIT | `docs/index.md:34-36`；中文：`docs/zh/index.md:34-36` | 仓库许可证为 Apache-2.0，VitePress 英文和中文 locale 页脚也标为 Apache-2.0。 | `LICENSE:1-3`；`docs/.vitepress/config.mts:107,200` |

### 表三 值得补的能力

| 能力 | 为什么现在没有 | 价值高低 |
|---|---|---|
| 配置数值域与公式安全校验 | 当前 `validate` 有部分参数检查，但未覆盖行为概率、流失概率和公式求值的安全边界；相关缺口见 `crates/sandtable-core/src/config.rs:651-720`。 | 高 |
| 仿真规模预算与流式事件调度 | 当前事件队列一次性承载玩家×天事件，尚无对应的规模上限或分日调度；见 `crates/sandtable-core/src/sim.rs:71-85`。 | 高 |
| 扫描目标可用性预检 | 当前目标是否可提取要到运行候选时才暴露，且不可用目标会被省略；见 `crates/sandtable-core/src/experiment.rs:210-219`、`crates/sandtable-core/src/sweep.rs:363-391`。 | 高 |
| 实际掉落结算系统 | 目前已有掉落配置和通用抽样原语，但尚无把它们连到仿真奖励结算的系统；见 `crates/sandtable-core/src/config.rs:229-247`、`crates/sandtable-core/src/rng.rs:111-193`、`crates/sandtable-core/src/sim.rs:117-126`。 | 高 |
| 桌面长任务进度与取消 | 桌面命令直接同步运行全部 replicate 并返回结果，没有进度或取消入口；见 `apps/desktop/src-tauri/src/lib.rs:119-136`。 | 中 |
| 真实运营数据校准流程 | 仓库将真实案例二期挂起，解除条件是用户提供运营数据与对标基准；见 `todo.md:20`。 | 高 |

### 表三 评估与分期建议（2026-10-18 巡检处理，不实现）

处理原则：表三只出评估与分期建议，**不实现**（需用户拍板）；其中 1–3 项恰好落在表一缺陷的修复面上，随本次整改一并落地，此处只记结论。

| 能力 | 结论（2026-10-18） | 分期建议 |
|---|---|---|
| 配置数值域与公式安全校验 | ✅ 已落地（表一 P1-1 / P1-2） | 无待办。`validate` 现覆盖流失与行为概率的有限性与 `[0,1]` 区间、`sessions_frac`、`model.loot` 拒载、`formulas.xp_needed` 逐级探针；`gain_xp` 另有运行时兜底 |
| 仿真规模预算与流式事件调度 | ✅ 已落地（表一 P1-4） | 无待办。事件队列改为按日滚动排程，规模与 `players × days` 解耦。若再要一道硬预算门（显式拒绝超大输入），建议放在 `scenario` 加载层，属锦上添花 |
| 扫描目标可用性预检 | ✅ 已落地（表一 P1-5） | 无待办。`MetricKey::unavailable_reason` + 加载器（CLI / Python 共用）与内核双层预检，不可用即拒载 |
| 实际掉落结算系统 | ⏳ 未实施，本次仅止损（配置拒载 + 数值通道关闭） | 建议第二批，需拍板。先出设计再实施：新 `Purpose` 尾追加（0–7 已锁）、结算挂在战斗胜利事件上、`rate_mult` 数值通道重开、`config_hash` 影响面、`disttest` 是否需要扩展。规模中等，独立一个 System |
| 桌面长任务进度与取消 | ⏳ 未实施 | 建议第三批，需拍板。依赖 Tauri 2 异步 command（进度回调 + 取消令牌）与前端进度条，改动面在 `apps/desktop`，与内核解耦 |
| 真实运营数据校准流程 | ⛔ 外部闸门（`todo.md:20`） | 不排期。解除条件是用户提供运营数据与对标基准，巡检无法推进 |

分批口径：第一批（已完成）= 表一全部 P1 / P2 修复 + 表二文档对齐；第二批（待拍板）= 掉落结算 System；第三批（待拍板，可选）= 桌面进度与取消。
