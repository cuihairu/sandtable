# TODO

> 2026-10-13 整理:只留需求条目;完成项一行证据(commit hash + 测试数)。

## 待办(挂闸,需用户拍板才开工)

- [ ] 真实案例二期 + 模型校准。解除条件:用户提供真实运营数据与对标基准
- [ ] 桌面端投入。剩余:native 文件对话框 GUI 与三平台安装包的人工开窗验收(六步无头实证过;安装包构建链已就绪 desktop-package.yml + 本机 deb 实证,待 Windows / macOS 运行态,证据 docs 18 Phase 7)
- [ ] 随机函数扩展后续。解除条件:出现真实品类需求

## 方向性(无期限,出现真实需求再启)

- [ ] 游戏引擎 Adapter
- [ ] Web API(仅当出现真实服务端需求,local-first 不预设)

## 已完成(一行证据)

- [x] 桌面 5-6 步解卡(2026-10-13,d8b5896 + 75b4e00): on_download 下载接线 + 手输路径入口 + 打包项目按钮,六步无头走查全过,project.test.mjs 6 测 CI 接入
- [x] 复杂行为脚本阶段 3(2026-10-11): perf 报告 GO + DayHook + Python 绑定,21 pytest 测试
- [x] query 守卫与路径字面量测试(33def8a): query.rs 6 测 + 桌面 lib.rs 7 测,CI 绿
- [x] 桌面无头冒烟升 CI 门(77bd901,cffb43d): Xvfb 截屏判定,runner 实证绿
- [x] pnpm overrides 三 pin(3b5528e): vite 6.4.3 / katex 0.18.2 / esbuild 0.25.0,docs:build 绿
- [x] glib 0.20.0 评估(2026-10-11): parked,tauri 2.x 依赖面封顶 gtk ^0.18,随 tauri 3 stable 一并抬
- [x] 文档一致性审计(2026-10-13): 三类差异 25 条已修并落表 docs/审计-文档一致性.md

验收:改动后 pnpm docs:build 过 / cargo check 过;测试绿才 push。
