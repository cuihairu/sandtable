# TODO

> 2026-10-14 对账:挂闸条目逐条核对本仓 git log / docs 决策记录 / 测试现状;完成项一行证据(commit hash + 测试数)。

## 待办(挂闸:需用户拍板 / 等外部输入 / 人工验收才开工)

- [ ] 真实案例二期 + 模型校准。解除条件:用户提供真实运营数据与对标基准(2026-10-11 拍板挂起不立项;一期宝可梦用公开数值已跑通全链见 docs 21,二期要真实运营面数据与外部基准,仓内无此输入)
- [ ] 桌面端投入。**剩:人工开窗验收**——native 文件对话框 GUI 与 Windows / macOS 完整交互走查(需本机 GUI 环境,自动化断言已尽);自动化链已覆盖:构建(run 38420221169 三腿绿)、启动(run 38436094647 20s 存活)、安装包安装+运行(run 38457041427,Windows 含 msi 腿 38488806732);证据 docs 18 Phase 7
- [ ] 随机函数扩展后续。解除条件:出现真实品类需求(24 章 7 项能力已全落地;唯一已记录候选 = 23 章 NPC 顾客行为所需 Poisson 到达过程,需与顾客 System 同启,候选登记见 docs 24 分期计划引言末段)

## 方向性(无期限,出现真实需求再启;全量见 docs 02 后续方向)

- [ ] 游戏引擎 Adapter。解除条件:docs/engine-adapter-design.md §5 五个决策点(目标引擎 / schema 命名域 / 落点 crate 还是 CLI / 参考 importer 归属 / 回流是否入一期);设计已定(§2 取引擎无关 JSON 契约,§3 契约面六条),§5 未拍不开工
- [ ] Web API(仅当出现真实服务端需求,local-first 不预设;docs 02 MVP 明确不做「游戏服务器运行时」)
- [ ] GP 优化(按需;Bayesian 已拍板随机森林代理并落地,GP 留后续,见 docs 12)
- [ ] CI 平衡回归(docs 02 后续方向登记,无定义)
- [ ] 可视化系统图与策划工作流(docs 02 后续方向登记,无定义)

## 已完成(一行证据:hash + 测试/运行条数,过程细节见 desktop-package.yml 注释与 docs 18)

- [x] Windows msi 腿补进安装冒烟(2026-10-14,d789b37): run 38488806732 三腿绿,msi 段 exit 0、装点 alive 20s
- [x] 安装包安装+运行冒烟(2026-10-14,89ce5c1 + fcef016 + 5ea7076): run 38457041427 三腿绿,安装产物各 alive 20s
- [x] 桌面启动冒烟升 CI(f74bc98): run 38436094647 双腿绿,裸产物 alive 20s
- [x] 桌面安装包链路 CI(99b614f + 26e8c25): run 38420221169 三腿绿,三平台制品齐
- [x] 随机原语指针对账(2026-10-14,f77fb4d): docs:build 绿
- [x] 桌面 5-6 步解卡(2026-10-13,d8b5896 + 75b4e00): project.test.mjs 6 测 CI 接入
- [x] 复杂行为脚本阶段 3(2026-10-11,a1e1ac4 + 127da96 + d99a8a9): 21 pytest 测
- [x] query 守卫与路径字面量测试(33def8a): query.rs 6 测 + 桌面 lib.rs 7 测,CI 绿
- [x] 桌面无头冒烟升 CI 门(77bd901,cffb43d): Xvfb 截屏判定,runner 实证绿
- [x] pnpm overrides 三 pin(3b5528e): docs:build 绿
- [x] glib 0.20.0 评估(2026-10-11,e5399ba): parked,随 tauri 3 stable 一并抬
- [x] 文档一致性审计(2026-10-13,d092b0a): 三类差异 25 条已修,落表 docs/审计-文档一致性.md

验收:改动后 pnpm docs:build 过 / cargo check 过;测试绿才 push。
