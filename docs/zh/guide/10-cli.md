---
title: 10 · CLI
---

[English](/guide/10-cli) | [中文](/zh/guide/10-cli)

# CLI

第一阶段 CLI 是第一优先级 UI。

## 子命令

| 命令 | 作用 | 阶段 |
| --- | --- | --- |
| `sandtable simulate` | 运行一次仿真 | **MVP** |
| `sandtable compare` | 比较两个 / 多个运行结果 | **MVP** |
| `sandtable validate` | 校验配置(注册表、schema、公式) | **MVP** |
| `sandtable init` | 生成示例配置骨架 | MVP 顺带 |
| `sandtable sweep` | 参数扫描实验 | Phase 3 |
| `sandtable query` | SQL 事后探索结果数据集(DuckDB) | Phase 3 |
| `sandtable recommend` | 从扫描产物生成敏感性矩阵与推荐区间 | Phase 4 |
| `sandtable params` | 数值参数表导出 / 导入(扁平 CSV) | Phase 5 |
| `sandtable report` | 生成 HTML 报告 | Phase 5 |
| `sandtable project` | 项目打包 pack / unpack / check(`.sandtable`) | 2026-10 |
| `sandtable workbook` | 结果产物 → 多工作表 `.xlsx`(只读交付) | Excel 工作流 |
| `sandtable optimize` | 自动寻优实验(进化 / Pareto 多目标) | Phase 8 |
| `sandtable surrogate` | 随机森林代理模型 train / predict / importance | Phase 8 |
| `sandtable disttest` | 分布检验(均匀 / 加权 / 正态 χ²,测试台不进仿真路径) | 随机函数(24 章) |

寻优与代理的口径见[参数扫描](./12-parameter-sweep)自动寻优节与[平衡推荐](./15-recommendation)代理节;分布检验的能力清单、分期与验收见[随机函数与概率系统](./24-random-functions)。

## 用法

```bash
sandtable simulate scenario.yaml
sandtable sweep experiment.yaml
sandtable compare --attack-a 100 --attack-b 105 --replicates 12
sandtable query sweep/summary.csv --sql "SELECT * FROM summary WHERE t1_win_rate = 'PASS'"
sandtable recommend experiment.yaml sweep-out/
sandtable params export scenario.yaml --out params.csv
sandtable project pack myproj --out myproj.sandtable
sandtable workbook experiment-out/ --out workflow.xlsx
sandtable report experiment/
sandtable optimize opt-exp.yaml --out opt-out/
sandtable surrogate train sweep-out/ --metric retention_d7
sandtable disttest normal --samples 100000 --buckets 20
```

### query(Phase 3,feature `duckdb`)

`sandtable query` 是[分析层](./09-data-output)的壳:对已落盘的结果数据集(CSV / Parquet)跑 SQL,仿真路径完全不经过数据库。输入文件按文件名词根注册为同名的 DuckDB 视图,SQL 直接引用:

```bash
# CSV:扫描汇总表的失败候选
sandtable query sweep-out/summary.csv \
  --sql "SELECT candidate, error FROM summary WHERE status = 'config_error'"

# Parquet:第 7 天分位战力(feature parquet 产出的数据集)
sandtable query out/day_stats.parquet \
  --sql "SELECT day, win_rate, sink_ratio FROM day_stats WHERE day <= 7 ORDER BY day"
```

- 多个输入文件可同时注册,视图名 = 文件名词根(如 `summary.csv` → `summary`);
- 结果默认表格输出到 stdout;`--out result.csv` 时以 CSV 落盘;
- DuckDB 以 feature `duckdb` 提供(bundled 静态构建),默认构建不含——分析依赖重,不背在最小构建上。

### recommend(Phase 4)

`sandtable recommend` 读 `sweep` 的产物(sweep.json)与实验文件(基线配置),重算 [OAT 弹性](./14-sensitivity)并给出[单轴推荐区间](./15-recommendation)——扫描数据复用,零额外仿真:

```bash
sandtable recommend experiment.yaml sweep-out/            # 目录或 sweep.json 路径均可
sandtable recommend experiment.yaml sweep-out/ --out rec.json
```

- MVP 只支持**单参数轴**(文档 15 章红线):sweep 定义了多个参数时报错,退出码 2;
- stdout 先打敏感性矩阵(参数 × 指标的弹性 E 与区间;区间跨零标"不显著",不可算如实标原因),再打推荐块(Current / Recommended / Reason / Confidence,形态见文档 15 章);
- 推荐区间端点由格点线性插值所得时在理由中标注(文档 15 章:连续区间不可能直接从格点读出);
- Confidence 是判据不是形容词:High / Medium / Low,判据见文档 15 章;
- `--out rec.json` 把敏感性矩阵与推荐一并落盘,供报告层(Phase 5)复用;
- sweep.json 的 spec 与 results 原样反序列化,指标名按 snake_case(如 `win_rate`)。

### params(Phase 5)

数值参数表与 YAML 之间的双向扁平 CSV 通道(评估结论见[数据输出](./09-data-output)):策划在 Excel 里维护数值,另存 CSV 回导:

```bash
# 全量数值参数导出为(path,value)模板
sandtable params export scenario.yaml --out params.csv

# 改值后回导:逐行覆写基线配置并校验,错误逐行报(退出码 2);
# 基线场景是可选的第二个位置参数
sandtable params import params.csv base.yaml --out merged.yaml
sandtable simulate merged.yaml
```

- 表格式:`path,value` 表头,每行一个数值参数;空行与 `#` 开头的行跳过;
- 覆盖范围 = 注册表全部数值参数(整数 / 浮点 / 分群权重);公式槽与时长(`30d`)不经参数表,需要自定义时直接编辑 YAML;
- 导入以可选的第二个位置参数为基线场景(缺省默认配置),未知路径给编辑距离建议,数值非法 / 越界 / 路径重复逐行标注,不静默跳过;
- 成功后打印 `config_hash`;`--out merged.yaml` 产出可直接跑仿真的场景文件(含 scenario 节的 population / duration / seed / population_mix 与 model 节全量数值参数)。

### project(项目打包)

把场景 / 实验定义(可选产物)打包为单个 `.sandtable` 归档,在 CLI / Web / Desktop 之间交换;manifest v1 契约与校验规则见[项目打包](./09-data-output):

```bash
sandtable project pack myproj --out myproj.sandtable    # 目录 → 归档
sandtable project unpack myproj.sandtable --out restored # 校验后展开(目标目录须为空)
sandtable project check myproj.sandtable                 # 只校验不落盘
```

- 导入即全量校验:manifest 结构、路径纪律、逐条 sha256、归档文件集合与清单严格相等、scenario / experiment 逐个加载校验,坏条目逐条报完再失败(退出码 2);
- 打包确定性:同目录两次打包字节一致(条目按路径排序、时间戳固定);
- Project 不新增仿真语义——展开出的就是普通配置文件,`simulate` / `sweep` 直接可跑。

### report(Phase 5)

把结果目录(可多个)渲染成单文件 HTML 报告——KPI、A/B 对比、扫描汇总与图表、敏感性与推荐,[数据输出](./09-data-output)的源文件对照表在彼:

```bash
sandtable report sim-out/ sweep-out/ rec.json --out report.html
sandtable report experiment/                 # 缺省写 ./report.html
```

- 只读已落盘产物(`report.json` / `comparison.json` / `sweep.json` / `rec.json` / `days.csv`),发现什么渲染什么;
- 输出自包含:内联 CSS + 内联 SVG,无 CDN、无 JS,离线可开;
- 一个源文件都找不到 → 退出码 2。

### workbook(Excel / JMP / Origin 交付)

读结果目录中已落盘的产物,已知产物一表一张,外加 `manifest`(自描述)与 `metric_dictionary`(内核 `kpi_dict`)——[数据输出](./09-data-output)契约的**交付侧**:

```bash
sandtable workbook experiment-out/                    # 写 experiment-out/sandbox.xlsx
sandtable workbook experiment-out/ --out workflow.xlsx
```

- 已知产物:`params.csv` / `candidates.csv` / `summary.csv` / `comparison.json` / `days.csv`,启用 `parquet` feature 时另有 `cohort.parquet`;缺席者在 manifest 里记 `absent` 行,**不出表**(缺席 ≠ 空表);
- 表契约:一表一张、单行表头在第 1 行、无合并单元格、无尾随空行;数值字段进真数值单元格(透视无「文本型数字」告警);
- 字段映射复用:列名与列序直接取自产物——工作簿不重算任何数值、不改列名;`metric_dictionary` 与 CSV、`sweep.json` 约束名共用内核 `kpi_dict` 列名;
- 确定性:归档时间戳固定(1980-01-01),同输入 → 字节一致;
- 目录里没有任何已知产物或不是目录 → 退出码 2;
- 它是**只读交付**——配置通路仍是双向 CSV 入口(`params export / import`),不做多表 → 配置树映射。

零依赖读回端:`scripts/templates/workbook_sheets.py`(`list` / `dump <表>` / `check`),纯标准库。

## 输出约定

- **stdout**:人读摘要(运行耗时、关键指标、约束 PASS / FAIL),面向终端;
- **文件**:完整结果按[输出目录约定](./09-data-output)落盘,stdout 不承载完整数据;
- **退出码**:`0` 成功;`1` 仿真或实验失败;`2` 配置 / 参数错误(用于 CI 区分);

## 确定性要求

`compare` 的输出对相同输入必须稳定:排序确定性(候选按实验标识排序,不按目录遍历序)、浮点格式固定(避免科学计数法抖动)。同 seed 重跑 `simulate`,除 `meta.json` 中环境字段外,输出内容一致([数据输出](./09-data-output))。

## 错误信息风格

配置错误必须指出**具体路径与原因**(如 `warrior.atk: 未知参数,你是否想写 warrior.attack?注册表中相近路径: warrior.attack`),错误信息面向配置作者,不面向内核开发者。
