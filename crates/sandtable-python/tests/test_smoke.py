"""sandtable_sim 冒烟测试(脚本层阶段 1 验收,scripts/scripting-design.md §7)。

前置:`cd crates/sandtable-python && maturin build --release`,然后
`pip install target/wheels/sandtable_sim-*.whl`,再 `python3 -m pytest tests/`。
模块未安装时整文件跳过(importorskip)——cargo 测试门不受本目录影响。
"""

import pytest

st = pytest.importorskip("sandtable_sim")

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

# RunMetrics 序列化必含字段(docs 09 章数据契约)
RUN_KEYS = {
    "schema_version",
    "model_version",
    "config_hash",
    "replicate",
    "seed",
    "players",
    "days",
}


def test_load_str_shape():
    cfg = st.load_str(YAML)
    assert (cfg.players, cfg.days) == (40, 3)
    assert len(cfg.config_hash) == 64, "SHA-256 hex"
    assert cfg.yaml == YAML


def test_load_file(tmp_path):
    p = tmp_path / "scenario.yaml"
    p.write_text(YAML, encoding="utf-8")
    assert st.load(str(p)).config_hash == st.load_str(YAML).config_hash
    with pytest.raises(ValueError):
        st.load(str(tmp_path / "nope.yaml"))


def test_load_invalid_config_rejected():
    bad = "schema_version: '1'\nscenario: {population: 0, duration: '3d'}\n"
    with pytest.raises(ValueError) as excinfo:
        st.load_str(bad)
    assert "配置错误" in str(excinfo.value)


def test_run_str_shape():
    out = st.run_str(YAML, 2)
    assert set(out) == {"meta", "config_hash", "days_csv", "results"}
    assert out["config_hash"] == st.load_str(YAML).config_hash
    assert out["meta"]["schema_version"]
    assert [r["replicate"] for r in out["results"]] == [0, 1]
    header, *rows = out["days_csv"].splitlines()
    assert header.startswith("day,active,alive_at_start")
    assert len(rows) == 3, "duration 3d → 3 行日序列"
    for r in out["results"]:
        assert RUN_KEYS <= set(r)
        assert r["players"] == 40
        assert r["days"] == 3


def test_run_with_config_object():
    assert len(st.run(st.load_str(YAML), 3)["results"]) == 3


def test_replicates_zero_rejected():
    with pytest.raises(ValueError):
        st.run_str(YAML, 0)


def test_replicates_default_is_one():
    # replicates 缺省 1(同 CLI simulate --replicates 默认)
    assert len(st.run_str(YAML)["results"]) == 1
    assert len(st.run(st.load_str(YAML))["results"]) == 1
    assert st.run_str(YAML)["results"][0]["replicate"] == 0


def test_sweep_all_candidates(tmp_path):
    p = tmp_path / "exp.yaml"
    p.write_text(EXP_YAML, encoding="utf-8")
    out = st.sweep(str(p), replicates=2)
    assert out["replicates"] == 2
    assert out["players"] == 40
    assert len(out["candidates"]) == 3, "90/100/110 三点网格"
    assert len(out["results"]) == 3, "全量:每候选一条"
    assert out["sims"] == 6
    assert out["axes"][0]["path"] == "model.warrior.attack"
    assert out["targets"]
    assert all(r["status"] == "ok" for r in out["results"])
    assert out["results"][0]["values"] == {"model.warrior.attack": 90.0}

    # 覆盖生效(粗筛语义,同 CLI)
    coarse = st.sweep(str(p), replicates=1)
    assert (coarse["replicates"], coarse["sims"]) == (1, 3)


def test_sweep_unknown_path_rejected_at_plan(tmp_path):
    bad = EXP_YAML.replace(
        "model.warrior.attack: {min: 90, max: 110, step: 10}",
        "model.unknown.path: {min: 1, max: 2, step: 1}",
    )
    p = tmp_path / "exp.yaml"
    p.write_text(bad, encoding="utf-8")
    with pytest.raises(ValueError):
        st.sweep(str(p))


def test_sweep_config_error_reported(tmp_path):
    # 轴取注册表路径但候选值非法(population=0)→ 候选项级 config_error,不静默丢弃
    bad = EXP_YAML.replace(
        "model.warrior.attack: {min: 90, max: 110, step: 10}",
        "scenario.population: {min: 0, max: 60, step: 30}",
    )
    p = tmp_path / "exp.yaml"
    p.write_text(bad, encoding="utf-8")
    out = st.sweep(str(p))
    statuses = [
        r["status"] if isinstance(r["status"], str) else "config_error"
        for r in out["results"]
    ]
    assert "config_error" in statuses, f"{statuses}"
    assert "ok" in statuses, f"{statuses}"


def test_recommend_single_axis(tmp_path):
    p = tmp_path / "exp.yaml"
    p.write_text(EXP_YAML, encoding="utf-8")
    results = st.sweep(str(p))["results"]
    rec = st.recommend(str(p), results)
    assert set(rec) == {"elasticities", "recommendation"}
    assert rec["recommendation"]["param"] == "model.warrior.attack"
    assert rec["recommendation"]["confidence"]
    assert isinstance(rec["recommendation"]["interval"], (list, type(None)))
    assert rec["elasticities"]


def test_recommend_multi_axis_rejected(tmp_path):
    two_axis = EXP_YAML.replace(
        "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
        "    model.warrior.attack: {min: 90, max: 110, step: 10}\n"
        "    model.warrior.defense: {min: 60, max: 80, step: 10}\n",
    )
    p = tmp_path / "exp.yaml"
    p.write_text(two_axis, encoding="utf-8")
    with pytest.raises(ValueError) as excinfo:
        st.recommend(str(p), st.sweep(str(p))["results"])
    assert "单参数轴" in str(excinfo.value)


def test_converter_rejects_unsupported_types(tmp_path):
    p = tmp_path / "exp.yaml"
    p.write_text(EXP_YAML, encoding="utf-8")
    with pytest.raises(TypeError):
        st.recommend(str(p), [object()])
    with pytest.raises(ValueError):
        st.recommend(str(p), [{"values": {}, "status": "ok"}])


def test_params_registry():
    rows = st.params()
    assert len(rows) >= 50
    assert {"path", "kind", "default", "desc"} <= set(rows[0])
    assert all(r["path"] for r in rows)
