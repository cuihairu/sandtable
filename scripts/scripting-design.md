# sandtable 脚本层设计(Python 载体)

状态:**阶段 0 已落地(2026-10-08),阶段 1 起未实施**(分期计划见文末;每期实施前按本文件为口径基线)。
拍板:**脚本语言定为 Python**(2026-10-08,理由:简单库多、仿真分析生态成熟——numpy / pandas / scipy / matplotlib 一线贯通)。本文档回答:嵌入形态怎么选、与 CLI / Web / WASM 三形态的边界、性能红线、脚本不被信任时怎么办。

## 0. 定位(承既有架构口径)

- [配置与公式引擎](../docs/guide/07-config-formula.md)的原则不变:**配置描述数据,代码描述复杂行为**。脚本不是把 YAML 变成编程语言,而是承载 YAML 表达不了的两类东西:**实验编排**(批量跑、自定义分析)与**复杂行为原型**(远期)。
- [时间模型](../docs/guide/05-time-model.md)的量级红线不变:单次仿真事件量 10⁷ 级,仿真热路径永远在 Rust;Python 出现在**实验粒度**(per-run / per-candidate),不出现在**事件粒度**。
- 三形态分工(文档 [09](../docs/guide/09-data-output.md)/[22](../docs/guide/22-web.md)):CLI 是主力实验形态;Web 定位小中型交互;桌面已立项并落地 Tauri 2 壳(2026-10,文档 18 Phase 7)。脚本层依附于 native 形态,Web 不做(见 §3)。

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

- 绑定层是**第三份薄转发**(CLI / wasm / python 三形态同源 core 纯函数,口径见 [22 章](../docs/guide/22-web.md)绑定纪律):不放仿真逻辑,只做 load → validate → run / sweep / recommend 的转接与 Arrow 交接;
- **等价验收照抄 web_parity 模式**:`py_parity` 测试锁"同配置同 seed 下,Python 入口 results 与 CLI report.json 逐值一致"——三形态一个内核,一份测试范式三种载体。

## 7. 分期计划

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| 0(零开发)✅ **已落地** | 外挂模式规范(本文档 §5)+ `examples/python/`:三个示例脚本(`kpi_report.py` 消费 report.json 出 KPI 汇总表、`daily_curves.py` 消费 days.csv 出按天四联图、`parquet_analysis.py` 消费三个 Parquet 批次出分群画像)+ README 依赖与运行记录 | 已验收(2026-10-08):三脚本本地跑通出 1 表 + 2 图(python 3.14 / pandas 3.0.6 / pyarrow 25.0.1 / matplotlib 3.10.7);零 Rust 改动 |
| 1 | `sandtable-python` crate(pyo3 feature 门)+ maturin 构建 + load / run / sweep / recommend / params 只读绑定 | `maturin build` 出 wheel;pytest 冒烟;`py_parity` 逐值一致;wasm 门不回归 |
| 2 | 编排 API:批量实验、A/B/扫描结果聚合、matplotlib 出图示例;`scripts/` 下官方模板 | 阶段 1 用例 ×N;CI 加 wheel 构建 job(可选发布) |
| 3(远期,需再拍板) | 批处理粒度的 Python System 回调(day-level chunk;GIL 侧依赖子解释器 [PEP 684](https://peps.python.org/pep-0684/) 与 free-threading [PEP 703](https://peps.python.org/pep-0703/) 的成熟度)、Pyodide Web 实验 | 先出性能实测报告再拍板,不预设结论 |

阶段 0 可与本设计文档同一批落地(纯示例);阶段 1 起动 Rust 侧,按"文档先行、每阶段独立提交、测试全绿再合"推进。

### 轮记录

- **2026-10-08 阶段 0 落地**(点火来源:巡检续批;依据:上表阶段 0 为纯示例、可随时开工,故拍板记录"直接开工,不等过目"):`examples/python/` 三示例 + README(依赖/运行/口径纪律,`sim-out/` 已 gitignore);验收列全过——三脚本消费 report.json / days.csv / Parquet 各自跑通,KPI 表与两张 PNG 本地产出。两点口径存档:①示例 CI95 用 ±1.96·SE 正态近似,权威 t 分布口径仍归 CLI(脚本头与 README 均注明);②本批零 Rust 改动,内核 / wasm / CI 门不涉及。
- **阶段 1 起(动 Rust 侧)继续冻结**,待设计过目后按上表验收逐期推进。

## 8. 来源与分级

| 级别 | 内容 | 来源 |
| --- | --- | --- |
| 本仓(口径) | 配置/代码分工、事件量级、三形态分工、命名纪律、绑定纪律 | docs 05 / 07 / 09 / 17 / 22 |
| 工具文档 | PyO3(扩展与 embed 指南)、maturin 构建 | [PyO3 user guide](https://pyo3.rs/)、[PyO3/maturin](https://github.com/PyO3/maturin) |
| 语言演进 | 子解释器 GIL、free-threading 成熟度 | [PEP 684](https://peps.python.org/pep-0684/)、[PEP 703](https://peps.python.org/pep-0703/) |
| 数据交接 | Arrow 零拷贝契约 | [Arrow C Data Interface](https://arrow.apache.org/docs/format/CDataInterface.html) |
| 事实核查 | PyPI `sandtable` 名称已被占用 | [项目结构](../docs/guide/17-project-structure.md)核查记录 |
| 决策 | Python 载体拍板、"扩展优于嵌入"取舍、不做事件级回调 | 2026-10-08 用户拍板 + 本文档推导 |
