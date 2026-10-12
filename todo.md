# TODO

> 生成于 2026-10-11(无 todo 文件,来源:docs/guide/18-roadmap.md「后续方向」+ 依赖告警)。
> 2026-10-11 账面复核:依赖告警两项关闭(一项落地、一项评估完毕 parked),挂闸项与方向项维持,解除条件逐条写明。
> 2026-10-12 巡检复核:五项未完触发条件均未出现——真实案例无用户侧运营数据入仓、桌面端 GUI 人工开窗未执行(验收清单已备,见 docs 18 Phase 7 照表执行)、无真实品类需求(随机函数)、无真实服务端需求(Adapter/Web API);维持挂闸。
> 2026-10-13 巡检增量:桌面端第 1-4 步已无头点击实证(1 仿真/2+3 扫描与推荐/4 会话内 SQL),抓到并修掉三个真 bug:Web 宝可梦 SIM 预设缺 behavior 块(补齐+预设守卫入 CI)、查询面板渲染期异常整页白屏(补顶层 ErrorBoundary)、WebKit 下 Arrow Int64 列 ToBigInt throw(days 建表整列转 DOUBLE);ToBigInt 边界补纯函数守卫(columns.ts 抽出 + node --test 入 CI,项目 CSV 载入同款风险一并关闭);5-6 步(native 文件对话框/下载项目包)卡点实证——GTK file chooser 无头自动化不可行(ctrl+l 不生效/键盘事件不投递/对话框 unmap/windowfocus BadMatch),底层 DuckDB 已有单测,需人工开窗验收。

## 挂闸项(需用户拍板才开工)

- [x] 复杂行为脚本 阶段 3(Python 载体,rhai 缓议;阶段 0-2 已落地 2026-10-11)——**全批落地(2026-10-11)**:第一批 = 性能实测报告([scripting-perf-report.md](https://github.com/cuihairu/sandtable/blob/main/scripts/scripting-perf-report.md):日粒度 chunk GO,30 天挂满单列 ≈3%/五列 ≈20% 基线;事件级红线数据反向证实维持);第二批 = 读态日钩子接线(core `DayHook` + Python `run_with_day_hook`,只读不改结果,pytest 对账锁死)。边界:事件级回调红线维持;Pyodide 维持「前端独立实验,不承诺」;numpy/Arrow 零拷贝留按需;rhai 维持缓议
- [ ] 真实案例二期 + 模型校准(已裁「挂起不立项」)。解除条件:用户提供真实运营数据与对标基准(属用户侧输入,待触发)
- [ ] 桌面端投入(维持挂闸门后)。解除条件:实验流 GUI **人工开窗验收完成**(Phase 7 状态;验收清单已备 2026-10-12,docs 18 Phase 7 六步照表执行;无头冒烟已过 2026-10-12——`bash scripts/desktop_smoke.sh`,启动链 + UI 渲染实证,顺带修掉清单原启动命令的 devUrl 坑;**第 1-4 步无头点击已过 2026-10-13**——抓到并修掉三真 bug:宝可梦 SIM 预设漂移(+守卫入 CI)/查询白屏(+ErrorBoundary)/WebKit ToBigInt(days 转 DOUBLE),5-6 步卡点:GTK file chooser 无头自动化不可行,需人工开窗)
- [ ] 随机函数扩展后续(24 章 7 项已全部落地,后续增量按需)。解除条件:出现真实品类需求

## 方向性(无期限,出现真实需求再启)

- [ ] 游戏引擎 Adapter
- [ ] Web API(仅当出现真实服务端需求,local-first 不预设)

## 依赖告警(dependabot)

- [x] pnpm 侧 overrides:vite → 6.4.3、katex → 0.18.2、esbuild → 0.25.0(三者均由 vitepress/mermaid 传递引入)——**已生效并复验(2026-10-11,`3b5528e`)**:package.json `pnpm.overrides` 三 pin 在位,锁解析图只含 pin 版(store 内 vite@5.4.21 / katex@0.16.47 / esbuild@0.21.5 为历史残留,不在锁文件),`pnpm install --frozen-lockfile` + `pnpm docs:build` 绿;Dependabot #3/#4/#5 随 pin 转 fixed
- [x] cargo 侧 glib 0.18.5 → 0.20.0(需评估 gtk 栈整体抬升与 tauri 关系,抬不动如实报方案)——**评估完毕:抬不动,parked(2026-10-11)**:`cargo update -p glib --precise 0.20.0` 被 cargo 拒——`gtk 0.18.2 ← tauri 2.12.2 ← sandtable-desktop` 要求 `glib ^0.18`,tauri 2.x 线依赖面封顶 `gtk ^0.18`(stable 顶格 2.12.2,3.0 仍 alpha.4);方案 = tauri 3.0 stable 且依赖面出现 gtk 0.20 栈时随桌面大版本一并抬;Dependabot #7(medium)维持 open,不 force 抬升

验收:改动后 `pnpm docs:build` 过 / `cargo check` 过;测试绿才 push。
