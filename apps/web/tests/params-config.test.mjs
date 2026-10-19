// WB-05 · 参数表接真实配置(节点侧守卫):
// - 注册表镜像与 registry.rs 逐条锁漂移(05.01);
// - kind → 编辑方式、只读类型与高级编辑口径(05.02);
// - 基线/候选读真实 YAML、缺值不回退默认(05.03);
// - 单元格提交解析四态(05.04/05.05 的逻辑面,快捷键在组件层 ParamTable.tsx);
// - 前端基础检查 + 内核完整校验与错误定位(05.06/05.07);
// - 绝对/相对变化、基线 0 不给百分比(05.08);
// - 搜索三字段口径与语言切换保留输入(05.09);
// - 分组/只看变更/只看错误/可见项全选(05.10);
// - 批量倍率先预览整批再一次性应用(05.11);
// - 单项/批量/恢复统一撤销重做历史(05.12,reducer 级);
// - 结构化编辑同步 YAML、高级 YAML 语法错误保留原文(05.13);
// - 保存/运行冻结已校验版本,后续编辑不影响(05.14,reducer 级);
// - YAML round-trip 保留 damage_model/loot/公式/未编辑结构(05.15)。
// 跑法(仓库根):node --test apps/web/tests/params-config.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import { PARAM_REGISTRY, registryParam, displayParamName, paramGroups } from '../src/workbench/params/paramRegistry.ts'
import {
  parseConfig, applyParamEdit, applyParamEdits, readNumeric, readText, hasParam,
  removeParam, restoreParam, numericValuesOf, paramDelta, locateKernelError, buildDefaultYaml,
} from '../src/workbench/params/configYaml.ts'
import {
  buildRowModels, validateParam, parseCellInput, kernelCheck, visibilityFilter, bulkPreview,
} from '../src/workbench/params/paramsLogic.ts'

const REPO_ROOT = new URL('../../../', import.meta.url).pathname

/* ————— 05.01 注册表全量(与 registry.rs 锁漂移) ————— */

test('WB-05.01 注册表镜像与 registry.rs 逐条一致(路径数 + 四字段)', () => {
  const src = readFileSync(`${REPO_ROOT}crates/sandtable-core/src/registry.rs`, 'utf8')
  // 提取 spec("path", Kind, "default", "desc")——多行调用逐字匹配
  const specs = [...src.matchAll(/spec\(\s*"([^"]+)"\s*,\s*(\w+)\s*,\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\)/g)]
  assert.ok(specs.length >= 60, `registry.rs 应有大量注册项,实际 ${specs.length}`)
  assert.equal(PARAM_REGISTRY.length, specs.length, 'TS 镜像条数与 registry.rs 一致')
  for (const [i, [, path, kind, def, desc]] of specs.entries()) {
    const mirror = PARAM_REGISTRY[i]
    const kinds = { U32: 'u32', U64: 'u64', I64: 'i64', F64: 'f64', Dur: 'dur', Mix: 'mix', Expr: 'expr', Table: 'table' }
    assert.equal(mirror.path, path, `第 ${i + 1} 项路径漂移`)
    assert.equal(mirror.kind, kinds[kind], `${path} kind 漂移`)
    assert.equal(mirror.default, def, `${path} 默认值漂移`)
    assert.equal(mirror.desc, desc, `${path} 描述漂移`)
  }
  // 注册表默认配置:全部数值默认项可解析(演示基线来源)
  const parsed = parseConfig(buildDefaultYaml())
  assert.equal(parsed.errors.length, 0)
  const numericKinds = new Set(['u32', 'u64', 'i64', 'f64', 'mix'])
  const expectNumeric = PARAM_REGISTRY.filter((p) => numericKinds.has(p.kind) && p.default !== '—').length
  assert.equal(Object.keys(numericValuesOf(parsed)).length, expectNumeric)
})

test('WB-05.01 参数表行模型 = 注册表全量 × 配置 YAML(移除 18 项原型口径)', () => {
  const yaml = [
    "schema_version: '1'",
    'scenario:',
    '  population: 500',
    'model:',
    '  warrior:',
    '    attack: 30',
  ].join('\n')
  const rows = buildRowModels(parseConfig(yaml), parseConfig(yaml))
  assert.equal(rows.length, PARAM_REGISTRY.length, '全量注册项入表')
  // 当前配置读取:写了的取配置值,没写的如实缺值
  const attack = rows.find((r) => r.def.path === 'model.warrior.attack')
  const population = rows.find((r) => r.def.path === 'scenario.population')
  const gacha = rows.find((r) => r.def.path === 'model.gacha.base_rate')
  assert.equal(attack.baseline.num, 30)
  assert.equal(population.baseline.num, 500)
  // 缺值不回退默认(0.02 是注册表默认,但配置没写 → present=false)
  assert.equal(gacha.baseline.present, false)
  assert.equal(gacha.baseline.num, undefined)
})

/* ————— 05.02 kind → 编辑方式 ————— */

test('WB-05.02 数值类型可编辑;dur/expr/table 只读(高级编辑入口)', () => {
  const yaml = buildDefaultYaml()
  const rows = buildRowModels(parseConfig(yaml), parseConfig(yaml))
  for (const kind of ['u32', 'u64', 'i64', 'f64', 'mix']) {
    assert.ok(rows.filter((r) => r.def.kind === kind).every((r) => r.editable), `${kind} 应可编辑`)
  }
  for (const kind of ['dur', 'expr', 'table']) {
    assert.ok(rows.filter((r) => r.def.kind === kind).every((r) => !r.editable), `${kind} 只读`)
  }
  // 组件口径证据(高级编辑入口由组件渲染):编辑方式判定只在逻辑层
  const damageModel = rows.find((r) => r.def.path === 'model.combat.damage_model')
  const duration = rows.find((r) => r.def.path === 'scenario.duration')
  const formula = rows.find((r) => r.def.path === 'model.formulas.xp_needed')
  assert.equal(damageModel.editable, false)
  assert.equal(duration.editable, false)
  assert.equal(formula.editable, false)
})

/* ————— 05.03 基线/候选列读真实文档,缺值不回退 ————— */

test('WB-05.03 基线列与候选列各读各的 YAML;候选缺值不显示默认值', () => {
  const base = parseConfig('scenario:\n  population: 1000\nmodel:\n  warrior:\n    attack: 100\n')
  const cand = parseConfig('scenario:\n  population: 1000\nmodel:\n  warrior:\n    attack: 120\n')
  const rows = buildRowModels(base, cand)
  const attack = rows.find((r) => r.def.path === 'model.warrior.attack')
  assert.equal(attack.baseline.num, 100)
  assert.equal(attack.candidate.num, 120)
  assert.equal(attack.modified, true)
  // 候选删掉 attack → 候选缺值(不给 100 也不给默认 100),修改状态 = 值消失
  const withoutAttack = removeParam('scenario:\n  population: 1000\nmodel:\n  warrior:\n    attack: 100\n', cand, 'model.warrior.attack')
  assert.equal(withoutAttack.ok, true)
  const rows2 = buildRowModels(base, parseConfig(withoutAttack.yaml))
  assert.equal(rows2.find((r) => r.def.path === 'model.warrior.attack').candidate.present, false)
  assert.equal(rows2.find((r) => r.def.path === 'model.warrior.attack').modified, true)
})

/* ————— 05.04/05.05 单元格缓冲与提交 ————— */

test('WB-05.04 单元格输入解析:未提交缓冲 → 非法/空/可提交三态分明', () => {
  const def = registryParam('model.warrior.attack')
  const empty = parseCellInput('  ', def)
  assert.equal(empty.state, 'empty')
  const bad = parseCellInput('abc', def)
  assert.equal(bad.state, 'invalid')
  const nonInt = parseCellInput('1.5', def)
  assert.equal(nonInt.state, 'invalid')
  const ok = parseCellInput(' 42 ', def)
  assert.equal(ok.state, 'ok')
  assert.equal(ok.text, '42')
  // 非法输入保留待修复的责任在组件(缓冲不清空):parseCellInput 不产生写入
})

test('WB-05.05 提交路径:成功写入候选 YAML,失败返回错误且不改候选', () => {
  const yaml = buildDefaultYaml()
  const cand = yaml
  const def = registryParam('model.combat.p_hit')
  const bad = parseCellInput('1.5', def)
  assert.equal(bad.state, 'invalid')
  // 组件层 onCommit 只在 ok 时 applyParamEdit(见 ParamTable.tsx commit);
  // 逻辑层锁定:ok 输入产生一次替换,注释与结构保留
  const ok = parseCellInput('0.9', def)
  assert.equal(ok.state, 'ok')
  const applied = applyParamEdit(cand, parseConfig(cand), def.path, ok.text)
  assert.equal(applied.ok, true)
  assert.equal(readNumeric(parseConfig(applied.yaml), def.path), 0.9)
  assert.ok(applied.yaml.includes('# 参数表内置基线'))
})

/* ————— 05.06 前端基础检查 + 内核完整校验 ————— */

test('WB-05.06 前端基础检查:有限数/整数域/无符号/概率/权重', () => {
  const attack = registryParam('model.warrior.attack')
  const maxRounds = registryParam('model.combat.max_rounds')
  const pHit = registryParam('model.combat.p_hit')
  const seed = registryParam('scenario.seed')
  const mix = registryParam('scenario.population_mix.casual')
  const rateMult = registryParam('model.loot.rate_mult')
  assert.equal(validateParam(attack, Number.NaN), '请输入有限数值')
  assert.equal(validateParam(attack, 1.5), '需要安全范围内的整数')
  assert.equal(validateParam(maxRounds, -1), '范围为 0–4294967295')
  assert.equal(validateParam(maxRounds, 4294967296), '范围为 0–4294967295')
  assert.equal(validateParam(pHit, 1.2), '概率范围为 0–1')
  assert.equal(validateParam(seed, 2 ** 53), '超出 JS 安全整数上限,请改用高级 YAML 编辑')
  assert.equal(validateParam(mix, 1.5), '权重范围为 0–1')
  assert.equal(validateParam(rateMult, -0.1), '')
  assert.equal(validateParam(attack, -5), '')
})

test('WB-05.06 文本级 u64 大整数明确拒绝(Number 会静默舍入)', () => {
  const seed = registryParam('scenario.seed')
  const big = parseCellInput('9007199254740993', seed) // 2^53+1:JS Number 读成 ...992
  assert.equal(big.state, 'invalid')
  assert.match(big.error, /安全整数/)
  const edge = parseCellInput(String(Number.MAX_SAFE_INTEGER), seed)
  assert.equal(edge.state, 'ok')
})

test('WB-05.06 内核完整校验(ok/失败)经统一入口', async () => {
  const good = await kernelCheck('yaml', async () => ({ config_hash: 'abc' }))
  assert.equal(good.ok, true)
  assert.equal(good.info.config_hash, 'abc')
  const bad = await kernelCheck('yaml', async () => {
    throw '配置错误: model.combat.p_hit: 概率必须在 [0, 1]'
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.path, 'model.combat.p_hit')
  assert.match(bad.message, /概率必须在/)
})

/* ————— 05.07 内核失败定位参数 ————— */

test('WB-05.07 内核错误定位参数与单元格;定位不到时如实返回 null', () => {
  assert.equal(locateKernelError('配置错误: model.combat.p_hit: 概率必须在 [0, 1]'), 'model.combat.p_hit')
  // 长路径优先(最具体定位)
  assert.equal(locateKernelError('model.loot.tables: 表名不能为空'), 'model.loot.tables')
  assert.equal(locateKernelError('p_stall 必须不小于 p_base'), null)
  // 表格状态列 + 待修复输入保留由组件承载(ParamTable.tsx kernelError 徽标,
  // onCommit 失败不清缓冲);store 侧记录定位结果
})

/* ————— 05.08 基线差异 ————— */

test('WB-05.08 绝对/相对变化;基线为 0 不给无穷百分比', () => {
  assert.deepEqual(paramDelta(100, 110), { abs: 10, rel: '+10.0%', text: '+10(+10.0%)' })
  assert.deepEqual(paramDelta(100, 90).rel, '-10.0%')
  assert.equal(paramDelta(0, 5).rel, null, '基线 0 不给百分比')
  assert.equal(paramDelta(0, 5).text, '+5')
  assert.equal(paramDelta(0, -5).text, '-5')
  assert.equal(paramDelta(50, 50).text, '—')
  assert.equal(paramDelta(undefined, 5).text, '—', '缺值不给变化')
})

/* ————— 05.09 搜索口径与语言切换 ————— */

test('WB-05.09 搜索匹配路径/原始描述/当前语言显示名;语言切换不丢输入', () => {
  const yaml = buildDefaultYaml()
  const rows = buildRowModels(parseConfig(yaml), parseConfig(yaml))
  const base = { group: 'all', changedOnly: false, errorsOnly: false, invalidPaths: new Set() }
  // 路径
  assert.ok(visibilityFilter(rows, { ...base, search: 'p_hit_monster', locale: 'zh-CN' }).length > 0)
  // 原始描述(zh)
  assert.ok(visibilityFilter(rows, { ...base, search: '怪物命中', locale: 'zh-CN' }).length > 0)
  // 当前语言显示名(en)
  assert.ok(visibilityFilter(rows, { ...base, search: 'Monster hit', locale: 'en-US' }).length > 0)
  // zh 下 en 名不参与(证明"当前语言"生效)
  assert.equal(visibilityFilter(rows, { ...base, search: 'Monster hit', locale: 'zh-CN' }).length, 0)
  // 显示名解析
  assert.equal(displayParamName('model.combat.p_hit_monster', 'en-US'), 'Monster hit chance')
  assert.equal(displayParamName('model.combat.p_hit_monster', 'zh-CN'), '怪物命中概率')
  // 语言切换保留搜索输入:唯一改写 paramSearch 的动作是 param/search(见 reducer)
})

/* ————— 05.10 分组/只看变更/只看错误/可见项全选 ————— */

test('WB-05.10 分组、只看变更、只看错误与可见项全选口径', () => {
  const base = parseConfig('model:\n  warrior:\n    attack: 100\n  gacha:\n    base_rate: 0.5\n')
  const cand = parseConfig('model:\n  warrior:\n    attack: 200\n  gacha:\n    base_rate: 0.5\n')
  const rows = buildRowModels(base, cand)
  const opts = { search: '', changedOnly: false, errorsOnly: false, invalidPaths: new Set(), locale: 'zh-CN' }
  assert.ok(visibilityFilter(rows, { ...opts, group: 'all' }).length === PARAM_REGISTRY.length)
  // WB-11.12:分组键改稳定英文键,显示名走词典(paramGroupLabel)
  assert.ok(visibilityFilter(rows, { ...opts, group: 'combat' }).every((r) => r.group === 'combat'))
  const changedOnly = visibilityFilter(rows, { ...opts, group: 'all', changedOnly: true })
  assert.deepEqual(changedOnly.map((r) => r.def.path), ['model.warrior.attack'])
  // 只看错误(内核失败定位路径集合)
  const invalid = new Set(['model.warrior.attack'])
  const errorsOnly = visibilityFilter(rows, { ...opts, group: 'all', errorsOnly: true, invalidPaths: invalid })
  assert.deepEqual(errorsOnly.map((r) => r.def.path), ['model.warrior.attack'])
  // 全选只作用于可见项:可见 = 战斗分组(组件 onSelectAll 用 visible 集合)
  const visibleCombat = visibilityFilter(rows, { ...opts, group: 'combat' })
  assert.ok(visibleCombat.length > 0 && visibleCombat.length < PARAM_REGISTRY.length)
  // 分组来自注册表派生(稳定键)
  assert.ok(paramGroups().includes('combat') && paramGroups().includes('gacha'))
})

/* ————— 05.11 批量倍率:先预览整批,再一次应用 ————— */

test('WB-05.11 批量预演整批校验;任一失败不产生写入表', () => {
  const yaml = buildDefaultYaml()
  const rows = buildRowModels(parseConfig(yaml), parseConfig(yaml))
  // 1.3 倍把 p_hit 推过 1 → 整批失败,edits 不完整(不应用)
  const bad = bulkPreview(rows, ['model.warrior.attack', 'model.combat.p_hit'], 1.3)
  assert.equal(bad.ok, false)
  assert.ok(bad.rows.find((r) => r.path === 'model.combat.p_hit').error !== '')
  // 0.9 倍:两项都过,整批一次写入
  const good = bulkPreview(rows, ['model.warrior.attack', 'model.combat.p_hit'], 0.9)
  assert.equal(good.ok, true)
  assert.equal(good.edits.length, 2)
  const applied = applyParamEdits(yaml, good.edits)
  assert.equal(applied.ok, true)
  assert.equal(readNumeric(parseConfig(applied.yaml), 'model.warrior.attack'), 90)
  assert.equal(readNumeric(parseConfig(applied.yaml), 'model.combat.p_hit'), 0.765)
  // 未勾选 / 非法倍率:整体级失败
  assert.equal(bulkPreview(rows, [], 1.1).ok, false)
  assert.equal(bulkPreview(rows, ['model.warrior.attack'], -1).ok, false)
  // 结构参数不进批量数值通道
  const tableOnly = bulkPreview(rows, ['model.loot.tables'], 2)
  assert.equal(tableOnly.ok, false)
  assert.match(tableOnly.rows[0].error, /不进数值批量通道/)
})

/* ————— 05.12/05.14 reducer:统一撤销/重做历史 + 冻结版本 ————— */

// workbenchStore 在模块顶层读 window(深链/本地草稿)——节点侧给最小替身,
// 且必须覆盖「import 求值 → 断言」全程(模块顶层 initialState 会读 window)。
function fakeWindow() {
  const store = {}
  globalThis.window = {
    location: { hash: '' },
    history: { replaceState: () => {} },
    localStorage: {
      getItem: (k) => store[k] ?? null,
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] },
    },
  }
  return () => { delete globalThis.window }
}

test('WB-05.12 单项编辑/批量/恢复单项/恢复全部 → 同一条撤销/重做历史', async () => {
  const restore = fakeWindow()
  try {
    const { reduce, paramYamlView } = await import('../src/workbench/state/workbenchStore.ts')
    let s = reduce({ ...baseState() }, { type: 'param/write', yaml: yamlWith('model.warrior.attack', '111') })
    s = reduce(s, { type: 'param/write', yaml: yamlWith('model.warrior.attack', '112') }) // 单项
    s = reduce(s, {
      type: 'param/write',
      yaml: applyParamEdits(s.paramDraft.yaml, [
        { path: 'model.combat.p_hit', text: '0.9' },
        { path: 'model.combat.dmg_var', text: '20' },
      ]).yaml,
    }) // 批量 = 一条历史
    s = reduce(s, { type: 'param/reset-one', path: 'model.warrior.attack' }) // 恢复单项 = 一条历史
    s = reduce(s, { type: 'param/reset-all' }) // 恢复全部 = 一条历史
    assert.equal(paramYamlView(s).cand, paramYamlView(s).base, '恢复全部后候选=基线')
    // 逆序撤销四步
    s = reduce(s, { type: 'param/undo' }) // 撤销 reset-all → 回到恢复单项后
    assert.equal(readNumeric(parseConfig(paramYamlView(s).cand), 'model.warrior.attack'), 100)
    s = reduce(s, { type: 'param/undo' }) // 撤销恢复单项 → 回到批量后
    assert.equal(readNumeric(parseConfig(paramYamlView(s).cand), 'model.combat.p_hit'), 0.9)
    s = reduce(s, { type: 'param/undo' }) // 撤销批量 → 回到 112
    assert.equal(readNumeric(parseConfig(paramYamlView(s).cand), 'model.combat.dmg_var'), 10)
    s = reduce(s, { type: 'param/undo' }) // 撤销 112 → 回到 111
    assert.equal(readNumeric(parseConfig(paramYamlView(s).cand), 'model.warrior.attack'), 111)
    // 重做:逐条恢复
    s = reduce(s, { type: 'param/redo' })
    assert.equal(readNumeric(parseConfig(paramYamlView(s).cand), 'model.warrior.attack'), 112)
    s = reduce(s, { type: 'param/redo' })
    assert.equal(readNumeric(parseConfig(paramYamlView(s).cand), 'model.combat.p_hit'), 0.9)
    // 新修改清空重做栈(线性历史)
    s = reduce(s, { type: 'param/write', yaml: yamlWith('model.warrior.attack', '150') })
    assert.equal(s.paramDraft.future.length, 0)
  } finally {
    restore()
  }
})

test('WB-05.14 冻结已校验配置版本;后续单元格编辑不影响冻结 YAML', async () => {
  const restore = fakeWindow()
  try {
    const { reduce, paramYamlView } = await import('../src/workbench/state/workbenchStore.ts')
    let s = baseState()
    const frozenYaml = yamlWith('model.warrior.attack', '111')
    s = reduce(s, { type: 'param/frozen', yaml: frozenYaml, configHash: 'deadbeef' })
    // 提交后继续改单元格
    s = reduce(s, { type: 'param/write', yaml: yamlWith('model.warrior.attack', '999') })
    assert.equal(s.paramFrozen.yaml, frozenYaml, '冻结版本不跟随单元格')
    assert.equal(s.paramFrozen.configHash, 'deadbeef')
    assert.notEqual(paramYamlView(s).cand, s.paramFrozen.yaml)
    // 换场景失效
    s = reduce(s, { type: 'object/select', kind: 'scenario', path: 'scenarios/other.yaml' })
    assert.equal(s.paramFrozen, null)
  } finally {
    restore()
  }
})

function baseState() {
  return {
    page: 'parameters',
    selection: {},
    explorerCollapsed: false,
    inspectorOpen: true,
    drawerOpen: false,
    paramDraft: { yaml: buildDefaultYaml(), saved: true, history: [], future: [] },
    paramFrozen: null,
    paramKernelError: null,
    project: null,
    objectDrafts: {},
    runs: [],
    runArtifacts: {},
    projectNotice: null,
    selectedCandidateId: null,
    metric: 'win',
    resultView: 'chart',
    resultFilter: 'all',
    sortKey: 'paramValue',
    sortDir: 1,
    paramSearch: '',
    paramGroup: 'all',
    changedOnly: false,
    errorsOnly: false,
    paramFocusId: null,
    paramSelected: [],
    design: {},
    designDirty: false,
  }
}

/** 在默认 YAML 上改一个参数的辅助(产出与 reducer 相同形态的候选文档)。 */
function yamlWith(path, text) {
  const yaml = buildDefaultYaml()
  const applied = applyParamEdit(yaml, parseConfig(yaml), path, String(text))
  assert.equal(applied.ok, true)
  return applied.yaml
}

/* ————— 05.13 结构化编辑 ↔ YAML 同步;高级 YAML 语法错误保留原文 ————— */

test('WB-05.13 结构化编辑写入 YAML 后参数表读到新值;高级 YAML 语法错误不更新', () => {
  const yaml = buildDefaultYaml()
  // 结构化编辑 → YAML
  const edited = applyParamEdit(yaml, parseConfig(yaml), 'model.churn.p_stall', '0.08')
  assert.equal(edited.ok, true)
  const rows = buildRowModels(parseConfig(yaml), parseConfig(edited.yaml))
  assert.equal(rows.find((r) => r.def.path === 'model.churn.p_stall').candidate.num, 0.08)
  // 高级 YAML:成功解析 → 更新参数表
  const rewritten = edited.yaml.replace('p_stall: 0.08', 'p_stall: 0.11')
  const parsedOk = parseConfig(rewritten)
  assert.equal(parsedOk.errors.length, 0)
  assert.equal(readNumeric(parsedOk, 'model.churn.p_stall'), 0.11)
  // 高级 YAML:语法错误 → 检出且页面保留原文(候选不写;原文=编辑框内容)
  const broken = rewritten.replace('p_stall: 0.11', 'p_stall: [0.11\n  bad line')
  const parsedBad = parseConfig(broken)
  assert.ok(parsedBad.errors.length > 0, '语法错误被检出')
  // 组件语义:只有 errors.length === 0 才 dispatch param/write(ParametersPage.applyAdvancedEdit)
})

test('WB-05.13 缺值参数写入:块节缺失自动补节链;flow 内补键', () => {
  // pokemon.yaml 无 gacha 节 → 写 gacha.base_rate 需补节
  const pokemon = readFileSync(`${REPO_ROOT}examples/pokemon.yaml`, 'utf8')
  const r1 = applyParamEdit(pokemon, parseConfig(pokemon), 'model.gacha.base_rate', '0.05')
  assert.equal(r1.ok, true)
  const p1 = parseConfig(r1.yaml)
  assert.equal(p1.errors.length, 0)
  assert.equal(readNumeric(p1, 'model.gacha.base_rate'), 0.05)
  assert.equal(readNumeric(p1, 'model.dungeon.tier_growth'), 1.25, '补节不破坏既有参数')
  // flow 映射内缺键:pokemon behavior.core 无 sessions_frac?有——改测 whale 缺 sessions_frac
  const noWhaleFrac = pokemon.replace('whale: { p_dungeon: 0.6, p_upgrade: 0.3, p_training: 0.1, sessions_frac: 0, sessions_int: 5 }', 'whale: { p_dungeon: 0.6, p_upgrade: 0.3, p_training: 0.1, sessions_int: 5 }')
  const r2 = applyParamEdit(noWhaleFrac, parseConfig(noWhaleFrac), 'model.behavior.whale.sessions_frac', '0.25')
  const p2 = parseConfig(r2.yaml)
  assert.equal(p2.errors.length, 0)
  assert.equal(readNumeric(p2, 'model.behavior.whale.sessions_frac'), 0.25)
})

/* ————— 05.15 YAML round-trip 保真 ————— */

test('WB-05.15 编辑后 round-trip 保留 damage_model/loot/公式/未编辑结构与注释', () => {
  const composed = [
    '# 顶部注释必须原样保留',
    "schema_version: '1'",
    '',
    'scenario:',
    '  population: 10000',
    '  duration: 30d',
    '  seed: 42',
    '  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }',
    '',
    'model:',
    '  # 战斗口径:比值模型',
    '  combat:',
    '    damage_model: ratio',
    '    ratio_k: 260',
    '    p_hit: 0.95',
    '  formulas:',
    "    xp_needed: 'xp_base * level ^ xp_pow'",
    '  loot:',
    '    rate_mult: 1.0',
    '    on_victory: chest',
    '    tables:',
    '      chest:',
    '        weights: { gold_small: 70, gold_mid: 25, gem: 5 }',
    '    rewards:',
    '      gold_small: { gold: 10, xp: 0 }',
    '  dungeon:',
    '    tier_table:',
    '      - { hp: 165, attack: 85, defense: 245 }',
    '      - { hp: 280, attack: 180, defense: 200 }',
  ].join('\n')
  const before = parseConfig(composed)
  assert.equal(before.errors.length, 0)
  // 两处结构化编辑(替换 token,不重序列化)
  const applied = applyParamEdits(composed, [
    { path: 'model.combat.p_hit', text: '0.88' },
    { path: 'model.combat.ratio_k', text: '300' },
  ])
  assert.equal(applied.ok, true)
  const after = applied.yaml
  // 结构字段逐字节保留
  assert.ok(after.includes('damage_model: ratio'))
  assert.ok(after.includes("xp_needed: 'xp_base * level ^ xp_pow'"))
  assert.ok(after.includes('weights: { gold_small: 70, gold_mid: 25, gem: 5 }'))
  assert.ok(after.includes('gold_small: { gold: 10, xp: 0 }'))
  assert.ok(after.includes('- { hp: 165, attack: 85, defense: 245 }'))
  assert.ok(after.includes('# 顶部注释必须原样保留'))
  assert.ok(after.includes('# 战斗口径:比值模型'))
  assert.ok(after.includes('duration: 30d'))
  // 除两处替换外逐行不变
  const beforeLines = composed.split('\n').filter((l) => !l.includes('p_hit: 0.95') && !l.includes('ratio_k: 260'))
  const afterLines = after.split('\n').filter((l) => !l.includes('p_hit: 0.88') && !l.includes('ratio_k: 300'))
  assert.deepEqual(afterLines, beforeLines)
  // 内核关心的语义值仍在
  const parsedAfter = parseConfig(after)
  assert.equal(readNumeric(parsedAfter, 'model.loot.rate_mult'), 1.0)
  assert.equal(readText(parsedAfter, 'model.combat.damage_model'), 'ratio')
  assert.equal(readText(parsedAfter, 'model.formulas.xp_needed'), 'xp_base * level ^ xp_pow')
})

test('WB-05.15 仓库全部示例 YAML 可解析;恢复单项走基线文本或删除', () => {
  const dir = `${REPO_ROOT}examples`
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.yaml'))) {
    const parsed = parseConfig(readFileSync(`${dir}/${f}`, 'utf8'))
    assert.equal(parsed.errors.length, 0, `${f} 应无语法错误: ${JSON.stringify(parsed.errors)}`)
  }
  // 恢复单项:基线有值写回;基线无值删除候选键
  const base = parseConfig('model:\n  churn:\n    p_stall: 0.05\n')
  const cand = parseConfig('model:\n  churn:\n    p_stall: 0.11\n')
  const restored = restoreParam('model:\n  churn:\n    p_stall: 0.11\n', cand, 'model.churn.p_stall', readText(base, 'model.churn.p_stall'))
  assert.equal(readNumeric(parseConfig(restored.yaml), 'model.churn.p_stall'), 0.05)
  const baseNoKey = parseConfig('scenario:\n  population: 1\n')
  const candExtraYaml = 'scenario:\n  population: 1\nmodel:\n  gacha:\n    base_rate: 0.5\n'
  const candExtra = parseConfig(candExtraYaml)
  const removed = restoreParam(candExtraYaml, candExtra, 'model.gacha.base_rate', readText(baseNoKey, 'model.gacha.base_rate'))
  assert.equal(removed.ok, true)
  assert.equal(hasParam(parseConfig(removed.yaml), 'model.gacha.base_rate'), false)
  assert.equal(readNumeric(parseConfig(removed.yaml), 'scenario.population'), 1, '删除不伤及相邻参数')
})
