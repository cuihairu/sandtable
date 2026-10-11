# 官方编排模板(脚本层阶段 2)

消费阶段 1 绑定(`sandtable_sim`)与 CLI 产物的三个编排模板。设计口径见
[scripting-design.md](../scripting-design.md) §7 阶段 2 拍板记录(2026-10-11):
纯 Python、零 Rust 改动;绑定承载同进程编排(run / sweep / recommend),
A/B 与既有产物分析走外挂通道(读 comparison.json / sweep.json)。

| 模板 | 通道 | 输入 | 产出 |
| --- | --- | --- | --- |
| [batch_sweep.py](batch_sweep.py) | 绑定(B) | 场景 YAML ×N | 全场景 KPI 汇总表(CSV) |
| [ab_summary.py](ab_summary.py) | 外挂(A) | comparison.json ×N(`sandtable compare` 产物) | 配对差汇总表 + 可选 PNG |
| [sweep_curves.py](sweep_curves.py) | 外挂(A) | sweep.json(`sandtable sweep` 产物) | 指标-参数曲线表 + 可选 PNG(约束带) |

## 依赖与运行

python3 + `sandtable_sim`(阶段 1 wheel:见 `crates/sandtable-python/`)+
matplotlib(仅 `--plot` 出图需要;纯表格运行不需要)。

```bash
cd crates/sandtable-python && maturin build --release
pip install ../../target/wheels/sandtable_sim-*.whl   # wheel 落在仓库根 target/wheels/

python3 scripts/templates/batch_sweep.py examples/pokemon.yaml examples/gacha-pity.yaml --replicates 4
python3 scripts/templates/sweep_curves.py sweep-out/sweep.json --metric win_rate --plot curves.png
```

## 口径与纪律

- 模板内 CI95 为 ±1.96·SE 正态近似(分析速览);权威口径(t 分布、配对差、
  CI 判定)在 CLI `compare` / `sweep` / `recommend`(同阶段 0 纪律);
- 模板是**起步样板**而非库:按需改写,不追求参数面齐全;
- `ab_summary.py` 表格尾带**模型边界注记**(CI 与判定仅在仿真模型内有效,口径同 `sandtable report` 页首,2026-10-11 拍板);PNG 不带该注记——图内标签维持英文、不依赖 CJK 字形的纪律不变;
- 脚本不被信任时的执行策略(永不自动执行、显式执行前审查)见设计文档 §5。
