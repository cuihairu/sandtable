#!/usr/bin/env python3
"""胜率 / 留存校准对账模板(todo 数据分析面 step ③ 起步,2026-10-27)。

把「真实侧」观测(calibration-design §2 契约)与「仿真侧」产物对账,出
逐锚点残差表(anchor, sim, observed, rel_diff_pct, band, verdict),可附
--plot 出 sim vs obs 校验散点 PNG(对角线 = 完全一致)。锚点验收带与校准
设计 §3.4 一致:|sim − obs| / obs ≤ 10%;retention 锚点另加绝对地板
obs ≥ 0.9。锚点缺观测来源时标 unmapped(诚实收窄,不用公开案例替代)。

输入:
  --sim-dir  仿真产物目录(须含 report.json + days.csv;simulate / sweep 产物)
  --obs-dir  观测目录(须含 cohort_day.csv;meta.yaml 可选,含 win_rate 锚点)

cohort_day.csv 列(固定,校准设计 §2):
  date, cohort_day, cohort, retained_players, active_players
  聚合口径:retention(cohort_day) = Σ retained_players / Σ active_players
  (跨 cohort 按同日合并)。

meta.yaml 键(模板期望形状;真实数据到位时以 MCP sandtable_calibrate 的
loader 为权威,本模板键名若有出入以校准设计 §2 为准):
  population, window_days, cohort_mix, win_definition,
  win_rate(标量,可选 → win_rate_total 锚点),
  win_rate_series: [{day, win_rate}, ...](可选 → win_rate_dN 逐日锚点)。

对轴口径:仿真 day(1 起)= 观测 cohort_day + --day-offset(同轴传 0)。
标量锚点取 report.json results[0](第 1 个 replicate,与 days.csv 同源);
多 replicate 的权威聚合在 compare / sweep 汇总,不在本模板。

只读:本模板不写 --sim-dir / --obs-dir;残差表落 --out(缺省 stdout)。
纪律:标签与图注英文(CJK 字形不依赖);版本行打 stderr(同 batch_sweep)。
"""

from __future__ import annotations

import argparse
import csv
import importlib.metadata
import platform
import sys
from pathlib import Path

SCRIPT_VERSION = "1.0"

# 锚点验收带(校准设计 §3.4)
BAND_REL = 0.10
RETENTION_FLOOR = 0.9

# 留存锚点:cohort_day → RunMetrics 字段
RETENTION_ANCHORS = {
    3: "retention_d3",
    7: "retention_d7",
    14: "retention_d14",
    30: "retention_d30",
}


def version_line() -> str:
    try:
        wheel = importlib.metadata.version("sandtable-sim")
    except importlib.metadata.PackageNotFoundError:
        wheel = "unknown"
    return (
        f"calibrate_win_rate.py {SCRIPT_VERSION}  "
        f"sandtable_sim {wheel}  python {platform.python_version()}"
    )


def read_json(path: Path) -> dict:
    import json

    with open(path, encoding="utf-8") as f:
        return json.load(f)


def read_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def read_meta(path: Path) -> dict:
    """meta.yaml 读为 dict;文件缺失返回 {}。缺 pyyaml 时报错退出。"""
    if not path.is_file():
        return {}
    try:
        import yaml
    except ImportError:
        sys.exit("缺 pyyaml:读 meta.yaml 需要(先 pip install pyyaml)")
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def add_anchor(
    rows: list[dict],
    anchor: str,
    sim: float | None,
    obs: float | None,
) -> None:
    """记一行锚点残差;sim 或 obs 缺失 → unmapped(诚实,不替代)。"""
    band_txt = f"{BAND_REL*100:.0f}%"
    if sim is None or obs is None:
        rows.append(
            {
                "anchor": anchor,
                "sim": "",
                "observed": "",
                "rel_diff_pct": "",
                "band": band_txt,
                "verdict": "unmapped",
            }
        )
        return
    rel = abs(sim - obs) / obs if obs else float("inf")
    floor_ok = not anchor.startswith("retention") or obs >= RETENTION_FLOOR
    if anchor.startswith("retention"):
        band_txt += f"+floor{RETENTION_FLOOR}"
    rows.append(
        {
            "anchor": anchor,
            "sim": f"{sim:.4f}",
            "observed": f"{obs:.4f}",
            "rel_diff_pct": f"{rel*100:.2f}",
            "band": band_txt,
            "verdict": "PASS" if (rel <= BAND_REL and floor_ok) else "FAIL",
        }
    )


def retention_obs(cohort_rows: list[dict], day_offset: int) -> dict[int, float]:
    """按 cohort_day 聚合 retention(Σretained / Σactive,跨 cohort 合并)。"""
    sums: dict[int, list[float]] = {}
    for r in cohort_rows:
        try:
            d = int(float(r["cohort_day"])) + day_offset
            retained = float(r["retained_players"])
            active = float(r["active_players"])
        except (KeyError, ValueError) as e:
            sys.exit(
                f"cohort_day.csv 列或数值缺失/非法: {e}(列应为 "
                "date, cohort_day, cohort, retained_players, active_players)"
            )
        sums.setdefault(d, [0.0, 0.0])
        sums[d][0] += retained
        sums[d][1] += active
    return {d: ret / act for d, (ret, act) in sums.items() if act > 0}


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--sim-dir", required=True, type=Path, help="仿真产物目录(report.json + days.csv)")
    ap.add_argument("--obs-dir", required=True, type=Path, help="观测目录(cohort_day.csv + 可选 meta.yaml)")
    ap.add_argument("--day-offset", type=int, default=0, help="仿真day − 观测cohort_day(同轴传 0)")
    ap.add_argument("--out", type=Path, help="残差表输出(缺省 stdout)")
    ap.add_argument("--plot", type=Path, help="可选:sim vs obs 校验散点 PNG(对角线=一致)")
    args = ap.parse_args()

    print(version_line(), file=sys.stderr)

    sim_report = read_json(args.sim_dir / "report.json")
    sim_metrics = sim_report["results"][0]
    obs_rows = read_csv(args.obs_dir / "cohort_day.csv")
    meta = read_meta(args.obs_dir / "meta.yaml")

    obs_ret = retention_obs(obs_rows, args.day_offset)
    sim_by_day = {int(float(r["day"])): r for r in read_csv(args.sim_dir / "days.csv")}

    rows: list[dict] = []
    # 留存锚点:obs 有该 cohort_day 才锚,否则 unmapped
    for cohort_day, field in sorted(RETENTION_ANCHORS.items()):
        sim_day = cohort_day + args.day_offset
        add_anchor(
            rows,
            f"retention_d{cohort_day}",
            sim_metrics.get(field),
            obs_ret.get(sim_day),
        )

    # win_rate 锚点:标量(meta.win_rate → 全程)与逐日(win_rate_series)
    series = (meta or {}).get("win_rate_series") or []
    if (meta or {}).get("win_rate") is not None:
        add_anchor(rows, "win_rate_total", sim_metrics.get("win_rate"), float(meta["win_rate"]))
    elif not series:
        add_anchor(rows, "win_rate", None, None)
    for pt in series:
        try:
            day = int(pt["day"]) + args.day_offset
            obs_wr = float(pt["win_rate"])
        except (KeyError, ValueError, TypeError) as e:
            sys.exit(f"meta.win_rate_series 条目非法({e}):须为 {{day, win_rate}}")
        sim_row = sim_by_day.get(day)
        add_anchor(
            rows,
            f"win_rate_d{day}",
            float(sim_row["win_rate"]) if sim_row else None,
            obs_wr,
        )

    def emit(f) -> None:
        w = csv.DictWriter(
            f, fieldnames=["anchor", "sim", "observed", "rel_diff_pct", "band", "verdict"]
        )
        w.writeheader()
        w.writerows(rows)

    if args.out:
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            emit(f)
        print(f"残差表 → {args.out}", file=sys.stderr)
    else:
        emit(sys.stdout)

    # 可选校验散点 PNG:x=observed, y=sim,对角线=完全一致(图注英文)
    numeric = [r for r in rows if r["sim"] and r["observed"]]
    if args.plot:
        try:
            import matplotlib

            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
        except ImportError:
            sys.exit("缺 matplotlib:--plot 需要(先 pip install matplotlib)")
        xs = [float(r["observed"]) for r in numeric]
        ys = [float(r["sim"]) for r in numeric]
        lo = min(xs + ys) if xs else 0.0
        hi = max(xs + ys) if xs else 1.0
        plt.figure(figsize=(6, 6))
        plt.plot([lo, hi], [lo, hi], "k--", lw=1, label="y = x")
        plt.scatter(xs, ys, c="tab:blue", label="anchor")
        plt.xlabel("observed")
        plt.ylabel("simulated")
        plt.title("win_rate / retention calibration")
        plt.legend()
        plt.grid(alpha=0.3)
        plt.tight_layout()
        plt.savefig(args.plot, dpi=150)
        print(f"校验散点 → {args.plot}", file=sys.stderr)

    failed = [r for r in rows if r["verdict"] == "FAIL"]
    unmapped = [r for r in rows if r["verdict"] == "unmapped"]
    print(
        f"锚点 {len(rows)} 个:FAIL {len(failed)},unmapped {len(unmapped)}",
        file=sys.stderr,
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
