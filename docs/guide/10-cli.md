---
title: 10 · CLI
---

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
| `sandtable report` | 生成 HTML 报告 | Phase 5 |

## 用法

```bash
sandtable simulate scenario.yaml
sandtable sweep experiment.yaml
sandtable compare result-a result-b
sandtable query sweep/summary.csv --sql "SELECT * FROM summary WHERE t1_win_rate = 'PASS'"
sandtable recommend experiment.yaml sweep-out/
sandtable report experiment/
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

## 输出约定

- **stdout**:人读摘要(运行耗时、关键指标、约束 PASS / FAIL),面向终端;
- **文件**:完整结果按[输出目录约定](./09-data-output)落盘,stdout 不承载完整数据;
- **退出码**:`0` 成功;`1` 仿真或实验失败;`2` 配置 / 参数错误(用于 CI 区分);

## 确定性要求

`compare` 的输出对相同输入必须稳定:排序确定性(候选按实验标识排序,不按目录遍历序)、浮点格式固定(避免科学计数法抖动)。同 seed 重跑 `simulate`,除 `meta.json` 中环境字段外,输出内容一致([数据输出](./09-data-output))。

## 错误信息风格

配置错误必须指出**具体路径与原因**(如 `warrior.atk: 未知参数,你是否想写 warrior.attack?注册表中相近路径: warrior.attack`),错误信息面向配置作者,不面向内核开发者。
