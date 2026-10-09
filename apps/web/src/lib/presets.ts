// 预设配置(零网络:内置字符串,与仓库 examples 同源)
export const PRESETS: { name: string; yaml: string }[] = [
  {
    name: '最小 RPG(默认)',
    yaml: `schema_version: '1'
scenario:
  population: 3000
  duration: 30d
  seed: 12345
  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }
`,
  },
  {
    name: '宝可梦案例(关都八道馆)',
    yaml: `schema_version: '1'
scenario:
  population: 3000
  duration: 30d
  seed: 12345
  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }
model:
  warrior: { attack: 140, defense: 130, hp: 225 }
  combat:
    damage_model: ratio
    ratio_k: 260
    p_hit: 0.95
    p_hit_monster: 0.95
    dmg_var: 7
    max_rounds: 32
  dungeon:
    tiers: 8
    m_hp: 165
    m_attack: 85
    m_defense: 245
    tier_growth: 1.25
    tier_table:
      - { hp: 165, attack: 85, defense: 245 }
      - { hp: 280, attack: 180, defense: 200 }
      - { hp: 310, attack: 240, defense: 155 }
      - { hp: 425, attack: 325, defense: 210 }
      - { hp: 540, attack: 410, defense: 540 }
      - { hp: 500, attack: 240, defense: 215 }
      - { hp: 705, attack: 540, defense: 400 }
      - { hp: 825, attack: 675, defense: 625 }
    reward_gold: 1400
    reward_xp: 1080
    reward_gold_growth: 1.26
    reward_xp_growth: 1.31
  progression:
    xp_base: 15
    xp_pow: 2.0
    level_attack_gain: 8
    level_defense_gain: 8
    level_hp_gain: 13
  churn: { p_base: 0.003, p_stall: 0.05, stall_days: 2 }
`,
  },
]

// 参数扫描预设(与 examples/pokemon-sweep.yaml 同源;population 调 3000
// 匹配 Web 形态的规模边界,网格与约束不动)
export const SWEEP_PRESET = `schema_version: '1'
scenario:
  population: 3000
  duration: 30d
  seed: 12345
  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }
model:
  warrior: { attack: 140, defense: 130, hp: 225 }
  combat:
    damage_model: ratio
    ratio_k: 260
    p_hit: 0.95
    p_hit_monster: 0.95
    dmg_var: 7
    max_rounds: 32
  dungeon:
    tiers: 8
    m_hp: 165
    m_attack: 85
    m_defense: 245
    tier_growth: 1.25
    tier_table:
      - { hp: 165, attack: 85, defense: 245 }
      - { hp: 280, attack: 180, defense: 200 }
      - { hp: 310, attack: 240, defense: 155 }
      - { hp: 425, attack: 325, defense: 210 }
      - { hp: 540, attack: 410, defense: 540 }
      - { hp: 500, attack: 240, defense: 215 }
      - { hp: 705, attack: 540, defense: 400 }
      - { hp: 825, attack: 675, defense: 625 }
    reward_gold: 1400
    reward_xp: 1080
    reward_gold_growth: 1.26
    reward_xp_growth: 1.31
  behavior:
    casual: { p_dungeon: 0.7, p_upgrade: 0.2, sessions_frac: 0.5, sessions_int: 1 }
    core: { p_dungeon: 0.6, p_upgrade: 0.3, sessions_frac: 0.5, sessions_int: 2 }
    whale: { p_dungeon: 0.65, p_upgrade: 0.3, sessions_frac: 0, sessions_int: 5 }
  progression:
    xp_base: 15
    xp_pow: 2.0
    level_attack_gain: 8
    level_defense_gain: 8
    level_hp_gain: 13
    upgrade_cost_base: 50
    upgrade_cost_num: 5
    upgrade_cost_den: 4
    upgrade_attack_gain: 2
  churn: { p_base: 0.003, p_stall: 0.05, stall_days: 2 }
sweep:
  replicates: 4
  parameters:
    model.warrior.attack: { min: 100, max: 260, step: 40 }
  targets:
    - { metric: win_rate, min: 0.85, max: 1.0, kind: hard }
    - { metric: churn_rate, min: 0.0, max: 0.2, kind: hard }
`

// Random 搜索预设(文档 12 章 Random 模式):与网格预设同模型同约束,
// 采样流与 base_seed 绑定(同配置同采样,线程数无关);24 样本 × 4 replicates
// = 96 次仿真,在 Web 预算门内。
export const SWEEP_PRESET_RANDOM = `schema_version: '1'
scenario:
  population: 3000
  duration: 30d
  seed: 12345
  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }
model:
  warrior: { attack: 140, defense: 130, hp: 225 }
  combat:
    damage_model: ratio
    ratio_k: 260
    p_hit: 0.95
    p_hit_monster: 0.95
    dmg_var: 7
    max_rounds: 32
  dungeon:
    tiers: 8
    m_hp: 165
    m_attack: 85
    m_defense: 245
    tier_growth: 1.25
    tier_table:
      - { hp: 165, attack: 85, defense: 245 }
      - { hp: 280, attack: 180, defense: 200 }
      - { hp: 310, attack: 240, defense: 155 }
      - { hp: 425, attack: 325, defense: 210 }
      - { hp: 540, attack: 410, defense: 540 }
      - { hp: 500, attack: 240, defense: 215 }
      - { hp: 705, attack: 540, defense: 400 }
      - { hp: 825, attack: 675, defense: 625 }
    reward_gold: 1400
    reward_xp: 1080
    reward_gold_growth: 1.26
    reward_xp_growth: 1.31
  behavior:
    casual: { p_dungeon: 0.7, p_upgrade: 0.2, sessions_frac: 0.5, sessions_int: 1 }
    core: { p_dungeon: 0.6, p_upgrade: 0.3, sessions_frac: 0.5, sessions_int: 2 }
    whale: { p_dungeon: 0.65, p_upgrade: 0.3, sessions_frac: 0, sessions_int: 5 }
  progression:
    xp_base: 15
    xp_pow: 2.0
    level_attack_gain: 8
    level_defense_gain: 8
    level_hp_gain: 13
    upgrade_cost_base: 50
    upgrade_cost_num: 5
    upgrade_cost_den: 4
    upgrade_attack_gain: 2
  churn: { p_base: 0.003, p_stall: 0.05, stall_days: 2 }
sweep:
  mode: random
  samples: 24
  replicates: 4
  parameters:
    model.warrior.attack: { min: 100, max: 260, step: 40 }
  targets:
    - { metric: win_rate, min: 0.85, max: 1.0, kind: hard }
    - { metric: churn_rate, min: 0.0, max: 0.2, kind: hard }
`

// 双轴网格预设(文档 22 后续项:联合可行域矩阵的演示形态):attack 3 点
// × p_hit 3 点 = 9 候选 × 4 replicates = 36 次仿真,在 Web 预算门内;
// 出两轴判定矩阵,不出单轴推荐带(红线不变)。
export const SWEEP_PRESET_GRID2 = `schema_version: '1'
scenario:
  population: 3000
  duration: 30d
  seed: 12345
  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }
model:
  warrior: { attack: 140, defense: 130, hp: 225 }
  combat:
    damage_model: ratio
    ratio_k: 260
    p_hit: 0.95
    p_hit_monster: 0.95
    dmg_var: 7
    max_rounds: 32
  dungeon:
    tiers: 8
    m_hp: 165
    m_attack: 85
    m_defense: 245
    tier_growth: 1.25
    tier_table:
      - { hp: 165, attack: 85, defense: 245 }
      - { hp: 280, attack: 180, defense: 200 }
      - { hp: 310, attack: 240, defense: 155 }
      - { hp: 425, attack: 325, defense: 210 }
      - { hp: 540, attack: 410, defense: 540 }
      - { hp: 500, attack: 240, defense: 215 }
      - { hp: 705, attack: 540, defense: 400 }
      - { hp: 825, attack: 675, defense: 625 }
    reward_gold: 1400
    reward_xp: 1080
    reward_gold_growth: 1.26
    reward_xp_growth: 1.31
  behavior:
    casual: { p_dungeon: 0.7, p_upgrade: 0.2, sessions_frac: 0.5, sessions_int: 1 }
    core: { p_dungeon: 0.6, p_upgrade: 0.3, sessions_frac: 0.5, sessions_int: 2 }
    whale: { p_dungeon: 0.65, p_upgrade: 0.3, sessions_frac: 0, sessions_int: 5 }
  progression:
    xp_base: 15
    xp_pow: 2.0
    level_attack_gain: 8
    level_defense_gain: 8
    level_hp_gain: 13
    upgrade_cost_base: 50
    upgrade_cost_num: 5
    upgrade_cost_den: 4
    upgrade_attack_gain: 2
  churn: { p_base: 0.003, p_stall: 0.05, stall_days: 2 }
sweep:
  replicates: 4
  parameters:
    model.warrior.attack: { min: 100, max: 260, step: 80 }
    model.combat.p_hit: { min: 0.9, max: 1.0, step: 0.05 }
  targets:
    - { metric: win_rate, min: 0.85, max: 1.0, kind: hard }
    - { metric: churn_rate, min: 0.0, max: 0.2, kind: hard }
`

// Latin Hypercube 预设(文档 12 章 lhs 模式):同模型同约束,samples 24
// 分层采样 × 4 replicates = 96 次仿真,预算门内;散点图(非网格序不连线)。
export const SWEEP_PRESET_LHS = `schema_version: '1'
scenario:
  population: 3000
  duration: 30d
  seed: 12345
  population_mix: { casual: 0.6, core: 0.3, whale: 0.1 }
model:
  warrior: { attack: 140, defense: 130, hp: 225 }
  combat:
    damage_model: ratio
    ratio_k: 260
    p_hit: 0.95
    p_hit_monster: 0.95
    dmg_var: 7
    max_rounds: 32
  dungeon:
    tiers: 8
    m_hp: 165
    m_attack: 85
    m_defense: 245
    tier_growth: 1.25
    tier_table:
      - { hp: 165, attack: 85, defense: 245 }
      - { hp: 280, attack: 180, defense: 200 }
      - { hp: 310, attack: 240, defense: 155 }
      - { hp: 425, attack: 325, defense: 210 }
      - { hp: 540, attack: 410, defense: 540 }
      - { hp: 500, attack: 240, defense: 215 }
      - { hp: 705, attack: 540, defense: 400 }
      - { hp: 825, attack: 675, defense: 625 }
    reward_gold: 1400
    reward_xp: 1080
    reward_gold_growth: 1.26
    reward_xp_growth: 1.31
  behavior:
    casual: { p_dungeon: 0.7, p_upgrade: 0.2, sessions_frac: 0.5, sessions_int: 1 }
    core: { p_dungeon: 0.6, p_upgrade: 0.3, sessions_frac: 0.5, sessions_int: 2 }
    whale: { p_dungeon: 0.65, p_upgrade: 0.3, sessions_frac: 0, sessions_int: 5 }
  progression:
    xp_base: 15
    xp_pow: 2.0
    level_attack_gain: 8
    level_defense_gain: 8
    level_hp_gain: 13
    upgrade_cost_base: 50
    upgrade_cost_num: 5
    upgrade_cost_den: 4
    upgrade_attack_gain: 2
  churn: { p_base: 0.003, p_stall: 0.05, stall_days: 2 }
sweep:
  mode: latin_hypercube
  samples: 24
  replicates: 4
  parameters:
    model.warrior.attack: { min: 100, max: 260, step: 40 }
  targets:
    - { metric: win_rate, min: 0.85, max: 1.0, kind: hard }
    - { metric: churn_rate, min: 0.0, max: 0.2, kind: hard }
`

// 扫描预设选择器条目(网格 / Random / LHS,同源 core::sweep SweepMode)
export const SWEEP_PRESETS: { name: string; yaml: string }[] = [
  { name: '宝可梦 · 单轴网格', yaml: SWEEP_PRESET },
  { name: '宝可梦 · 单轴随机(Random)', yaml: SWEEP_PRESET_RANDOM },
  { name: '宝可梦 · 单轴 LHS(latin_hypercube)', yaml: SWEEP_PRESET_LHS },
  { name: '宝可梦 · 双轴网格(联合可行域)', yaml: SWEEP_PRESET_GRID2 },
]

