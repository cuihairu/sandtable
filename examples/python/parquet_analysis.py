#!/usr/bin/env python3
"""Parquet 数据集:sandtable --parquet 产物 → pyarrow → pandas。

脚本层阶段 0 示例(外挂模式,见 scripts/scripting-design.md §2 方案 A)。
`simulate --parquet` 落三个批次(day_stats / power_snapshots / cohort,docs 09 章
Arrow 契约);pyarrow 读入零转换,pandas 直接分析。需以 --features parquet 构建 CLI。

输入产出(仓库根目录执行):
    cargo run -p sandtable-cli --features parquet -- simulate examples/pokemon.yaml \
        --replicates 3 --parquet --out examples/python/sim-out

运行(图落在数据目录):
    python3 examples/python/parquet_analysis.py [sim-out 目录]
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
import pyarrow.parquet as pq


def main() -> int:
    data_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "examples/python/sim-out")
    paths = {n: data_dir / f"{n}.parquet" for n in ("day_stats", "power_snapshots", "cohort")}
    missing = [str(p) for p in paths.values() if not p.exists()]
    if missing:
        print(f"缺 {'、'.join(missing)};先用 simulate --parquet --out 产出(见文件头注释)", file=sys.stderr)
        return 2

    day_stats = pq.read_table(paths["day_stats"]).to_pandas()
    print(f"day_stats:{len(day_stats)} 行 × {len(day_stats.columns)} 列")
    cols = [c for c in ("day", "win_rate", "sink_ratio", "active") if c in day_stats.columns]
    print(day_stats[cols].head(7).to_string(index=False), "\n")

    cohort = pq.read_table(paths["cohort"]).to_pandas()
    print(f"cohort:{len(cohort)} 行 × {len(cohort.columns)} 列")
    print(cohort.to_string(index=False), "\n")

    # 分群画像:三分群的平均等级 / 战力 / 金币
    fig, axes = plt.subplots(1, 3, figsize=(12, 4))
    fig.suptitle(f"sandtable cohort profile ({data_dir.name})")
    for ax, col, title in (
        (axes[0], "mean_level", "Mean level"),
        (axes[1], "mean_power", "Mean power"),
        (axes[2], "mean_gold", "Mean gold"),
    ):
        if col not in cohort.columns:
            continue
        ax.bar(cohort["cohort"], cohort[col], color="#5b7fb9")
        ax.set_title(title, fontsize=10)
        ax.grid(True, axis="y", alpha=0.3)
    fig.tight_layout()

    out = data_dir / "cohort_profile.png"
    fig.savefig(out, dpi=150)
    print(f"图已写出:{out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
