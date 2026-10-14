# sandtable 游戏引擎 Adapter 设计

**状态:已代决(巡检 R1)并落地。** 五个决策点已按 §5.1 代决,阶段 0–2 全部实装于 `crates/sandtable-engine`(2026-10-14):契约导出 + 参考导入器 + 回流约定,契约规范见 §7。
配套工程证据:跨平台 CI 链已就位(2026-10-13,`desktop-package.yml` 三平台矩阵实跑 bundler),见 §4。

## 0. 定位(承既有架构口径)

- 沙盘的核心资产是**配置语义**(七概念 + 数值表 + 公式/曲线 + 行为配置),不是任何引擎的运行时。
- 目标:**配置一次,引擎侧复用**——沙盘内验证过的参数与曲线,能以机器可读方式交给引擎侧,减少"沙盘与实机两套数"的漂移。
- 不做的事:不写引擎侧运行时、不复制 core 逻辑到引擎、不让引擎成为 core 的反向依赖。引擎是**消费方**,不是同构实现。

## 1. 需求场景(按优先级)

1. 沙盘验证过的数值(掉落率、成长曲线、抽卡期望)同步到引擎侧,策划不必二次录入。
2. 引擎侧配置反向校验:改引擎参数前,先在沙盘验一下分布是否健康。
3. 引擎侧真实运行结果回流,与沙盘分布做 A/B 对照(依赖场景 1 的契约)。
4. 多引擎并行(同一沙盘配置喂两个引擎做选型对比)。

场景 1–3 需要"出得来"的契约;场景 4 要求契约**引擎无关**——这决定 §2 的推荐方向。

## 2. 形态对比与决策

| 形态 | 做法 | 优点 | 代价 | 判断 |
| --- | --- | --- | --- | --- |
| **A. 引擎无关 JSON 契约** | 定义中立 JSON schema,导出沙盘配置;各引擎写**自己的 importer** | 一次导出多引擎复用;契约可版本化、可 diff、可入版本库;沙盘零引擎依赖 | 每接一个引擎写一次 importer(薄,但真实工作量) | **推荐**。沙盘保持引擎无关,契约稳定即可;importer 是引擎侧薄胶水,可社区化 |
| B. 逐引擎 importer 内建 | sandtable 直接生成 Unity/Unreal 资源(脚本able/scene) | 引擎侧零胶水 | 沙盘被引擎 API 绑死,升级即破;每接一引擎重做一套;core 侧被迫引入平台依赖 | 不做。违反 §0 定位,维护成本随引擎数线性涨 |
| C. 引擎侧只读沙盘源码目录 | 引擎直接读 `*.yaml` / `*.json` 配置目录 | 零转换 | 无契约版本、无校验、路径与命名成隐式约定 | 不推荐。可作为场景 1 的临时过渡,不作为契约 |

**决策:取 A。** 引擎侧 importer 由引擎方维护或委托;沙盘只提供契约与参考 importer(可选)。

## 3. 契约面(A 方案细节)

1. **导出范围**:仅导出沙盘语义层——数值表、公式/曲线、掉落表、抽卡配置、行为配置。不导出 UI、布局、动画等引擎侧概念;沙盘本就没有的东西不假装生成。
2. **版本字段**:契约带 `schema_version`,语义变更走加法;删除/改义须升 major 并留迁移说明。
3. **确定性**:导出产物排序稳定(键序、列表序固定),便于 diff 与代码评审——与 core 现有确定性纪律一致。
4. **校验**:导出前走 `validate_config` 同源校验,不产出"沙盘自己都跑不通"的契约;`config_hash` 随契约一起出,便于引擎侧回指沙盘运行结果。
5. **参考 importer**:可选提供一个纯 JSON→数据的参考实现(引擎侧自研亦可),用于示例与回归。
6. **不做反向写入**:契约是沙盘→引擎的单向输出;反向回流(场景 3)走独立的回流文件,不写回契约。

## 4. 落点(待拍板确认)

- **落点**:独立 `sandtable-engine` crate(薄壳,同 `sandtable-python` 范式:core path 依赖、导出器纯函数、cargo test 直接覆盖),还是 CLI 内 feature 门子命令——倾向**独立 crate**,保持 core 零改动;
- **feature 门**:默认不编进 CLI 主二进制(同 arrow / parquet 的 feature 纪律),CI 加构建门与测试门;
- **跨平台 CI(2026-10-13 立)**:`.github/workflows/desktop-package.yml` 以三平台矩阵实跑 bundler 链(ubuntu-24.04 / windows-2025 / macos-15)——适配层若走独立 crate,可复用同一矩阵做构建门;若走 WASM 产物形态(导出器纯函数、理论可编译 wasm32),亦可复用,无需新建工作流。当前不新建 CI 条目,仅登记复用点;
- **WASM 门**:导出器是纯函数、无平台绑定,若走 WASM 形态须过 core 的 wasm32 编译门(现有 CI 已覆盖同型纪律)。

## 5. 决策点(2026-10-14 已代决,见 §5.1;原待拍板记录保留)

1. 目标引擎是哪个(决定 schema 取舍与参考 importer 是否要做);
2. 契约 schema 版本起点与命名域(包名 / 文件扩展名 / JSON 命名风格);
3. 落点:独立 `sandtable-engine` crate,还是 CLI 内 feature 门子命令;
4. 参考 importer 是否由沙盘仓库维护(涉及长期维护责任);
5. 场景 3 回流是否纳入第一期(影响契约是否要预留回指字段)。

## 5.1 代决记录(巡检 R1,2026-10-14)

五项均属产品方向 / 设计取舍且有明确推荐,不涉版本发布、License、付费、素材授权或人工验收,按巡检授权代决:

1. **目标引擎:不预设。** A 方案的立论即引擎无关(§2),schema 按「中立语义层」取舍,先落地契约再等真实引擎接入,不为假想引擎特化字段。
2. **命名域:schema_version 起点 `"0.1.0"`;包名 `sandtable-engine`;扩展名 `.engine.json`;JSON 键 snake_case** (与沙盘 YAML 配置键风格一致,跨语言消费方零歧义)。
3. **落点:独立 `sandtable-engine` crate** (同 `sandtable-python` 薄壳范式:core path 依赖、导出器纯函数、cargo test 直接覆盖),CLI 子命令留待真实接入需求出现再加。
4. **参考 importer:由沙盘仓维护。** load 即契约回归 oracle(导出产物必须能被重新加载且等价,tests/roundtrip.rs 19 测),与 py_parity / web_parity 先例同构。
5. **回流:纳入一期。** `config_hash` 本就随契约导出,回流文件只回指 hash + 指标点,成本极低且是场景 3(A/B 对照)的唯一通道,不做则场景 3 永远缺位。

## 6. 分期(已全部完成,2026-10-14)

- **阶段 0**:契约 v0 草案(导出 schema + 示例产物 + 校验),只导出,不接任何引擎。✅
- **阶段 1**:参考 importer + 回归测试(导出产物可被重新加载并等价校验)。✅
- **阶段 2**:场景 3 回流文件约定与校验(已拍板纳入)。✅

实装:`crates/sandtable-engine`(contract.rs 导出器 + importer.rs 参考导入 + backflow.rs 回流约定;tests/roundtrip.rs 19 测;examples/export_pokemon.rs 最小可跑;README.md 含接入三步)。

## 7. 契约规范 v0.1(sandtable-engine 落地口径)

- **顶层**:`kind`(`sandtable-engine-contract`)/ `schema_version`(`0.1.0`)/ `config_hash`(64 位十六进制,随契约出)/ `model`。
- **model 面**:warrior、whale_gain_mult、combat、dungeon(几何参数恒出 + tier_table 可选)、behavior(三群)、training(可选)、progression、formula、churn、loot(可选)、gacha(可选)。
- **有效值导出**:缺省即语义明确的标量导出生效值(`damage_model` 缺省→`"difference"`、`ratio_k` 缺省→`1.0`);tier_table 行内 gold/xp 缺省按 `reward · growth^tier` 截断为有效整数(与 core `monster_of` 同公式)。
- **确定性**:字段序 = 声明序,BTreeMap 键序固定;导出前过 `config::validate` 同源校验,不产出沙盘自己都跑不通的契约。
- **回流**:`kind`=`sandtable-engine-backflow` + `config_hash` 回指 + 指标点(键须过 `MetricKey::parse`,均值须有限,CI 下界≤上界);单向,不写回契约。

### 接入三步

1. **取契约**:YAML 场景 → `export_from_yaml`(或 `export(&SimConfig)`)→ 写 `*.engine.json`。
2. **校验 + 读入**:`importer::load(json)` 校验 kind / schema_version / 64 位 hash / 域值(命中率∈[0,1]、tier_table 行数 == tiers 等)。
3. **回流对照**:引擎侧写回流文件(回指同一 `config_hash`)→ `backflow_load` 校验 → `backflow_matches` 对回契约做 A/B 对照。
