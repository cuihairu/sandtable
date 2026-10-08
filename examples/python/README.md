# Python 示例:消费 sandtable 产物(脚本层阶段 0)

外挂模式(方案 A)的最小示范:三个脚本只读 CLI 落盘产物,不 import 内核、不改 Rust——
形态、边界与脚本安全策略见 [scripts/scripting-design.md](../../scripts/scripting-design.md)(阶段 0 定义在 §7)。

## 依赖

Python ≥ 3.10,另需:

```bash
pip install pandas pyarrow matplotlib
```

本地验证版本:Python 3.14.4 / pandas 3.0.6 / pyarrow 25.0.1 / matplotlib 3.10.7。

## 产出输入并运行

仓库根目录:

```bash
# report.json + days.csv(任一构建都行)
cargo run -p sandtable-cli -- simulate examples/pokemon.yaml \
    --replicates 3 --out examples/python/sim-out

# 三个 Parquet 批次(需 parquet feature)
cargo run -p sandtable-cli --features parquet -- simulate examples/pokemon.yaml \
    --replicates 3 --parquet --out examples/python/sim-out

python3 examples/python/kpi_report.py        # report.json → KPI 汇总表
python3 examples/python/daily_curves.py      # days.csv → 按天四联图 sim-out/daily_curves.png
python3 examples/python/parquet_analysis.py  # parquet → 批次表 + 分群画像 sim-out/cohort_profile.png
```

路径参数可省略,缺省即上表路径;`sim-out/` 已 gitignore,产物只留本地。

## 口径与纪律

- `kpi_report.py` 的 CI95 是 **±1.96·SE 正态近似**(分析速览用);权威 CI95(CI 真覆盖,
  t 分布、配对差)以 `sandtable report` / report 子命令为准(文档 11/13 章);
- 本机跑自己写的脚本属**可信**场景,无附加限制;「项目文件携带脚本永不自动执行」等
  三条硬规则见设计文档 §5——示例脚本进仓库即受其约束(CI 跑固定脚本);
- 阶段 1 起另有绑定 API(方案 B,pip wheel + Arrow 零拷贝)入口;本目录保持外挂模式
  示例,作为零依赖回退路径的活文档(设计文档 §2)。
