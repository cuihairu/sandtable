# sandtable 脚本层设计(Python 载体)

状态:**阶段 0–2 已落地(阶段 0:2026-10-08;阶段 1:2026-10-11;阶段 2:2026-10-11),阶段 3 已拍板开工(2026-10-11,用户授权自行拍板),第一批已落地——性能实测报告([scripting-perf-report.md](scripting-perf-report.md)):日粒度批量 chunk 回调 GO(30 天挂满 ≈3% 基线,固定成本 ns 级),事件级红线被数据反向证实维持;第二批已落地——读态日钩子(core `DayHook` + Python `run_with_day_hook`,只读不改结果,pytest 对账锁死);rhai 缓议,Pyodide 不承诺**(分期计划见文末;每期实施前按本文件为口径基线)。
拍板:**脚本语言定为 Python**(2026-10-08,理由:简单库多、仿真分析生态成熟——numpy / pandas / scipy / matplotlib 一线贯通)。本文档回答:嵌入形态怎么选、与 CLI / Web / WASM 三形态的边界、性能红线、脚本不被信任时怎么办。

## 0. 定位(承既有架构口径)

- [配置与公式引擎](../zh/guide/07-config-formula.md)的原则不变:**配置描述数据,代码描述复杂行为**。脚本不是把 YAML 变成编程语言,而是承载 YAML 表达不了的两类东西:**实验编排**(批量跑、自定义分析)与**复杂行为原型**(远期)。
- [时间模型](../zh/guide/05-time-model.md)的量级红线不变:单次仿真事件量 10⁷ 级,仿真热路径永远在 Rust;Python 出现在**实验粒度**(per-run / per-candidate),不出现在**事件粒度**。
- 三形态分工(文档 [09](../zh/guide/09-data-output.md)/[22](../zh/guide/22-web.md)):CLI 是主力实验形态;Web 定位小中型交互;桌面已立项并落地 Tauri 2 壳(2026-10,文档 18 Phase 7)。脚本层依附于 native 形态,Web 不做(见 §3)。

## 1. 需求场景(按优先级)

1. **分析与可视化**:消费 `report.json / days.csv / Parquet`(文档 09 契约),pandas + matplotlib 出图、scipy 做统计——Python 生态在此无可替代;
2. **实验编排**:一个脚本批量生成配置变体、循环跑 sweep、聚合多实验产出;
3. **场景脚本**:程序化生成 YAML(地图/掉落表/保底曲线等参数化模板);
4. **自定义 System 原型**(远期):用 Python 快速验证行为逻辑,定型后下沉 Rust——受 §4 性能红线约束,仅在批处理粒度可行(见分期阶段 3)。

## 2. 形态对比与决策

| 方案 | 形态 | 隔离性 | 性能 | 部署 | 维护成本 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| A 外挂进程 | Python 脚本 subprocess 调 CLI / 直读产物文件 | **最好**(进程边界) | 进程启动 + IO 开销,相对仿真本体可忽略 | 零要求 | 零(不改 core) | **阶段 0 立即用** |
| B 扩展模块(maturin + PyO3) | core 编译为 Python wheel,`import` 后同进程调用 | 差(同进程,无沙箱) | **最好**(零拷贝 Arrow 交接) | pip / maturin 构建,manylinux/macOS wheel | 中(feature 门 + CI 新链) | **分期主体(阶段 1–2)** |
| C 嵌入解释器(PyO3 embed) | `sandtable` CLI 二进制内嵌 CPython,`sandtable script x.py` | 差(同进程) | 同 B | **所有 CLI 用户背 CPython 链接与 DLL** | 高(embed 构建链、GIL/信号) | **不做**(理由见下) |
| D 事件级 Python 回调 | Python 作为 System 实现载体,逐事件回调 | 差 | **禁止级差**:10⁷ 事件 × µs 级调用 ≈ 慢两个数量级 | — | 高(GIL 与并行确定性冲突) | **远期仅在批处理粒度评估**(阶段 3) |

C 不做的核心理由:embed 的收益(单二进制带脚本能力)只惠及少数要写脚本的用户,成本却摊给**每一个** CLI 用户(二进制体积、Windows DLL、构建复杂度);而"跑 Python 脚本"这件事,方案 A(系统 Python + subprocess)与方案 B(pip 安装 wheel)都已覆盖。经典取舍:**扩展优于嵌入**——官方指南同样把 extension module 列为主路径、embed 为特殊场景([PyO3 user guide](https://pyo3.rs/))。

B 与 A 叠加不冲突:B 落地后 A 仍是零依赖回退路径(没装 wheel 就 subprocess 调 CLI)。

## 3. 与三形态的边界

| 形态 | 脚本层 | 说明 |
| --- | --- | --- |
| CLI(native) | **主载体**(A 与 B) | 编排、分析、场景生成都挂这里 |
| Web(WASM) | **不支持** | CPython 编译 wasm 会把核心 wasm 体积与依赖纪律一起拖垮(核心 wasm 当前 ~2.6 MB,docs 22 规模定位);若将来有需求,Pyodide 属**前端独立实验**,不进 core、不承诺 |
| 桌面(Tauri 2,壳已落地 2026-10) | 载体待定(Phase 7 后续再拍板) | 候选:sidecar 系统 Python(方案 A 语义)或随包分发 wheel 的 venv(方案 B 语义) |

core 纪律不变:PyO3 依赖进**独立 crate**(`sandtable-python`,绑定壳层),core 本体依赖树保持无平台库(docs 04 边界),`wasm32` 门与现有 feature 门不受影响(同 `arrow` / `parquet` 的 feature 纪律)。

## 4. 性能预算

| 粒度 | 频率 | Python 开销 | 判定 |
| --- | --- | --- | --- |
| 实验编排(per run / per candidate) | 10²–10³ 次/实验 | 每次 µs–ms 级(函数调用 + 数据交接) | ✅ 可忽略 |
| 数据交接(per run) | 1 次/run | Arrow C Data Interface 零拷贝进 pandas([Arrow 格式](https://arrow.apache.org/docs/format/CDataInterface.html)) | ✅ |
| 事件回调(per event) | **10⁷/run** | Rust ~10² ns vs Python ~µs → 慢两个数量级 | ⛔ 红线:禁止事件级 Python 回调(除非未来以"日粒度批量 chunk"形态评估,见阶段 3) |

## 5. 安全:脚本不被信任时怎么办

CPython **没有真沙箱**(内省、文件、网络、ctypes 全开),安全只能靠**进程隔离与执行策略**,不靠语言层。威胁模型分级:

| 场景 | 信任级别 | 措施 |
| --- | --- | --- |
| 本地作者跑自己写的脚本 | 可信(默认) | 正常执行,无附加限制 |
| 项目文件携带脚本(docs 09 项目打包为规划:zip 含 models/scenarios/experiments) | **不可信** | 三条硬规则:①项目文件中的脚本**永不自动执行**(导入项目 ≠ 执行);②仅显式 `sandtable script <file>`(或用户手动 `python`)执行,执行前 CLI 打印脚本路径与内容哈希;③项目 zip 清单若有 `scripts/` 节,导入时如实列出并标"代码,执行前请审查" |
| 服务端 / 多租户替他人跑脚本 | **不支持** | 红线:sandtable 不做"运行他人脚本"的托管服务;需要时用户自建容器隔离,与本项目无关 |
| CI 跑示例脚本 | 半可信 | 仓库内固定脚本,标准 CI 隔离 |

方案 A 的进程隔离手段(编排脚本调用 CLI 时建议,进示例模板):`subprocess.run(timeout=…)`,可用 `resource.setrlimit`(CPU / 地址空间)与禁网环境(容器)加码;方案 B 同进程**无隔离**——这是把 B 定位为"作者本机工具"而非"执行分发代码的通道"的原因,与上表第 2 行的策略呼应。

## 6. API 草图(方案 B,阶段 1)

```python
import sandtable_sim as st   # 包名待核:PyPI 'sandtable' 已被占用(docs 17),发布前按该章纪律核查候选名

cfg = st.load("examples/pokemon.yaml")          # ← load_str / validate,报错消息与 CLI 同源
out = st.run(cfg, replicates=12)                # ← 复用 run_simulation_native 同层纯函数
days = out.days.to_pandas()                     # ← Arrow 零拷贝;days 即 days.csv 同一契约(docs 09)
sw = st.sweep("examples/pokemon-sweep.yaml", replicates=4)   # ← 计划/候选/判定,同 core::sweep
rec = st.recommend("examples/pokemon-sweep.yaml", sw.results)
```

- 绑定层是**第三份薄转发**(CLI / wasm / python 三形态同源 core 纯函数,口径见 [22 章](../zh/guide/22-web.md)绑定纪律):不放仿真逻辑,只做 load → validate → run / sweep / recommend 的转接与 Arrow 交接;
- **等价验收照抄 web_parity 模式**:`py_parity` 测试锁"同配置同 seed 下,Python 入口 results 与 CLI report.json 逐值一致"——三形态一个内核,一份测试范式三种载体。

## 7. 分期计划

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| 0(零开发)✅ **已落地** | 外挂模式规范(本文档 §5)+ `examples/python/`:三个示例脚本(`kpi_report.py` 消费 report.json 出 KPI 汇总表、`daily_curves.py` 消费 days.csv 出按天四联图、`parquet_analysis.py` 消费三个 Parquet 批次出分群画像)+ README 依赖与运行记录 | 已验收(2026-10-08):三脚本本地跑通出 1 表 + 2 图(python 3.14 / pandas 3.0.6 / pyarrow 25.0.1 / matplotlib 3.10.7);零 Rust 改动 |
| 1 | `sandtable-python` crate(pyo3 feature 门)+ maturin 构建 + load / run / sweep / recommend / params 只读绑定 | `maturin build` 出 wheel;pytest 冒烟;`py_parity` 逐值一致;wasm 门不回归;**✅ 已落地(2026-10-11)** |
| 2 | 编排 API:批量实验、A/B/扫描结果聚合、matplotlib 出图示例;`scripts/` 下官方模板 | 阶段 1 用例 ×N;CI 加 wheel 构建 job(可选发布);**✅ 已落地(2026-10-11,模板三件 + 验收跑通;CI wheel job 按拍板④延期)** |
| 3(**✅ 已落地 2026-10-11**;Pyodide 维持不承诺) | 批处理粒度的 Python System 回调(day-level chunk;GIL 侧依赖子解释器 [PEP 684](https://peps.python.org/pep-0684/) 与 free-threading [PEP 703](https://peps.python.org/pep-0703/) 的成熟度)、Pyodide Web 实验 | 先出性能实测报告再拍板,不预设结论。**第一批已落地(2026-10-11)**:[scripting-perf-report.md](scripting-perf-report.md)(基准 `crates/sandtable-python/examples/perf_chunk.rs`)——**日粒度 chunk GO**(逐玩家全量观测面每日一次,30 天挂满 ≈3% 基线;固定成本 attach+调用 ≈86 ns 可忽略),**事件级红线被数据反向证实**(10⁷ × 86 ns ≈ 0.86 s > 10k×30 基线 0.70 s,§4 维持不松);**第二批已落地(2026-10-11)**:core `run_with_day_hook`(`Option<&mut dyn DayHook>`,`run` 缺省 None 零行为变化,只读契约测试锁死)+ Python `run_with_day_hook` / `run_str_with_day_hook`(payload = {replicate, day, cohort_names, cohort, level, power, gold, churned} 逐玩家平行数组,回调异常整次报错;pytest 21 例含 payload 对账 `day_stats.gold_supply`)。rhai 缓议;Pyodide 维持 §3「前端独立实验,不承诺」不动 |

阶段 0 可与本设计文档同一批落地(纯示例);阶段 1 起动 Rust 侧,按"文档先行、每阶段独立提交、测试全绿再合"推进。

### 轮记录

- **2026-10-08 阶段 0 落地**(点火来源:巡检续批;依据:上表阶段 0 为纯示例、可随时开工,故拍板记录"直接开工,不等过目"):`examples/python/` 三示例 + README(依赖/运行/口径纪律,`sim-out/` 已 gitignore);验收列全过——三脚本消费 report.json / days.csv / Parquet 各自跑通,KPI 表与两张 PNG 本地产出。两点口径存档:①示例 CI95 用 ±1.96·SE 正态近似,权威 t 分布口径仍归 CLI(脚本头与 README 均注明);②本批零 Rust 改动,内核 / wasm / CI 门不涉及。
- **2026-10-11 阶段 1 拍板:设计通过,开工实施**(点火来源:巡检 11 轮,授权按原计划与台账自行拍板)。对照核查三项:①原计划 §6.1「配置描述数据,代码/脚本描述复杂行为」「复杂行为应该通过脚本/扩展机制完成」即本设计的合法性来源,§0 定位(编排 + 分析,不把 YAML 变成编程语言)与其一致;②台账一致性:阶段 0 已验收,本设计 2026-10-08 定稿后无搁置事由;③技术红线实证:pyo3 进独立 crate `sandtable-python`,core 依赖树零改动,CI wasm 门为 `-p sandtable-core` 包级不受影响;本机 Python 3.14.4 + 头文件 + `libpython3.14.so` 在位,pyo3 0.29.3 / maturin 1.15.0 现行稳定;CI `cargo test --workspace` 覆盖新 crate 需 python3-dev(已加)。**实施口径**:绑定照抄 wasm 双层结构(`*_native` 纯函数 + 薄封装)但独立实现、不链 sandtable-wasm(wasm-bindgen 不进 native crate);core 唯一真源,三份独立薄转发由 pairwise 等价测试锁死(web_parity: wasm↔CLI;py_parity: py↔CLI;desktop: desktop↔wasm);Python 侧无 Web 的 64 replicates / 200 预算门(原生形态,同 CLI)。**对 §6 草图的两点偏离**:①`out.days.to_pandas()`(Arrow 零拷贝)不进阶段 1,days 以 `days_csv` 字符串交付(与 CLI 逐字节同源,`pd.read_csv(io.StringIO(...))` 即得 DataFrame),Arrow C Data Interface 留阶段 2 编排 API 一并做;②sweep 为一次全量调用(plan + 顺序跑全部候选,同 CLI 语义;wasm 的 plan/candidate 分解是为让出浏览器主线程,Python 无此约束)。
- **2026-10-11 阶段 1 落地**(与拍板同日连续实施,三批提交):`crates/sandtable-python/`(pyo3 0.29.3,crate-type `cdylib` + `rlib`:前者供 maturin 出 wheel,后者供 `cargo test --workspace` 直跑)+ `pyproject.toml`(maturin,发行名 `sandtable-sim`,导入名 `sandtable_sim`)+ pytest 两文件(冒烟 13 例 + `py_parity` 3 例)。**验收列全过**:`maturin build --release` 出 wheel(CPython 3.14,manylinux_2_34);pytest 16/16 绿(含 simulate / sweep / recommend 与 CLI 产物逐值一致、`days_csv` 与 CLI `days.csv` 逐字节一致);`cargo test --workspace` 含新 crate 7 例全绿,wasm 门不回归;CI 门补 `python3-dev`。**落地口径存档**:replicates 门与 CLI 同义(≥ 1,0 即 ValueError);候选 `status` 两形态("ok" 字符串 / `{"config_error": ...}` 对象)在 Python 侧照实透传,调用方按 `isinstance(str)` 分派;报告 `meta` 含时间戳不参与确定性,py_parity 只比 `results` / `elasticities` / `recommendation`。
- **2026-10-11 阶段 2 拍板:设计通过,开工实施**(点火来源:巡检 11 轮同一续批令「连续推进直到全清」;基线:本文件 §7 分期计划 + §1 需求场景 2「一个脚本批量生成配置变体、循环跑 sweep、聚合多实验产出」)。**四项设计口径**:①编排在 Python 侧脚本完成、**零 Rust 改动**——绑定面(阶段 1 的 load / run / sweep / recommend / params)已覆盖编排所需,把编排函数做进绑定等于把编排语义搬进 Rust,违背 §6「绑定层是薄转发,不放编排逻辑」纪律;交付落点 `scripts/templates/`(§7 表内「官方模板」)。②A/B 走外挂(A)通道:绑定面无 compare,模板消费 CLI `compare --out` 的 comparison.json;§2 已拍板「B 落地后 A 仍是零依赖回退路径」,两通道叠加是设计内行为,Python 侧 A/B 编排成为高频需求时再拍板 compare 进绑定。③**Arrow 零拷贝延期(修订阶段 1 轮记录「留阶段 2 一并做」的暂记)**:绑定当前最大交接面是日聚合表(O(days) 行,30 天 ≈ 30 行,`io.StringIO` → DataFrame 开销 µs 级),C Data Interface 的收益对象是分群 / 战力快照级明细(Parquet 规模),该面 Python 侧暂无真实消费需求;按 docs 17「有真实需求再拆,不预设」延后,触发条件 = Python 侧出现大表分析或 Parquet 模板的交接瓶颈。④CI wheel 构建 job 延期(§7 表标注「可选发布」):无下游消费者(未发布 PyPI),平台矩阵成本先行;触发条件 = 发布决定(与 docs 17 命名再核同批)。
- **2026-10-11 阶段 2 落地**(与拍板同日,`2b277a5`):`scripts/templates/` 三模板(batch_sweep / ab_summary / sweep_curves)+ README(依赖 / 运行 / 口径纪律)。**验收跑通**:batch_sweep 走绑定通道,pokemon + gacha-pity ×4 replicates 出 KPI 汇总表(窗口不足指标如实记 "-",零方差退点估计);ab_summary 双 comparison.json 出配对差表 + PNG(攻击覆盖不触及抽卡指标 → diff 精确 0,CRN 语义自检通过);sweep_curves 消费 pokemon-sweep 产物(6 候选,churn_rate 约束带 [0, 0.2] 全 pass,含 `--plot` 约束带渲染)+ 双轴如实拒绝;表格模式与多轴拒绝均验证。两条纪律:绘图标签英文(不依赖 CJK 字形,任意机器出图一致,同阶段 0 示例);CI95 为 ±1.96·SE 正态近似、权威口径归 CLI(模板头与 README 注明)。§7 表「CI 加 wheel 构建 job」与 Arrow 零拷贝按拍板③④延期,触发条件已记录。
- **2026-10-11 阶段 3 拍板:开工并全批落地**(点火来源:巡检点火令,授权对挂闸项第一条自行拍板;范围沿阶段 0–2 同形态,rhai 缓议、Pyodide 维持 §3「前端独立实验,不承诺」不动)。**第一批(a1e1ac4)**:性能实测报告 [scripting-perf-report.md](scripting-perf-report.md)(基准 `crates/sandtable-python/examples/perf_chunk.rs`,方法论与数据见该报告)——日粒度 chunk GO,事件级红线被数据反向证实维持。**第二批(127da96 + d99a8a9)**:core `DayHook` 只读观测钩子(`run_with_day_hook`,`run` 缺省 None 零行为变化,只读契约黄金快照测试锁死)+ Python 绑定 `run_with_day_hook` / `run_str_with_day_hook`(payload = {replicate, day, cohort_names, cohort, level, power, gold, churned} 逐玩家平行数组;首次回调异常存 error 跳过后续、run 结束整次报错,不在 GIL 内 panic);验收:Rust lib 9 测试 + pytest 21 例(payload 逐日对账 `day_stats.gold_supply`、results 与 `run_str` 逐值一致、异常与 replicates=0 语义)。**边界存档**:事件级回调红线不因 GO 松动(§4);默认 5 列观测面 30 天 ≈20% 基线 = 原型/分析定位,生产热路径不适用(定型后下沉 Rust,§1 定位);numpy/Arrow 零拷贝留后续按需(报告「边界」节);钩子只读故与并行确定性零交互,GIL 竞争面不存在(单线程编排形态,同 CLI sweep 语义)。**pyo3 0.29 实施注记**:签名必选参数不可排在可选参数后(回调殿前 `(cfg, day_callback, replicates=1)`);py.eval 的 lambda 闭包只解析 globals 不吃 locals(测试注入列表须传 globals 位置)。
- **2026-10-11 巡检续批补位**(点火来源:巡检续批;基线:阶段 0–2 已落地,本批为已落地面的漂移修复与补齐,不新增分期、不改既有四项拍板口径):①`run` / `run_str` 的 `replicates` 加缺省值 1——CLI `simulate --replicates` 缺省 1 而 Python 侧此前必填,三形态调用面不一致;pytest 增默认值断言(冒烟 14 例,合计 17/17 绿)。②补 `crates/sandtable-python/README.md`(构建安装 / 快速上手 / API 表 / 错误语义 / 测试入口),根 README 双语的 Python 绑定条目加链接——此前 docs 17 与 examples/python README 均指向该处而文件不存在。③CI test job 增 `python3 -m py_compile scripts/templates/*.py` 语法门——三模板此前零 CI 覆盖;只做语法门,不建 wheel 不跑 pytest(拍板④维持,触发条件=发布决定)。④docs 17 core 布局树按实际单文件结构重写(树形漂成了不存在的子目录划分),依赖方向块与模块职责速查同步。

## 8. 来源与分级

| 级别 | 内容 | 来源 |
| --- | --- | --- |
| 本仓(口径) | 配置/代码分工、事件量级、三形态分工、命名纪律、绑定纪律 | docs 05 / 07 / 09 / 17 / 22 |
| 工具文档 | PyO3(扩展与 embed 指南)、maturin 构建 | [PyO3 user guide](https://pyo3.rs/)、[PyO3/maturin](https://github.com/PyO3/maturin) |
| 语言演进 | 子解释器 GIL、free-threading 成熟度 | [PEP 684](https://peps.python.org/pep-0684/)、[PEP 703](https://peps.python.org/pep-0703/) |
| 数据交接 | Arrow 零拷贝契约 | [Arrow C Data Interface](https://arrow.apache.org/docs/format/CDataInterface.html) |
| 事实核查 | PyPI `sandtable` 名称已被占用 | [项目结构](../zh/guide/17-project-structure.md)核查记录 |
| 决策 | Python 载体拍板、"扩展优于嵌入"取舍、不做事件级回调 | 2026-10-08 用户拍板 + 本文档推导 |
