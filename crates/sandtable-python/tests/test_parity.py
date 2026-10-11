"""py_parity:Python 绑定与 CLI 产物逐值一致(scripts/scripting-design.md §6)。

同配置同 seed 下,Python 入口的 results 与 CLI report.json / sweep.json /
recommendation.json 逐值一致——三形态一个内核,一份等价测试范式三种载体
(web_parity: wasm↔CLI;desktop 测试: desktop↔wasm;本文件: py↔CLI)。

前置:已 pip install sandtable_sim(见 test_smoke.py);需本机 cargo 可跑 CLI。
CLI 的 meta 含 generated_at_unix 时间戳,不参与确定性,只比 results /
elasticities / recommendation。
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

st = pytest.importorskip("sandtable_sim")
pytestmark = pytest.mark.skipif(
    shutil.which("cargo") is None, reason="需 cargo 跑 CLI 对照"
)

ROOT = Path(__file__).resolve().parents[3]

YAML = """\
schema_version: '1'
scenario: {population: 40, duration: '3d', seed: 7}
"""

EXP_YAML = """\
schema_version: '1'
scenario: {population: 40, duration: '3d', seed: 7}
sweep:
  replicates: 2
  parameters:
    model.warrior.attack: {min: 90, max: 110, step: 10}
  targets:
    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}
"""


def run_cli(*args):
    subprocess.run(
        ["cargo", "run", "-q", "-p", "sandtable-cli", "--", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )


def status_of(result):
    """status 两种形态:"ok" 字符串或 {"config_error": ...} 对象。"""
    s = result["status"]
    return s if isinstance(s, str) else "config_error"


def test_simulate_matches_cli(tmp_path):
    scenario = tmp_path / "scenario.yaml"
    scenario.write_text(YAML, encoding="utf-8")
    cli_out = tmp_path / "cli"
    run_cli(
        "simulate", str(scenario),
        "--replicates", "2",
        "--out", str(cli_out),
    )
    report = json.loads((cli_out / "report.json").read_text(encoding="utf-8"))

    py = st.run_str(YAML, 2)
    assert py["results"] == report["results"], "results 逐值一致"
    assert (
        py["config_hash"] == report["results"][0]["config_hash"]
    ), "config_hash 同源"
    assert py["days_csv"] == (cli_out / "days.csv").read_text(
        encoding="utf-8"
    ), "days_csv 与 CLI 写盘逐字节一致"


def test_sweep_matches_cli(tmp_path):
    experiment = tmp_path / "exp.yaml"
    experiment.write_text(EXP_YAML, encoding="utf-8")
    cli_out = tmp_path / "cli-sweep"
    run_cli("sweep", str(experiment), "--out", str(cli_out))
    report = json.loads((cli_out / "sweep.json").read_text(encoding="utf-8"))

    py = st.sweep(str(experiment), replicates=2)
    assert py["results"] == report["results"], "results 逐值一致"
    assert len(py["candidates"]) == report["counts"]["candidates"]
    assert [status_of(r) for r in py["results"]] == [
        status_of(r) for r in report["results"]
    ]
    assert py["replicates"] == report["spec"]["replicates"]


def test_recommend_matches_cli(tmp_path):
    experiment = tmp_path / "exp.yaml"
    experiment.write_text(EXP_YAML, encoding="utf-8")
    sweep_dir = tmp_path / "cli-sweep"
    run_cli("sweep", str(experiment), "--out", str(sweep_dir))
    rec_path = tmp_path / "rec.json"
    run_cli(
        "recommend", str(experiment),
        str(sweep_dir / "sweep.json"),
        "--out", str(rec_path),
    )
    report = json.loads(rec_path.read_text(encoding="utf-8"))

    py = st.recommend(
        str(experiment), st.sweep(str(experiment), replicates=2)["results"]
    )
    assert py["elasticities"] == report["elasticities"], "敏感性矩阵逐值一致"
    assert py["recommendation"] == report["recommendation"], "推荐块逐值一致"
