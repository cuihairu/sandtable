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

## 2. 后续修复波(2026-11-01 更新:一问题一 commit,`fix(ui)` 前缀;四联格式:问题 / before / after / commit)

> 状态:✅ 已修(含 before/after 截图与 commit hash)/ ⏳ 待用户(需新素材或用户决策,报告标注)。截图存 `docs/review/shots-after/`,文件名对齐问题编号。

### T1 ✅ 已修 — `784695d`
- **问题**: 语言切换器标签在 390px 被截断为 “E”(≤760px 下全部 `command-trigger` 收成 30px 图标,`key-label` 整词 “English” 被压成 “E”)。
- **Before**: `docs/review/shots-after/T1-before.png`(390px,语言入口显示 “文 E” 截断)
- **After**: `docs/review/shots-after/T1-after.png`(390px,语言入口显示 “文 EN” 短码;1280px 宽屏仍显示完整 “English” 徽标不受影响)
- **Commit**: `784695d fix(ui): collapse language switcher to locale code on narrow screens`

### T2–T5 ⏳ 待用户

| # | 严重度 | 问题 | 定位 / 建议 | 状态 |
| --- | --- | --- | --- | --- |
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

## 6. 2026-11-01 修复波(缩放自适应;一问题一 commit,`fix(ui)` 前缀)

> 用户令:所有 UI 修复带同视图 before/after 截图成对,存 `docs/review/shots-after/`,文件名对齐问题编号;汇报四联:问题 / before / after / commit。

| # | 严重度 | 问题 | 定位 | before | after | commit |
| --- | --- | --- | --- | --- | --- | --- |
| U1 | 高 | 数据与导出页内容被固定 1000px 上限挤在左侧,1920/2560 宽窗右侧空置 ~650–1290px | `.wb-app .exchange-page{ padding:23px; max-width:1000px }` | `shots-after/U1-before.png` | `shots-after/U1-after.png` | `068041f` |

- **U1 证据**:修前 100%×2560 下 `.exchange-page` computed `width=1000px / max-width:1000px`,主区 2288px,右侧空置 1288px;修后 `width=2288px / max-width:none`。
- **缩放矩阵**:100%/125%/150% × 1280/1920/2560 共 9 组合,交换页 `pageW==mainW` 全通过(无挤中间):`shots-after/zoom-grid/z{zoom}-w{width}.png`。其余页(analysis/parameters/designer/runs)经全量 cap 扫描无像素上限,均满宽利用。
- **designer 排除**:`form-section` 1960px 系 `form-layout`(主列+侧轨网格)自然尺寸,非页面上限,不修。
- **parameters 排除**:`parameter-table` 在自身滚动容器内横向滚动(right 1419>1280 视口),页面无横向滚动条,属常规表格行为,不修。

## 7. 历史已修项截图补全(2026-11-01 用户令:已修缺截图=未完成)

> 用户令:每个 UI 修复须带同视图 before/after 截图成对,文件名对齐报告问题编号,汇报四联:问题 / before / after / commit。下列 1.1–1.5、T1 为旧波次已 commit、缺截图,本次以临时 worktree checkout 到各 fix 的父 commit 重建真 before(旧 HEAD 同视图为真 after)。

| # | 问题 | before | after | commit |
| --- | --- | --- | --- | --- |
| 1.1 | grid 模式因子表一行 5 格套 4 轨,Min/Max/Step 表头与输入格中心错位 | `shots-after/1.1-before.png` | `shots-after/1.1-after.png` | `a6e99ea` |
| 1.2 | 辅助文字整族灰对比度不达 AA(--wb-muted 对白 2.51–4.66:1) | `shots-after/1.2-before.png` | `shots-after/1.2-after.png` | `e95d198` |
| 1.3 | 窄屏主画布被全局 `main{max-width}` 规则裁切(content 右缘被切) | `shots-after/1.3-before.png` | `shots-after/1.3-after.png` | `7c9d361` |
| 1.4 | 1280 下三枚 234px 命令触发器塞爆应用栏,demo 徽标溢出视口 69px(右缘 1349) | `shots-after/1.4-before.png` | `shots-after/1.4-after.png` | `c1f3b43` |
| 1.5 | 命令搜索占位在 29px 触发器内换行到 3 行被裁 | `shots-after/1.5-before.png` | `shots-after/1.5-after.png` | `a6b48ae` |
| T1 | 390 窄屏语言切换器整词被裁为 “E” | `shots-after/T1-before.png` | `shots-after/T1-after.png` | `784695d` |

- **1.2 证据**(色差肉眼难辨,补计算值):面包屑/侧栏 `.muted` computed `rgb(102,119,126)→rgb(97,113,120)`,对白 4.66→5.07;按审计对最暗实际底 `#f2f5f6` 为 4.13→4.63(≥4.5 通过)。
- **1.4 证据**:徽标右缘 1349px(溢出)→ 1263px(图标化,视口内)。
- **1.5 证据**:搜索触发器占位由 3 行被裁 → 单行 ellipsis + `Ctrl K` kbd。
- **T1 证据**:390 下切换器文字 “E”(裁)→ “EN”(locale 短码,`aria-label`/`title` 保留全词)。
- 重建方法:临时 worktree(隔离,未碰主工作树)`git checkout <fix 的父 commit>` + 复用 apps/web/node_modules 软链 + vite dev :5201,Playwright 同视口截图;after 取自主工作树当前 HEAD(:5190)。
