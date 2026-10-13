# sandtable 游戏引擎 Adapter 设计(方案待拍板)

状态:**方案待拍板,未实施**(2026-10-13 立本文)。本文回答:引擎 Adapter 的形态选型、与三形态(CLI / Web /桌面)的边界、core 纪律怎么守。**目标引擎未定**——选型第一决策点,定了才开工。

## 0. 定位(承既有架构口径)

- **单一内核纪律不变**(文档 02):所有形态链接 `sandtable-core`。引擎 Adapter 是**第四条形态**,同样只链接 core,不复制仿真逻辑——它搬运的是**配置**(SimConfig 树),不是仿真结果。
- **core 无平台/引擎依赖不变**(文档 04 边界):core 依赖树保持无平台库、可编译 wasm32。引擎知识一律进**独立 crate 或 feature 门后**,core 本体不出现任何引擎类型。
- **Local-first 不变**(文档 02):导出在本地完成,产物是文件(引擎侧自取),不引入账号/服务/网络。
- **为什么需要**:策划在 sandtable YAML 里调参(数值表 + 公式 + 行为配置),仿真验证经济/战力/留存;但**游戏内实现**(真实战斗、真实掉落、真实抽卡)发生在引擎里,两份实现漂移 = 仿真承诺破产。Adapter 的目标是让引擎侧系统**从同一份校验过的配置构建**,而不是手抄第二份。

## 1. 需求场景(按优先级)

1. **配置导出**:校验过的 SimConfig → 引擎可消费的产物(JSON 为主,按引擎可选资产文件),引擎侧系统(战斗公式、掉落表、保底、成长曲线)据此实现或生成 ScriptableObject / DataAsset / Resource;
2. **schema 产物**:公式曲线采样表、分群权重、参数注册表快照(registry `all()` 导出)给引擎策划工具链用;
3. **结果回流(远期,按需)**:引擎侧线上遥测(真实掉落/付费/留存)回流与仿真基准对账——依赖真实运营数据,与 todo「真实案例二期」同闸门,**本设计不承诺**。

## 2. 形态对比与决策

| 方案 | 形态 | core 改动 | 引擎侧成本 | 多引擎 | 结论 |
| --- | --- | --- | --- | --- | --- |
| A 引擎无关 JSON 导出 | `sandtable export-engine`(或子命令)输出单个 JSON(校验后 SimConfig 全树 + schema_version + 导出时刻),各引擎自写 importer | 新增导出器(纯函数:validate → serialize) | 每引擎一个 importer,只读 JSON,不引 sandtable 依赖 | 天然支持(格式稳定即契约) | **推荐(与 B 叠加)** |
| B 按引擎的资产生成 | A 的 JSON 之上,再加各引擎资产生成器(Unity ScriptableObject / Godot Resource / Unreal DataAsset 的生成脚本) | 生成器放独立 crate 或仓库 scripts | 引擎侧零解析,直接吃资产 | 每引擎一个生成器 | **第二拍板后按需加** |
| C core 内嵌引擎 schema | core 里维护各引擎的 schema 类型 | **破纪律**:core 出现引擎类型与依赖 | — | — | **不做**(同脚本层「扩展优于嵌入」的取舍:core 保持引擎无关) |
| D 引擎侧解析 sandtable YAML | 引擎团队自己写 YAML 解析 + 配置消费 | 零 | 每引擎复刻一套 YAML 语义,漂移风险最高 | 理论可行 | **不推荐**(等于把 single-source 纪律外包) |

**推荐路径:A 先行**(JSON 是唯一契约面,importer 是引擎侧自己的事);B 在目标引擎拍板后按该引擎生成器做;C / D 排除理由见上表。

## 3. 契约面(A 方案细节)

- **产物内容**:`SimConfig` 全树(Serialize 直出,与 `report.json` 的 meta 同纪律:schema_version、模型版本)+ 环境字段(导出时刻,`SANDTABLE_GIT_SHA` 回退 unknown,与 report 产物同口径);
- **格式纪律**:条目(字段)按路径排序、数值浮点逐位稳定(`serde_json` float_roundtrip 已开,与 web_parity 同根基)、schema_version 进产物——与 `.sandtable` 打包、report.json 三条产物线同一条确定性纪律;
- **校验前置**:导出走 `validate` 同源路径,坏配置不出导出(同 [params import](./guide/10-cli) 纪律:错误逐条报完再失败);
- **路径纪律**:结果文件放 `results/` 下、词根清晰,与 [数据输出](./guide/09-data-output) 契约对齐;引擎 importer 按 schema_version 认版,旧版产物显式报错不静默;
- **不回读引擎产物**:导出是单向的(sandtable → 引擎),引擎侧数值修改回流 sandtable 属配置变更,走 params import 既有通道,不在 Adapter 里开反向路。

## 4. 落点(待拍板确认)

- **crate**:新 `sandtable-engine` crate(薄壳,同 `sandtable-python` 范式:core path 依赖,导出器纯函数,cargo test 直接覆盖)还是 CLI 内 feature 门子命令——倾向**独立 crate**,保持 core 零改动;
- **feature 门**:默认不编进 CLI 主二进制(同 arrow / parquet 的 feature 纪律),CI 加构建门与测试门;
- **wasm**:导出器若纯函数无平台依赖,理论可编译 wasm32(给 Web/桌面用),但 Web 定位小中型仿真,导出引擎 JSON 在浏览器无消费方——**不进 wasm,CLI/桌面先行**。

## 5. 决策点(需用户拍板,未拍不开工)

1. **目标引擎**:Unity / Unreal / Godot / 自研 / 其他——决定 B 阶段生成器形态与 importer 语言(C# / C++ / GDScript);
2. **落点**:独立 `sandtable-engine` crate(推荐)还是 CLI feature 子命令;
3. **A 阶段范围**:仅 SimConfig 全树,还是含 registry 快照 / 公式采样表;
4. **B 阶段是否同批做**:目标引擎定了就连生成器一起,还是先 JSON、生成器二期;
5. **结果回流(§1.3)**:挂起,与真实案例二期同闸门。

## 6. 分期(拍板后启用)

- 阶段 1(A):导出器 + CLI 接入 + JSON 契约测试(确定性 / schema_version / 坏配置拒导出)+ 单测锁 roundtrip 回读;
- 阶段 2(B,目标引擎定后):该引擎生成器 + 资产产物测试;
- 阶段 3(按需):结果回流对账,待真实运营数据。

**红线**:core 本体零引擎类型;导出器纯函数、坏配置不出导出;契约字段排序与浮点稳定——三条与现有产物线同一纪律。未拍板前本文不改 core 一行。
