#!/usr/bin/env python3
"""工作流数据包读取:多工作表 .xlsx → CSV,标准库零依赖。

走外挂通道:`sandbox.xlsx` 由 CLI `sandtable workbook <产物目录>` 产出
(命令侧红线见 docs/guide/09-data-output.md「导出侧:多工作表工作簿」)。
本模板是它的读回端——因为工作簿遵守「单行表头 + 真实数值单元格 + 无合并
单元格」的契约,标准库就能读,不需要 pandas / openpyxl。

用法:
    python3 workbook_sheets.py PACKAGE.xlsx list                     # 表清单 + manifest 对账
    python3 workbook_sheets.py PACKAGE.xlsx dump comparison          # 一张表 → CSV(stdout)
    python3 workbook_sheets.py PACKAGE.xlsx dump summary --out t.csv # 一张表 → CSV(落盘)
    python3 workbook_sheets.py PACKAGE.xlsx check                    # manifest 自描述与实际逐行核对

口径:数值单元格按 XLSX 15 位有效数字上限往返,文本单元格原样;缺席产物在
manifest 里是 absent 行,本就没有工作表,所以 check 对账只比对存在表。
"""

from __future__ import annotations

import argparse
import csv
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

MAIN_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def _letters_to_index(text: str) -> int:
    """A → 0,Z → 25,AA → 26(与写出端同一个双射 26 进制)。"""
    out = 0
    for ch in text:
        out = out * 26 + (ord(ch) - ord("A") + 1)
    return out - 1


def _cell_value(cell: ET.Element) -> str | None:
    """单元格 → CSV 文本:数值走最短往返表示,文本原样,空格不补。"""
    if cell.get("t") == "inlineStr":
        return cell.findtext(f"{MAIN_NS}is/{MAIN_NS}t") or ""
    value = cell.findtext(f"{MAIN_NS}v")
    return value if value is not None else None


def _parse_sheet(xml: bytes) -> list[list[str | None]]:
    root = ET.fromstring(xml)
    rows: list[list[str | None]] = []
    for row in root.findall(f"{MAIN_NS}sheetData/{MAIN_NS}row"):
        cells: list[str | None] = []
        for cell in row.findall(f"{MAIN_NS}c"):
            ref = cell.get("r", "")
            letters = "".join(ch for ch in ref if ch.isalpha())
            index = _letters_to_index(letters) if letters else len(cells)
            while len(cells) < index:
                cells.append(None)
            cells.append(_cell_value(cell))
        rows.append(cells)
    return rows


def _load(path: Path) -> dict[str, list[list[str | None]]]:
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheets: dict[str, list[list[str | None]]] = {}
        for index, sheet in enumerate(workbook.find(f"{MAIN_NS}sheets"), start=1):
            sheets[sheet.get("name", "")] = _parse_sheet(archive.read(f"xl/worksheets/sheet{index}.xml"))
    return sheets


def _write_csv(rows: list[list[str | None]], path: Path | None) -> None:
    """表 → CSV:标准库 csv 的引号规则(内嵌逗号 / 引号 / 换行自动转义)。"""
    target = sys.stdout if path is None else open(path, "w", newline="", encoding="utf-8")
    with target as handle:
        csv.writer(handle).writerows(
            ["" if cell is None else cell for cell in row] for row in rows
        )


def _cmd_dump(sheets: dict[str, list[list[str | None]]], name: str, path: Path | None) -> int:
    if name not in sheets:
        print(f"错误: 工作簿里没有表 {name};现有 {', '.join(sheets) or '无'}", file=sys.stderr)
        return 2
    if not sheets[name] or len(sheets[name][0]) == 0:
        print(f"错误: 表 {name} 没有表头行", file=sys.stderr)
        return 2
    _write_csv(sheets[name], path)
    return 0


def _cmd_list(sheets: dict[str, list[list[str | None]]]) -> int:
    print("name\trows\tcols")
    for name, rows in sheets.items():
        cols = max((len(r) for r in rows), default=0)
        print(f"{name}\t{max(len(rows) - 1, 0)}\t{cols}")
    return 0


def _cmd_check(sheets: dict[str, list[list[str | None]]]) -> int:
    """manifest 逐行对账:表清单、行列数、缺席记录与实际一致。"""
    if "manifest" not in sheets:
        print("错误: 工作簿缺 manifest 表", file=sys.stderr)
        return 2
    manifest = sheets["manifest"]
    header, *body = manifest
    index = {value: i for i, value in enumerate(header) if value is not None}

    def cell(row: list[str | None], column: str) -> str | None:
        at = index.get(column, -1)
        return row[at] if 0 <= at < len(row) else None

    bad = 0
    absent: list[str] = []
    for row in body:
        kind = cell(row, "kind")
        if kind == "sheet":
            name, rows, cols = cell(row, "name"), cell(row, "rows"), cell(row, "cols")
            if name not in sheets:
                print(f"不一致: manifest 声称有表 {name},工作簿里没有", file=sys.stderr)
                bad += 1
                continue
            actual_rows = max(len(sheets[name]) - 1, 0)
            actual_cols = len(sheets[name][0])
            if (str(actual_rows), str(actual_cols)) != (rows, cols):
                print(
                    f"不一致: 表 {name} manifest 记 {rows}x{cols},实际 {actual_rows}x{actual_cols}",
                    file=sys.stderr,
                )
                bad += 1
        elif kind == "absent":
            name = cell(row, "name")
            if name and name in sheets:
                print(f"不一致: 缺席产物 {name} 却生成了工作表", file=sys.stderr)
                bad += 1
            if name:
                absent.append(name)
    if bad:
        return 1
    print(f"manifest 与实际一致:{len(sheets)} 张表;缺席产物 {len(absent)} 项(未出表)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="多工作表工作簿读取(标准库零依赖)")
    parser.add_argument("package", type=Path, help="sandtable workbook 产出的 .xlsx")
    parser.add_argument("action", choices=["list", "dump", "check"], help="list / dump <表> / check")
    parser.add_argument("sheet", nargs="?", help="dump 目标表名")
    parser.add_argument("--out", type=Path, help="dump 落盘路径(缺省 stdout)")
    args = parser.parse_args()

    if not args.package.is_file():
        print(f"错误: {args.package} 不是文件", file=sys.stderr)
        return 2
    try:
        sheets = _load(args.package)
    except (KeyError, ET.ParseError) as exc:
        print(f"错误: 不是合法的工作簿({exc})", file=sys.stderr)
        return 2
    if args.action == "list":
        return _cmd_list(sheets)
    if args.action == "check":
        return _cmd_check(sheets)
    if not args.sheet:
        print("错误: dump 需要表名", file=sys.stderr)
        return 2
    return _cmd_dump(sheets, args.sheet, args.out)


if __name__ == "__main__":
    sys.exit(main())
