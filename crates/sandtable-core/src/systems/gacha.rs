//! 抽卡保底系统(文档 24 章 R2):保底状态机 + 抽数 KPI。
//!
//! 状态机语义(配置面 [`crate::config::GachaConfig`]):
//! - 单抽成功率 `p' = min(1, base_rate + max(0, n − pity_soft_start + 1)·pity_soft_step)`,
//!   其中 n = 距上次命中的抽数(1 起始,= since_hit + 1);`pity_soft_start` 是第 1 个
//!   获得概率加成的抽数(1 起始,与官方公示"自第 N 抽起软保底"一致,2026-10-31 校准修正
//!   旧实现 +2 抽偏移:旧式 `max(0, k − soft_start)` 使软保底实际起于 soft_start+2 抽);
//! - 硬保底:`n ≥ pity_hard > 0` 时 `p' = 1`(第 pity_hard 抽必中);
//! - 软保底只在 `pity_soft_step > 0` 时生效(起点前增量为 0,天然退化)。
//! - 定轨层(2026-11-01 校准,`featured_rate`/`featured_guarantee`):5★ 命中后独立判定
//!   是否为所定目标(带键 [`Purpose::GachaFeatured`]);连续非目标达到 `featured_guarantee`
//!   后下一次 5★ 必为目标。该层不改 5★ 率面、用独立 RNG 流——无定轨配置的 5★ 流
//!   逐字节不变(CRN 可比)。
//!
//! 确定性:逐抽消耗带键 [`Purpose::Gacha`] 事件;保底计数器是 actor
//! 确定性状态、**不进 RNG 键**——改保底参数只改概率面,不挪键(CRN 保持,
//! A/B 臂逐玩家同键可比)。

use crate::config::GachaConfig;
use crate::rng::{DayRng, Purpose};
use crate::world::Actor;

/// 下一次抽取的命中率:基础率 + 软保底增量,硬保底钳到 1。
/// `since_hit` 为距上次命中的连续未中抽数,故本次是第 `since_hit + 1` 抽。
pub fn hit_rate(cfg: &GachaConfig, since_hit: u64) -> f64 {
    let mut p = cfg.base_rate;
    if cfg.pity_soft_step > 0.0 {
        // 抽 n = since_hit + 1 的增量 = max(0, n − pity_soft_start + 1)·step。
        // 用 i128 免 u64 下溢(soft_start < 2 时 n − soft_start + 1 可为 0 或正)。
        let n = since_hit as i128 + 1;
        let bonus = (n - cfg.pity_soft_start as i128 + 1).max(0) as f64 * cfg.pity_soft_step;
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

/// 定轨判定:下一次 5★ 是否因连续非目标达到阈值而被强制为所定目标。
/// 仅当 `featured_rate > 0`(有目标概念)且 `featured_guarantee > 0` 时成立。
pub fn featured_is_guaranteed(cfg: &GachaConfig, off_featured: u64) -> bool {
    cfg.featured_rate > 0.0 && cfg.featured_guarantee > 0 && off_featured >= cfg.featured_guarantee
}

/// 抽到「所定目标」的会话语义:重复 5★ 命中直到命中所定目标,期间非目标 5★
/// 累计定轨计数(`actor.gacha_off_featured`),命中目标即清零。
/// `featured_rate <= 0`(无目标概念,如常驻池)时退化为 [`pull_until_hit`]。
///
/// 定轨语义(2026-11-01 校准,溯源见 `data/public/genshin/sources.md`):
/// 角色池 `featured_rate = 0.5` / `featured_guarantee = 1`(50/50,歪后必 UP);
/// 武器池 Version 5.0 起 `0.375` / `1`(双 UP 各 37.5%,所定单武器,最坏 160 抽;
/// 此前 2 点最坏 240);常驻池 `0` / `0`(无定轨)。
pub fn pull_until_featured(rng: &mut DayRng, actor: &mut Actor, cfg: &GachaConfig) -> u64 {
    if cfg.featured_rate <= 0.0 {
        return pull_until_hit(rng, actor, cfg);
    }
    let before = actor.gacha_pulls;
    loop {
        // 5★ 率面与定轨无关:先走独立 5★ 命中会话,再判定是否为目标。
        pull_until_hit(rng, actor, cfg);
        let p = if featured_is_guaranteed(cfg, actor.gacha_off_featured) {
            1.0
        } else {
            cfg.featured_rate
        };
        if rng.chance(Purpose::GachaFeatured, p) {
            actor.gacha_off_featured = 0;
            return actor.gacha_pulls - before;
        }
        actor.gacha_off_featured += 1;
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
            featured_rate: 0.0,
            featured_guarantee: 0,
        }
    }

    /// 状态机逐点:无保底恒为基础率;硬保底在第 pity_hard 抽钳到 1;
    /// 软保底从起点后线性爬升并钳到 1;软硬同时命中取硬(= 1);
    /// step = 0 时软保底整体不生效。
    #[test]
    fn hit_rate_state_machine_points() {
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
        assert_eq!(hit_rate(&soft, 0), 0.02); // 抽 1:起点前无增量
        assert_eq!(hit_rate(&soft, 38), 0.02); // 抽 39:起点(40)前无增量
        assert_eq!(hit_rate(&soft, 39), 0.02 + 0.05); // 抽 40 = 起点,增量 1·0.05
        assert_eq!(hit_rate(&soft, 40), 0.02 + 2.0 * 0.05); // 抽 41:增量 2·0.05
        assert_eq!(hit_rate(&soft, 60), 1.0); // 增量 22·0.05 → 钳到 1

        let both = cfg(0.02, 50, 40, 0.05);
        assert_eq!(hit_rate(&both, 45), 0.02 + 7.0 * 0.05); // 抽 46:软保底爬升 0.02 + 7·0.05
        assert_eq!(hit_rate(&both, 49), 1.0); // 硬保底压过软保底

        // step = 0 → 软保底整体不生效(即便起点为 0)
        let no_soft = cfg(0.02, 0, 0, 0.0);
        assert_eq!(hit_rate(&no_soft, 100), 0.02);
    }

    /// 会话语义:pull_until_hit 恰好一次命中、计数自洽
    /// (pulls = since_hit 累计 + 1;命中即清零 since_hit)。
    #[test]
    fn session_exactly_one_hit() {
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
    fn session_counter_resets_after_hit() {
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
    fn soft_pity_reduces_pulls() {
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
    fn no_pity_pulls_match_closed_form() {
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
    fn hard_pity_pulls_match_closed_form() {
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

    /// 定轨层:featured_rate ≤ 0 退化为单层 5★ 会话(抽数逐点一致);
    /// 定轨阈值处判定为真;有定轨时会话必在有限 5★ 内命中目标且计数清零;
    /// 无定轨(featured_guarantee=0)时每次 5★ 独立判定。
    #[test]
    fn featured_layer_semantics() {
        // 无目标概念 → pull_until_featured 与 pull_until_hit 抽数逐点一致
        let plain = cfg(0.02, 50, 0, 0.0);
        for i in 0..30u64 {
            let mut r1 = DayRng::new(7, i, 0);
            let mut r2 = DayRng::new(7, i, 0);
            let mut a1 = new_actor(i);
            let mut a2 = new_actor(i);
            assert_eq!(
                pull_until_featured(&mut r1, &mut a1, &plain),
                pull_until_hit(&mut r2, &mut a2, &plain)
            );
            assert_eq!(a1.gacha_off_featured, 0);
        }

        // 定轨阈值判定:featured_guarantee=1 → 连续 1 次非目标后必为目标
        let mut c = cfg(0.02, 50, 0, 0.0);
        c.featured_rate = 0.5;
        c.featured_guarantee = 1;
        assert!(!featured_is_guaranteed(&c, 0));
        assert!(featured_is_guaranteed(&c, 1));
        assert!(featured_is_guaranteed(&c, 5));

        // 有定轨:会话必命中目标、命中后计数清零、抽数 ≤ 最坏 2 次 5★ × 硬保底 50
        for i in 0..200u64 {
            let mut rng = DayRng::new(11, i, 0);
            let mut a = new_actor(i);
            pull_until_featured(&mut rng, &mut a, &c);
            assert!(
                a.gacha_hits >= 1 && a.gacha_hits <= 2,
                "hits={}",
                a.gacha_hits
            );
            assert_eq!(a.gacha_off_featured, 0, "命中目标后定轨计数清零");
            assert!(
                a.gacha_pulls <= 100,
                "最坏 2×50=100:pulls={}",
                a.gacha_pulls
            );
        }
    }

    /// 无定轨(featured_guarantee=0):5★ 独立判定,目标命中会话数服从几何(均 2 次 5★)。
    #[test]
    fn featured_without_guarantee_is_geometric() {
        let mut c = cfg(0.02, 50, 0, 0.0);
        c.featured_rate = 0.5;
        c.featured_guarantee = 0;
        let n = 2000u64;
        let mean_hits: f64 = (0..n)
            .map(|i| {
                let mut rng = DayRng::new(42, i, 0);
                let mut a = new_actor(i);
                pull_until_featured(&mut rng, &mut a, &c);
                a.gacha_hits as f64
            })
            .sum::<f64>()
            / n as f64;
        // E[#5★] = 1/0.5 = 2,σ=√2 → SE≈0.03,给 0.25 余量
        assert!((mean_hits - 2.0).abs() < 0.25, "E[#5★]=2,实测 {mean_hits}");
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
            gacha_off_featured: 0,
        }
    }
}
