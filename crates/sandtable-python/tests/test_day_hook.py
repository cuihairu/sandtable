"""sandtable_sim 日钩子测试(脚本层阶段 3 第二批,scripts/scripting-design.md §7)。

前置同 test_smoke.py:maturin build --release + pip install 后 pytest。
锁死三件事:只读(results 与 run_str 逐值一致)、payload 与 day_stats 对账、
回调异常整次报错。事件级回调红线不在本通道(每天一次)。
"""

import pytest

st = pytest.importorskip("sandtable_sim")

YAML = """\
schema_version: '1'
scenario: {population: 40, duration: '3d', seed: 7}
"""


def test_day_hook_payload_parity():
    seen = []

    def hook(payload):
        seen.append(payload)

    v = st.run_str_with_day_hook(YAML, hook, 2)
    base = st.run_str(YAML, 2)
    assert v["results"] == base["results"], "日钩子不得改变结果"

    days = base["results"][0]["days"]
    assert len(seen) == 2 * days, f"replicates × days 次回调: {len(seen)}"
    assert [(p["replicate"], p["day"]) for p in seen] == [
        (r, d) for r in range(2) for d in range(1, days + 1)
    ]
    for p in seen:
        assert p["cohort_names"] == ["casual", "core", "whale"]
        for key in ("cohort", "level", "power", "gold", "churned"):
            assert len(p[key]) == 40, f"{key} 逐玩家一条"
        supply = v["results"][p["replicate"]]["day_stats"][p["day"] - 1]["gold_supply"]
        assert sum(p["gold"]) == supply, "金币守恒对账 day_stats.gold_supply"


def test_day_hook_with_config_object():
    seen = []
    st.run_with_day_hook(st.load_str(YAML), lambda p: seen.append(p))
    assert len(seen) == 3, "replicates 缺省 1"


def test_day_hook_callback_exception_raises():
    def hook(payload):
        raise ValueError("回调炸点")

    with pytest.raises(ValueError, match="日钩子回调失败"):
        st.run_str_with_day_hook(YAML, hook, 1)


def test_day_hook_replicates_zero_rejected():
    with pytest.raises(ValueError, match="replicates"):
        st.run_str_with_day_hook(YAML, lambda p: None, 0)
