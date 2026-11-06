# feat/xlsx-calibrate 验收记录(2026-11-07)

支链 `feat/xlsx-calibrate`(起点 be7fb4a,9 commit:72fcafa xlsx 读取层、
61bb5b5 MCP .xlsx 数据源、7de8450 docs、b0b4bac/8361e45 todo、54331bd core
守卫、0c87bb9/b0675bc/c8405c8 机器可用性措辞)经 codex -p luna 五轮审核后
合入 main。

其中 7 个功能 commit 已先经 PR #3 squash 合入 main(6b3db98,CI 全绿
run 42220348777);本次合并(edb34fb)带来审核整改的 6 个 fix/docs commit
(2fd8114、61a9a21、d89463e、1e0d6bd、b51c762、8277ef7、2b6007b、2c53cf5、
2517713,含两次 amend 前身 c9b33ec/d89463e)。

## 审核轮次与结论

| 轮 | 结论 | 要点 |
|---|---|---|
| 1 | FAIL(5 P1) | calamine Range.get 相对坐标致 B2 起步表错位;稀疏表内存;守卫误伤硬保底/全显式层表;文档过宽 |
| 2 | FAIL(3 P1) | 预算未含起点偏移(1×1 有效区域可展开 16384×1048576);校准入口固定 header_row=1;「兜底报错」与 sim.rs 实际截断语义不符 |
| 3 | FAIL(1 P1 + 1 P2) | featured_guarantee>0 配置绕过尾部守卫(g=1e6 定轨永不生效,触限概率趋近 1);文档对水平偏移描述过宽 |
| 4 | FAIL(1 P2) | 1/g 高估命中率(周期 g+1);无硬保底时期望 μ 被当确定下界(反例 g=1、base=1e-4、f=1e-100 边界放行,实际溢出 ≈ 101·e^{-100}) |
| 5 | FAIL(1 P1) | featured_guarantee=u64::MAX 时 g+1 整型溢出(debug panic / release 回绕绕过守卫) |
| 6 | **PASS,可合并** | 溢出边界封堵(saturating_add + f64 域),无新问题 |

最终守卫形态(config.rs validate):分支化可证明 ≤ e^{-100} 触限界——
有硬保底按确定 5★ 数 MAX/pity_hard(定轨必触发或直中尾部界);无硬保底
无定轨按 μ·f ≥ MAX×MIN_GACHA_TARGET_RATE;无硬保底有定轨按 Chernoff
(μ ≥ max(2(g+1), 800))。MIN_GACHA_TARGET_RATE 由 1e-6 收紧为 1e-4。

xlsx 读取层(xlsx.rs):绝对坐标换算(range.start() 偏移)、展开尺寸预算
MAX_XLSX_CELLS=2,000,000(含起点偏移);B2 起步与远端散点夹具锁定。
校准映射契约(文档 en/zh):表头必须在第 1 行;水平偏移可映射(区域外列
为无名空表头格),垂直偏移是读取层能力、映射不接受;往返声明改为
value-for-value(最短往返数值文本,不保留原始数字格式)。

## 门禁证据(本机,HEAD=2517713)

- cargo fmt --all --check 过;cargo clippy(改动三 crate --all-targets
  -D warnings)过;
- cargo test --workspace exit 0(core 229,含新增 xlsx 偏移/远端散点、
  gacha 尾部界、显式层表兼容测试);
- wasm32-unknown-unknown check 过;arrow / arrow+wasm check 过;
- parquet、duckdb+parquet feature 测试 exit 0(duckdb bundled 编译多次被
  本机外部 SIGTERM 打断,nice -j2 后完成);python 模板 py_compile 过。

## 合并与 CI

- merge commit edb34fb(合并树与分支顶 2517713 逐位一致,唯一冲突
  zh 09-data-output.md 取分支侧);远端分支 feat/xlsx-calibrate 已删,
  本地保留。
- CI run 42298593073(merge edb34fb):test / Web 构建(wasm+前端) /
  桌面无头冒烟 三 job 全 success;Deploy Docs run 42298593168 success。
  链接:https://github.com/cuihairu/sandtable/actions/runs/42298593073
