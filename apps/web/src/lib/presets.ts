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
  combat: { p_hit: 0.95, p_hit_monster: 0.95, dmg_var: 7, max_rounds: 32 }
  dungeon:
    tiers: 8
    m_hp: 165
    m_attack: 219
    m_defense: 61
    tier_growth: 1.18
    reward_gold: 1400
    reward_xp: 1080
    reward_growth: 1.31
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
