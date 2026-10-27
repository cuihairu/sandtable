#!/usr/bin/env python3
"""经济曲线校准对账模板(todo 数据分析面 step ③ 起步,2026-10-27)。

把「真实侧」观测 economy_day.csv(calibration-design §2 契约)与「仿真侧」
days.csv 对账,出逐锚点残差表(anchor, sim, observed, rel_diff_pct, band,
verdict),可附 --plot 出 per-player 产出/回收曲线 PNG。验收带与校准设计
§3.4 一致:|sim − obs| / obs ≤ 10%。

输入:
  --sim-dir  仿真产物目录(须含 days.csv + report.json)
  --obs-dir  观测目录(须含 economy_day.csv;meta.yaml 可选,供 population)

economy_day.csv 列(固定,校准设计 §2):
  date, gold_granted_total, gold_spent_total, active_players
  聚合口径:per-player(日) = total / active_players;观测侧按日期排序,
  首个日期 = day 1(与仿真 day 轴对齐);per-player(全程) =
  Σtotal / population(meta.yaml;缺失则全程锚点标 unmapped)。

锚点:
  gold_per_player_dN     日产出人均(sim income_per_active vs obs granted/active)
  spend_per_player_dN    日消耗人均(sim spending_per_active vs obs spent/active)
  gold_per_player_total  全程产出人均(sim gold_earned_total/players vs obs Σgranted/population)
  spend_per_player_total 全程消耗人均(同上 spend 侧)
  sink_ratio 在 §2 契约无回收列 → 标 unmapped(诚实,不虚构)。

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
BAND_REL = 0.10


def version_line() -> str:
    try:
        wheel = importlib.metadata.version("sandtable-sim")
    except importlib.metadata.PackageNotFoundError:
        wheel = "unknown"
    return (
        f"calibrate_economy.py {SCRIPT_VERSION}  "
        f"sandtable_sim {wheel}  python {platform.python_version()}"
    )


def read_json(path: Path) -> dict:
    import json

    with open(path, encoding="utf-8") as f:
        return json.load(f)


def read_csv(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def verdict(anchor: str, sim: float, obs: float) -> tuple[str, str]:
    band = f"{BAND_REL * 100:.0f}%"
    rel = abs(sim - obs) / obs if obs else float("inf")
    return band, ("PASS" if rel <= BAND_REL else "FAIL")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sim-dir", required=True, type=Path, help="仿真产物目录(days.csv + report.json)")
    ap.add_argument("--obs-dir", required=True, type=Path, help="观测目录(economy_day.csv)")
    ap.add_argument("--out", type=Path, help="残差表输出(缺省 stdout)")
    ap.add_argument("--plot", type=Path, help="可选:sim vs obs per-player 曲线 PNG")
    args = ap.parse_args()

    print(version_line(), file=sys.stderr)

    sim_days = read_csv(args.sim_dir / "days.csv")
    sim_report = read_json(args.sim_dir / "report.json")
    sim_metrics = sim_report["results"][0]
    obs_rows = read_csv(args.obs_dir / "economy_day.csv")
    sim_by_day = {int(float(r["day"])): r for r in sim_days}

    # 观测侧按日期排序,首个日期 = day 1
    obs_rows = sorted(obs_rows, key=lambda r: r["date"])
    obs_by_day: dict[int, dict[str, float]] = {}
    for i, r in enumerate(obs_rows, start=1):
        try:
            active = float(r["active_players"])
            obs_by_day[i] = {
                "granted_pp": float(r["gold_granted_total"]) / active if active else 0.0,
                "spent_pp": float(r["gold_spent_total"]) / active if active else 0.0,
            }
        except (KeyError, ValueError) as e:
            sys.exit(f"economy_day.csv 列或数值缺失/非法: {e}(列应为 "
                     "date, gold_granted_total, gold_spent_total, active_players)")

    rows: list[dict] = []
    for day in sorted(set(sim_by_day) | set(obs_by_day)):
        sim_row = sim_by_day.get(day)
        obs = obs_by_day.get(day)
        if sim_row is None or obs is None:
            continue
        # 日产出人均
        band, v = verdict("gold_per_player", float(sim_row["income_per_active"]), obs["granted_pp"])
        rows.append({"anchor": f"gold_per_player_d{day}", "sim": f"{float(sim_row['income_per_active']):.2f}",
                     "observed": f"{obs['granted_pp']:.2f}",
                     "rel_diff_pct": f"{abs(float(sim_row['income_per_active'])-obs['granted_pp'])/obs['granted_pp']*100:.2f}",
                     "band": band, "verdict": v})
        # 日消耗人均
        band, v = verdict("spend_per_player", float(sim_row["spending_per_active"]), obs["spent_pp"])
        rows.append({"anchor": f"spend_per_player_d{day}", "sim": f"{float(sim_row['spending_per_active']):.2f}",
                     "observed": f"{obs['spent_pp']:.2f}",
                     "rel_diff_pct": f"{abs(float(sim_row['spending_per_active'])-obs['spent_pp'])/obs['spent_pp']*100:.2f}",
                     "band": band, "verdict": v})

    # 全程人均锚点(meta.yaml population;缺失则 unmapped)
    population = None
    meta_path = args.obs_dir / "meta.yaml"
    if meta_path.is_file():
        try:
            import yaml
        except ImportError:
            sys.exit("缺 pyyaml:读 meta.yaml 需要(先 pip install pyyaml)")
        with open(meta_path, encoding="utf-8") as f:
            population = (yaml.safe_load(f) or {}).get("population")

    obs_granted = sum(float(r["gold_granted_total"]) for r in obs_rows)
    obs_spent = sum(float(r["gold_spent_total"]) for r in obs_rows)
    if population:
        sim_gpp = float(sim_metrics["gold_earned_total"]) / float(sim_metrics["players"])
        sim_spp = float(sim_metrics["gold_spent_total"]) / float(sim_metrics["players"])
        band, v = verdict("gold_per_player", sim_gpp, obs_granted / float(population))
        rows.append({"anchor": "gold_per_player_total", "sim": f"{sim_gpp:.2f}",
                     "observed": f"{obs_granted/float(population):.2f}",
                     "rel_diff_pct": f"{abs(sim_gpp-obs_granted/float(population))/(obs_granted/float(population))*100:.2f}",
                     "band": band, "verdict": v})
        band, v = verdict("spend_per_player", sim_spp, obs_spent / float(population))
        rows.append({"anchor": "spend_per_player_total", "sim": f"{sim_spp:.2f}",
                     "observed": f"{obs_spent/float(population):.2f}",
                     "rel_diff_pct": f"{abs(sim_spp-obs_spent/float(population))/(obs_spent/float(population))*100:.2f}",
                     "band": band, "verdict": v})
    else:
        rows.append({"anchor": "gold_per_player_total", "sim": "", "observed": "",
                     "rel_diff_pct": "", "band": "", "verdict": "unmapped (meta.yaml 缺 population)"})

    # sink_ratio:§2 契约无回收列 → 诚实标 unmapped
    rows.append({"anchor": "sink_ratio", "sim": "", "observed": "", "rel_diff_pct": "",
                 "band": "", "verdict": "unmapped (economy_day.csv 无回收列)"})

    def emit(f) -> None:
        w = csv.DictWriter(f, fieldnames=["anchor", "sim", "observed", "rel_diff_pct", "band", "verdict"])
        w.writeheader()
        w.writerows(rows)

    if args.out:
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            emit(f)
        print(f"残差表 → {args.out}", file=sys.stderr)
    else:
        emit(sys.stdout)

    if args.plot:
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt
        except ImportError:
            sys.exit("缺 matplotlib:--plot 需要(先 pip install matplotlib)")
        days = sorted(set(sim_by_day) | set(obs_by_day))
        plt.figure(figsize=(8, 5))
        plt.plot(days, [obs_by_day[d]["granted_pp"] if d in obs_by_day else float("nan") for d in days],
                 "o-", label="observed granted per player")
        plt.plot(days, [float(sim_by_day[d]["income_per_active"]) if d in sim_by_day else float("nan")
                        for d in days], "s--", label="sim income per active")
        plt.plot(days, [obs_by_day[d]["spent_pp"] if d in obs_by_day else float("nan") for d in days],
                 "^-", label="observed spent per player")
        plt.plot(days, [float(sim_by_day[d]["spending_per_active"]) if d in sim_by_day else float("nan")
                        for d in days], "v--", label="sim spending per active")
        plt.xlabel("day")
        plt.ylabel("gold per player")
        plt.title("economy calibration (sim vs observed)")
        plt.legend()
        plt.grid(alpha=0.3)
        plt.tight_layout()
        plt.savefig(args.plot, dpi=150)
        print(f"曲线图 → {args.plot}", file=sys.stderr)

    failed = [r for r in rows if r["verdict"] == "FAIL"]
    unmapped = [r for r in rows if "unmapped" in r["verdict"]]
    print(f"锚点 {len(rows)} 个:FAIL {len(failed)},unmapped {len(unmapped)}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
