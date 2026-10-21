# sandtable-python

core 的 Python 绑定(pyo3 + maturin)。发行名 `sandtable-sim`,导入名 `sandtable_sim`;与 CLI / wasm 同构的薄转发层——逻辑全部在 core 的 `*_native` 纯函数里,本 crate 只做类型转换,不承载仿真语义(分层纪律见 [scripts/scripting-design.md](../../scripts/scripting-design.md))。

## 构建与安装

```bash
cd crates/sandtable-python
maturin build --release
# workspace 共用一个 target 目录,wheel 落在仓库根 target/wheels/ 下
pip install ../../target/wheels/sandtable_sim-*.whl
```

需要 Python ≥ 3.9 与 Rust 工具链(maturin ≥ 1.0,< 2.0)。

## 快速上手

```python
import sandtable_sim as st

cfg = st.load_str("""
schema_version: '1'
scenario: {population: 40, duration: '3d', seed: 7}
""")

out = st.run(cfg)                # replicates 缺省 1(同 CLI simulate --replicates 默认)
print(out["days_csv"])           # 与 CLI days.csv 逐字节一致(py_parity 锁死)
print(out["results"][0]["win_rate"])
```

## API 一览

| 函数 | 签名 | 说明 |
| --- | --- | --- |
| `load` | `(path) -> Config` | 从 YAML 文件加载配置 |
| `load_str` | `(yaml) -> Config` | 从 YAML 文本加载配置 |
| `run` | `(cfg, replicates = 1) -> dict` | 运行仿真 → `{meta, config_hash, days_csv, results}` |
| `run_str` | `(yaml, replicates = 1) -> dict` | 同 `run`,YAML 文本入口 |
| `run_with_day_hook` | `(cfg, day_callback, replicates = 1) -> dict` | 同 `run`,每日日结后回调 `day_callback(payload)`;只读,不改 results |
| `run_str_with_day_hook` | `(yaml, day_callback, replicates = 1) -> dict` | 同 `run_with_day_hook`,YAML 文本入口 |
| `sweep` | `(path, replicates = 0) -> dict` | 扫描实验;`replicates=0` 表示用 YAML 内值 |
| `recommend` | `(path, results) -> dict` | 单轴弹性与推荐 → `{elasticities, recommendation}` |
| `params` | `() -> list[dict]` | 参数注册表 `{path, kind, default, desc}`(只读) |

`Config` 对象属性:`yaml`(原文)、`config_hash`(SHA-256 hex)、`players`、`days`。

### 日钩子(阶段 3,批处理粒度)

```python
seen = []
st.run_str_with_day_hook(yaml, lambda p: seen.append(p))
# p = {replicate, day, cohort_names: ["casual","core","whale"],
#      cohort/level/power/gold/churned: 逐玩家平行数组}
```

每日 `DayClose` 记账完成后回调一次,**只读**——同配置同 seed 结果与 `run_str`
逐值一致(pytest 锁死)。成本见 scripts/scripting-perf-report.md
(默认 5 列观测面 30 天 ≈20% 基线,原型/分析定位);事件级回调是设计红线,不提供。

## 错误语义

- 配置 / 实验文件错误、`replicates=0` 等非法参数 → `ValueError`;
- sweep 候选项级错误不抛异常:`status` 为字符串 `"ok"` 或对象 `{"config_error": ...}`,消费方按 `isinstance(str)` 分派(见 `scripts/templates/batch_sweep.py`);
- `meta.generated_at_unix` 是壁钟时间戳,逐次运行不同——做等价比对时只比 `results` / `elasticities` / `recommendation`(py_parity 测试即如此)。

## 测试

```bash
python3 -m pytest tests/
```

- `test_smoke.py`:模块功能冒烟(模块未安装时整文件跳过,不影响 cargo 测试门);
- `test_parity.py`:py_parity,Python 输出与 CLI 逐字节比对(`days_csv`),需要本机 `cargo` 可用;CI 暂不跑 pytest(wheel/pytest 任务按[拍板④](../../scripts/scripting-design.md)挂起,触发条件=发布决定)。

## 相关

- 分期与拍板记录:[scripts/scripting-design.md](../../scripts/scripting-design.md)
- 官方编排模板(绑定通道 / 外部通道):[scripts/templates/](../../scripts/templates/)
- 外挂模式示例(零 Rust 依赖回退路径):[examples/python/](../../examples/python/)
