# TODO

> 2026-10-14 对账:挂闸条目逐条核对本仓 git log / docs 决策记录 / 测试现状;完成项一行证据(commit hash + 测试数)。

## 待办(挂闸:需用户拍板 / 等外部输入 / 人工验收才开工)

- [ ] 真实案例二期 + 模型校准。解除条件:用户提供真实运营数据与对标基准(2026-10-11 拍板挂起不立项;一期宝可梦用公开数值已跑通全链见 docs 21,二期要真实运营面数据与外部基准,仓内无此输入)
- [ ] 桌面端投入。**剩:人工开窗验收**——native 文件对话框 GUI 与 Windows / macOS 完整交互走查(需本机 GUI 环境,自动化断言已尽)。自动化链已覆盖:构建(三腿绿 run 38420221169 制品齐)→ 启动链(裸产物 20s 存活 run 38436094647)→ 安装包安装+运行(三平台 run 38457041427);证据 docs 18 Phase 7
- [ ] 随机函数扩展后续。解除条件:出现真实品类需求(24 章 7 项能力已全落地;唯一已记录候选 = 23 章 NPC 顾客行为所需 Poisson 到达过程,需与顾客 System 同启,候选登记见 docs 24 分期计划末行)

## 方向性(无期限,出现真实需求再启;全量见 docs 02 后续方向)

- [ ] 游戏引擎 Adapter。解除条件:docs/engine-adapter-design.md §5 五个决策点(目标引擎 / schema 命名域 / 落点 crate 还是 CLI / 参考 importer 归属 / 回流是否入一期);设计已定(§2 取引擎无关 JSON 契约,§3 契约面六条),§5 未拍不开工
- [ ] Web API(仅当出现真实服务端需求,local-first 不预设;docs 02 MVP 明确不做「游戏服务器运行时」)
- [ ] GP 优化(按需;Bayesian 已拍板随机森林代理并落地,GP 留后续,见 docs 12)
- [ ] CI 平衡回归(docs 02 后续方向登记,无定义)
- [ ] 可视化系统图与策划工作流(docs 02 后续方向登记,无定义)

## 已完成(一行证据)

- [x] 安装包安装+运行冒烟(2026-10-14,89ce5c1 + fcef016 + 5ea7076):三平台安装产物再跑 20s——Windows nsis /S + /D= 定目录 / macOS dmg -mountpoint 挂载拷贝 / Linux dpkg -i + Xvfb,制品先上传留排障件;run 38457041427 三腿绿(Win exit 0 → C:\st-install alive / mac /tmp/st-install .app alive / linux /usr/bin/sandtable-desktop pid=9466 alive)
- [x] 桌面启动冒烟升 CI(f74bc98):Windows / macOS 裸产物 20s 进程存活,兜 WebView2 / WKWebView 运行库与窗口创建 panic;run 38436094647 双腿 alive(Win pid=4544 / mac pid=3077)
- [x] 桌面安装包链路 CI(99b614f + 26e8c25):三平台矩阵 fail-fast 关 + wasm-pack 三连重试;run 38420221169 三腿绿制品齐(Win 36.8 MB / mac 46.5 MB / Linux 27 MB),不打 tag 不建 Release
- [x] 随机原语指针对账(2026-10-14,f77fb4d):23 章三处过期指针(误指 24 章「分期」)改指 7 项已落地清单 + todo 挂闸项;24 章分期计划末登记 Poisson 候选
- [x] 桌面 5-6 步解卡(2026-10-13,d8b5896 + 75b4e00): on_download 下载接线 + 手输路径入口 + 打包项目按钮,六步无头走查全过,project.test.mjs 6 测 CI 接入
- [x] 复杂行为脚本阶段 3(2026-10-11): perf 报告 GO + DayHook + Python 绑定,21 pytest 测试
- [x] query 守卫与路径字面量测试(33def8a): query.rs 6 测 + 桌面 lib.rs 7 测,CI 绿
- [x] 桌面无头冒烟升 CI 门(77bd901,cffb43d): Xvfb 截屏判定,runner 实证绿
- [x] pnpm overrides 三 pin(3b5528e): vite 6.4.3 / katex 0.18.2 / esbuild 0.25.0,docs:build 绿
- [x] glib 0.20.0 评估(2026-10-11): parked,tauri 2.x 依赖面封顶 gtk ^0.18,随 tauri 3 stable 一并抬
- [x] 文档一致性审计(2026-10-13): 三类差异 25 条已修并落表 docs/审计-文档一致性.md

验收:改动后 pnpm docs:build 过 / cargo check 过;测试绿才 push。
