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
| `sandtable report` | 生成 HTML 报告 | Phase 5 |

## 用法

```bash
sandtable simulate scenario.yaml
sandtable sweep experiment.yaml
sandtable compare result-a result-b
sandtable query sweep/summary.csv --sql "SELECT * FROM summary WHERE t1_win_rate = 'PASS'"
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

## 输出约定

- **stdout**:人读摘要(运行耗时、关键指标、约束 PASS / FAIL),面向终端;
- **文件**:完整结果按[输出目录约定](./09-data-output)落盘,stdout 不承载完整数据;
- **退出码**:`0` 成功;`1` 仿真或实验失败;`2` 配置 / 参数错误(用于 CI 区分);

## 确定性要求

`compare` 的输出对相同输入必须稳定:排序确定性(候选按实验标识排序,不按目录遍历序)、浮点格式固定(避免科学计数法抖动)。同 seed 重跑 `simulate`,除 `meta.json` 中环境字段外,输出内容一致([数据输出](./09-data-output))。

## 错误信息风格

配置错误必须指出**具体路径与原因**(如 `warrior.atk: 未知参数,你是否想写 warrior.attack?注册表中相近路径: warrior.attack`),错误信息面向配置作者,不面向内核开发者。
