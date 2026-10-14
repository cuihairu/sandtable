# sandtable-engine

游戏引擎 Adapter(引擎无关 JSON 契约)。沙盘的核心资产是**配置语义**(七概念 + 数值表 + 公式 / 曲线 + 行为配置),不是任何引擎的运行时;本 crate 把验证过的语义层以机器可读 JSON 交给引擎侧,减少「沙盘与实机两套数」的漂移。

设计与决策记录见仓库 `docs/engine-adapter-design.md`(契约规范 §7)。

## API

| 函数 | 面 | 说明 |
| --- | --- | --- |
| `export(&SimConfig)` | 导出 | 语义层 → `EngineContract`(导出前走 `validate_config` 同源校验,不产出沙盘自己跑不通的契约) |
| `export_from_yaml(&str)` | 导出 | YAML 场景 → 契约(经 `core::scenario::load_str` 同源加载) |
| `export_json(&SimConfig)` | 导出 | 契约 → JSON 文本(稳定字段序) |
| `EngineContract::to_json()` | 导出 | 同上,方法形态 |
| `importer::load(&str)` | 参考导入 | 契约 JSON → 校验后的 `EngineContract`(结构 + 域值双层校验) |
| `backflow_load(&str)` | 回流 | 引擎侧运行结果文件 → 校验后的 `BackflowReport` |
| `backflow_matches(&BackflowReport, &EngineContract)` | 回流 | 回流是否回指给定契约(`config_hash` 相等) |

## 接入三步(引擎侧)

1. **取契约**:沙盘侧 `export_from_yaml` 导出 `.engine.json`(或经 `export_json` 拿文本);文件带 `kind` / `schema_version` / `config_hash`。
2. **校验 + 读入**:用参考导入器 `load` 校验结构域值,再按字段初始化引擎数值——`model.dungeon.tier_table` 行内产出已是有效整数(缺省回退几何已取整);`model.combat.damage_model` 为显式口径(`difference` / `ratio`);`training` / `loot` / `gacha` 缺省 None 表示沙盘未配置该系统。
3. **回流对照**:引擎跑完按回流约定写 `BackflowReport`(键须为沙盘指标名,`config_hash` 回指契约),`backflow_matches` 确认对得上,再与沙盘分布做 A/B 对照。

## 契约纪律

- 只导出沙盘语义层;UI / 布局 / 动画等引擎侧概念不导出(设计文档 §3.1)。
- 缺省即语义明确的标量导出**有效值**(消费方不背沙盘缺省表);契约带 `schema_version`(`0.1.0`),语义变更走加法。
- 回流是单向输出,不写回契约(§3.6)。
