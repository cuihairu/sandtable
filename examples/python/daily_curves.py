#!/usr/bin/env python3
"""按天曲线:sandtable days.csv → pandas → matplotlib。

脚本层阶段 0 示例(外挂模式,见 scripts/scripting-design.md §2 方案 A)。
days.csv 与 report.json 同一 run 的产物,18 列契约见 docs/guide/09-data-output.md。

输入产出(仓库根目录执行):
    cargo run -p sandtable-cli -- simulate examples/pokemon.yaml \
        --replicates 3 --out examples/python/sim-out

运行(图落在输入文件同目录):
    python3 examples/python/daily_curves.py [days.csv 路径]
"""

from __future__ import annotations

import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # 无显示环境直接落盘
import matplotlib.pyplot as plt
import pandas as pd

PANELS = [
    # (列名, 图题, y 轴标签)
    ("win_rate", "Win rate by day", "win_rate"),
    ("churn_rate", "Churn rate by day", "churn_rate"),
    ("gold_supply", "Gold supply by day", "gold_supply"),
    ("mean_power", "Mean power by day", "mean_power"),
]


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "examples/python/sim-out/days.csv")
    if not path.exists():
        print(f"找不到 {path};先用 simulate --out 产出(见文件头注释)", file=sys.stderr)
        return 2

    df = pd.read_csv(path)
    print(f"days.csv:{len(df)} 行 × {len(df.columns)} 列,列 = {', '.join(df.columns)}\n")

    fig, axes = plt.subplots(2, 2, figsize=(11, 7))
    fig.suptitle(f"sandtable daily curves ({path.parent.name})")
    for ax, (col, title, ylabel) in zip(axes.flat, PANELS):
        ax.plot(df["day"], df[col], marker=".", linewidth=1)
        ax.set_title(title, fontsize=10)
        ax.set_xlabel("day")
        ax.set_ylabel(ylabel)
        ax.grid(True, alpha=0.3)
    fig.tight_layout()

    out = path.parent / "daily_curves.png"
    fig.savefig(out, dpi=150)
    print(f"图已写出:{out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
