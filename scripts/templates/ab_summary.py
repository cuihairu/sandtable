#!/usr/bin/env python3
"""A/B 结果聚合:多份 comparison.json → 配对差汇总表 + 可选图。

走外挂通道:comparison.json 由 CLI `sandtable compare --out` 产出
(绑定面无 compare;设计文档 §7 阶段 2 拍板②)。多文件 = 多指标或
多实验的横向汇总。

用法:
    python3 ab_summary.py COMPARISON.json [MORE.json ...] [--plot out.png]

表列:文件、指标、A/B 臂攻击、配对差、CI95、效应量 d、判定
(BHigher / AHigher / NoDifference,基于置信区间不是点估计)。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

VERDICT_ZH = {
    "BHigher": "B 高",
    "AHigher": "A 高",
    "NoDifference": "无显著差异",
}


def main() -> int:
    ap = argparse.ArgumentParser(
        description="A/B 结果聚合 → 配对差汇总表(阶段 2 官方模板)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("reports", nargs="+", help="comparison.json 文件(≥1)")
    ap.add_argument("--plot", help="输出 PNG(配对差 ± CI95 误差棒;需 matplotlib)")
    args = ap.parse_args()

    rows = []
    for name in args.reports:
        raw = json.loads(Path(name).read_text(encoding="utf-8"))
        cmp = raw["comparison"]
        rows.append(
            {
                "file": name,
                "metric": cmp["metric"],
                "attack_a": raw["attack_a"],
                "attack_b": raw["attack_b"],
                "diff": cmp["diff_mean"],
                "ci": (cmp["diff_ci95_lo"], cmp["diff_ci95_hi"]),
                "d": cmp["effect_size_d"],
                "verdict": cmp["verdict"],
            }
        )

    header = (
        f"{'file':<40} {'metric':<22} {'A/B':<10} {'diff':>10} "
        f"{'CI95':<26} {'d':>7}  verdict"
    )
    print(header)
    print("-" * len(header))
    for r in rows:
        print(
            f"{r['file']:<40} {r['metric']:<22} "
            f"{r['attack_a']}/{r['attack_b']:<6} {r['diff']:>+10.4f} "
            f"[{r['ci'][0]:+.4f}, {r['ci'][1]:+.4f}]{'':<4} {r['d']:>+7.3f}  "
            f"{VERDICT_ZH.get(r['verdict'], r['verdict'])}"
        )

    if args.plot:
        try:
            import matplotlib

            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
        except ImportError:
            print("出图需 matplotlib(pip install matplotlib)", file=sys.stderr)
            return 2
        fig, ax = plt.subplots(figsize=(8, 4.5))
        labels = [f"{Path(r['file']).parent.name}:{r['metric']}" for r in rows]
        diffs = [r["diff"] for r in rows]
        half = [(r["ci"][1] - r["ci"][0]) / 2 for r in rows]
        ax.errorbar(range(len(rows)), diffs, yerr=half, fmt="o", capsize=4)
        ax.axhline(0.0, color="gray", linewidth=0.8, linestyle="--")
        ax.set_xticks(range(len(rows)), labels, rotation=20, ha="right")
        # 图内标签用英文:不依赖 CJK 字形,任意机器出图一致(同阶段 0 示例)
        ax.set_ylabel("paired diff B-A (CRN)")
        ax.set_title("A/B paired difference with CI95")
        fig.tight_layout()
        fig.savefig(args.plot, dpi=150)
        print(f"已写出 {args.plot}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
