#!/usr/bin/env python3
"""观测侧数据校验模板(2026-10-30 决策 §2.3 最小实现)。

校验 calibration-design §2 契约的「标准」观测件(不是原始业务明细):
  cohort_day.csv: date, cohort_day, cohort, retained_players, active_players
  economy_day.csv: date, gold_granted_total, gold_spent_total, active_players
  meta.yaml(可选): population, window_days, cohort_mix, win_definition, ...

检查面(决策 §2.3「先验证数据,再运行工具」):
  1. 重复行     —— cohort_day 键(cohort, cohort_day)与(date, cohort)唯一;
                  economy_day 键(date)唯一。
  2. 整数日轴   —— cohort_day 为非负整数且每 cohort 连续无缺日;
                  economy 日期严格递增且为连续日历日(缺日即 FAIL)。
  3. 非负       —— 人数/金币各列 ≥ 0。
  4. 零分母     —— active_players ≥ 1;meta.population(若在)≥ 1。
  5. 加总一致性 —— 每行 retained_players ≤ active_players;
                  meta.cohort_mix 若可识别为份额(映射或列表且 Σ≈1)则校验 Σ≈1,
                  否则如实报「形状未识别,跳过」不算 FAIL。

只读:本模板不写 --obs-dir。逐项 PASS/FAIL,任一 FAIL 退出码 1(可作 CI 门)。
口径:原始业务明细 → 标准 CSV 的转换是数据/表结构特定的,留待真实数据到位
后于接入时固定(决策 §2.3);本模板校验的是转换后的标准契约件。

版本与纪律同 calibrate_*:版本行打 stderr;只验证过机制(合成自洽/注入坏样本),
未经真实数据执行验证,不作任何校准或验收声明。
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import importlib.metadata
import platform
import sys
from pathlib import Path

SCRIPT_VERSION = "1.0"

# cohort_day.csv 固定列(校准设计 §2)
COHORT_COLS = ("date", "cohort_day", "cohort", "retained_players", "active_players")
ECONOMY_COLS = ("date", "gold_granted_total", "gold_spent_total", "active_players")


def version_line() -> str:
    """版本行:脚本版本 · sandtable_sim wheel(若在)· python 解释器。"""
    try:
        sim = importlib.metadata.version("sandtable-sim")
    except importlib.metadata.PackageNotFoundError:
        sim = "n/a"
    return (
        f"validate_obs.py {SCRIPT_VERSION} · sandtable_sim {sim} · "
        f"python {platform.python_version()}"
    )


class Checker:
    """逐项校验的容器:name → (verdict, detail);FAIL 累计退出码 1。"""

    def __init__(self) -> None:
        self.items: list[tuple[str, str, str]] = []

    def ok(self, name: str, detail: str) -> None:
        self.items.append(("PASS", name, detail))

    def fail(self, name: str, detail: str) -> None:
        self.items.append(("FAIL", name, detail))

    def skip(self, name: str, detail: str) -> None:
        self.items.append(("SKIP", name, detail))

    @property
    def failed(self) -> bool:
        return any(v == "FAIL" for v, _, _ in self.items)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def parse_date(s: str) -> dt.date | None:
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_meta(path: Path) -> dict:
    """minimal YAML-lite:仅解析顶层 scalar 与浅列表/映射(观测件形状足够)。"""
    import re

    data: dict = {}
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return data
    for line in text.splitlines():
        m = re.match(r"^(\w+):\s*(.*)$", line)
        if not m:
            continue
        key, val = m.group(1), m.group(2).strip()
        if val in ("", "null", "~", "None"):
            data[key] = None
        elif re.match(r"^-?\d+$", val):
            data[key] = int(val)
        elif re.match(r"^-?\d+\.\d+$", val):
            data[key] = float(val)
        elif val in ("true", "false"):
            data[key] = val == "true"
        elif val.startswith("[") and val.endswith("]"):
            inner = val[1:-1].strip()
            data[key] = [float(x) for x in inner.split(",") if x.strip()]
        elif val.startswith("{") and val.endswith("}"):
            inner = val[1:-1].strip()
            pairs = {}
            for part in inner.split(","):
                if ":" not in part:
                    continue
                k, v = part.split(":", 1)
                v = v.strip()
                try:
                    pairs[k.strip()] = float(v)
                except ValueError:
                    pairs[k.strip()] = v.strip('"\'')
            data[key] = pairs
        else:
            data[key] = val.strip('"\'')
    return data


def check_cohort(c: Checker, rows: list[dict[str, str]]) -> None:
    # 列存在性
    missing = [col for col in COHORT_COLS if col not in rows[0]]
    if missing:
        c.fail("cohort_day 列", f"缺列 {missing}(契约固定列 {COHORT_COLS})")
        return
    # 1) 重复行
    seen = {}
    dup = []
    for i, r in enumerate(rows):
        key = (r["cohort"], r["cohort_day"])
        if key in seen:
            dup.append(f"行{seen[key]+1}/{i+1} 重复(cohort={r['cohort']},day={r['cohort_day']})")
        else:
            seen[key] = i
    if dup:
        c.fail("重复行(cohort,cohort_day)", "; ".join(dup[:5]) + (f" 共{len(dup)}处" if len(dup) > 5 else ""))
    else:
        c.ok("重复行(cohort,cohort_day)", f"{len(rows)} 行唯一")
    seen2 = {}
    dup2 = []
    for i, r in enumerate(rows):
        key = (r["date"], r["cohort"])
        if key in seen2:
            dup2.append(f"行{i+1} 重复(date={r['date']},cohort={r['cohort']})")
        else:
            seen2[key] = i
    if dup2:
        c.fail("重复行(date,cohort)", "; ".join(dup2[:5]))
    else:
        c.ok("重复行(date,cohort)", "唯一")
    # 2) 整数日轴(每 cohort 连续)
    by_cohort: dict[str, list[int]] = {}
    for r in rows:
        try:
            d = int(r["cohort_day"])
        except ValueError:
            c.fail("cohort_day 整数", f"非整数: {r['cohort_day']!r}")
            continue
        if d < 0:
            c.fail("cohort_day 非负", f"负日: {d}")
        by_cohort.setdefault(r["cohort"], []).append(d)
    for cohort, days in by_cohort.items():
        lo, hi = min(days), max(days)
        if len(set(days)) != hi - lo + 1:
            c.fail("整数日轴连续", f"cohort={cohort}: {lo}..{hi} 缺 {hi - lo + 1 - len(set(days))} 日")
        else:
            c.ok("整数日轴连续", f"cohort={cohort}: {lo}..{hi} 连续")
    # 3) 非负 + 4) 零分母 + 5) retained ≤ active
    neg = [f"行{i+1} {col}={r[col]}" for i, r in enumerate(rows)
           for col in ("retained_players", "active_players") if _neg(r[col])]
    if neg:
        c.fail("非负", "; ".join(neg[:5]))
    else:
        c.ok("非负", "人数列均 ≥ 0")
    zero = [f"行{i+1} active_players={r['active_players']}" for i, r in enumerate(rows)
            if not _pos(r["active_players"])]
    if zero:
        c.fail("零分母(active_players)", "; ".join(zero[:5]))
    else:
        c.ok("零分母(active_players)", "均 ≥ 1")
    over = [f"行{i+1} retained={r['retained_players']}>active={r['active_players']}"
            for i, r in enumerate(rows)
            if _num(r["retained_players"]) > _num(r["active_players"])]
    if over:
        c.fail("retained ≤ active", "; ".join(over[:5]))
    else:
        c.ok("retained ≤ active", f"{len(rows)} 行成立")


def check_economy(c: Checker, rows: list[dict[str, str]]) -> None:
    missing = [col for col in ECONOMY_COLS if col not in rows[0]]
    if missing:
        c.fail("economy_day 列", f"缺列 {missing}(契约固定列 {ECONOMY_COLS})")
        return
    # 1) 重复行(date)
    seen = {}
    dup = []
    for i, r in enumerate(rows):
        if r["date"] in seen:
            dup.append(f"行{seen[r['date']]+1}/{i+1} 重复 date={r['date']}")
        else:
            seen[r["date"]] = i
    if dup:
        c.fail("重复行(date)", "; ".join(dup[:5]))
    else:
        c.ok("重复行(date)", f"{len(rows)} 行唯一")
    # 2) 连续日历日 + 排序
    dates = [parse_date(r["date"]) for r in rows]
    if any(d is None for d in dates):
        c.fail("日期可解析", "存在无法解析的 date")
    else:
        if dates != sorted(dates):
            c.fail("日期升序", "economy 日期非严格递增")
        else:
            gaps = [(dates[i], dates[i + 1]) for i in range(len(dates) - 1)
                    if (dates[i + 1] - dates[i]).days != 1]
            if gaps:
                c.fail("日期连续(无缺日)", f"{len(gaps)} 处断档,如 {gaps[:3]}")
            else:
                c.ok("日期连续(无缺日)", f"{len(dates)} 日连续")
    # 3) 非负 + 4) 零分母
    neg = [f"行{i+1} {col}={r[col]}" for i, r in enumerate(rows)
           for col in ("gold_granted_total", "gold_spent_total", "active_players")
           if _neg(r[col])]
    if neg:
        c.fail("非负(金币/人数)", "; ".join(neg[:5]))
    else:
        c.ok("非负(金币/人数)", "均 ≥ 0")
    zero = [f"行{i+1} active_players={r['active_players']}" for i, r in enumerate(rows)
            if not _pos(r["active_players"])]
    if zero:
        c.fail("零分母(active_players)", "; ".join(zero[:5]))
    else:
        c.ok("零分母(active_players)", "均 ≥ 1")


def check_meta(c: Checker, meta: dict) -> None:
    if not meta:
        c.skip("meta.yaml", "缺席(可选件),跳过")
        return
    pop = meta.get("population")
    if pop is not None:
        if not _pos(str(pop)):
            c.fail("population 分母", f"population={pop} 非正")
        else:
            c.ok("population 分母", f"population={pop}")
    mix = meta.get("cohort_mix")
    if mix is None:
        c.skip("cohort_mix 份额", "缺席,跳过")
    elif isinstance(mix, dict):
        total = sum(v for v in mix.values() if isinstance(v, (int, float)))
        if abs(total - 1.0) < 1e-6:
            c.ok("cohort_mix 份额和", f"Σ={total:.6f}≈1")
        else:
            c.fail("cohort_mix 份额和", f"Σ={total}≠1")
    elif isinstance(mix, list):
        total = sum(x for x in mix if isinstance(x, (int, float)))
        if abs(total - 1.0) < 1e-6:
            c.ok("cohort_mix 份额和", f"Σ={total:.6f}≈1")
        else:
            c.fail("cohort_mix 份额和", f"Σ={total}≠1")
    else:
        c.skip("cohort_mix 份额", f"形状未识别({type(mix).__name__}),跳过")


def _num(s: str) -> float:
    try:
        return float(s)
    except (TypeError, ValueError):
        return float("nan")


def _neg(s: str) -> bool:
    try:
        return float(s) < 0
    except (TypeError, ValueError):
        return False


def _pos(s: str) -> bool:
    try:
        return float(s) >= 1
    except (TypeError, ValueError):
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description="观测侧标准契约件校验(决策 §2.3)")
    ap.add_argument("--obs-dir", type=Path, required=True, help="含 cohort_day.csv / economy_day.csv / meta.yaml 的目录")
    args = ap.parse_args()
    print(version_line(), file=sys.stderr)

    c = Checker()
    obs = args.obs_dir
    if not obs.is_dir():
        c.fail("obs-dir", f"目录不存在: {obs}")
    else:
        cohort = obs / "cohort_day.csv"
        economy = obs / "economy_day.csv"
        meta = obs / "meta.yaml"
        if cohort.is_file():
            rows = read_csv(cohort)
            if rows:
                check_cohort(c, rows)
            else:
                c.fail("cohort_day.csv", "空表(无数据行)")
        else:
            c.fail("cohort_day.csv", "缺失(必需交付件)")
        if economy.is_file():
            rows = read_csv(economy)
            if rows:
                check_economy(c, rows)
            else:
                c.fail("economy_day.csv", "空表(无数据行)")
        else:
            c.fail("economy_day.csv", "缺失(必需交付件)")
        check_meta(c, parse_meta(meta))

    for verdict, name, detail in c.items:
        print(f"{verdict:5s}  {name}: {detail}")
    n_fail = sum(1 for v, _, _ in c.items if v == "FAIL")
    print(f"summary: {len(c.items)} checks, {n_fail} fail", file=sys.stderr)
    return 1 if c.failed else 0


if __name__ == "__main__":
    sys.exit(main())
