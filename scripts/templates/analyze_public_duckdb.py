#!/usr/bin/env python3
"""公开真实数据 DuckDB 导入验证(todo「数据分析面」step ②/③,2026-11-01)。

把「线上真实数据」经 DuckDB 导入跑 SQL 聚合,与源 JSON 顶层统计逐位核对。
本模板是 2026-11-01 解封路径的复跑证据:公开基准数据(data/public/genshin/
character-event-pity.json,MsExcel85/genshin-drop-rate 社区全量样本)虽非
用户真实运营数据,但按 2026-10-31 用户口径「公开数据 = 测试/校准基准」,
可解除「缺真实运营数据」BLOCKED,用于验证数据分析面机制(①②③)。

输入:
  --data  公开基准 JSON 路径(默认 data/public/genshin/character-event-pity.json)
  --csv   可选,把 per_pity_counts 导成 CSV 供 `sandtable query`(Rust DuckDB)复核

只读:本模板不写 --data 路径;可选 --csv 落盘是导出旁路,不是改数据。
输出:stderr 版本行 + stdout 聚合统计(PASS/FAIL)。任一断言失败退出码 1。

纪律:与 calibrate_* 一致——只读、版本行打 stderr、英文标签(CJK 不依赖)。
"""
from __future__ import annotations

import argparse
import importlib.metadata
import json
import platform
import sys
from pathlib import Path


def version_line() -> str:
    try:
        wheel = importlib.metadata.version("sandtable-sim")
    except importlib.metadata.PackageNotFoundError:
        wheel = "unknown"
    return (
        f"analyze_public_duckdb.py 1.0  "
        f"sandtable_sim {wheel}  duckdb {duckdb_version()}  python {platform.python_version()}"
    )


def duckdb_version() -> str:
    try:
        import duckdb

        return duckdb.__version__
    except Exception:
        return "unknown"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--data",
        default="data/public/genshin/character-event-pity.json",
        help="公开基准 JSON 路径",
    )
    ap.add_argument("--csv", help="可选:把逐抽计数导出成 CSV(供 sandtable query 复核)")
    args = ap.parse_args()

    print(version_line(), file=sys.stderr)

    data = Path(args.data)
    if not data.exists():
        print(f"FAIL: 数据不存在 {data}", file=sys.stderr)
        return 1
    with data.open() as f:
        payload = json.load(f)

    counts = payload["per_pity_counts"]
    total = sum(counts)

    try:
        import duckdb

        con = duckdb.connect(":memory:")
        rows = [(pull, count) for pull, count in enumerate(counts, start=1)]
        con.executemany(
            "CREATE TABLE pity (pity_pull INTEGER, hit_count BIGINT); "
            "INSERT INTO pity VALUES (?, ?)",
            rows,
        )
        (n, db_total, db_mean, db_rate) = con.execute(
            """
            SELECT
              count(*) AS n,
              sum(hit_count) AS total_hits,
              sum(hit_count * pity_pull)::DOUBLE / sum(hit_count) AS mean_pulls,
              1.0 / (sum(hit_count * pity_pull)::DOUBLE / sum(hit_count)) AS consolidated_rate
            FROM pity
            """
        ).fetchone()
    except Exception as exc:  # noqa: BLE001 - 报告缺件不崩溃
        print(f"FAIL: DuckDB 不可用: {exc}", file=sys.stderr)
        return 1

    # 与源 JSON 顶层逐位核对
    ok = (
        n == len(counts)
        and db_total == payload["total_five_star_hits"] == total
        and abs(db_mean - payload["mean_pulls"]) < 0.001
        and abs(db_rate - payload["consolidated_rate"]) < 0.0001
    )
    print(f"n={n}")
    print(f"total_hits={db_total}")
    print(f"mean_pulls={db_mean:.3f}")
    print(f"consolidated_rate={db_rate:.5f}")
    print("PASS" if ok else "FAIL")
    if not ok:
        return 1

    if args.csv:
        out = Path(args.csv)
        import csv

        with out.open("w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["pity_pull", "hit_count"])
            for i, c in enumerate(counts, start=1):
                w.writerow([i, c])
        print(f"CSV 已导出: {out} ({len(counts)} 行)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
