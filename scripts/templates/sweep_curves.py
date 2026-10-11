#!/usr/bin/env python3
"""扫描结果出图:sweep.json → 指标-参数曲线表 + 可选图(约束带)。

走外挂通道:sweep.json 由 CLI `sandtable sweep --out` 产出(spec 内含
参数轴与 targets,无需实验 YAML;设计文档 §7 阶段 2 拍板②)。
单参数轴模板;多轴扫描请按轴拆分后逐轴查看(同推荐 MVP 红线)。

用法:
    python3 sweep_curves.py sweep-out/sweep.json [--metric win_rate] [--plot curves.png]

曲线:候选参数值 vs 指标均值(误差棒 = CI95);targets 覆盖该指标时画
约束带;配置错误候选照常列入表格、不进曲线(不静默丢弃,同 CLI)。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def metric_stats_of(result: dict, metric: str) -> tuple[float, float, float] | None:
    """(mean, ci_lo, ci_hi);候选配置错误或指标缺失返回 None。"""
    if not isinstance(result["status"], str):  # {"config_error": ...} 对象形态
        return None
    for name, stats in result["metric_stats"]:
        if name == metric:
            return stats["mean"], stats["ci95_lo"], stats["ci95_hi"]
    return None


def main() -> int:
    ap = argparse.ArgumentParser(
        description="扫描结果 → 指标-参数曲线(阶段 2 官方模板)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("sweep_json", help="sweep.json(sandtable sweep --out 产物)")
    ap.add_argument("--metric", help="查看指标(缺省取第一个 target 的指标,无则 win_rate)")
    ap.add_argument("--plot", help="输出 PNG(需 matplotlib)")
    args = ap.parse_args()

    report = json.loads(Path(args.sweep_json).read_text(encoding="utf-8"))
    spec = report["spec"]
    parameters = spec["parameters"]
    if len(parameters) != 1:
        sys.exit(
            f"模板只做单轴可视化,sweep 定义了 {len(parameters)} 个参数轴;"
            "多轴请按轴拆分扫描后逐轴查看"
        )
    axis = parameters[0]["path"]
    metric = args.metric or (
        spec["targets"][0]["metric"] if spec["targets"] else "win_rate"
    )

    # 候选表(按参数值升序);配置错误候选照常列出
    targets_for_metric = [t for t in spec["targets"] if t["metric"] == metric]
    band = next(((t["min"], t["max"]) for t in targets_for_metric), None)
    rows = []
    for result in report["results"]:
        value = result["values"][axis]
        stats = metric_stats_of(result, metric)
        if stats is None:
            err = (
                result["status"]["config_error"]
                if not isinstance(result["status"], str)
                else f"{metric} 不可得"
            )
            rows.append((value, None, err, None))
        else:
            verdict = next(
                (
                    t["verdict"]
                    for t in result["target_outcomes"]
                    if t["metric"] == metric
                ),
                "-",
            )
            rows.append((value, stats, f"{verdict}", stats))

    rows.sort(key=lambda r: r[0])
    print(f"轴:{axis}  指标:{metric}" + (f"  约束带:{band}" if band else ""))
    print(f"{'value':>10} {'mean':>10} {'ci95_lo':>10} {'ci95_hi':>10}  verdict")
    for value, stats, note, _ in rows:
        if stats is None:
            print(f"{value:>10.2f} {'-':>10} {'-':>10} {'-':>10}  config_error:{note}")
        else:
            print(
                f"{value:>10.2f} {stats[0]:>10.4f} {stats[1]:>10.4f} "
                f"{stats[2]:>10.4f}  {note}"
            )

    plotted = [r for r in rows if r[3] is not None]
    skipped = len(rows) - len(plotted)
    if args.plot:
        try:
            import matplotlib

            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
        except ImportError:
            print("出图需 matplotlib(pip install matplotlib)", file=sys.stderr)
            return 2
        fig, ax = plt.subplots(figsize=(8, 4.5))
        xs = [r[0] for r in plotted]
        means = [r[3][0] for r in plotted]
        half = [(r[3][2] - r[3][0]) / 2 for r in plotted]  # (hi-lo)/2
        ax.errorbar(xs, means, yerr=half, fmt="o-", capsize=4)
        if band and band[0] is not None and band[1] is not None:
            ax.axhspan(band[0], band[1], alpha=0.15, color="green", label="target")
            ax.legend()
        ax.set_xlabel(axis)
        ax.set_ylabel(metric)
        # 图内标签用英文:不依赖 CJK 字形,任意机器出图一致(同阶段 0 示例)
        ax.set_title(
            f"{metric} vs {axis} (n={len(plotted)}"
            + (f", {skipped} config_error excluded" if skipped else "")
            + ")"
        )
        fig.tight_layout()
        fig.savefig(args.plot, dpi=150)
        print(f"已写出 {args.plot}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
