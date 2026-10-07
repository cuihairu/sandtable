//! World:运行时状态(文档 03 章)。Phase 1 内实体与状态都在这里;
//! 与不可变配置([`crate::config::SimConfig`],Model 雏形)分离。

use crate::config::{Cohort, SimConfig};
use crate::rng::{DayRng, Purpose};

/// 单个玩家实例(Actor)。
#[derive(Debug, Clone)]
pub struct Actor {
    pub id: u64,
    pub cohort: Cohort,
    // 战斗属性
    pub attack: i64,
    pub defense: i64,
    pub hp: i64,
    // 成长
    pub level: u32,
    pub xp_into_level: i64,
    pub upgrades: u32,
    pub upgrade_cost_next: i64,
    // 经济
    pub gold: i64,
    // 派生
    pub power: i64,
    // 日内与累计状态
    pub active: bool,
    pub churned: bool,
    pub in_day1_cohort: bool,
    /// 连续活跃日无战力增长(停滞计数,文档 13 章流失机制)
    pub idle_streak: u32,
}

impl Actor {
    pub fn power_of(attack: i64, defense: i64, hp: i64, level: u32) -> i64 {
        attack * 2 + defense + hp / 10 + level as i64 * 10
    }

    pub fn recompute_power(&mut self) {
        self.power = Self::power_of(self.attack, self.defense, self.hp, self.level);
    }
}

/// 运行时世界。
pub struct World {
    pub config: SimConfig,
    /// 玩家按 id 升序存放——遍历顺序确定(文档 06 章有序容器规则)
    pub actors: Vec<Actor>,
}

impl World {
    /// 按种子生成玩家群体。分群用键 (seed, actor_id, 0, 0, Cohort) 派生,
    /// 与生成顺序无关。
    pub fn new(config: SimConfig) -> Self {
        let seed = config.base_seed;
        let [w0, w1, _] = config.cohort_weights;
        let mut actors = Vec::with_capacity(config.players as usize);
        for id in 0..u64::from(config.players) {
            let roll = DayRng::new(seed, id, 0)
                .draw_indexed(Purpose::Cohort, 0)
                .f64();
            let cohort = if roll < w0 {
                Cohort::Casual
            } else if roll < w0 + w1 {
                Cohort::Core
            } else {
                Cohort::Whale
            };
            let mut actor = Actor {
                id,
                cohort,
                attack: config.init_attack,
                defense: config.init_defense,
                hp: config.init_hp,
                level: 1,
                xp_into_level: 0,
                upgrades: 0,
                upgrade_cost_next: config.progression.upgrade_cost_base,
                gold: 0,
                power: 0,
                active: false,
                churned: false,
                in_day1_cohort: false,
                idle_streak: 0,
            };
            actor.recompute_power();
            actors.push(actor);
        }
        Self { config, actors }
    }
}
