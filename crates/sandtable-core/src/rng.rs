//! 带键随机数(文档 06 章)。
//!
//! 随机数不来自"逐个推进的流",按键直接派生:
//!
//! ```text
//! key = (seed, actor_id, day, event_index, purpose)
//! ```
//!
//! 派生是纯函数,与调用顺序无关:改参数导致某场战斗回合数变化时,后续战斗
//! 仍用自己的 (day, 战斗序号) 键,不会错位——这是 Common Random Numbers
//! (A/B 可比随机路径)的实现基础。
//!
//! 实现为 SplitMix64 链式混合:把键的各分量依次混入,输出 u64。无共享状态,
//! 天然并行安全,可按键局部重放。

/// 抽取用途,集中注册,防止同名不同义(文档 06 章禁止事项)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Purpose {
    /// 行为决策:会话数、动作选择
    Behavior = 0,
    /// 战斗命中判定(玩家与怪物共用,以 event_index 区分次序)
    CombatHit = 1,
    /// 战斗伤害浮动
    CombatDamage = 2,
    /// 掉落
    Loot = 3,
    /// 流失判定
    Churn = 4,
    /// 初始分群(仅 day=0 初始化用)
    Cohort = 5,
}

pub const PURPOSE_COUNT: usize = 6;

/// 单个 u64 键派生:SplitMix64 终结器。
fn mix(mut x: u64) -> u64 {
    x = x.wrapping_mul(0xff51afd7ed558ccd);
    x ^= x >> 33;
    x = x.wrapping_mul(0xc4ceb9fe1a85ec53);
    x ^= x >> 33;
    x
}

/// 按键派生一个 u64。纯函数。
pub fn derive_u64(seed: u64, actor_id: u64, day: u32, event_index: u32, purpose: Purpose) -> u64 {
    let mut h = seed ^ 0x9e37_79b9_7f4a_7c15;
    h = mix(h ^ actor_id.wrapping_mul(0x100_0000_01b3));
    h = mix(h ^ (((day as u64) << 32) | event_index as u64));
    h = mix(h ^ (purpose as u64).wrapping_mul(0xff51_afd7_ed55_8ccd));
    h
}

/// 一次抽取得到的随机值句柄,提供常用分布。
#[derive(Debug, Clone, Copy)]
pub struct Draw(u64);

impl Draw {
    pub fn u64(self) -> u64 {
        self.0
    }

    /// [0, 1) 均匀浮点(53 位精度)。
    pub fn f64(self) -> f64 {
        (self.0 >> 11) as f64 * (1.0 / (1u64 << 53) as f64)
    }

    /// 以概率 p 返回 true。p 越界时按截断处理(0.0 → false,≥1.0 → true)。
    pub fn chance(self, p: f64) -> bool {
        if p <= 0.0 {
            false
        } else if p >= 1.0 {
            true
        } else {
            self.f64() < p
        }
    }

    /// [lo, hi] 闭区间均匀整数。hi < lo 时返回 lo。
    pub fn range_i64(self, lo: i64, hi: i64) -> i64 {
        if hi <= lo {
            return lo;
        }
        let span = (hi - lo + 1) as u64;
        lo + (self.0 % span) as i64
    }
}

/// 单个 actor 单天的随机数发生器。
///
/// `draw(purpose)` 按 purpose 递增各自的 event_index;`draw_indexed(purpose, i)`
/// 按显式序号取值、不推进计数器——战斗轮次用后者:第 k 场战斗第 r 轮的键为
/// `battle_index * MAX_ROUND_SLOTS + r`,与前几场战斗打了多少轮无关(文档 06 章)。
///
/// 约定:每场战斗最多 [`MAX_ROUND_SLOTS`] 轮。
pub struct DayRng {
    seed: u64,
    actor_id: u64,
    day: u32,
    counters: [u32; PURPOSE_COUNT],
}

/// 每场战斗在 event_index 空间中占用的槽位数(即最大轮数)。
pub const MAX_ROUND_SLOTS: u32 = 32;

impl DayRng {
    pub fn new(seed: u64, actor_id: u64, day: u32) -> Self {
        Self {
            seed,
            actor_id,
            day,
            counters: [0; PURPOSE_COUNT],
        }
    }

    /// 取该 purpose 的下一个事件序号并派生。
    pub fn draw(&mut self, purpose: Purpose) -> Draw {
        let idx = self.counters[purpose as usize];
        self.counters[purpose as usize] = idx.wrapping_add(1);
        self.draw_indexed(purpose, idx)
    }

    /// 按显式序号派生,不推进计数器。
    pub fn draw_indexed(&self, purpose: Purpose, event_index: u32) -> Draw {
        Draw(derive_u64(
            self.seed,
            self.actor_id,
            self.day,
            event_index,
            purpose,
        ))
    }

    /// 便捷:按 purpose 顺序抽取并以概率 p 判定。
    pub fn chance(&mut self, purpose: Purpose, p: f64) -> bool {
        self.draw(purpose).chance(p)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 同键同值() {
        let a = derive_u64(42, 7, 3, 1, Purpose::CombatHit);
        let b = derive_u64(42, 7, 3, 1, Purpose::CombatHit);
        assert_eq!(a, b);
    }

    #[test]
    fn 键任一分量变化则值变化() {
        let base = derive_u64(42, 7, 3, 1, Purpose::CombatHit);
        assert_ne!(base, derive_u64(43, 7, 3, 1, Purpose::CombatHit));
        assert_ne!(base, derive_u64(42, 8, 3, 1, Purpose::CombatHit));
        assert_ne!(base, derive_u64(42, 7, 4, 1, Purpose::CombatHit));
        assert_ne!(base, derive_u64(42, 7, 3, 2, Purpose::CombatHit));
        assert_ne!(base, derive_u64(42, 7, 3, 1, Purpose::CombatDamage));
    }

    #[test]
    fn 抽取顺序无关() {
        // 值由 (purpose, event_index) 决定,与调用先后无关:
        // draw() 按序分配 0、1、2…;draw_indexed(i) 恒等于第 i 次顺序抽取
        let mut a = DayRng::new(9, 1, 1);
        let x0 = a.draw(Purpose::Behavior).u64();
        let x1 = a.draw(Purpose::Behavior).u64();
        let b = DayRng::new(9, 1, 1);
        let y1 = b.draw_indexed(Purpose::Behavior, 1).u64();
        let y0 = b.draw_indexed(Purpose::Behavior, 0).u64();
        assert_eq!(x0, y0);
        assert_eq!(x1, y1);
        // 不同 purpose 的键空间互不干扰
        let c1 = derive_u64(9, 1, 1, 0, Purpose::Churn);
        assert_ne!(x0, c1);
    }

    #[test]
    fn draw_indexed_不推进计数器() {
        let mut rng = DayRng::new(9, 1, 1);
        let x = rng.draw_indexed(Purpose::CombatHit, 5);
        let _ = x;
        let y = rng.draw(Purpose::CombatHit); // event_index 应为 0,而不是 6
        let z = derive_u64(9, 1, 1, 0, Purpose::CombatHit);
        assert_eq!(y.u64(), z);
    }

    #[test]
    fn chance_边界() {
        let d = Draw(u64::MAX);
        assert!(!d.chance(0.0));
        assert!(d.chance(1.0));
    }

    #[test]
    fn range_闭区间() {
        assert_eq!(Draw(0).range_i64(3, 7), 3); // 余 0 → lo
        assert_eq!(Draw(4).range_i64(3, 7), 7); // 余 4 → hi
        assert_eq!(Draw(5).range_i64(5, 5), 5); // 单点区间
        assert_eq!(Draw(9).range_i64(7, 3), 7); // 退化输入(hi < lo)返回 lo
    }
}
