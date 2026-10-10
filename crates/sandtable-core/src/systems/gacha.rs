//! 抽卡保底系统(文档 24 章 R2):保底状态机 + 抽数 KPI。
//!
//! 状态机语义(配置面 [`crate::config::GachaConfig`]):
//! - 单抽成功率 `p' = min(1, base_rate + max(0, k − pity_soft_start)·pity_soft_step)`,
//!   其中 k = 距上次命中的连续未中抽数;
//! - 硬保底:`k + 1 ≥ pity_hard > 0` 时 `p' = 1`(第 pity_hard 抽必中);
//! - 软保底只在 `pity_soft_step > 0` 时生效(起点前增量为 0,天然退化)。
//!
//! 确定性:逐抽消耗带键 [`Purpose::Gacha`] 事件;保底计数器是 actor
//! 确定性状态、**不进 RNG 键**——改保底参数只改概率面,不挪键(CRN 保持,
//! A/B 臂逐玩家同键可比)。

use crate::config::GachaConfig;
use crate::rng::{DayRng, Purpose};
use crate::world::Actor;

/// 下一次抽取的命中率:基础率 + 软保底增量,硬保底钳到 1。
pub fn hit_rate(cfg: &GachaConfig, since_hit: u64) -> f64 {
    let mut p = cfg.base_rate;
    if cfg.pity_soft_step > 0.0 {
        let bonus = (since_hit.saturating_sub(cfg.pity_soft_start)) as f64 * cfg.pity_soft_step;
        p += bonus;
    }
    if cfg.pity_hard > 0 && since_hit + 1 >= cfg.pity_hard {
        p = 1.0;
    }
    p.min(1.0)
}

/// 一次抽卡会话:逐抽直到首次命中(会话语义:抽数 KPI 即"出到即止"的
/// 期望抽数 E[T]),更新 actor 的计数状态,返回本次消耗的抽数。
pub fn pull_until_hit(rng: &mut DayRng, actor: &mut Actor, cfg: &GachaConfig) -> u64 {
    let before = actor.gacha_pulls;
    loop {
        let p = hit_rate(cfg, actor.gacha_since_hit);
        actor.gacha_pulls += 1;
        if rng.chance(Purpose::Gacha, p) {
            actor.gacha_hits += 1;
            actor.gacha_since_hit = 0;
            return actor.gacha_pulls - before;
        }
        actor.gacha_since_hit += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(base_rate: f64, pity_hard: u64, soft_start: u64, soft_step: f64) -> GachaConfig {
        GachaConfig {
            base_rate,
            pity_hard,
            pity_soft_start: soft_start,
            pity_soft_step: soft_step,
        }
    }

    /// 状态机逐点:无保底恒为基础率;硬保底在第 pity_hard 抽钳到 1;
    /// 软保底从起点后线性爬升并钳到 1;软硬同时命中取硬(= 1);
    /// step = 0 时软保底整体不生效。
    #[test]
    fn 命中率_状态机逐点() {
        let c = cfg(0.02, 0, 0, 0.0);
        for k in [0u64, 5, 100, 1000] {
            assert_eq!(hit_rate(&c, k), 0.02, "无保底 k={k}");
        }

        let hard = cfg(0.02, 50, 0, 0.0);
        assert_eq!(hit_rate(&hard, 0), 0.02);
        assert_eq!(hit_rate(&hard, 47), 0.02); // k+1 = 48 < 50
        assert_eq!(hit_rate(&hard, 48), 0.02); // k+1 = 49 < 50
        assert_eq!(hit_rate(&hard, 49), 1.0); // k+1 = 50 → 必中

        let soft = cfg(0.02, 0, 40, 0.05);
        assert_eq!(hit_rate(&soft, 0), 0.02);
        assert_eq!(hit_rate(&soft, 40), 0.02); // 起点前无增量
        assert_eq!(hit_rate(&soft, 41), 0.07); // (41−40)·0.05
        assert_eq!(hit_rate(&soft, 60), 1.0); // 1.02 钳到 1

        let both = cfg(0.02, 50, 40, 0.05);
        assert_eq!(hit_rate(&both, 45), 0.27); // 软保底爬升 0.02 + 5·0.05
        assert_eq!(hit_rate(&both, 49), 1.0); // 硬保底压过软保底

        // step = 0 → 软保底整体不生效(即便起点为 0)
        let no_soft = cfg(0.02, 0, 0, 0.0);
        assert_eq!(hit_rate(&no_soft, 100), 0.02);
    }

    /// 会话语义:pull_until_hit 恰好一次命中、计数自洽
    /// (pulls = since_hit 累计 + 1;命中即清零 since_hit)。
    #[test]
    fn 会话_恰好一次命中() {
        for i in 0..50u64 {
            let mut rng = DayRng::new(7, i, 0);
            let mut a = new_actor(i);
            pull_until_hit(&mut rng, &mut a, &cfg(0.02, 80, 0, 0.0));
            assert_eq!(a.gacha_hits, 1);
            assert!(
                a.gacha_pulls <= 80,
                "硬保底 80 内必中:pulls={}",
                a.gacha_pulls
            );
            assert_eq!(a.gacha_since_hit, 0);
            // pulls − 1 = 命中前连续未中数,命中后清零,只能从 pulls 侧自证:
            // 再抽一次必从头计数(下一段由计数器接力测试覆盖)
        }
    }

    /// 保底计数器跨会话接力:命中后 since_hit 清零,下一会话从基础率重新爬坡
    /// (同 actor 复用同一 rng 流,Gacha 计数器顺序推进)。
    #[test]
    fn 会话_命中后计数器清零重爬() {
        let c = cfg(0.02, 60, 0, 0.0);
        let mut rng = DayRng::new(7, 3, 0);
        let mut a = new_actor(3);
        for _ in 0..3 {
            pull_until_hit(&mut rng, &mut a, &c);
            assert_eq!(a.gacha_since_hit, 0);
        }
        assert_eq!(a.gacha_hits, 3);
        assert!(
            a.gacha_pulls <= 180,
            "三次会话各 ≤ 60 抽:pulls={}",
            a.gacha_pulls
        );
    }

    /// 软保底方向(CRN):同键流下,爬坡概率面的平均抽数严格小于无保底基线。
    #[test]
    fn 软保底_降抽数方向() {
        let base = cfg(0.02, 0, 0, 0.0);
        let soft = cfg(0.02, 0, 10, 0.05);
        let mean = |c: &GachaConfig| -> f64 {
            let n = 500u64;
            (0..n)
                .map(|i| {
                    let mut rng = DayRng::new(7, i, 0);
                    let mut a = new_actor(i);
                    pull_until_hit(&mut rng, &mut a, c);
                    a.gacha_pulls as f64
                })
                .sum::<f64>()
                / n as f64
        };
        let mb = mean(&base);
        let ms = mean(&soft);
        assert!(ms < mb, "软保底应降抽数:soft={ms} 应 < base={mb}");
    }

    /// 无保底几何分布期望:E[T] = 1/p。基线 p=0.02 → 50 抽,CI 内核对。
    #[test]
    fn 无保底_期望抽数对齐解析解() {
        let c = cfg(0.02, 0, 0, 0.0);
        let n = 2000u64;
        let mean: f64 = (0..n)
            .map(|i| {
                let mut rng = DayRng::new(42, i, 0);
                let mut a = new_actor(i);
                pull_until_hit(&mut rng, &mut a, &c);
                a.gacha_pulls as f64
            })
            .sum::<f64>()
            / n as f64;
        // 几何分布 σ = √(1−p)/p ≈ 49.5 → n=2000 时 SE ≈ 1.1,给 4.0 余量
        assert!((mean - 50.0).abs() < 4.0, "E[T] = 1/p = 50,实测 {mean}");
    }

    /// 硬保底解析解:E[T] = Σ_{t=1..H-1} t·(1−p)^{t−1}·p + H·(1−p)^{H−1}。
    /// p=0.02, H=50 → ≈ 31.79(文档 24 章 R2 验收数)。
    #[test]
    fn 硬保底_期望抽数对齐解析解() {
        let c = cfg(0.02, 50, 0, 0.0);
        let n = 2000u64;
        let mean: f64 = (0..n)
            .map(|i| {
                let mut rng = DayRng::new(42, i, 0);
                let mut a = new_actor(i);
                pull_until_hit(&mut rng, &mut a, &c);
                a.gacha_pulls as f64
            })
            .sum::<f64>()
            / n as f64;
        let p: f64 = 0.02;
        let analytic: f64 = (1..=49)
            .map(|t| t as f64 * (1.0 - p).powi(t - 1) * p)
            .sum::<f64>()
            + 50.0 * (1.0 - p).powi(49);
        // σ ≈ 22 → SE ≈ 0.5,给 1.0 余量
        assert!(
            (mean - analytic).abs() < 1.0,
            "E[T] 解析 {analytic} vs 实测 {mean}"
        );
    }

    fn new_actor(id: u64) -> Actor {
        Actor {
            id,
            cohort: crate::config::Cohort::Core,
            attack: 0,
            defense: 0,
            hp: 0,
            level: 1,
            xp_into_level: 0,
            upgrades: 0,
            upgrade_cost_next: 0,
            gold: 0,
            power: 0,
            active: false,
            churned: false,
            in_day1_cohort: false,
            idle_streak: 0,
            gacha_since_hit: 0,
            gacha_pulls: 0,
            gacha_hits: 0,
        }
    }
}
