# sandtable-mcp

Sandtable 的 MCP(Model Context Protocol)服务器:官方 [rmcp](https://github.com/modelcontextprotocol/rust-sdk) SDK + stdio 传输,**原生直调 sandtable-core**——不经 wasm / Node 边界,单二进制零 Node 依赖。

## 工具面(五枚)

| 工具 | 作用 | 输入 |
| --- | --- | --- |
| `sandtable_validate` | 校验场景 YAML,返回 config_hash / players / days / 版本元数据 | `yaml` |
| `sandtable_run` | 跑 R 个 replicate;results 与 CLI `simulate` 报告同构(逐值一致) | `yaml`, `replicates` |
| `sandtable_plan_sweep` | 实验 YAML → 网格候选 → 真跑全部候选(PASS/BORDERLINE/FAIL 判定,候选间 rayon 并行) | `yaml`, `replicates_override?` |
| `sandtable_analyze` | 纯统计工作台(零额外仿真):`ab_compare`(CRN 配对比较)/ `daily_aggregate`(逐日 95% CI)/ `kpi_summary`(运行级 KPI 表)/ `recommend`(单轴推荐区间) | `analysis` + 各类型参数 |
| `sandtable_calibrate` | 本地只读校准对账:mapping 聚合 `data_dir` 内 CSV 观测值 → 真跑场景 → 逐锚点 sim/observed 残差表(PASS/FAIL/UNMAPPED) | `yaml`, `data_dir`, `mapping`, `replicates?` |

## 纪律

- **与 CLI / wasm 同源**:同 seed 同配置逐值一致;统计(配对 CI、逐日聚合)全部出自内核 `sandtable-core`,壳层零重算。
- **错误原文透传**:内核/配置错误以 tool-level error(`is_error: true`)返回,不在壳层改写,代理可读消息继续。
- **交互预算**:`sandtable_run` replicates ≤ 4096;`sandtable_plan_sweep` 候选数 × replicates ≤ 1000 次仿真;更大实验走 CLI(不受此限)。
- **校准只读**:`sandtable_calibrate` 只读本地 `data_dir`,CSV 路径不得逃出该目录;输出只含聚合残差与验收带判定,**原始观测行不外发**。replicates ≤ 128;单次锚点行 ≤ 10 000,超限拒绝而非静默截断。runs 复用内核 `experiment::summarize` / `MetricKey`(壳层零重算)。

## 接入

```json
{
  "mcpServers": {
    "sandtable": {
      "command": "sandtable-mcp"
    }
  }
}
```

构建:`cargo build -p sandtable-mcp --release`(产物 `target/release/sandtable-mcp`)。stdio 传输:stdout 只承载 MCP 帧,诊断不打印。

## 测试

- 单元:13 个用例真内核驱动(`cargo test -p sandtable-mcp`)——预算拒绝、契约形状、A/B 判定、逐日聚合、KPI 缺席语义、单轴推荐红线、校准聚合/UNMAPPED/映射与路径拒绝/零分母预算。
- 端到端:`tests/mcp_stdio.rs` 用官方 rmcp 客户端真 spawn 本 crate 二进制,走 initialize → list_tools → call_tool 全链路验证五枚工具(与代理/IDE 接入同一条链路)。
