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

use crate::Error;

/// 抽取用途,集中注册,防止同名不同义(文档 06 章禁止事项)。
///
/// 变体只能**追加**在末尾:新用途不得改动既有编号,否则旧键全变,
/// 黄金快照与 A/B 可比随机路径同时失效(文档 06 / 24 章)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Purpose {
    /// 行为决策:会话数、动作选择
    Behavior = 0,
    /// 战斗命中判定(玩家与怪物共用,以 event_index 区分次序)
    CombatHit = 1,
    /// 战斗伤害浮动
    CombatDamage = 2,
    /// 掉落:加权掉落表抽取(文档 24 章 R1)
    Loot = 3,
    /// 流失判定
    Churn = 4,
    /// 初始分群(仅 day=0 初始化用)
    Cohort = 5,
    /// 洗牌 / 无放回抽样(文档 24 章 R1:Fisher–Yates、局部洗牌、A-Res
    /// 共用一条流;分布检验台的抽样流也走这里——两者都不进仿真路径,
    /// 与仿真键空间分立)
    Shuffle = 6,
    /// 抽卡命中判定(文档 24 章 R2):保底状态机抽取。保底计数器是 actor
    /// 确定性状态,不进键;改保底参数不挪键,CRN 成立。
    Gacha = 7,
    /// 正态抽样(文档 24 章 R3):Box–Muller,一次逻辑抽取消耗两个均匀值
    /// (计数器 +2);改 μ/σ 只改变换不改键,双消耗键稳定。
    Normal = 8,
}

pub const PURPOSE_COUNT: usize = 9;

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

/// Box–Muller 变换(纯函数,供 [`DayRng::normal`] 与测试复用):
/// u1 定幅(半径)、u2 定向(角度),`u1 ≤ 0` 钳到 `f64::MIN_POSITIVE`。
pub fn box_muller(u1: f64, u2: f64, mu: f64, sigma: f64) -> f64 {
    let u1 = u1.max(f64::MIN_POSITIVE);
    mu + sigma.abs() * (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
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

/// 加权表(文档 24 章 R1):权重 → CDF 前缀和,**加载期编译**,运行期零字符串。
///
/// 抽取 = 一次 [0,1) 均匀 + CDF 二分比较,O(log n)。轮盘线性扫是朴素实现,
/// alias method(Walker 1977;Vose 1991)为热路径优化项,仅当单日百万级引用
/// 时启用——可读性优先。
///
/// 零权重项永不入选:严格小于比较使其不与同前缀的邻居并列。
#[derive(Debug, Clone)]
pub struct WeightedTable {
    /// 项名(按输入序;YAML 侧经 BTreeMap 已保证确定序)
    names: Vec<String>,
    /// CDF 前缀和,末项 = 权重总和(非递减)
    cums: Vec<f64>,
    /// 权重总和
    total: f64,
}

impl WeightedTable {
    /// 编译权重表并校验:表非空、项名非空、权重为有限非负数、至少一项为正。
    pub fn from_weights(weights: &[(String, f64)]) -> Result<Self, Error> {
        if weights.is_empty() {
            return Err(Error::Config("加权表不能为空".into()));
        }
        let mut names = Vec::with_capacity(weights.len());
        let mut cums = Vec::with_capacity(weights.len());
        let mut total = 0.0;
        for (name, w) in weights {
            if name.is_empty() {
                return Err(Error::Config("加权表项名不能为空".into()));
            }
            if !w.is_finite() || *w < 0.0 {
                return Err(Error::Config(format!(
                    "加权表权重必须为有限非负数({name}: {w})"
                )));
            }
            total += w;
            cums.push(total);
            names.push(name.clone());
        }
        if total <= 0.0 {
            return Err(Error::Config("加权表至少一项权重为正".into()));
        }
        Ok(Self { names, cums, total })
    }

    pub fn names(&self) -> &[String] {
        &self.names
    }

    pub fn len(&self) -> usize {
        self.names.len()
    }

    pub fn is_empty(&self) -> bool {
        self.names.is_empty()
    }

    /// 项 i 的权重(由 CDF 差分得,不另存)。
    pub fn weight(&self, i: usize) -> f64 {
        let s = if i == 0 { 0.0 } else { self.cums[i - 1] };
        self.cums[i] - s
    }

    /// 归一化概率(分布检验的期望计数用):和为 1。
    pub fn probabilities(&self) -> Vec<f64> {
        (0..self.names.len())
            .map(|i| self.weight(i) / self.total)
            .collect()
    }

    /// 一次抽取 → 项索引。
    pub fn pick(&self, draw: Draw) -> usize {
        let target = draw.f64() * self.total;
        self.cums.partition_point(|&c| c <= target)
    }
}

impl Draw {
    /// 从加权表抽一项(消耗一次均匀)。
    pub fn weighted(self, table: &WeightedTable) -> usize {
        table.pick(self)
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

    /// 便捷:按 purpose 顺序抽一次加权表(文档 24 章 R1)。
    pub fn weighted(&mut self, purpose: Purpose, table: &WeightedTable) -> usize {
        self.draw(purpose).weighted(table)
    }

    /// 正态抽样(Box–Muller 1958,文档 24 章 R3):连续消耗两个带键均匀
    /// u1, u2 → `mu + sigma·√(−2 ln u1)·cos(2π u2)`。
    ///
    /// 键纪律:一次逻辑抽取消耗两个均匀值、计数器 +2——改 μ/σ 只改变换
    /// 不挪键(A/B 臂同键可比,`u1 = 0` 以 `f64::MIN_POSITIVE` 下限防御,
    /// 概率 2⁻⁵³)。`sigma < 0` 与 `sigma` 非有限由配置层把关;此处按
    /// `sigma.abs()` 处理,`sigma = 0` 退化为常值 mu。
    pub fn normal(&mut self, purpose: Purpose, mu: f64, sigma: f64) -> f64 {
        let u1 = self.draw(purpose).f64();
        let u2 = self.draw(purpose).f64();
        box_muller(u1, u2, mu, sigma)
    }

    /// 带钳位正态(文档 24 章 R3):正态无界,属性类用途必须 clamp;
    /// 钳位是确定性后处理,不消耗额外抽取,不破坏键稳定。
    pub fn normal_clamped(
        &mut self,
        purpose: Purpose,
        mu: f64,
        sigma: f64,
        lo: f64,
        hi: f64,
    ) -> f64 {
        self.normal(purpose, mu, sigma).clamp(lo, hi)
    }

    /// 取该 purpose 连续 n 次抽取并一次性推进计数器(洗牌 / 无放回抽样)。
    /// 只动本 purpose 的计数器,其他用途的键空间不受影响。
    pub fn draw_stream(&mut self, purpose: Purpose, n: usize) -> Vec<Draw> {
        let base = self.counters[purpose as usize];
        self.counters[purpose as usize] = base.wrapping_add(n as u32);
        (0..n as u32)
            .map(|i| {
                Draw(derive_u64(
                    self.seed,
                    self.actor_id,
                    self.day,
                    base.wrapping_add(i),
                    purpose,
                ))
            })
            .collect()
    }

    /// Fisher–Yates 洗牌,O(n),消耗 n−1 次抽取(文档 24 章 R1)。
    /// 结果依赖输入顺序——牌序即配置,键不变则洗牌不变,CRN 成立。
    pub fn shuffle<T>(&mut self, purpose: Purpose, xs: &mut [T]) {
        let n = xs.len();
        if n < 2 {
            return;
        }
        let draws = self.draw_stream(purpose, n - 1);
        for i in (1..n).rev() {
            let j = (draws[i - 1].u64() % (i + 1) as u64) as usize;
            xs.swap(i, j);
        }
    }

    /// 无放回均匀抽样 = 局部 Fisher–Yates 前 k 位,O(k)。
    pub fn sample<T: Clone>(&mut self, purpose: Purpose, xs: &[T], k: usize) -> Vec<T> {
        let m = xs.len().min(k);
        if m == 0 {
            return Vec::new();
        }
        let draws = self.draw_stream(purpose, m.saturating_sub(1));
        let mut out: Vec<T> = xs[..m].to_vec();
        for i in (1..m).rev() {
            let j = (draws[i - 1].u64() % (i + 1) as u64) as usize;
            out.swap(i, j);
        }
        out
    }

    /// 无放回**加权**抽样:A-Res 键序法(Efraimidis & Spirakis 2006),
    /// 每项算键 `u^(1/w)` 取前 k 大,O(n log k);一次性流式,与权重尺度无关。
    /// 零权重项键为 0,永不入选。
    pub fn sample_weighted<T: Clone>(
        &mut self,
        purpose: Purpose,
        xs: &[T],
        table: &WeightedTable,
        k: usize,
    ) -> Result<Vec<T>, Error> {
        if xs.len() != table.len() {
            return Err(Error::Config(format!(
                "无放回加权抽样:项数 {} 与权重表 {} 不一致",
                xs.len(),
                table.len()
            )));
        }
        let k = xs.len().min(k);
        if k == 0 {
            return Ok(Vec::new());
        }
        let draws = self.draw_stream(purpose, xs.len());
        let mut keyed: Vec<(f64, usize)> = (0..xs.len())
            .map(|i| (draws[i].f64().powf(1.0 / table.weight(i)), i))
            .collect();
        // 键降序;键相同取索引小者,确定性破平
        keyed.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)));
        Ok(keyed.iter().take(k).map(|(_, i)| xs[*i].clone()).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::disttest;

    /// 新 purpose 只能追加,不得改动既有编号:编号一变旧键全变,
    /// 黄金快照与 A/B 可比随机路径同时失效(文档 06 / 24 章 R1 验收项)。
    #[test]
    fn 用途编号锁定_追加不挪旧键() {
        let nums: [u8; PURPOSE_COUNT] = [
            Purpose::Behavior as u8,
            Purpose::CombatHit as u8,
            Purpose::CombatDamage as u8,
            Purpose::Loot as u8,
            Purpose::Churn as u8,
            Purpose::Cohort as u8,
            Purpose::Shuffle as u8,
            Purpose::Gacha as u8,
            Purpose::Normal as u8,
        ];
        assert_eq!(nums, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
        // 各 purpose 在同一键下取值互不相同(键空间正交)
        let all = [
            Purpose::Behavior,
            Purpose::CombatHit,
            Purpose::CombatDamage,
            Purpose::Loot,
            Purpose::Churn,
            Purpose::Cohort,
            Purpose::Shuffle,
            Purpose::Gacha,
            Purpose::Normal,
        ];
        let vals: Vec<u64> = all.iter().map(|p| derive_u64(42, 7, 3, 1, *p)).collect();
        assert_eq!(
            vals.iter()
                .cloned()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            9
        );
    }

    fn table(weights: &[f64]) -> WeightedTable {
        let names = ["a", "b", "c"];
        WeightedTable::from_weights(
            &weights
                .iter()
                .enumerate()
                .map(|(i, &w)| (names[i].to_string(), w))
                .collect::<Vec<_>>(),
        )
        .unwrap()
    }

    #[test]
    fn 加权表_校验() {
        assert!(WeightedTable::from_weights(&[]).is_err());
        assert!(WeightedTable::from_weights(&[("".to_string(), 1.0)])
            .unwrap_err()
            .to_string()
            .contains("项名"));
        assert!(WeightedTable::from_weights(&[("a".to_string(), -1.0)])
            .unwrap_err()
            .to_string()
            .contains("非负"));
        assert!(WeightedTable::from_weights(&[("a".to_string(), f64::NAN)])
            .unwrap_err()
            .to_string()
            .contains("非负"));
        assert!(WeightedTable::from_weights(&[("a".to_string(), 0.0)]).is_err());
    }

    #[test]
    fn 加权表_边界与零权重() {
        let t = WeightedTable::from_weights(&[("a".to_string(), 1.0)]).unwrap();
        // 单一项:任何抽取都指向它
        for i in 0..64u32 {
            let d = Draw(derive_u64(1, 1, 1, i, Purpose::Loot));
            assert_eq!(d.weighted(&t), 0);
        }
        // 零权重项永不入选(严格小于比较使其与邻居不并列)
        let t = WeightedTable::from_weights(&[
            ("a".to_string(), 5.0),
            ("zero".to_string(), 0.0),
            ("c".to_string(), 5.0),
        ])
        .unwrap();
        assert_eq!(t.len(), 3);
        for i in 0..2000u32 {
            let d = Draw(derive_u64(9, 2, 1, i, Purpose::Loot));
            assert_ne!(d.weighted(&t), 1, "零权重项被抽中");
        }
        // 概率和为 1
        let probs = t.probabilities();
        assert!((probs.iter().sum::<f64>() - 1.0).abs() < 1e-12);
    }

    #[test]
    fn 加权表_万次采样卡方() {
        // R1 验收:万次采样 χ² 全过(70/25/5 三档掉落)
        let t = table(&[70.0, 25.0, 5.0]);
        let mut rng = DayRng::new(42, 7, 3);
        let mut obs = [0.0f64; 3];
        for _ in 0..100_000 {
            obs[rng.weighted(Purpose::Loot, &t)] += 1.0;
        }
        let exp: Vec<f64> = t.probabilities().iter().map(|p| p * 100_000.0).collect();
        let (o, e) = disttest::merge_buckets(&obs, &exp, disttest::MIN_EXPECTED);
        let chi = disttest::chi_square(&o, &e).unwrap();
        assert!(
            chi.pass(0.01),
            "χ² {} p={} 未过 α=0.01",
            chi.stat,
            chi.p_value
        );
    }

    #[test]
    fn 万次采样_两档与均匀表() {
        for weights in [[1.0, 1.0, 1.0], [1.0, 99.0, 0.5]] {
            let t = table(&weights);
            let mut rng = DayRng::new(7, 1, 1);
            let mut obs = [0.0f64; 3];
            for _ in 0..100_000 {
                obs[rng.weighted(Purpose::Loot, &t)] += 1.0;
            }
            let exp: Vec<f64> = t.probabilities().iter().map(|p| p * 100_000.0).collect();
            let (o, e) = disttest::merge_buckets(&obs, &exp, disttest::MIN_EXPECTED);
            assert!(
                disttest::chi_square(&o, &e).unwrap().pass(0.01),
                "权重 {weights:?} 未过检验"
            );
        }
    }

    #[test]
    fn 流抽取_只动本用途计数() {
        let mut rng = DayRng::new(5, 1, 1);
        let a = rng.draw_stream(Purpose::Shuffle, 4);
        assert_eq!(a.len(), 4);
        // 洗牌之后,Behavior 的第 0 次抽取仍是最初那次(计数器未互扰)
        assert_eq!(
            rng.draw(Purpose::Behavior).u64(),
            derive_u64(5, 1, 1, 0, Purpose::Behavior)
        );
        // 流内值 = 按显式序号派生(第 i 项对应 event_index = i)
        let mut rng2 = DayRng::new(5, 1, 1);
        let stream = rng2.draw_stream(Purpose::Shuffle, 3);
        for (i, d) in stream.iter().enumerate() {
            assert_eq!(d.u64(), rng2.draw_indexed(Purpose::Shuffle, i as u32).u64());
        }
        // 推进计数器后再取流,序号接着走
        let mut rng3 = DayRng::new(5, 1, 1);
        rng3.draw_stream(Purpose::Shuffle, 2); // 消耗 0,1
        let c = rng3.draw_stream(Purpose::Shuffle, 2);
        assert_eq!(c[0].u64(), rng3.draw_indexed(Purpose::Shuffle, 2).u64());
        assert_eq!(c[1].u64(), rng3.draw_indexed(Purpose::Shuffle, 3).u64());
    }

    #[test]
    fn 洗牌_确定性且是排列() {
        let xs = [0i32, 1, 2, 3, 4, 5, 6, 7];
        let mut a = DayRng::new(11, 1, 1);
        let mut x = xs.to_vec();
        a.shuffle(Purpose::Shuffle, &mut x);
        let mut b = DayRng::new(11, 1, 1);
        let mut y = xs.to_vec();
        b.shuffle(Purpose::Shuffle, &mut y);
        assert_eq!(x, y, "同种子洗牌必须逐位一致");
        let mut sorted = x.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, xs.to_vec(), "洗牌必须是不含重复的排列");
        let mut c = DayRng::new(12, 1, 1);
        let mut z = xs.to_vec();
        c.shuffle(Purpose::Shuffle, &mut z);
        assert_ne!(x, z, "换种子洗牌应不同");
        // 单元素 / 空数组不消耗抽取
        let mut rng = DayRng::new(1, 1, 1);
        let mut one = [42i32];
        rng.shuffle(Purpose::Shuffle, &mut one);
        assert_eq!(one, [42]);
        assert_eq!(
            rng.draw(Purpose::Shuffle).u64(),
            derive_u64(1, 1, 1, 0, Purpose::Shuffle)
        );
    }

    #[test]
    fn 无放回抽样_不重复且确定() {
        let xs: Vec<i32> = (0..20).collect();
        let a = DayRng::new(3, 1, 1).sample(Purpose::Shuffle, &xs, 7);
        let b = DayRng::new(3, 1, 1).sample(Purpose::Shuffle, &xs, 7);
        assert_eq!(a.len(), 7);
        assert_eq!(a, b);
        assert!(
            a.iter().collect::<std::collections::BTreeSet<_>>().len() == 7,
            "抽样须无重复"
        );
        // k 超过长度时按长度截断,不 panic
        let s = DayRng::new(3, 1, 1).sample(Purpose::Shuffle, &xs, 99);
        assert_eq!(s.len(), xs.len());
        assert!(s.iter().collect::<std::collections::BTreeSet<_>>().len() == xs.len());
        // k = 0 不消耗抽取
        let mut rng = DayRng::new(3, 1, 1);
        assert!(rng.sample(Purpose::Shuffle, &xs, 0).is_empty());
        assert_eq!(
            rng.draw(Purpose::Shuffle).u64(),
            derive_u64(3, 1, 1, 0, Purpose::Shuffle)
        );
    }

    #[test]
    fn 无放回加权抽样_频次成比例() {
        // A-Res:权重 80/15/5 的三项,抽 1 项一万次 → a 占绝对多数
        let xs = ["a", "b", "c"];
        let t = table(&[80.0, 15.0, 5.0]);
        let mut rng = DayRng::new(9, 1, 1);
        let mut counts = [0usize; 3];
        for _ in 0..10_000 {
            let got = rng.sample_weighted(Purpose::Shuffle, &xs, &t, 1).unwrap();
            assert_eq!(got.len(), 1, "k=1 时须恰好 1 项");
            counts[got[0].as_bytes()[0] as usize - b'a' as usize] += 1;
        }
        assert!(
            counts[0] > counts[1] && counts[1] > counts[2],
            "频次 {counts:?} 未按权重降序"
        );
        assert!(
            counts[0] > 7500 && counts[2] < 1000,
            "频次 {counts:?} 偏离权重 80/15/5"
        );

        // k = n 时抽全且无重复
        let all = DayRng::new(4, 1, 1)
            .sample_weighted(Purpose::Shuffle, &xs, &t, 3)
            .unwrap();
        assert_eq!(all.len(), 3);
        assert_eq!(
            all.len(),
            all.iter().collect::<std::collections::BTreeSet<_>>().len()
        );

        // 项数与权重表不一致 → 配置错误
        let mut rng = DayRng::new(4, 1, 1);
        assert!(rng
            .sample_weighted(Purpose::Shuffle, &[1i32], &t, 1)
            .unwrap_err()
            .to_string()
            .contains("不一致"));

        // 万次全桶 χ² 通过(抽 1 项,期望成比例)
        let (o, e) = disttest::merge_buckets(
            &counts.map(|c| c as f64),
            &[8000.0, 1500.0, 500.0],
            disttest::MIN_EXPECTED,
        );
        assert!(disttest::chi_square(&o, &e).unwrap().pass(0.01));
    }

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

    /// R3 验收(文档 24 章):Box–Muller 双消耗键稳定——normal 恰消耗两个
    /// 均匀、值 = box_muller(u1, u2);**改 μ/σ 不挪键**:A/B 臂同键下,normal
    /// 之后的下一抽完全一致(两臂消耗了同一对均匀值)。
    #[test]
    fn 正态_双消耗键稳定() {
        let mut a = DayRng::new(42, 7, 3);
        let mut b = DayRng::new(42, 7, 3);
        let na = a.normal(Purpose::Normal, 0.0, 1.0);
        let nb = b.normal(Purpose::Normal, 5.0, 2.0);
        // 各自等于前两个均匀值的变换
        let u1 = DayRng::new(42, 7, 3).draw_indexed(Purpose::Normal, 0).f64();
        let u2 = DayRng::new(42, 7, 3).draw_indexed(Purpose::Normal, 1).f64();
        assert_eq!(na, box_muller(u1, u2, 0.0, 1.0));
        assert_eq!(nb, box_muller(u1, u2, 5.0, 2.0));
        // 改 μ/σ 后,后续抽取仍同键同值(A/B 可比不破)
        let na2 = a.draw(Purpose::Normal).f64();
        let nb2 = b.draw(Purpose::Normal).f64();
        assert_eq!(na2, nb2, "改 μ/σ 只改变换不挪键");
        assert_ne!(na, nb);
    }

    /// sigma = 0 退化为常值;clamp 生效;负 sigma 取绝对值。
    #[test]
    fn 正态_clamp与退化() {
        let mut rng = DayRng::new(42, 7, 3);
        assert_eq!(rng.normal(Purpose::Normal, 3.5, 0.0), 3.5);
        let mut rng2 = DayRng::new(42, 7, 3);
        let v = rng2.normal_clamped(Purpose::Normal, 0.0, 1.0, -0.5, 0.5);
        assert!((-0.5..=0.5).contains(&v), "钳位后应落在界内:{v}");
        // 负 sigma 与正 sigma 同分布(取绝对值):同键同值
        let mut rng3 = DayRng::new(42, 7, 3);
        let mut rng4 = DayRng::new(42, 7, 3);
        assert_eq!(
            rng3.normal(Purpose::Normal, 0.0, -1.0),
            rng4.normal(Purpose::Normal, 0.0, 1.0)
        );
    }

    /// 均值/方差对齐解析解(R3 验收:CI 覆盖):10 万样本,均值容差
    /// 4·σ/√N,方差容差 4·√(2/N) 相对偏差(χ² 分布的方差近似)。
    #[test]
    fn 正态_均值方差对齐解析解() {
        let n = 100_000usize;
        let (mu, sigma) = (7.0, 2.5);
        let mut rng = DayRng::new(2026, 1, 0);
        let sum: f64 = (0..n).map(|_| rng.normal(Purpose::Normal, mu, sigma)).sum();
        let mean = sum / n as f64;
        let sq_sum: f64 = (0..n)
            .map(|_| rng.normal(Purpose::Normal, mu, sigma))
            .map(|x| (x - mean) * (x - mean))
            .sum();
        let var = sq_sum / (n - 1) as f64;
        assert!(
            (mean - mu).abs() < 4.0 * sigma / (n as f64).sqrt(),
            "均值 {mean} 应在 {mu} ± {} 内",
            4.0 * sigma / (n as f64).sqrt()
        );
        let rel = (var - sigma * sigma).abs() / (sigma * sigma);
        assert!(
            rel < 4.0 * (2.0 / n as f64).sqrt(),
            "方差 {var} 相对偏差 {rel} 应 < {}",
            4.0 * (2.0 / n as f64).sqrt()
        );
    }

    #[test]
    fn range_闭区间() {
        assert_eq!(Draw(0).range_i64(3, 7), 3); // 余 0 → lo
        assert_eq!(Draw(4).range_i64(3, 7), 7); // 余 4 → hi
        assert_eq!(Draw(5).range_i64(5, 5), 5); // 单点区间
        assert_eq!(Draw(9).range_i64(7, 3), 7); // 退化输入(hi < lo)返回 lo
    }
}
