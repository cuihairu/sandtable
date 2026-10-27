# 官方编排模板(脚本层阶段 2 + 数据分析面校准)

消费阶段 1 绑定(`sandtable_sim`)与 CLI 产物的编排模板(Python 与 MATLAB 两大类;编排类 + 校准对账类)。设计口径见
[scripting-design.md](../scripting-design.md) §7 阶段 2 拍板记录(2026-10-11):
纯 Python、零 Rust 改动;绑定承载同进程编排(run / sweep / recommend),
A/B 与既有产物分析走外挂通道(读 comparison.json / sweep.json)。

| 模板 | 通道 | 输入 | 产出 |
| --- | --- | --- | --- |
| [batch_sweep.py](batch_sweep.py) | 绑定(B) | 场景 YAML ×N | 全场景 KPI 汇总表(CSV) |
| [ab_summary.py](ab_summary.py) | 外挂(A) | comparison.json ×N(`sandtable compare` 产物) | 配对差汇总表 + 可选 PNG |
| [sweep_curves.py](sweep_curves.py) | 外挂(A) | sweep.json(`sandtable sweep` 产物) | 指标-参数曲线表 + 可选 PNG(约束带) |
| [daily_analysis.m](daily_analysis.m) | 外挂(A) | 产物目录(days.csv + report.json,compare 目录另读 comparison.json) | KPI 摘要 + A/B 判定打印 + 逐日曲线图窗(base MATLAB) |
| [calibrate_win_rate.py](calibrate_win_rate.py) | 外挂(A) | 仿真产物(report.json + days.csv)+ 观测(cohort_day.csv + meta.yaml) | 留存/胜率锚点残差表 + 可选校验散点 PNG |
| [calibrate_economy.py](calibrate_economy.py) | 外挂(A) | 仿真产物(days.csv + report.json)+ 观测(economy_day.csv + 可选 meta.yaml) | 经济逐日/全程人均锚点残差表 + 可选曲线 PNG |

## 依赖与运行

python3 + `sandtable_sim`(阶段 1 wheel:见 `crates/sandtable-python/`)+
matplotlib(仅 `--plot` 出图需要;纯表格运行不需要)。

```bash
cd crates/sandtable-python && maturin build --release
pip install ../../target/wheels/sandtable_sim-*.whl   # wheel 落在仓库根 target/wheels/

python3 scripts/templates/batch_sweep.py examples/pokemon.yaml examples/gacha-pity.yaml --replicates 4
python3 scripts/templates/sweep_curves.py sweep-out/sweep.json --metric win_rate --plot curves.png
```

## 口径与纪律

- 模板内 CI95 为 ±1.96·SE 正态近似(分析速览);权威口径(t 分布、配对差、
  CI 判定)在 CLI `compare` / `sweep` / `recommend`(同阶段 0 纪律);
- 模板是**起步样板**而非库:按需改写,不追求参数面齐全;
- `ab_summary.py` 表格尾带**模型边界注记**(CI 与判定仅在仿真模型内有效,口径同 `sandtable report` 页首,2026-10-11 拍板);PNG 不带该注记——图内标签维持英文、不依赖 CJK 字形的纪律不变;
- `daily_analysis.m` 只依赖 **base MATLAB**(readtable / jsondecode / plot),不需要任何 Toolbox,也不需要 MATLAB Engine——核心仿真与默认图表不依赖商业授权;MATLAB Engine 评估(从 MATLAB 调内核、任务状态 / 日志 / 输出目录 / 结果回收)仍挂在有真实本机调用需求之后,见 docs/guide/09;图内标签与终端输出维持英文(CJK 字形不依赖,同 PNG 纪律);
- `batch_sweep.py` 记录**脚本与依赖版本**:启动时向 stderr 打一行 `batch_sweep.py <脚本版本> · sandtable_sim <wheel 版本> · python <解释器版本>`(不进 CSV 表体,表体保持单行表头);**失败不影响核心仿真**:单个场景解析或运行失败记入该行 `error` 列并继续其余场景,核心(同进程 pyo3 纯函数)不受影响,末尾汇总 `失败 n/m`,任一失败退出码 1(消费方按 `error` 列过滤可用行);
- 脚本不被信任时的执行策略(永不自动执行、显式执行前审查)见设计文档 §5;
- **校准模板**(calibrate_*,2026-10-27,todo「数据分析面」step ③):观测侧契约与锚点定义见 [calibration-design.md](../../docs/calibration-design.md) §2/§3——观测 CSV 列名固定,验收带 `|sim − obs| / obs ≤ 10%`,retention 锚点另加绝对地板 `obs ≥ 0.9`;**锚点缺观测来源时如实标 `unmapped`,不用公开案例替代**(替代红线);锚点全 PASS 退出码 0,任一 FAIL 退出码 1(CI 可作门)。**模板只验证过机制**:本机自测用仿真产物合成观测侧(自洽,残差 0.00%,`retention_d30=0.89` 因触 0.9 地板如实 FAIL);真实数据到位后以 MCP `sandtable_calibrate`(step ①,挂闸真实数据)的 loader 为权威;`sink_ratio` 在 economy_day.csv 契约无回收列,如实 unmapped 不虚构;对轴口径:仿真 day(1 起)= 观测 cohort_day + `--day-offset`(同轴传 0),economy 观测按日期排序首个日期 = day 1。
