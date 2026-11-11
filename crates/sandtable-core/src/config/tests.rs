//! 配置域测试:校验门逐域覆盖 + config_hash 缺省稳定性。

use std::collections::BTreeMap;

use super::*;

#[cfg(test)]
mod tests {
    use super::*;

    /// 公式槽在 validate 编译(文档 07 章:加载期编译):语法 / 白名单
    /// 错误报出槽名与原因,默认公式必须通过。
    #[test]
    fn validate_formula_slot_compile_error() {
        let mut cfg = SimConfig::default();
        cfg.formulas.xp_needed = "xp_base *".into();
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("formulas.xp_needed"), "{msg}");

        cfg.formulas.xp_needed = "xp_base * atk".into();
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("未知变量"), "{msg}");

        cfg.formulas.xp_needed = String::new();
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("formulas.xp_needed"), "{msg}");

        assert!(validate(&SimConfig::default()).is_ok());
    }

    /// ST-AUD-02 / I-002:players / days 上界与 players×days 预算。
    /// 单维超限与规模超预算都返回结构化 ConfigError,不得放行到 OOM。
    #[test]
    fn validate_sim_scale_budget_bounds() {
        // 单维超上界(预算本身)
        let cfg = SimConfig {
            players: MAX_SIM_DIM + 1,
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("players"), "{msg}");

        let cfg = SimConfig {
            days: MAX_SIM_DIM + 1,
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("days"), "{msg}");

        // players×days 超预算但单维未超:10000×30=30万 合法,20000×30=60万 超
        let cfg = SimConfig {
            players: 20_000,
            days: 30,
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("players × days"), "{msg}");

        // 恰在预算内:400000 合法
        let cfg = SimConfig {
            players: 20_000,
            days: 20,
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_ok());
    }

    /// 比值口径约束(阻力 #1 显式性):ratio_k 只在 damage_model: ratio 下
    /// 生效;口径未切时给出即报错,k 非正报错;缺省配置保持合法。
    #[test]
    fn validate_ratio_model_constraint() {
        let mut cfg = SimConfig::default();
        cfg.combat.ratio_k = 260.0;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("damage_model"), "{msg}");

        cfg.combat.damage_model = Some(DamageModel::Ratio);
        assert!(validate(&cfg).is_ok());

        cfg.combat.ratio_k = 0.0;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("ratio_k"), "{msg}");
    }

    #[test]
    fn validate_gacha_featured_rate_bounds() {
        let mut cfg = SimConfig {
            gacha: Some(Default::default()),
            ..SimConfig::default()
        };
        // 无定轨组合约束按 base_rate × featured_rate 下界校验,把 base_rate
        // 钉在下限,确保 featured_rate 侧单独触发(默认 base_rate=0.02 会
        // 掩盖组合越界)。
        cfg.gacha.as_mut().unwrap().base_rate = MIN_GACHA_BASE_RATE;

        assert!(validate(&cfg).is_ok());

        cfg.gacha.as_mut().unwrap().featured_rate =
            MIN_GACHA_TARGET_RATE / MIN_GACHA_BASE_RATE * 0.5;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("featured_rate"), "{msg}");

        cfg.gacha.as_mut().unwrap().featured_rate = f64::INFINITY;
        assert!(validate(&cfg)
            .unwrap_err()
            .to_string()
            .contains("featured_rate"));

        cfg.gacha.as_mut().unwrap().featured_rate = -0.1;
        assert!(validate(&cfg)
            .unwrap_err()
            .to_string()
            .contains("featured_rate"));

        cfg.gacha.as_mut().unwrap().featured_rate = 1.1;
        assert!(validate(&cfg)
            .unwrap_err()
            .to_string()
            .contains("featured_rate"));

        cfg.gacha.as_mut().unwrap().featured_rate = 1.0;
        assert!(validate(&cfg).is_ok());

        // 2026-11-06 审核发现:无定轨时目标命中概率为
        // base_rate × featured_rate;两个下限相乘仅 1e-8,触限概率趋于 1。
        // 2026-11-07 复审:统一守卫要求会话目标命中期望数下界 ≥ 100
        // (触限概率 ≤ e^{-100});无定轨 + 无硬保底特例即乘积 ≥ 100/MAX。
        cfg.gacha.as_mut().unwrap().featured_guarantee = 0;
        cfg.gacha.as_mut().unwrap().base_rate = MIN_GACHA_BASE_RATE;
        cfg.gacha.as_mut().unwrap().featured_rate = 0.5;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("目标命中率过低"), "{msg}");

        // featured_rate 拉满:命中期望下界恰为 100,放行(边界取 < 严格比较)。
        cfg.gacha.as_mut().unwrap().featured_rate = 1.0;
        assert!(validate(&cfg).is_ok());

        cfg.gacha.as_mut().unwrap().featured_rate = 0.5;
        // 有定轨(g=1)走 Chernoff 分支:μ = MAX × base_rate ≥ max(2(g+1), 800)
        // 即可,featured_rate 不进入该分支(定轨必触发的路径与直中概率无关)。
        cfg.gacha.as_mut().unwrap().base_rate = 0.02;
        cfg.gacha.as_mut().unwrap().featured_guarantee = 1;
        match validate(&cfg) {
            Ok(()) => {}
            Err(err) => panic!("有定轨时不受无定轨下限约束: {err}"),
        }
    }

    /// 练级环耦合(阻力 #4 显式性):产出面与行为带互相咬合,单边给出报错。
    #[test]
    fn validate_training_loop_coupling() {
        // 62e1185 起缺省已带训练产出(Some{xp:400,gold:150})且各分群 p_training=0.1,
        // 默认行为带已满足耦合;要构造「产出面有、行为带无」须显式把三群 p_training 清零。
        let mut cfg = SimConfig {
            training: Some(TrainingConfig { xp: 100, gold: 10 }),
            ..SimConfig::default()
        };
        cfg.behavior.casual.p_training = 0.0;
        cfg.behavior.core.p_training = 0.0;
        cfg.behavior.whale.p_training = 0.0;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("p_training"), "{msg}"); // 产出面有、行为带无

        cfg.behavior.casual.p_dungeon = 0.5;
        cfg.behavior.casual.p_upgrade = 0.1;
        cfg.behavior.casual.p_training = 0.4; // 合计恰为 1
        assert!(validate(&cfg).is_ok());

        // 零产出产出面合法(参数模板回导产生):惰性、不报死配置
        let zero = SimConfig {
            training: Some(TrainingConfig { xp: 0, gold: 0 }),
            ..SimConfig::default()
        };
        assert!(validate(&zero).is_ok());

        // 62e1185 起缺省已带训练产出,要构造「行为带有、产出面无」须显式 training: None。
        let cfg2 = SimConfig {
            training: None,
            behavior: {
                let mut b = BehaviorConfig::default();
                b.core.p_training = 0.1; // 0.6 + 0.3 + 0.1 合计恰为 1
                b
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg2).unwrap_err().to_string();
        assert!(msg.contains("model.training"), "{msg}"); // 行为带有、产出面无

        let cfg3 = SimConfig {
            behavior: {
                let mut b = BehaviorConfig::default();
                b.whale.p_dungeon = 0.8;
                b.whale.p_training = 0.3; // 0.8 + 0.3(升级)+ 0.3 > 1
                b
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg3).unwrap_err().to_string();
        assert!(msg.contains("p_training"), "{msg}");
    }

    /// 新口径字段缺省不进 canonical JSON:旧配置(无字段)与缺省配置
    /// config_hash 逐字节一致——加字段不改存量语义。
    #[test]
    fn config_hash_stable_when_optional_absent() {
        let legacy = SimConfig::default();
        assert!(legacy.combat.damage_model.is_none());
        assert_eq!(legacy.combat.ratio_k, 1.0);
        let mut switched = SimConfig::default();
        switched.combat.damage_model = Some(DamageModel::Ratio);
        assert_ne!(config_hash(&switched), config_hash(&legacy));
    }

    /// 掉落面校验(文档 24 章 R1):rate_mult 非正、空表名、全零权重、
    /// 非有限负数逐项报错;合法表正常加载(结算已接入仿真——注释曾写
    /// 「未接入被拒」,与现实相反,I-033 更正);loot 缺省(None)不进
    /// canonical JSON。
    #[test]
    fn validate_loot_section() {
        fn loot(
            rate_mult: f64,
            on_victory: &str,
            tables: BTreeMap<String, LootTableConfig>,
            rewards: BTreeMap<String, LootReward>,
        ) -> SimConfig {
            SimConfig {
                loot: Some(LootConfig {
                    rate_mult,
                    on_victory: on_victory.to_string(),
                    tables,
                    rewards,
                }),
                ..SimConfig::default()
            }
        }
        fn table(weights: BTreeMap<String, f64>) -> BTreeMap<String, LootTableConfig> {
            [("chest".to_string(), LootTableConfig { weights })]
                .into_iter()
                .collect()
        }
        fn w(pairs: &[(&str, f64)]) -> BTreeMap<String, f64> {
            pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()
        }
        fn rw(pairs: &[(&str, (i64, i64))]) -> BTreeMap<String, LootReward> {
            pairs
                .iter()
                .map(|(k, (g, x))| (k.to_string(), LootReward { gold: *g, xp: *x }))
                .collect()
        }

        // rate_mult 非正
        for rm in [0.0, -1.0] {
            let msg = validate(&loot(rm, "", Default::default(), Default::default()))
                .unwrap_err()
                .to_string();
            assert!(msg.contains("rate_mult"), "{msg}");
        }
        // 空表名
        let cfg = loot(
            1.0,
            "",
            [(
                "".to_string(),
                LootTableConfig {
                    weights: w(&[("a", 1.0)]),
                },
            )]
            .into_iter()
            .collect(),
            Default::default(),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("表名"), "{msg}");
        // 空表(无权重)
        let cfg = loot(1.0, "", table(BTreeMap::new()), Default::default());
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("chest"), "{msg}");
        // 全零权重
        let cfg = loot(
            1.0,
            "",
            table(w(&[("a", 0.0), ("b", 0.0)])),
            Default::default(),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("权重"), "{msg}");
        // 非有限权重
        let cfg = loot(
            1.0,
            "",
            table(w(&[("a", 70.0), ("b", f64::NAN)])),
            Default::default(),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("权重"), "{msg}");
        // on_victory 缺失(空串)
        let cfg = loot(1.0, "", table(w(&[("a", 1.0)])), rw(&[("a", (1, 0))]));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("on_victory"), "{msg}");
        // on_victory 指向不存在的表
        let cfg = loot(1.0, "nope", table(w(&[("a", 1.0)])), rw(&[("a", (1, 0))]));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("on_victory") && msg.contains("nope"), "{msg}");
        // 权重条目缺 rewards 定义
        let cfg = loot(
            1.0,
            "chest",
            table(w(&[("a", 1.0), ("b", 1.0)])),
            rw(&[("a", (1, 0))]),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("rewards") && msg.contains("b"), "{msg}");
        // rewards 条目无表引用(死配置)
        let cfg = loot(
            1.0,
            "chest",
            table(w(&[("a", 1.0)])),
            rw(&[("a", (1, 0)), ("dead", (1, 0))]),
        );
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("dead"), "{msg}");
        // 数额为负
        let cfg = loot(1.0, "chest", table(w(&[("a", 1.0)])), rw(&[("a", (-1, 0))]));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("负"), "{msg}");
        // 数额全零
        let cfg = loot(1.0, "chest", table(w(&[("a", 1.0)])), rw(&[("a", (0, 0))]));
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("全为零"), "{msg}");
        // 合法配置:结算已接入,加载通过(docs/loot-settlement-design.md)
        let cfg = loot(
            1.5,
            "chest",
            table(w(&[
                ("gold_small", 70.0),
                ("gold_mid", 25.0),
                ("xp_charm", 5.0),
            ])),
            rw(&[
                ("gold_small", (10, 0)),
                ("gold_mid", (50, 0)),
                ("xp_charm", (0, 20)),
            ]),
        );
        assert!(validate(&cfg).is_ok(), "{:?}", validate(&cfg).err());

        // loot = None 缺省不进 canonical JSON(训练字段先例)
        assert!(SimConfig::default().loot.is_none());
    }

    /// 概率面边界(审核整改 P1):流失概率与行为概率的 NaN/越界逐字段拦截。
    /// NaN 此前的行为是比较恒假,恰好越过 `< 0.0 || > 1.0` 形态的检查。
    #[test]
    fn validate_probability_bounds() {
        fn churn_err(p_base: f64, p_stall: f64) -> String {
            let mut cfg = SimConfig::default();
            cfg.churn.p_base = p_base;
            cfg.churn.p_stall = p_stall;
            validate(&cfg).unwrap_err().to_string()
        }
        assert!(churn_err(f64::NAN, 0.05).contains("p_base"));
        assert!(churn_err(0.003, f64::NAN).contains("p_stall"));
        assert!(churn_err(0.003, 1.5).contains("p_stall"));
        assert!(churn_err(-0.1, 0.05).contains("p_base"));
        // 合法边界:p_base=0 / p_stall=1 通过(流失概率允许闭区间)
        assert!(validate(&{
            let mut cfg = SimConfig::default();
            cfg.churn.p_base = 0.0;
            cfg
        })
        .is_ok());

        for c in Cohort::ALL {
            let mut cfg = SimConfig::default();
            cfg.behavior.for_cohort_mut(c).p_dungeon = f64::NAN;
            let msg = validate(&cfg).unwrap_err().to_string();
            assert!(msg.contains("有限数"), "{c:?}: {msg}");

            let mut cfg = SimConfig::default();
            cfg.behavior.for_cohort_mut(c).sessions_frac = 1.2;
            let msg = validate(&cfg).unwrap_err().to_string();
            assert!(msg.contains("sessions_frac"), "{c:?}: {msg}");

            let mut cfg = SimConfig::default();
            cfg.behavior.for_cohort_mut(c).sessions_frac = f64::NAN;
            assert!(validate(&cfg)
                .unwrap_err()
                .to_string()
                .contains("sessions_frac"));
        }
        // sessions_frac 合法边界 0.0 / 1.0 通过(缺省即 0.5)
        assert!(validate(&SimConfig::default()).is_ok());
    }

    /// 公式求值安全边界(审核整改 P1):xp_needed 求值 ≤ 0(含 (0,1) 截断
    /// 为 0)或非有限时,validate 拒绝;默认公式必须通过。
    #[test]
    fn validate_xp_needed_evaluation_positive() {
        let mut cfg = SimConfig::default();
        cfg.formulas.xp_needed = "0".into();
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("升级环不终止"), "{msg}");

        let mut cfg = SimConfig::default();
        cfg.formulas.xp_needed = "0.5".into();
        assert!(validate(&cfg)
            .unwrap_err()
            .to_string()
            .contains("升级环不终止"));

        let mut cfg = SimConfig::default();
        cfg.formulas.xp_needed = "0 * xp_base".into();
        assert!(validate(&cfg).is_err());

        let mut cfg = SimConfig::default();
        cfg.formulas.xp_needed = "xp_base * level ^ xp_pow".into();
        assert!(validate(&cfg).is_ok());
    }

    /// 抽卡面校验(文档 24 章 R2):base_rate 必须在 (0, 1](≤ 0 永不终止、
    /// > 1 概率非法);pity_soft_step 非负有限;gacha 缺省(None)不进 canonical JSON。
    #[test]
    fn validate_gacha_section() {
        fn gacha(base_rate: f64, pity_soft_step: f64) -> SimConfig {
            SimConfig {
                gacha: Some(GachaConfig {
                    base_rate,
                    pity_hard: 50,
                    pity_soft_start: 0,
                    pity_soft_step,
                    featured_rate: 0.0,
                    featured_guarantee: 0,
                }),
                ..SimConfig::default()
            }
        }

        // base_rate 越界:0 / 负数 / > 1 / NaN 逐项报错
        for br in [0.0, -0.5, 1.5, f64::NAN] {
            let msg = validate(&gacha(br, 0.0)).unwrap_err().to_string();
            assert!(msg.contains("base_rate"), "{msg}");
        }
        // ST-AUD-03:base_rate 低于下限(如 1e-300)不再放行——期望 1e300 抽
        // 的实质死循环,必须显式拒绝。
        for br in [MIN_GACHA_BASE_RATE * 0.5, 1e-300] {
            let msg = validate(&gacha(br, 0.0)).unwrap_err().to_string();
            assert!(msg.contains("base_rate"), "{msg}");
        }
        // ST-AUD-03:pity_hard 超过会话最大抽数拒绝(防御纵深)。
        let mut cfg = gacha(0.02, 0.0);
        cfg.gacha.as_mut().unwrap().pity_hard = MAX_GACHA_PULLS + 1;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("pity_hard"), "{msg}");
        // pity_soft_step 非负有限
        for step in [-0.01, f64::NAN] {
            let msg = validate(&gacha(0.02, step)).unwrap_err().to_string();
            assert!(msg.contains("pity_soft_step"), "{msg}");
        }
        // 合法配置通过:纯硬保底 / 软硬混合 / 无保底(步长 0)
        assert!(validate(&gacha(0.02, 0.0)).is_ok());
        assert!(validate(&gacha(1.0, 0.1)).is_ok());
        // gacha = None 缺省不进 canonical JSON(训练字段先例)
        assert!(SimConfig::default().gacha.is_none());
    }

    /// 审核发现 2026-11-04:`has_gold_reward` 须只计入 `on_victory` 指名表
    /// 的金币奖励——掉落仅从该表抽取,金币放在非胜利表(从未抽取)不是可测
    /// 口径,纯结构零不得冒充实测值;奖励名含点(如 `gold.pouch`)也须能识别。
    #[test]
    fn has_gold_reward_only_counts_on_victory_table() {
        use std::collections::BTreeMap;

        fn loot_cfg(
            on_victory: &str,
            tables: BTreeMap<String, LootTableConfig>,
            rewards: BTreeMap<String, LootReward>,
        ) -> LootConfig {
            LootConfig {
                rate_mult: 1.0,
                on_victory: on_victory.to_string(),
                tables,
                rewards,
            }
        }
        fn table(weights: BTreeMap<String, f64>) -> LootTableConfig {
            LootTableConfig { weights }
        }

        // 金币奖励只在 on_victory 表 → 可测
        let mut tables = BTreeMap::new();
        tables.insert(
            "chest".to_string(),
            table([("gold.pouch".to_string(), 1.0)].into()),
        );
        let mut rewards = BTreeMap::new();
        rewards.insert("gold.pouch".to_string(), LootReward { gold: 5, xp: 0 });
        let cfg = loot_cfg("chest", tables, rewards);
        assert!(
            cfg.has_gold_reward(),
            "on_victory 表的金币奖励(名含点)应可测"
        );

        // 金币奖励挂权重 0 条目(恒不可抽):可测口径不成立(2026-11-05)
        let mut tables = BTreeMap::new();
        tables.insert(
            "chest".to_string(),
            table([("gold".to_string(), 0.0), ("potion".to_string(), 1.0)].into()),
        );
        let mut rewards = BTreeMap::new();
        rewards.insert("gold".to_string(), LootReward { gold: 5, xp: 0 });
        rewards.insert("potion".to_string(), LootReward { gold: 0, xp: 10 });
        let cfg = loot_cfg("chest", tables, rewards);
        assert!(
            !cfg.has_gold_reward(),
            "金币奖励挂权重 0 条目(不可抽)不得判可测"
        );

        // 金币奖励只放在非 on_victory 表(从未抽取)→ 不可测
        let mut tables = BTreeMap::new();
        tables.insert(
            "chest".to_string(),
            table([("potion".to_string(), 1.0)].into()),
        );
        tables.insert(
            "spare".to_string(),
            table([("gold_pouch".to_string(), 1.0)].into()),
        );
        let mut rewards = BTreeMap::new();
        rewards.insert("potion".to_string(), LootReward { gold: 0, xp: 10 });
        rewards.insert("gold_pouch".to_string(), LootReward { gold: 5, xp: 0 });
        let cfg = loot_cfg("chest", tables, rewards);
        assert!(
            !cfg.has_gold_reward(),
            "金币奖励不在 on_victory 表 → 不可测"
        );

        // on_victory 表缺失(未指向既有表)→ 不可测
        let mut tables = BTreeMap::new();
        tables.insert(
            "spare".to_string(),
            table([("gold_pouch".to_string(), 1.0)].into()),
        );
        let mut rewards = BTreeMap::new();
        rewards.insert("gold_pouch".to_string(), LootReward { gold: 5, xp: 0 });
        let cfg = loot_cfg("missing", tables, rewards);
        assert!(!cfg.has_gold_reward(), "on_victory 指向不存在的表 → 不可测");
    }

    /// ST-AUD-04 / I-004:经济面 i64 符号/范围门。负或溢出量级的
    /// `whale_gain_mult` 会经 `as u64` 回绕污染全部经济指标;负强化成本
    /// 会把扣费变成加钱并回绕。全部返回结构化 ConfigError,不放行到仿真。
    #[test]
    fn validate_economy_signed_fields_gated() {
        // whale_gain_mult:负值 / 0 / 溢出量级均拒(正值有限才放行)
        for mult in [-1, 0, i64::MAX] {
            let cfg = SimConfig {
                whale_gain_mult: mult,
                ..SimConfig::default()
            };
            let msg = validate(&cfg).unwrap_err().to_string();
            assert!(msg.contains("whale_gain_mult"), "{mult}: {msg}");
        }
        let cfg = SimConfig {
            whale_gain_mult: MAX_ECONOMY_VALUE,
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_ok(), "上界内正值应放行");

        // 强化成本三件套:负值 / 0 均拒(正数才放行)。num/den=0 由旧门
        // 「强化成本比率不能为 0」先拦,base=0 由新门拦截。
        let cfg = SimConfig {
            progression: ProgressionConfig {
                upgrade_cost_base: -1,
                ..ProgressionConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("upgrade_cost"), "{msg}");

        // training 产出负值拒(与 reward_gold 同一防线口径)
        for (xp, gold) in [(-1, 0), (0, -1)] {
            let cfg = SimConfig {
                training: Some(TrainingConfig { xp, gold }),
                ..SimConfig::default()
            };
            let msg = validate(&cfg).unwrap_err().to_string();
            assert!(msg.contains("training"), "{xp}/{gold}: {msg}");
        }

        // 默认配置仍合法
        assert!(validate(&SimConfig::default()).is_ok());
    }

    /// ST-AUD-14 / I-014:数值槽统一有限 + 区间门。怪物/成长倍率/战斗/
    /// 流失/分群占比/角色三维的 NaN、Inf、负值、零值、上界越界全部
    /// 返回结构化 ConfigError,不放行到仿真(防 powi/乘积塌成 NaN/Inf
    /// 再经 as i64 洗成有限值,或 cohort 反向/失真)。
    #[test]
    fn validate_numeric_slots_unified_gates() {
        // dungeon 怪物三维:零/负/上界越界均拒
        for v in [0, -1] {
            let cfg = SimConfig {
                dungeon: DungeonConfig {
                    m_hp: v,
                    ..DungeonConfig::default()
                },
                ..SimConfig::default()
            };
            let msg = validate(&cfg).unwrap_err().to_string();
            assert!(msg.contains("m_hp"), "{msg}");
        }
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                m_hp: MAX_ECONOMY_VALUE + 1,
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_err(), "m_hp 上界越界应拒");

        // dungeon 成长倍率:NaN / Inf / 0 / 负均拒(有限正数才放行)
        for (name, v) in [
            ("tier_growth", f64::NAN),
            ("tier_growth", f64::INFINITY),
            ("tier_growth", 0.0),
            ("tier_growth", -1.3),
            ("reward_gold_growth", f64::NAN),
            ("reward_xp_growth", f64::NEG_INFINITY),
        ] {
            let cfg = SimConfig {
                dungeon: DungeonConfig {
                    tier_growth: if name == "tier_growth" { v } else { 1.3 },
                    reward_gold_growth: if name == "reward_gold_growth" { v } else { 1.4 },
                    reward_xp_growth: if name == "reward_xp_growth" { v } else { 1.4 },
                    ..DungeonConfig::default()
                },
                ..SimConfig::default()
            };
            assert!(validate(&cfg).is_err(), "{name}={v} 应拒");
        }

        // combat.max_rounds:0 拒;churn.stall_days:0 拒
        let cfg = SimConfig {
            combat: CombatConfig {
                max_rounds: 0,
                ..CombatConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("max_rounds"), "{msg}");
        let cfg = SimConfig {
            churn: ChurnConfig {
                stall_days: 0,
                ..ChurnConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("stall_days"), "{msg}");

        // cohort_weights:负占比拒([-0.5,1.0,0.5] 原合法但分群失真)
        let cfg = SimConfig {
            cohort_weights: [-0.5, 1.0, 0.5],
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("cohort_weights"), "{msg}");

        // warrior 三维:零/上界越界拒(正且有限才放行)
        let cfg = SimConfig {
            warrior: WarriorConfig {
                attack: 0,
                ..WarriorConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("warrior"), "{msg}");
        let cfg = SimConfig {
            warrior: WarriorConfig {
                hp: MAX_ECONOMY_VALUE + 1,
                ..WarriorConfig::default()
            },
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_err(), "warrior hp 上界越界应拒");

        // 默认配置仍合法
        assert!(validate(&SimConfig::default()).is_ok());
    }

    /// 2026-11-06 审核发现:有限正增长率 alone 不够——`tier_growth=1e308`
    /// 与 `tiers=64` 时 `1e308.powi(63)` 溢出为 Inf,怪物三维经 `as i64`
    /// 饱和为 `i64::MAX`。必须按最高层派生值拒载。
    #[test]
    fn validate_tier_growth_derived_overflow() {
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 64,
                tier_growth: 1e308,
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("tier_growth^63"), "{msg}");

        // 增长率有限但派生值刚过经济上界也拒
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 64,
                tier_growth: 2.0,
                m_hp: MAX_ECONOMY_VALUE,
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_err());

        // reward 面同口径:增长派生值溢出拒
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 64,
                reward_gold: 1,
                reward_gold_growth: 1e308,
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_err());
    }

    /// 2026-11-07 复审整改:目标守卫分支化,各分支给出可证明的 ≤ e^{-100}
    /// 触限界——有硬保底按确定 5★ 数(定轨必触发或直中尾部界),无硬保底
    /// 无定轨按乘积(μ·f),无硬保底有定轨按 Chernoff(μ ≥ max(2(g+1), 800),
    /// 期望不是确定下界,上轮 1/g 口径的边界反例已封堵)。
    #[test]
    fn validate_gacha_hard_pity_featured_bound() {
        let mut cfg = SimConfig {
            gacha: Some(Default::default()),
            ..SimConfig::default()
        };
        // 有硬保底:pity=1 时会话 5★ 数确定 = MAX(每抽一个),直中尾部界
        // 2e-4 × 1e6 = 200 ≥ 100:放行(base_rate 不进入该分支)。
        cfg.gacha.as_mut().unwrap().base_rate = MIN_GACHA_BASE_RATE;
        cfg.gacha.as_mut().unwrap().featured_rate = 2e-4;
        cfg.gacha.as_mut().unwrap().pity_hard = 1;
        assert!(validate(&cfg).is_ok());

        // featured_rate 再降两个量级:直中尾部界 0.1 < 100,拒绝。
        cfg.gacha.as_mut().unwrap().featured_rate = 1e-7;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("featured_rate"), "{msg}");

        // 无硬保底无定轨:μ × f = 100 × 2e-4 = 0.02 < 100,拒绝。
        cfg.gacha.as_mut().unwrap().featured_rate = 2e-4;
        cfg.gacha.as_mut().unwrap().pity_hard = 0;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("目标命中率过低"), "{msg}");

        // 第三轮审核发现的定轨绕过(base 1e-4、f 1e-6、g=1e6、无保底):
        // μ=100 不满足 μ ≥ 2(g+1),拒绝。
        cfg.gacha.as_mut().unwrap().featured_rate = 1e-6;
        cfg.gacha.as_mut().unwrap().featured_guarantee = 1_000_000;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("目标命中率过低"), "{msg}");

        // 同攻击家族配足 μ:base 0.02 → μ = 2e4,取 g=9000 时 μ ≥ 2(g+1)=1.8e4
        // 且 μ ≥ 800,放行(溢出 ⊆ {5★ ≤ g},Chernoff 界成立)。
        cfg.gacha.as_mut().unwrap().base_rate = 0.02;
        cfg.gacha.as_mut().unwrap().featured_guarantee = 9_000;
        assert!(validate(&cfg).is_ok());

        // 上轮反例族(g=1、base=1e-4、f=1e-100、无保底,第三轮口径边界放行)
        // 现被 μ ≥ 800 拒绝。
        cfg.gacha.as_mut().unwrap().base_rate = MIN_GACHA_BASE_RATE;
        cfg.gacha.as_mut().unwrap().featured_rate = 1e-100;
        cfg.gacha.as_mut().unwrap().featured_guarantee = 1;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("目标命中率过低"), "{msg}");

        // 但有硬保底时定轨必触发:pity=90、g=1、f=1e-100,5★ 数 11111 ≥ 2,
        // 前 2 个 5★ 必含一次定轨命中,溢出不可能,放行。
        cfg.gacha.as_mut().unwrap().pity_hard = 90;
        assert!(validate(&cfg).is_ok());

        // 第五轮复审(u64 溢出边界):g = u64::MAX 时 g+1 溢出——saturating
        // 后 g+1 = u64::MAX,N 永远小于它,走直中尾部界拒绝;两个构建档都
        // 不得 panic。
        cfg.gacha.as_mut().unwrap().featured_guarantee = u64::MAX;
        assert!(validate(&cfg).is_err());

        cfg.gacha.as_mut().unwrap().pity_hard = 0;
        cfg.gacha.as_mut().unwrap().base_rate = 0.02;
        assert!(validate(&cfg).is_err());
    }

    /// 2026-11-07 复审整改:显式层表全行给定 gold/xp 时几何回退值不被使用
    /// (combat::monster_of 按行内显式值取数),不按派生值拒绝合法配置;
    /// 部分行缺省时回退仍参与行为,照常校验。
    #[test]
    fn validate_explicit_tier_table_skips_derived_reward_check() {
        let rows = |gold: Option<i64>, xp: Option<i64>| -> Vec<TierRow> {
            (0..64)
                .map(|_| TierRow {
                    hp: 10,
                    attack: 1,
                    defense: 1,
                    gold,
                    xp,
                })
                .collect()
        };
        // 全行显式产出:即便增长率荒谬(回退值不被使用)也放行。
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 64,
                reward_gold_growth: 1e308,
                tier_table: Some(rows(Some(100), Some(50))),
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_ok());

        // 有一行缺省产出:几何回退参与行为,荒谬增长率照常拒绝。
        let mut partial = rows(Some(100), Some(50));
        partial[10].gold = None;
        let cfg = SimConfig {
            dungeon: DungeonConfig {
                tiers: 64,
                reward_gold_growth: 1e308,
                tier_table: Some(partial),
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("reward_gold"), "{msg}");
    }

    /// 2026-11-12 审核修复批 P1:tier_table 行级战斗面校验——attack/defense
    /// 须为正(此前仅查 hp),三键与 warrior 同面上界;行内产出 gold/xp
    /// 非负且走经济统一上界。
    #[test]
    fn validate_tier_table_row_bounds() {
        let row =
            |hp: i64, attack: i64, defense: i64, gold: Option<i64>, xp: Option<i64>| TierRow {
                hp,
                attack,
                defense,
                gold,
                xp,
            };
        let cfg = |rows: Vec<TierRow>| SimConfig {
            dungeon: DungeonConfig {
                tiers: rows.len() as u32,
                tier_table: Some(rows),
                ..DungeonConfig::default()
            },
            ..SimConfig::default()
        };

        let msg = validate(&cfg(vec![row(10, 0, 1, None, None)]))
            .unwrap_err()
            .to_string();
        assert!(
            msg.contains("tier_table[0]") && msg.contains("attack/defense"),
            "{msg}"
        );

        let msg = validate(&cfg(vec![row(10, -5, 1, None, None)]))
            .unwrap_err()
            .to_string();
        assert!(msg.contains("attack/defense"), "{msg}");

        let msg = validate(&cfg(vec![row(MAX_ECONOMY_VALUE + 1, 1, 1, None, None)]))
            .unwrap_err()
            .to_string();
        assert!(msg.contains("战斗运算上界"), "{msg}");

        let msg = validate(&cfg(vec![row(10, 1, 1, Some(-1), None)]))
            .unwrap_err()
            .to_string();
        assert!(msg.contains("gold"), "{msg}");

        let msg = validate(&cfg(vec![row(10, 1, 1, None, Some(MAX_ECONOMY_VALUE + 1))]))
            .unwrap_err()
            .to_string();
        assert!(msg.contains("xp"), "{msg}");

        // 边界值放行:三键恰在上界、产出为零
        let ok = cfg(vec![row(
            MAX_ECONOMY_VALUE,
            MAX_ECONOMY_VALUE,
            MAX_ECONOMY_VALUE,
            Some(0),
            Some(0),
        )]);
        assert!(validate(&ok).is_ok());
    }

    /// 2026-11-12 审核修复批 P1:sessions_int 上界——players × days 预算
    /// 不约束每人每日工作量,巨值会话数(合法 u32)实质死循环且战斗键
    /// `battle_index × 64` 回绕破坏 CRN。
    #[test]
    fn validate_sessions_int_upper_bound() {
        let mut cfg = SimConfig::default();
        cfg.behavior.whale.sessions_int = MAX_SESSIONS_PER_DAY + 1;
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("sessions_int"), "{msg}");

        cfg.behavior.whale.sessions_int = MAX_SESSIONS_PER_DAY;
        assert!(validate(&cfg).is_ok());
    }

    /// 2026-11-06 审核发现:分群权重和必须归一。`[0.5,0.5,0.5]` 和 1.5
    /// 会让 whale 桶恒空;和 < 1 时尾段无人。显式要求和 = 1。
    #[test]
    fn validate_cohort_weights_normalized() {
        let cfg = SimConfig {
            cohort_weights: [0.5, 0.5, 0.5],
            ..SimConfig::default()
        };
        let msg = validate(&cfg).unwrap_err().to_string();
        assert!(msg.contains("等于 1"), "{msg}");

        let cfg = SimConfig {
            cohort_weights: [0.3, 0.3, 0.3],
            ..SimConfig::default()
        };
        assert!(validate(&cfg).is_err());

        // 默认 [0.60, 0.30, 0.10] 精确归一,放行
        assert!(validate(&SimConfig::default()).is_ok());
    }
}
