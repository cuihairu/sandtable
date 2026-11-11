//! 逐域校验(文档 10 章):加载期拒绝非法 / 死配置,全部返回结构化
//! ConfigError;sim::run 假定已通过本函数。

use crate::Error;

use super::*;

/// 校验(文档 10 章:配置错误返回具体原因,退出码 2)。
pub fn validate(cfg: &SimConfig) -> crate::Result<()> {
    if cfg.players == 0 {
        return Err(Error::Config("players 必须大于 0".into()));
    }
    if cfg.days == 0 {
        return Err(Error::Config("days 必须大于 0".into()));
    }
    if cfg.players > MAX_SIM_DIM {
        return Err(Error::Config(format!(
            "players 不能超过 {MAX_SIM_DIM}(仿真规模预算 {MAX_SIM_SCALE} 的上界)"
        )));
    }
    if cfg.days > MAX_SIM_DIM {
        return Err(Error::Config(format!(
            "days 不能超过 {MAX_SIM_DIM}(仿真规模预算 {MAX_SIM_SCALE} 的上界)"
        )));
    }
    let scale = cfg.players as u64 * cfg.days as u64;
    if scale > MAX_SIM_SCALE {
        return Err(Error::Config(format!(
            "players × days = {scale} 超出仿真规模预算 {MAX_SIM_SCALE}(调小 population / duration)"
        )));
    }
    if cfg.combat.max_rounds > crate::rng::MAX_ROUND_SLOTS {
        return Err(Error::Config(format!(
            "max_rounds 不能超过 {}(战斗键的槽位约束)",
            crate::rng::MAX_ROUND_SLOTS
        )));
    }
    if cfg.combat.max_rounds == 0 {
        return Err(Error::Config(
            "combat.max_rounds 不能为 0(0 会让全部战斗判负)".into(),
        ));
    }
    if !cfg.combat.ratio_k.is_finite() || cfg.combat.ratio_k <= 0.0 {
        return Err(Error::Config(
            "combat.ratio_k 必须为有限正数(仅 ratio 口径生效)".into(),
        ));
    }
    if cfg.churn.stall_days == 0 {
        return Err(Error::Config(
            "churn.stall_days 不能为 0(0 会让 idle_streak >= 0 恒真,流失率失真)".into(),
        ));
    }
    if cfg.warrior.attack <= 0 || cfg.warrior.defense <= 0 || cfg.warrior.hp <= 0 {
        return Err(Error::Config(
            "warrior.attack/defense/hp 必须为正(战力与存活需正数)".into(),
        ));
    }
    if cfg.warrior.attack > MAX_ECONOMY_VALUE
        || cfg.warrior.defense > MAX_ECONOMY_VALUE
        || cfg.warrior.hp > MAX_ECONOMY_VALUE
    {
        return Err(Error::Config(format!(
            "warrior.attack/defense/hp 不能超过 {MAX_ECONOMY_VALUE}(战力运算上界)"
        )));
    }
    if cfg.dungeon.tiers == 0 || cfg.dungeon.tiers > 64 {
        return Err(Error::Config("tiers 必须在 1..=64".into()));
    }
    if cfg.dungeon.reward_gold < 0 || cfg.dungeon.reward_xp < 0 {
        return Err(Error::Config(
            "reward_gold / reward_xp 不能为负(负奖励会让经济面 u64 回绕)".into(),
        ));
    }
    // I-014:怪物数值与成长倍率必须有限为正,否则 powi/乘积会塌成 NaN/Inf
    // 再经 as i64 洗成有限值(战力/掉落/分位数全错)。逐字段显式拦截。
    let d = &cfg.dungeon;
    for (name, v) in [
        ("m_hp", d.m_hp),
        ("m_attack", d.m_attack),
        ("m_defense", d.m_defense),
    ] {
        if v <= 0 || v > MAX_ECONOMY_VALUE {
            return Err(Error::Config(format!(
                "dungeon.{name} 必须在 (0, {MAX_ECONOMY_VALUE}] 区间(正数且有上界)"
            )));
        }
    }
    for (name, v) in [
        ("tier_growth", d.tier_growth),
        ("reward_gold_growth", d.reward_gold_growth),
        ("reward_xp_growth", d.reward_xp_growth),
    ] {
        if !v.is_finite() || v <= 0.0 {
            return Err(Error::Config(format!(
                "dungeon.{name} 必须为有限正数(负/零/NaN 会让逐层数值塌陷)"
            )));
        }
    }
    // 2026-11-06 审核发现:有限正增长率 alone 不够——`1e308.powi(63)` 会
    // 溢出为 Inf,再经 `as i64` 饱和为 `i64::MAX`。按最高使用层校验派生值,
    // 确保几何曲线本身保持在经济数值上界内,而不是只看增长率字面值。
    let highest_tier = cfg.dungeon.tiers - 1;
    if cfg.dungeon.tier_table.is_none() {
        for (name, base) in [
            ("m_hp", d.m_hp),
            ("m_attack", d.m_attack),
            ("m_defense", d.m_defense),
        ] {
            let highest = base as f64 * d.tier_growth.powi(highest_tier as i32);
            if !highest.is_finite() || highest > MAX_ECONOMY_VALUE as f64 {
                return Err(Error::Config(format!(
                    "dungeon.{name} × tier_growth^{highest_tier} 必须不超过 {MAX_ECONOMY_VALUE}(最高层派生值溢出会饱和为 i64::MAX)"
                )));
            }
        }
    }
    // 2026-11-07 复审整改:显式层表全行给定 gold/xp 时,几何回退值不被使用
    // (combat::monster_of 按行内显式值取数),此时不按派生值拒绝——回退兜底
    // 仅服务表外越界层,不在本守卫范围。部分行缺省时回退仍参与行为,照常校验。
    let explicit_rewards = cfg.dungeon.tier_table.as_ref().is_some_and(|rows| {
        !rows.is_empty() && rows.iter().all(|r| r.gold.is_some() && r.xp.is_some())
    });
    if !explicit_rewards {
        for (name, base, growth) in [
            ("reward_gold", d.reward_gold, d.reward_gold_growth),
            ("reward_xp", d.reward_xp, d.reward_xp_growth),
        ] {
            if base == 0 {
                continue;
            }
            let highest = base as f64 * growth.powi(highest_tier as i32);
            if !highest.is_finite() || highest > MAX_ECONOMY_VALUE as f64 {
                return Err(Error::Config(format!(
                    "dungeon.{name} × {}_growth^{highest_tier} 必须不超过 {MAX_ECONOMY_VALUE}(最高层派生值溢出会饱和为 i64::MAX)",
                    name
                )));
            }
        }
    }
    if cfg.whale_gain_mult <= 0 || cfg.whale_gain_mult > MAX_ECONOMY_VALUE {
        return Err(Error::Config(format!(
            "model.whale_gain_mult 必须在 (0, {MAX_ECONOMY_VALUE}] 区间(负数或溢出量级会污染经济指标)"
        )));
    }
    if let Some(training) = &cfg.training {
        if training.xp < 0 || training.gold < 0 {
            return Err(Error::Config(
                "training.xp / training.gold 不能为负(负产出会让经济面 u64 回绕)".into(),
            ));
        }
    }
    if let Some(rows) = &cfg.dungeon.tier_table {
        if rows.is_empty() || rows.len() > 64 {
            return Err(Error::Config("tier_table 长度必须在 1..=64".into()));
        }
        if rows.len() != cfg.dungeon.tiers as usize {
            return Err(Error::Config(format!(
                "tier_table 长度 {} 与 tiers {} 不一致(表模式下层数由数组长度决定)",
                rows.len(),
                cfg.dungeon.tiers
            )));
        }
        if rows.iter().any(|r| r.hp <= 0) {
            return Err(Error::Config("tier_table 每层 hp 必须为正".into()));
        }
        // 行级战斗面校验(2026-11-12 审核修复批 P1):attack/defense 此前
        // 连正负都未设防;巨值进 combat 的 ceil_div/attack*2 溢出 i64 使
        // 选层逻辑失真。与 warrior 三键同面同界(经济统一上界)。
        for (i, r) in rows.iter().enumerate() {
            if r.attack <= 0 || r.defense <= 0 {
                return Err(Error::Config(format!(
                    "tier_table[{i}]: attack/defense 必须为正(逐层怪物数值需正数)"
                )));
            }
            if r.hp > MAX_ECONOMY_VALUE
                || r.attack > MAX_ECONOMY_VALUE
                || r.defense > MAX_ECONOMY_VALUE
            {
                return Err(Error::Config(format!(
                    "tier_table[{i}]: hp/attack/defense 不能超过 {MAX_ECONOMY_VALUE}(战斗运算上界)"
                )));
            }
            if let Some(g) = r.gold {
                if !(0..=MAX_ECONOMY_VALUE).contains(&g) {
                    return Err(Error::Config(format!(
                        "tier_table[{i}]: gold 必须在 [0, {MAX_ECONOMY_VALUE}] 内"
                    )));
                }
            }
            if let Some(x) = r.xp {
                if !(0..=MAX_ECONOMY_VALUE).contains(&x) {
                    return Err(Error::Config(format!(
                        "tier_table[{i}]: xp 必须在 [0, {MAX_ECONOMY_VALUE}] 内"
                    )));
                }
            }
        }
    }
    // 掉落加权表:权重非负、至少一项为正、表名非空(编译期校验由
    // rng::WeightedTable 承担,这里给出带路径的报错)
    if let Some(loot) = &cfg.loot {
        if !loot.rate_mult.is_finite() || loot.rate_mult <= 0.0 {
            return Err(Error::Config(
                "model.loot.rate_mult 必须为正(≤ 0 会让全部权重失效)".into(),
            ));
        }
        for (name, table) in &loot.tables {
            if name.is_empty() {
                return Err(Error::Config("model.loot: 表名不能为空".into()));
            }
            if table.weights.is_empty() {
                return Err(Error::Config(format!(
                    "model.loot.tables.{name}: 权重表不能为空"
                )));
            }
            let path = format!("model.loot.tables.{name}");
            let weights: Vec<(String, f64)> =
                table.weights.iter().map(|(k, v)| (k.clone(), *v)).collect();
            if crate::rng::WeightedTable::from_weights(&weights).is_err() {
                return Err(Error::Config(format!(
                    "{path}: 权重必须为有限非负数且至少一项为正"
                )));
            }
        }
        // 胜利绑定:必须指名一张既有表(显式性——不猜默认表,漏配即报错)
        if loot.on_victory.is_empty() {
            return Err(Error::Config(
                "model.loot.on_victory: 必须指名掉落表名(tables 中的键)".into(),
            ));
        }
        if !loot.tables.contains_key(&loot.on_victory) {
            return Err(Error::Config(format!(
                "model.loot.on_victory: 表 {} 不存在(tables 中无此键)",
                loot.on_victory
            )));
        }
        // 结算数额:非负、不得全零(全零条目抽到了也不产出,是死配置)
        for (name, r) in &loot.rewards {
            if r.gold < 0 || r.xp < 0 {
                return Err(Error::Config(format!(
                    "model.loot.rewards.{name}: 数额不能为负"
                )));
            }
            if r.gold == 0 && r.xp == 0 {
                return Err(Error::Config(format!(
                    "model.loot.rewards.{name}: 数额不能全为零(至少一项 > 0)"
                )));
            }
        }
        // 表条目 ↔ rewards 双向对账:抽到却没有数额是死掉落,
        // 定义了却无人抽取是死配置——两种都拒载(同 ratio_k 口径显式性)
        for (name, table) in &loot.tables {
            for item in table.weights.keys() {
                if !loot.rewards.contains_key(item) {
                    return Err(Error::Config(format!(
                        "model.loot.tables.{name}: 条目 {item} 缺少 rewards 定义"
                    )));
                }
            }
        }
        for item in loot.rewards.keys() {
            if !loot.tables.values().any(|t| t.weights.contains_key(item)) {
                return Err(Error::Config(format!(
                    "model.loot.rewards.{item}: 无表引用(死配置)"
                )));
            }
        }
    }
    if let Some(gacha) = &cfg.gacha {
        if !gacha.base_rate.is_finite()
            || gacha.base_rate < MIN_GACHA_BASE_RATE
            || gacha.base_rate > 1.0
        {
            return Err(Error::Config(
                format!(
                    "model.gacha.base_rate 必须在 [{MIN_GACHA_BASE_RATE}, 1] 区间(低于下限会让抽卡会话期望抽数失控)"
                ),
            ));
        }
        if gacha.pity_hard > MAX_GACHA_PULLS {
            return Err(Error::Config(format!(
                "model.gacha.pity_hard 不能超过 {MAX_GACHA_PULLS}(抽卡会话最大抽数)"
            )));
        }
        if !gacha.pity_soft_step.is_finite() || gacha.pity_soft_step < 0.0 {
            return Err(Error::Config(
                "model.gacha.pity_soft_step 必须为非负有限数".into(),
            ));
        }
        if !gacha.featured_rate.is_finite() || !(0.0..=1.0).contains(&gacha.featured_rate) {
            return Err(Error::Config(
                "model.gacha.featured_rate 必须在 [0, 1] 内的有限数".into(),
            ));
        }
        // 目标命中尾部界(2026-11-07 第四轮复审整改,分支化给出可证明的界):
        // 过检配置要求单会话触限概率 ≤ e^{-100},使 sim 层的超限处置(记为
        // 该玩家未命中并继续,`sim.rs` 防御纵深)保持其「运行时不可能路径」
        // 注释成立;validate 不改 sim 的截断语义。会话内 off_featured 从 0
        // 起(会话只在命中后结束),各分支:
        // - 有硬保底:会话 5★ 数是确定值 N = MAX/pity_hard(软保底只增不减)。
        //   定轨(g ≥ 1)且 N ≥ g+1 时,前 g+1 个 5★ 必含一次命中(前 g 个
        //   全歪则第 g+1 个定轨必中),溢出不可能;否则溢出概率 =
        //   (1-featured_rate)^N ≤ e^{-featured_rate·N},要求
        //   featured_rate × N ≥ MAX × MIN_GACHA_TARGET_RATE。
        // - 无硬保底:5★ 数 X ~ Bin(MAX, base_rate)(软保底只增不减),
        //   μ = MAX × base_rate 是期望不是下界,不能当确定值用(反例:
        //   g=1、base=1e-4、f=1e-100 在第三轮口径下边界放行,实际溢出概率
        //   ≈ 101·e^{-100} > e^{-100})。无定轨(g=0):溢出 = 全程无命中,
        //   P = (1-base×f)^MAX ≤ e^{-μ·f},要求 μ × featured_rate ≥
        //   MAX × MIN_GACHA_TARGET_RATE(2026-11-06 审核发现的原始动机:
        //   两因子各取下限 1e-4 时乘积 1e-8,触限概率趋于 1,单看一侧拦不住);
        //   有定轨:溢出 ⊆ {X ≤ g}(前 g+1 个 5★ 必含一次命中),当
        //   g+1 ≤ μ/2 时 P(X ≤ μ/2) ≤ e^{-μ/8}(multiplicative Chernoff),
        //   要求 μ ≥ 2(g+1) 且 μ ≥ 800。
        let threshold = MAX_GACHA_PULLS as f64 * MIN_GACHA_TARGET_RATE;
        if gacha.featured_rate > 0.0 {
            let ok = if let Some(n_stars) = MAX_GACHA_PULLS.checked_div(gacha.pity_hard) {
                let n_stars = n_stars as f64;
                // g+1 用 saturating:g = u64::MAX 时普通加法溢出(debug panic /
                // release 回绕为 0,会让「定轨必触发」恒真放行,第五轮复审)。
                let g_plus_1 = gacha.featured_guarantee.saturating_add(1) as f64;
                (gacha.featured_guarantee >= 1 && n_stars >= g_plus_1)
                    || gacha.featured_rate * n_stars >= threshold
            } else {
                let mu = MAX_GACHA_PULLS as f64 * gacha.base_rate;
                if gacha.featured_guarantee == 0 {
                    mu * gacha.featured_rate >= threshold
                } else {
                    let g_plus_1 = gacha.featured_guarantee as f64 + 1.0;
                    mu >= 2.0 * g_plus_1 && mu >= 800.0
                }
            };
            if !ok {
                return Err(Error::Config(format!(
                    "model.gacha 目标命中率过低:单会话触限概率无法压到 e^-100 以下(无硬保底无定轨要求 base_rate × featured_rate ≥ MIN_GACHA_TARGET_RATE;有硬保底按确定 5★ 数 {MAX_GACHA_PULLS}/pity_hard 估,定轨必触发或 featured_rate × 5★ 数 ≥ {threshold};无硬保底有定轨按 Chernoff 要求 μ ≥ max(2(g+1), 800))"
                )));
            }
        }
    }
    // 概率面统一有限性与区间校验(审核整改 P1):NaN 与越界概率会静默改写
    // 行为——NaN 比较恒假恰好越过下面的范围检查,> 1 的流失概率变成必然
    // 触发,负值变成永不触发。逐字段显式拦截,与命中概率同一口径。
    if !(cfg.churn.p_base.is_finite() && (0.0..=1.0).contains(&cfg.churn.p_base)) {
        return Err(Error::Config(
            "churn.p_base 必须为 [0, 1] 内的有限数".into(),
        ));
    }
    if !(cfg.churn.p_stall.is_finite() && (0.0..=1.0).contains(&cfg.churn.p_stall)) {
        return Err(Error::Config(
            "churn.p_stall 必须为 [0, 1] 内的有限数".into(),
        ));
    }
    if cfg.churn.p_stall < cfg.churn.p_base {
        return Err(Error::Config("p_stall 必须不小于 p_base".into()));
    }
    if cfg.progression.upgrade_cost_num == 0 || cfg.progression.upgrade_cost_den == 0 {
        return Err(Error::Config("强化成本比率不能为 0".into()));
    }
    if cfg.progression.upgrade_cost_base <= 0
        || cfg.progression.upgrade_cost_num <= 0
        || cfg.progression.upgrade_cost_den <= 0
    {
        return Err(Error::Config(
            "progression.upgrade_cost_base/num/den 必须为正(负成本会把扣费变成加钱并回绕 u64)"
                .into(),
        ));
    }
    if cfg.cohort_weights.iter().any(|&w| !(w.is_finite())) {
        return Err(Error::Config("cohort_weights 含非有限值".into()));
    }
    if cfg.cohort_weights.iter().any(|&w| w < 0.0) {
        return Err(Error::Config(
            "cohort_weights 不能为负(负占比会反向分群)".into(),
        ));
    }
    let cohort_sum = cfg.cohort_weights.iter().sum::<f64>();
    if cohort_sum <= 0.0 {
        return Err(Error::Config("cohort_weights 之和必须大于 0".into()));
    }
    // 2026-11-06 审核发现:分群配比必须归一。world::new 按 `roll < w0` /
    // `roll < w0+w1` / else 三分,`roll ∈ [0,1)`;和 > 1 时 whale 桶
    // `roll ≥ w0+w1` 可能为空(如 [0.5,0.5,0.5] 和 1.5,whale 恒 0 玩家),
    // 和 < 1 时尾段无人——配比与仿真不符。须显式要求和 = 1(容差取
    // 1e-9,容纳默认 [0.60,0.30,0.10] 的 f64 求和误差 1.1e-16)。
    if (cohort_sum - 1.0).abs() > 1e-9 {
        return Err(Error::Config(
            "cohort_weights 之和必须等于 1(归一化占比,当前和 != 1 会令分群桶失真)".into(),
        ));
    }
    for c in Cohort::ALL {
        let b = cfg.behavior.for_cohort(c);
        if !(b.p_dungeon.is_finite() && b.p_upgrade.is_finite() && b.p_training.is_finite()) {
            return Err(Error::Config(format!(
                "behavior.{}: 行为概率必须为有限数",
                c.name()
            )));
        }
        if !(b.sessions_frac.is_finite() && (0.0..=1.0).contains(&b.sessions_frac)) {
            return Err(Error::Config(format!(
                "behavior.{}.sessions_frac 必须为 [0, 1] 内的有限数",
                c.name()
            )));
        }
        if b.p_dungeon < 0.0
            || b.p_upgrade < 0.0
            || b.p_training < 0.0
            || b.p_dungeon + b.p_upgrade + b.p_training > 1.0
        {
            return Err(Error::Config(format!(
                "behavior.{}: p_dungeon + p_upgrade + p_training 必须在 [0, 1]",
                c.name()
            )));
        }
    }
    // 练级环显式性(阻力 #4):产出面与行为带互相咬合,单边给出属配置矛盾。
    let any_training_band = Cohort::ALL
        .iter()
        .any(|c| cfg.behavior.for_cohort(*c).p_training > 0.0);
    match cfg.training {
        Some(t) => {
            if t.xp < 0 || t.gold < 0 {
                return Err(Error::Config("training.xp / training.gold 不能为负".into()));
            }
            // 零产出({xp:0,gold:0})合法且惰性:参数模板回导会产生它,
            // 行为上等同无练级带(会话照常消耗但不改变任何统计)
            if !any_training_band && (t.xp > 0 || t.gold > 0) {
                return Err(Error::Config(
                    "model.training 产出已配置但各分群 p_training 均为 0(练级带永不触发)".into(),
                ));
            }
        }
        None if any_training_band => {
            return Err(Error::Config(
                "behavior.*.p_training > 0 需要 model.training 配置练级产出(xp / gold)".into(),
            ));
        }
        None => {}
    }
    if !(0.0..=1.0).contains(&cfg.combat.p_hit) || !(0.0..=1.0).contains(&cfg.combat.p_hit_monster)
    {
        return Err(Error::Config("命中概率必须在 [0, 1]".into()));
    }
    // 口径显式性(阻力 #1,同 reward_growth 拆分先例):ratio_k 只在
    // damage_model: ratio 下生效,给出而口径未切属配置矛盾(扫它扫了个死参数)。
    let ratio = matches!(cfg.combat.damage_model, Some(DamageModel::Ratio));
    if !ratio && cfg.combat.ratio_k != 1.0 {
        return Err(Error::Config(
            "combat.ratio_k 只在 damage_model: ratio 下生效(damage_model 缺省为 difference)".into(),
        ));
    }
    if ratio && !(cfg.combat.ratio_k > 0.0 && cfg.combat.ratio_k.is_finite()) {
        return Err(Error::Config(
            "combat.ratio_k 必须为正的有限值(比值口径的分母含 defense,比例参数给出量纲)".into(),
        ));
    }
    // 公式槽加载期编译(文档 07 章):语法 / 白名单 / 有界性在此暴露,
    // sim::run 假定已通过编译。
    let xp_needed_formula =
        crate::formula::compile(&cfg.formulas.xp_needed, crate::formula::XP_NEEDED_VARS)
            .map_err(|e| Error::Config(format!("formulas.xp_needed: {e}")))?;
    // 公式求值安全边界(审核整改 P1):编译通过 ≠ 求值安全,xp_needed
    // 求值 ≤ 0(含 (0,1) 区间截断为 0)会让 progression::gain_xp 的升级环
    // 无法终止。加载期在 1..=512 逐级求值(远超 30 天仿真的可达等级;
    // 探针区间外的退化由 gain_xp 的运行时防护兜底)。
    for level in 1..=512u32 {
        let v = xp_needed_formula.eval(&[
            f64::from(level),
            cfg.progression.xp_base as f64,
            cfg.progression.xp_pow,
        ]);
        if !v.is_finite() || v as i64 <= 0 {
            return Err(Error::Config(format!(
                "formulas.xp_needed 在 level={level} 求值为 {v},必须始终为正的有限值(求值 ≤ 0 会让升级环不终止)"
            )));
        }
    }
    Ok(())
}
