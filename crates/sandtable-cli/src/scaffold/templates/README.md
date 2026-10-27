# __NAME__ 场景脚手架

由 `sandtable scaffold __NAME__` 生成(2026-10-27)。四件套:

| 文件 | 用途 |
| --- | --- |
| `scenario.yaml` | 场景骨架(最小可运行;`model` 节缺省走内核默认值) |
| `params.csv` | 基线参数表(`params export`,只读基线;双向 CSV 参数通道) |
| `experiment.yaml` | 单轴扫描实验草稿(`sweep` 三节) |
| `README.md` | 本文件 |

## 快速开始

```bash
sandtable validate scenario.yaml                     # 校验场景
sandtable simulate scenario.yaml --out out/sim       # 单次运行(report.json + days.csv)
sandtable params export scenario.yaml --out params.csv   # 导出基线参数表
sandtable sweep experiment.yaml --out out/sweep      # 扫描实验(candidates.csv / summary.csv)
sandtable compare scenario.yaml --attack-a 100 --attack-b 105 --replicates 12 --out out/cmp
```

## 下一步

- 在 `scenario.yaml` 取消注释 `model:` 分节并填数值,建立本作的真实数值;
- 用 `params.csv` 做参数双向导入(`sandtable params import`),改 `experiment.yaml`
  的 `parameters` / `targets` 做平衡实验;
- 数值接入与阻力清单参考 docs/guide/21(真实配置验证案例)。
