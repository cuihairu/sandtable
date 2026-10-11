# 脚本层阶段 3 第一批:批处理粒度回调性能实测报告

日期:2026-10-11 · 门槛:设计稿 [scripting-design.md](scripting-design.md) §7 阶段 3
验收「先出性能实测报告再拍板,不预设结论」· 基准:`crates/sandtable-python/examples/perf_chunk.rs`

复跑命令(仓库根,release 必须):

```bash
cargo run -p sandtable-python --release --example perf_chunk
```

## 方法论与口径

- 全部走**真实通道**:基线是真实 `core::sim::run`,跨界是真实 pyo3 attach/调用,交接是真实
  `Vec<f64> → Python list` + `builtins.sum` 真实遍历(不测「创建后即弃」的假通道);
- 每项取多轮 **min**(最快情形);数字随机器变化,**结论按数量级读**,不跨机器承诺绝对值;
- **共享开发机警告**:本机是多人共享开发机(load 可被其他 workspace 的构建打到 40+),
  同日三轮复跑的基线波动 3.4 倍(下文如实标注)。**跨轮稳定的量是结论依据**:固定成本
  ns 级三轮一致;交接线性标度三轮一致。主表取最安静一轮(run 1,其 10k×30 ≈ 0.70 s 与
  文档「~0.5 s」口径同数量级,自洽)。

## 实测数据(run 1,2026-10-11)

### 基线吞吐(纯 Rust,不经 Python)

| players | days | repeats | per-run ms |
| --- | --- | --- | --- |
| 200 | 10 | 20 | 3.9 |
| 1 000 | 30 | 5 | 71.5 |
| 10 000 | 30 | 2 | 701.9 |

### 跨界固定成本(回调每天的固定部分)

| primitive | iters | per-op ns |
| --- | --- | --- |
| attach(empty) | 200 000 | 4 |
| noop call0 | 50 000 | 82 |

三轮复跑 attach 均 ≈4 ns(跨轮稳定);call0 82–145 ns(仍 ns 级)。「一天一次无参回调」
固定成本 ≈ attach + 调用,30 天挂满 = µs 级,对任何规模 **0.00%**(推导表)。

### 批量交接(每日一次,n = 玩家数的单列观测向量)

| n (players) | iters | create list ns | create + sum ns | numpy asarray ns |
| --- | --- | --- | --- | --- |
| 1 000 | 2 000 | 64 946 | 69 017 | 163 160 |
| 10 000 | 500 | 582 308 | 753 078 | 1 776 867 |

线性标度:创建 ≈ 58–65 ns/元素;`sum` 真实遍历增量小。`asarray` 反而更慢
(list→ndarray 二次转换);numpy 原生通道要快须走 buffer/Arrow 零拷贝——那是设计稿 §4
已定向的交接路线,不在本报告范围。

### 多列载荷(钩子默认观测面:cohort/level/power/gold/churned 5 列)

| players | cols | create + sum per day | 30 天占比(run 1 基线) |
| --- | --- | --- | --- |
| 1 000 | 5 | ≈0.5–0.6 ms | **≈ 21–24%** |
| 10 000 | 5 | ≈4–5 ms | **≈ 21%** |

(5 列不是单列 ×5:多一次循环、多 4 次 sum、分配器压力,实测 ≈7.4×;占比按 run 1 基线
折算,受共享机噪声影响给区间。)

### 推导:日粒度 chunk 挂满 30 天的开销占比(单列)

| players | days | baseline ms | noop-only % | exchange + consume % |
| --- | --- | --- | --- | --- |
| 1 000 | 30 | 71.5 | 0.00% | **2.90%** |
| 10 000 | 30 | 701.9 | 0.00% | **3.22%** |

## 结论(按数据,不预设)

1. **日粒度批量 chunk 回调:可行(GO)**——固定成本 ns 级完全可忽略;单列观测面每日一次
   30 天挂满 ≈3% 基线;**默认 5 列全观测面 ≈20% 基线**——原型与分析场景明确可用,
   生产热路径不适合(那也不是它的定位:设计稿 §1 定位「行为逻辑原型,定型后下沉 Rust」)。
   2. **事件级红线被数据反向证实**:10k×30 ≈ 10⁷ 事件,10⁷ × 86 ns ≈ 0.86 s **超过基线
   0.70 s 本身**——还没算逐事件数据交接。设计稿 §4「禁止事件级回调」维持,不因本次
   GO 松动。
3. **接线形态(第二批)**:读态日钩子(read-only observation hook)先行——core 挂
   `Option<&mut dyn DayHook>`(`run` 缺省 None,零行为变化,黄金快照与 py/web/桌面
   三角等价不动),Python 绑定实现钩子按日回调 Python callable,批量交接按本报告的
   list 通道(默认 5 列,成本见上表);numpy/Arrow 零拷贝留后续按需。

## 边界

- 单线程语义:钩子在仿真线程内 `Python::attach`,不涉 GIL 竞争;PEP 684/703(子解释器
  与 free-threading)是并行扩展路线,当前 rayon 候选并行下 Python 钩子**只在串行编排
  形态可用**(同 CLI `sweep` 语义),与设计稿「Python 出现在实验粒度」的定位一致;
- Pyodide Web 实验维持「前端独立实验,不承诺」(设计稿 §3),不在阶段 3 范围;
- rhai 维持缓议。
