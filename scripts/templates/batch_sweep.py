#!/usr/bin/env python3
"""批量实验编排:多场景 YAML × replicates → KPI 汇总表。

走绑定通道(同进程调 sandtable_sim.run),是设计文档 §1 需求场景 2
「批量生成配置变体、循环跑、聚合多实验产出」的起步样板。

用法:
    python3 batch_sweep.py [--replicates 4] [--out out.csv] SCENARIO.yaml ...

口径:表内 CI95 为 ±1.96·SE 正态近似;权威口径在 CLI compare / sweep / recommend。
"""

from __future__ import annotations

import argparse
import csv
import importlib.metadata
import math
import platform
import sys
from pathlib import Path

try:
    import sandtable_sim as st
except ImportError:
    sys.exit(
        "缺 sandtable_sim:先构建并安装阶段 1 wheel(见 scripts/templates/README.md)"
    )

# 脚本自身版本(Python 自动化条目「记录脚本/依赖版本」)。
SCRIPT_VERSION = "1.0"


def version_line() -> str:
    """脚本 + 依赖 + 解释器版本一行(输出到 stderr,不进 CSV 表体)。"""
    try:
        wheel = importlib.metadata.version("sandtable-sim")
    except importlib.metadata.PackageNotFoundError:
        wheel = "unknown"
    return (
        f"batch_sweep.py {SCRIPT_VERSION}  "
        f"sandtable_sim {wheel}  python {platform.python_version()}"
    )

# RunMetrics 标量字段(docs 09 数据契约);gold_per_player 为派生列
KPI_FIELDS = [
    "retention_d3",
    "retention_d7",
    "win_rate",
    "churn_rate_total",
    "whale_gold_share",
    "inflation_daily_mean",
    "sink_ratio_mean",
]


def mean_ci(values: list[float]) -> tuple[float, float] | None:
    """均值与 ±1.96·SE;n=1 时 CI 退化为点估计(同 core summarize 语义)。

    空序列返回 None——窗口不足(如 3 天场景的 retention_d7)时指标不可得。
    """
    n = len(values)
    if n == 0:
        return None
    mean = sum(values) / n
    if n < 2:
        return mean, mean
    var = sum((v - mean) ** 2 for v in values) / (n - 1)
    return mean, 1.96 * math.sqrt(var / n)


def fmt(mean_ci_value: tuple[float, float] | None) -> str:
    """'mean±half';不可得记 '-'(不留空,表格列宽可读)。"""
    if mean_ci_value is None:
        return "-"
    m, h = mean_ci_value
    return f"{m:.4f}±{h:.4f}" if h else f"{m:.4f}"


def main() -> int:
    ap = argparse.ArgumentParser(
        description="批量实验编排 → KPI 汇总表(阶段 2 官方模板)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("scenarios", nargs="+", help="场景 YAML 文件(≥1)")
    ap.add_argument(
        "--replicates", type=int, default=4, help="每场景 replicate 数(默认 4)"
    )
    ap.add_argument("--out", help="CSV 输出路径(缺省打印到 stdout)")
    args = ap.parse_args()
    if args.replicates < 1:
        ap.error("--replicates 至少为 1")

    print(version_line(), file=sys.stderr)
    rows: list[dict[str, str]] = []
    failures = 0
    for name in args.scenarios:
        row: dict[str, str] = {
            "scenario": name,
            "replicates": str(args.replicates),
            "config_hash": "",
            "error": "",
        }
        try:
            out = st.run(st.load(str(name)), args.replicates)
        except Exception as exc:  # noqa: BLE001 - 一个场景失败不影响其余场景与核心
            failures += 1
            row["error"] = f"{type(exc).__name__}: {exc}"
            print(f"警告: {name} 失败({row['error']}),跳过", file=sys.stderr)
            rows.append(row)
            continue
        per_kpi = {f: [] for f in KPI_FIELDS}
        gold_per_player: list[float] = []
        for r in out["results"]:
            for f in KPI_FIELDS:
                if r[f] is not None:
                    per_kpi[f].append(float(r[f]))
            gold_per_player.append(r["gold_earned_total"] / r["players"])

        row["config_hash"] = out["config_hash"][:12]
        for f in KPI_FIELDS:
            row[f] = fmt(mean_ci(per_kpi[f]))
        gpp = mean_ci(gold_per_player)
        row["gold_per_player"] = f"{gpp[0]:.2f}" if gpp else "-"
        rows.append(row)

    cols = ["scenario", "replicates", "config_hash", *KPI_FIELDS, "gold_per_player", "error"]
    if args.out:
        with open(args.out, "w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=cols)
            writer.writeheader()
            writer.writerows(rows)
        print(
            f"已写出 {args.out}({len(rows)} 场景 × {args.replicates} replicates)",
            file=sys.stderr,
        )
    else:
        writer = csv.DictWriter(sys.stdout, fieldnames=cols)
        writer.writeheader()
        writer.writerows(rows)
    if failures:
        print(f"失败 {failures}/{len(args.scenarios)} 场景(其余照常)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
