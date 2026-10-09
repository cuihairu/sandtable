//! 指标在线聚合(文档 13 章)。
//!
//! 统计口径要点:
//! - 留存:retention_Dn = |{a : active(a,n)}| / |{a : active(a,1)}|,
//!   分母是第 1 天活跃玩家(day-1 cohort)。D1 恒为 1,有信息量的是 D3+。
//! - 通胀(主口径):inflation(d) = (G(d) − G(d−1)) / max(G(d−1), 1),
//!   G 为存续玩家金币存量;辅以 sink_ratio(d) = 回收(d) / max(产出(d), 1)。
//! - churn_rate(d) = 新增流失数(d) / 期初活跃数(d)。
//! - 分布:Power 在快照日(1/3/7/14/30)取精确排序分位数;逐日均值为精确和。
//!   直方图 / t-digest 等有界结构是更大规模时的替换项,Phase 1 不需要。
//!
//! 聚合只用整数计数器与整数和,浮点只在最终比值处出现。

use serde::Serialize;

use crate::config::{Cohort, SimConfig};

/// 单日聚合(时间序列的一个点)。
#[derive(Debug, Clone, Serialize)]
pub struct DayStat {
    pub day: u32,
    /// 当日活跃玩家数(至少一次会话)
    pub active: u64,
    /// 期初存活玩家数
    pub alive_at_start: u64,
    /// 当日新增流失数
    pub new_churned: u64,
    /// 新增流失 / 期初活跃
    pub churn_rate: f64,
    pub battles: u64,
    pub wins: u64,
    /// 胜利 / 总战斗
    pub win_rate: f64,
    /// 当日全体玩家获得的金币总量
    pub gold_earned: u64,
    /// 当日消耗的金币总量(升级)
    pub gold_spent: u64,
    /// 回收 / 产出(文档 13 章辅助口径)
    pub sink_ratio: f64,
    /// G(d):日结时存续玩家金币存量总和
    pub gold_supply: i64,
    /// (G(d) − G(d−1)) / max(G(d−1), 1)
    pub inflation: f64,
    /// 产出的人均值(按当日活跃)
    pub income_per_active: f64,
    /// 回收的人均值(按当日活跃)
    pub spending_per_active: f64,
    /// 日结存活玩家 Power 均值
    pub mean_power: f64,
    pub levelups: u64,
    pub upgrades: u64,
}

/// 快照日 Power 分布(精确分位数)。
#[derive(Debug, Clone, Serialize)]
pub struct PowerSnapshot {
    pub day: u32,
    pub n: u64,
    pub p50: f64,
    pub p90: f64,
    pub p99: f64,
}

/// 按分群的期末切片(文档 13 章"按 cohort 切片输出"的最小实现)。
#[derive(Debug, Clone, Serialize)]
pub struct CohortStat {
    pub cohort: &'static str,
    pub count: u64,
    pub churned: u64,
    pub mean_power: f64,
    pub mean_gold: f64,
    pub mean_level: f64,
}

/// 单次 replicate 的全部指标输出。
#[derive(Debug, Clone, Serialize)]
pub struct RunMetrics {
    pub schema_version: &'static str,
    pub model_version: &'static str,
    pub config_hash: String,
    pub replicate: u32,
    pub seed: u64,
    pub players: u32,
    pub days: u32,
    /// 第 1 天活跃玩家数(留存分母)
    pub day1_cohort: u64,
    pub retention_d1: Option<f64>,
    pub retention_d3: Option<f64>,
    pub retention_d7: Option<f64>,
    pub retention_d14: Option<f64>,
    pub retention_d30: Option<f64>,
    /// 期末累计流失数与流失率
    pub churn_total: u64,
    pub churn_rate_total: f64,
    /// 全程累计胜率
    pub win_rate: f64,
    pub gold_earned_total: u64,
    pub gold_spent_total: u64,
    /// whale 分群获得的金币占比(无付费语义,文档 13 章)
    pub whale_gold_share: f64,
    /// 日 inflation 序列(d ≥ 2)的均值
    pub inflation_daily_mean: f64,
    /// 最后一天的 inflation
    pub inflation_last: f64,
    /// 日 sink_ratio 序列均值
    pub sink_ratio_mean: f64,
    pub power_snapshots: Vec<PowerSnapshot>,
    pub cohort_stats: Vec<CohortStat>,
    pub day_stats: Vec<DayStat>,
}

/// 线性插值分位数。`sorted` 必须已升序;p ∈ [0, 100]。
pub fn percentile(sorted: &[i64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return sorted[0] as f64;
    }
    let p = p.clamp(0.0, 100.0);
    let idx = p / 100.0 * (sorted.len() - 1) as f64;
    let lo = idx.floor() as usize;
    let hi = idx.ceil() as usize;
    let frac = idx - lo as f64;
    sorted[lo] as f64 * (1.0 - frac) + sorted[hi] as f64 * frac
}

/// 快照日(Power 分布取精确分位数的日期)。
pub const SNAPSHOT_DAYS: [u32; 5] = [1, 3, 7, 14, 30];

#[derive(Default)]
struct DayAcc {
    active: u64,
    new_churned: u64,
    battles: u64,
    wins: u64,
    gold_earned: u64,
    gold_spent: u64,
    whale_gold: u64,
    levelups: u64,
    upgrades: u64,
    power_sum: i128,
    power_count: u64,
}

/// 单次运行内的增量聚合器。
pub struct RunAggregator {
    players: u32,
    days: u32,
    day1_cohort: u64,
    /// 各天"day1 cohort 中的活跃数"(下标 1..=days)
    active_in_cohort: Vec<u64>,
    cur: DayAcc,
    day_stats: Vec<DayStat>,
    power_snapshots: Vec<PowerSnapshot>,
    final_cohort_stats: Option<Vec<CohortStat>>,
    gold_earned_total: u64,
    gold_spent_total: u64,
    whale_gold_total: u64,
    battles_total: u64,
    wins_total: u64,
    churn_total: u64,
    prev_supply: i64,
    sink_ratio_sum: f64,
    inflation_sum: f64,
    inflation_days: u64,
    inflation_last: f64,
}

impl RunAggregator {
    pub fn new(cfg: &SimConfig) -> Self {
        Self {
            players: cfg.players,
            days: cfg.days,
            day1_cohort: 0,
            active_in_cohort: vec![0; cfg.days as usize + 1],
            cur: DayAcc::default(),
            day_stats: Vec::with_capacity(cfg.days as usize),
            power_snapshots: Vec::new(),
            final_cohort_stats: None,
            gold_earned_total: 0,
            gold_spent_total: 0,
            whale_gold_total: 0,
            battles_total: 0,
            wins_total: 0,
            churn_total: 0,
            prev_supply: 0,
            sink_ratio_sum: 0.0,
            inflation_sum: 0.0,
            inflation_days: 0,
            inflation_last: 0.0,
        }
    }

    /// 玩家当日活跃(至少一次会话)。第 1 天计入留存分母。
    pub fn mark_active(&mut self, day: u32, in_day1_cohort: bool) {
        self.cur.active += 1;
        if day == 1 {
            self.day1_cohort += 1;
            self.active_in_cohort[1] += 1;
        } else if in_day1_cohort {
            self.active_in_cohort[day as usize] += 1;
        }
    }

    /// 一次战斗结算(无论胜负)。`gold_gain` 为该场实际入账(含 whale 倍率)。
    pub fn record_battle(&mut self, win: bool, gold_gain: u64, is_whale: bool) {
        self.cur.battles += 1;
        self.battles_total += 1;
        if win {
            self.cur.wins += 1;
            self.wins_total += 1;
        }
        self.cur.gold_earned += gold_gain;
        self.gold_earned_total += gold_gain;
        if is_whale {
            self.cur.whale_gold += gold_gain;
            self.whale_gold_total += gold_gain;
        }
    }

    /// 一次练级会话产出(阻力 #4):金币进经济面,不进战斗统计
    /// (练级不是战斗,胜率分母不含它)。
    pub fn record_training(&mut self, gold_gain: u64) {
        self.cur.gold_earned += gold_gain;
        self.gold_earned_total += gold_gain;
    }

    pub fn record_upgrade(&mut self, cost: i64) {
        self.cur.gold_spent += cost as u64;
        self.gold_spent_total += cost as u64;
        self.cur.upgrades += 1;
    }

    pub fn record_levelup(&mut self, n: u32) {
        self.cur.levelups += n as u64;
    }

    /// 玩家当日流失(当日已活跃过,计入 day1 cohort 逻辑不受影响)。
    pub fn record_churn(&mut self) {
        self.cur.new_churned += 1;
        self.churn_total += 1;
    }

    pub fn observe_power(&mut self, power: i64) {
        self.cur.power_sum += power as i128;
        self.cur.power_count += 1;
    }

    /// 日结。`supply` 为存续玩家金币存量总和 G(d);`snapshot_powers` 为快照日
    /// 传入存活玩家 Power(非快照日传空切片);最后一天传 `cohort_final`。
    pub fn end_day(
        &mut self,
        day: u32,
        alive_at_start: u64,
        supply: i64,
        snapshot_powers: &[i64],
        cohort_final: Option<&[CohortStat]>,
    ) {
        let inflation = (supply - self.prev_supply) as f64 / self.prev_supply.max(1) as f64;
        let sink_ratio = self.cur.gold_spent as f64 / self.cur.gold_earned.max(1) as f64;
        let stat = DayStat {
            day,
            active: self.cur.active,
            alive_at_start,
            new_churned: self.cur.new_churned,
            churn_rate: self.cur.new_churned as f64 / alive_at_start.max(1) as f64,
            battles: self.cur.battles,
            wins: self.cur.wins,
            win_rate: self.cur.wins as f64 / self.cur.battles.max(1) as f64,
            gold_earned: self.cur.gold_earned,
            gold_spent: self.cur.gold_spent,
            sink_ratio,
            gold_supply: supply,
            inflation,
            income_per_active: self.cur.gold_earned as f64 / self.cur.active.max(1) as f64,
            spending_per_active: self.cur.gold_spent as f64 / self.cur.active.max(1) as f64,
            mean_power: if self.cur.power_count > 0 {
                self.cur.power_sum as f64 / self.cur.power_count as f64
            } else {
                0.0
            },
            levelups: self.cur.levelups,
            upgrades: self.cur.upgrades,
        };
        if day >= 2 {
            self.inflation_sum += inflation;
            self.inflation_days += 1;
        }
        self.inflation_last = inflation;
        self.sink_ratio_sum += sink_ratio;
        self.prev_supply = supply;

        if SNAPSHOT_DAYS.contains(&day) {
            let mut sorted = snapshot_powers.to_vec();
            sorted.sort_unstable();
            self.power_snapshots.push(PowerSnapshot {
                day,
                n: sorted.len() as u64,
                p50: percentile(&sorted, 50.0),
                p90: percentile(&sorted, 90.0),
                p99: percentile(&sorted, 99.0),
            });
        }
        if let Some(cs) = cohort_final {
            self.final_cohort_stats = Some(cs.to_vec());
        }
        self.day_stats.push(stat);
        self.cur = DayAcc::default();
    }

    /// 汇总为 RunMetrics。
    pub fn finish(self, cfg: &SimConfig, replicate: u32, seed: u64) -> RunMetrics {
        let last_day = self.days;
        let ret = |n: u32| -> Option<f64> {
            if n > last_day || self.day1_cohort == 0 {
                return None;
            }
            Some(self.active_in_cohort[n as usize] as f64 / self.day1_cohort as f64)
        };
        RunMetrics {
            schema_version: crate::SCHEMA_VERSION,
            model_version: crate::MODEL_VERSION,
            config_hash: crate::config::config_hash(cfg),
            replicate,
            seed,
            players: self.players,
            days: self.days,
            day1_cohort: self.day1_cohort,
            retention_d1: ret(1),
            retention_d3: ret(3),
            retention_d7: ret(7),
            retention_d14: ret(14),
            retention_d30: ret(30),
            churn_total: self.churn_total,
            churn_rate_total: self.churn_total as f64 / self.players.max(1) as f64,
            win_rate: self.wins_total as f64 / self.battles_total.max(1) as f64,
            gold_earned_total: self.gold_earned_total,
            gold_spent_total: self.gold_spent_total,
            whale_gold_share: self.whale_gold_total as f64 / self.gold_earned_total.max(1) as f64,
            inflation_daily_mean: if self.inflation_days > 0 {
                self.inflation_sum / self.inflation_days as f64
            } else {
                0.0
            },
            inflation_last: self.inflation_last,
            sink_ratio_mean: self.sink_ratio_sum / self.days.max(1) as f64,
            power_snapshots: self.power_snapshots,
            cohort_stats: self.final_cohort_stats.unwrap_or_default(),
            day_stats: self.day_stats,
        }
    }
}

/// 期末按分群切片统计(仅最后一天日结时传入 `end_day`)。
pub fn cohort_slice(actors: &[crate::world::Actor]) -> Vec<CohortStat> {
    let mut stats = Cohort::ALL.map(|c| CohortStat {
        cohort: c.name(),
        count: 0,
        churned: 0,
        mean_power: 0.0,
        mean_gold: 0.0,
        mean_level: 0.0,
    });
    for a in actors {
        let s = &mut stats[a.cohort.index()];
        s.count += 1;
        if a.churned {
            s.churned += 1;
        }
        s.mean_power += a.power as f64;
        s.mean_gold += a.gold as f64;
        s.mean_level += a.level as f64;
    }
    for s in &mut stats {
        let n = s.count.max(1) as f64;
        s.mean_power /= n;
        s.mean_gold /= n;
        s.mean_level /= n;
    }
    stats.to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 分位数_插值() {
        let v = vec![10, 20, 30, 40];
        assert_eq!(percentile(&v, 0.0), 10.0);
        assert_eq!(percentile(&v, 100.0), 40.0);
        assert_eq!(percentile(&v, 50.0), 25.0); // (20+30)/2
        assert_eq!(percentile(&v, 75.0), 32.5); // 30 + 0.5*(40-30)
    }

    #[test]
    fn 分位数_空与单点() {
        assert_eq!(percentile(&[], 50.0), 0.0);
        assert_eq!(percentile(&[7], 99.0), 7.0);
    }

    #[test]
    fn 汇总_留存分母是_day1_cohort() {
        let cfg = SimConfig {
            players: 4,
            days: 7,
            ..SimConfig::default()
        };
        let mut agg = RunAggregator::new(&cfg);
        // day1:4 人全活跃
        for _ in 0..4 {
            agg.mark_active(1, false);
        }
        // day2:day1 cohort 中 3 人活跃
        for _ in 0..3 {
            agg.mark_active(2, true);
        }
        agg.end_day(1, 4, 0, &[100, 100, 100, 100], None);
        agg.end_day(2, 4, 0, &[100, 100, 100], None);
        for d in 3..=7 {
            agg.end_day(d, 3, 0, &[], None);
        }
        let m = agg.finish(&cfg, 0, cfg.base_seed);
        assert_eq!(m.day1_cohort, 4);
        assert_eq!(m.retention_d1, Some(1.0));
        assert_eq!(m.retention_d3, Some(0.0));
        assert_eq!(m.retention_d7, Some(0.0));
        assert!(m.retention_d14.is_none()); // 超出运行天数
        assert_eq!(m.power_snapshots.len(), 3); // 快照日 1/3/7 ⊆ 运行窗口
    }
}
