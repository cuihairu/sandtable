# 2026-10-31 UI 审核(impeccable):sandtable workbench

> 方法:impeccable v4.8.0 `audit/critique` + Playwright 真机渲染 + 全页对比度扫描(WCAG 1.4.3,普通文字 ≥4.5:1、大字 ≥3:1)+ 计算样式/几何探针。
> 范围:`apps/web` workbench 全部 5 个页面(analysis / parameters / designer / runs / exchange)+ legacy + prototype,桌面 1280×800 与窄屏 390×760。
> 无登录页:本仓是 local-first demo,无鉴权网关,演示模式直接进入 workbench(无凭据门槛)。
> 设计基线:**无 `DESIGN.md` / `PRODUCT.md`**;视觉方向仅在 `design-system/sandtable/MASTER.md` 以 token 表形式局部固化。

## 0. 整体 critique(不留情面)

这是一台高密度的 Operate 模式工具,骨架是对的:空态有图标 + 文案 + CTA,动效克制并尊重 `prefers-reduced-motion`,i18n 双语齐全,token 有 `tokens.test.mjs` 兜底。但它的执行纪律在“1600px 自查截图”和“1280px 真实使用”之间明显断层,暴露出三类系统性问题:

1. **色彩纪律溃败(最严重)**。辅助文字不是一两处偏浅,而是整族 muted 色落在 2.5–4.5:1 的不达标区间——`--wb-muted` token 加 10 处散落字面量、1 处内联色,全在 AA 线以下。这不是疏忽,是设计系统里“辅助灰”整族没有被 AA 预算约束过,token 锁了取值却没锁对比度。
2. **布局以“开发机视口”为中心**。应用栏三枚固定 234px 命令触发器把 1280px 塞爆:demo 徽标溢出视口 69px、命令搜索占位换行到 3 行再被 29px 高度裁切。能跑 ≠ 对。
3. **迁移残留与声明失配**。V2 画布被全局 `main{max-width:1020px;margin:0 auto}` 漏斗套住(旧 Phase 页面规则串台);因子表 grid 声明 4 轨、grid 模式一行却有 5 格,Min/Max/Step 表头与输入格错位。

好在这些都是“最小、可定位、可验证”的坏损——五处当场修复(见下),其余列为 todo。修完后六个页面全页对比度扫描 **0 失败**,应用栏几何无重叠、无溢出,因子表表头/输入中心严格对齐。

## 1. 已修(坏损,当场最小修复,一问题一 commit)

### 1.1 [高] 因子表 grid 模式列错位 — `a6e99ea`

- **现象**:designer 页“Factors and ranges (kernel mode grid)”表,表头 Min/Max/Step 与下方输入格水平中心错开。
- **根因**:`FactorTable.tsx` grid 模式一行渲染 5 格(path / min / max / step / remove),而 `.factor-grid` 模板只声明 4 轨(`repeat(4, …)`),格子自动换行,列心对不齐。
- **证据**(几何探针):修复后表头 Min/Max/Step 中心 = 539/665/790,输入格中心 = 539/665/790,严格一致;grid 模板 `177.812px 118.547px × 4`。
- **定位**:`src/workbench/designer/FactorTable.tsx` + `.factor-grid`(base 与 narrow media)。
- **修复**:两处 grid 模板 3→4 轨。

### 1.2 [高] 辅助文字对比度不达 WCAG AA — `e95d198`

- **现象**:全页扫描抓到 20+ 处辅助文字 < 4.5:1,最差 `#96a6ad`(面包屑 `/`)对白仅 2.51:1。
- **根因**:`--wb-muted: #66777e` 及 10 处散落字面量、1 处 `FactorTable.tsx` 内联色,整族辅助灰未按 AA 预算选值。
- **证据**:修复后六页全页扫描 FAILURES: 0(analysis/parameters/designer/runs/exchange/legacy 均 0)。
- **定位**:`src/tokens.css` `--wb-muted`、`src/workbench/workbench.css` 10 处字面量、`FactorTable.tsx:139` 内联。
- **修复**:`--wb-muted #66777e → #617178`(对最暗实际底 `#f2f5f6` 保 4.63:1,余量足),并按各自最暗底把 10 处字面量与 1 处内联色压到 ≥4.5:1 + 余量;token 沿 `tokens.css` / `public/prototype/workbench.css :root` / `design-system/sandtable/MASTER.md` / `tests/tokens.test.mjs` 四处锁步同改,守卫测试同步不红。

### 1.3 [中] 窄屏画布被全局 `main` 规则裁切 — `7c9d361`

- **现象**:窄屏下主画布被限制、居中并裁切内容(旧 Phase 页面 `main{}` 泄漏到 V2 `.main-area`)。
- **根因**:`src/index.css` 的 `main { max-width: 1020px; margin: 0 auto; padding: 24px 16px 48px; }` 是旧界面全局规则,`.main-area` 命中 `main` 元素后被套了“收缩自适应 + 居中 + overflow:hidden”。
- **定位**:`src/index.css` `main` 规则 → `.main-area`。
- **修复**:`.wb-app .main-area` 中和掉泄漏(max-width:none、margin:0、padding:0),narrow 下加 `overflow-x:auto` 本地滚动。

### 1.4 [中] Demo 徽标溢出应用栏 — `c1f3b43`

- **现象**:1280px 下演示徽标右缘到 1349px,溢出视口 69px 被裁。
- **根因**:应用栏三枚固定 234px 命令触发器 + 其它控件,总量超 1280px。
- **定位**:`components/AppBar.tsx` `.prototype-label` + `.prototype-label` CSS。
- **修复**:`<1500px` 徽标收敛为图标化(圆点 + info 图标),文字以 `text-overflow` 收起,保留 `aria-label`/`title`;徽标本体 `flex-shrink:0` 不再被裁。修复后 1280 徽标右缘 1263px(在视口内),1600 全文显示。

### 1.5 [中] 命令搜索占位换行并被裁 — `a6b48ae`

- **现象**:应用栏“Search params and commands…”占位在 29px 高的触发器内换行到 3 行,被裁断。
- **根因**:`.command-trigger` 固定宽、flex 项无法收缩到 min-content 以下,长占位被迫换行。
- **定位**:`src/workbench/workbench.css` `.command-trigger` 及其子 `span`/`kbd`。
- **修复**:标签 `white-space:nowrap + text-overflow:ellipsis`、`min-width:0`(kbd 同理单行),沿用徽标的“渐进披露”思路;修复后占位单行截断、无裁切,应用栏无重叠。

## 2. 后续修复波(2026-10-31 更新:一问题一 commit,`fix(ui)` 前缀)

> 状态:✅ 已修(含 commit hash)/ ⏳ 待用户(需新素材或用户决策,报告标注)。

| # | 严重度 | 问题 | 定位 / 建议 | 状态 |
| --- | --- | --- | --- | --- |
| T1 | 低 | 语言切换器标签在 390px 被截断为 “E” | `LanguageSwitcher.tsx`;窄屏显示 locale 短码(`EN`/`中`)而非整词截断 | ✅ 已修 `784695d` |
| T2 | 低 | 应用栏根因仍拥挤:三枚 234px 固定宽命令触发器把 bar 塞满,修复是“渐进披露”治标 | `AppBar.tsx` + `.command-trigger`;建议把低频命令收进溢出菜单,或让触发器自适应内容宽 | ⏳ 待用户(应用栏模式是设计决策:统一固定宽 vs 溢出菜单) |
| T3 | 信息 | 缩放/平移手感待真机走查(rAF 合流已在 `ee36e71` 埋点,未在真机验收) | 图表缩放交互 | ⏳ 待用户(需真机/触控走查) |
| T4 | 信息 | **缺 `DESIGN.md` / `PRODUCT.md`**;视觉方向仅 `MASTER.md` token 表局部固化 | 建议补 `impeccable document` 生成 DESIGN.md,把层级/字阶/动效口径固化,否则后续改版缺对照 | ⏳ 待用户(设计口径文档属设计决策) |
| T5 | 信息 | 执行内核并发测试(batch queue FIFO / 并发调度)预存 flaky,随机器负载在 0–5 之间抖动,与本轮 UI 修复无关(CSS 改动无法触及执行逻辑;干净 HEAD 同样抖) | `tests/execution.test.mjs`;建议独立成带重试/确定性时钟的子集,不阻塞 UI 审核门禁 | ⏳ 待用户(测试基建决策,非 UI 修复) |

## 3. 值得肯定

- **空态**是亮点:runs 页“无任务”给出图标 + “No tasks right now” + “Configure an experiment” CTA;analysis 页空结果有明确引导文案;不是一片空白。
- **动效克制**且尊重 `prefers-reduced-motion`(扫描到 `transition:none !important` / `animation:none !important` 兜底),仅保留 0.12–0.25s 的状态过渡 + 一条 toast 动画。
- **i18n** 双语齐全,语言切换即时生效;**token** 由 `tokens.test.mjs` 锁步守卫,原型/设计系统/tokens.css 不会静默漂移。

## 4. 门禁

- 测试:`node --test tests/tokens.test.mjs tests/workbench-dom.test.mjs tests/workbench-ids.test.mjs tests/workbench-locale.test.mjs tests/i18n.test.mjs` → 46/46 通过(本轮所触及文件)。
- 执行内核并发测试存在预存 flaky(见 T5),负载相关、干净 HEAD 亦复现,非本轮引入;CSS/token 改动不触及执行逻辑。
- 对比度:六页全页扫描 0 失败(见 1.2)。

## 5. 截图与探针

截图目录(临时,未入库):`/tmp/ui-audit-sandtable/` — `rep-analysis-1280/390.png`、`rep-designer-1280/390.png`、`rep-runs-1280.png`、`rep-parameters-1280.png`、`rep-exchange-1280.png`、`final-appbar.png`。几何/对比度探针脚本:`/tmp/a11ycheck.mjs`、`/tmp/bar.mjs`、`/tmp/fact3.mjs`、`/tmp/srch.mjs`。
