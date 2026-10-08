#!/usr/bin/env python3
"""KPI 汇总表:sandtable report.json → pandas。

脚本层阶段 0 示例(外挂模式,见 scripts/scripting-design.md §2 方案 A):
只消费 CLI 产物,不改内核。

输入产出(仓库根目录执行):
    cargo run -p sandtable-cli -- simulate examples/pokemon.yaml \
        --replicates 3 --out examples/python/sim-out

运行:
    python3 examples/python/kpi_report.py [report.json 路径]

CI 口径说明:此处 mean ± 1.96·SE 是正态近似,用于分析速览;
权威 CI95(CI 真覆盖,t 分布)以 `sandtable report` / report 子命令为准。
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pandas as pd

# 进 report.json results[] 的标量 KPI(嵌套的 day_stats / cohort_stats /
# power_snapshots 归 parquet 示例,这里只取逐 replicate 的汇总值)
KPI_COLUMNS = [
    "win_rate",
    "retention_d1",
    "retention_d3",
    "retention_d7",
    "retention_d14",
    "retention_d30",
    "churn_rate_total",
    "gold_earned_total",
    "gold_spent_total",
    "sink_ratio_mean",
    "whale_gold_share",
    "inflation_daily_mean",
    "inflation_last",
]

NAMES = {
    "win_rate": "胜率",
    "retention_d1": "次日留存",
    "retention_d3": "3 日留存",
    "retention_d7": "7 日留存",
    "retention_d14": "14 日留存",
    "retention_d30": "30 日留存",
    "churn_rate_total": "总流失率",
    "gold_earned_total": "总产出金币",
    "gold_spent_total": "总消耗金币",
    "sink_ratio_mean": "消耗占比均值",
    "whale_gold_share": "大 R 金币份额",
    "inflation_daily_mean": "通胀日均值",
    "inflation_last": "通胀末期",
}


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "examples/python/sim-out/report.json")
    if not path.exists():
        print(f"找不到 {path};先用 simulate --out 产出(见文件头注释)", file=sys.stderr)
        return 2

    report = json.loads(path.read_text(encoding="utf-8"))
    results = report["results"]
    print(f"meta: {report['meta']}  replicates: {len(results)}\n")

    rows = [{k: r[k] for k in KPI_COLUMNS} for r in results]
    df = pd.DataFrame(rows)

    n = len(df)
    summary = pd.DataFrame(
        {
            "指标": [NAMES[k] for k in df.columns],
            "mean": df.mean().round(6).values,
            "std": df.std(ddof=1).round(6).values,
            # 正态近似 CI95(权威 t 分布口径见文件头说明)
            "ci95_lo": (df.mean() - 1.96 * df.std(ddof=1) / math.sqrt(n)).round(6).values,
            "ci95_hi": (df.mean() + 1.96 * df.std(ddof=1) / math.sqrt(n)).round(6).values,
        }
    )
    print(summary.to_string(index=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
