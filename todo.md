# TODO

> 生成于 2026-10-11（无 todo 文件，来源：docs/guide/18-roadmap.md「后续方向」+ 依赖告警）。

## 挂闸项（需用户拍板才开工）
- [ ] 复杂行为脚本 阶段 3（Python 载体，rhai 缓议；阶段 0-2 已落地 2026-10-11）
- [ ] 真实案例二期 + 模型校准（已裁「挂起不立项」——需真实运营数据与对标基准，属用户侧输入，待触发）
- [ ] 桌面端投入（维持挂闸门后）：实验流 GUI **人工开窗验收未做**（Phase 7 状态）
- [ ] 随机函数扩展后续（24 章 7 项已全部落地，后续增量按需）

## 方向性（无期限，出现真实需求再启）
- [ ] 游戏引擎 Adapter
- [ ] Web API（仅当出现真实服务端需求，local-first 不预设）

## 依赖告警（dependabot）
- [ ] pnpm 侧 overrides：vite → 6.4.3、katex → 0.18.2、esbuild → 0.25.0（三者均由 vitepress/mermaid 传递引入）
- [ ] cargo 侧 glib 0.18.5 → 0.20.0（需评估 gtk 栈整体抬升与 tauri 关系，抬不动如实报方案）

验收：改动后 `pnpm docs:build` 过 / `cargo check` 过；测试绿才 push。
