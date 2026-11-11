//! WebAssembly 薄绑定(文档 08/18 章:Phase 6)。
//!
//! 纪律:**不放仿真逻辑**——只转发 sandtable-core(load → validate → run),
//! 输出与 CLI `simulate` 的 report.json 同构(`{meta, results}`,另附
//! `days_csv` 与 CLI 写盘产物逐字节一致,文档 09 章),统计等价
//! 由 CLI 侧等价测试锁死。meta 只带版本字段;`generated_at_unix`/`git_sha`
//! 是环境字段,由前端构建注入,不在绑定层伪造。
//!
//! Web 定位小中型仿真(文档 09 章:WASM 内存 4GB 上限、单线程),
//! replicates 上限 64,更大的实验引导走 CLI / 桌面。
//!
//! 参数扫描(文档 12/14/15 章)同为薄转发:sweep_plan / sweep_candidate /
//! sweep_recommend 与 CLI sweep / recommend 同源;单线程下候选并行不可用,
//! 由 JS 逐候选驱动、候选间让出主线程(见 sweep 段注释)。

mod compare;
mod kpi;
mod optimize;
mod params;
mod run;
mod sweep;
mod validate;

pub use compare::*;
pub use kpi::*;
pub use optimize::*;
pub use params::*;
pub use run::*;
pub use sweep::*;
pub use validate::{validate_config, validate_config_native};

#[cfg(test)]
mod tests {
    use super::*;
    // 显式 use 优先于 prelude 的 glob(wasm-bindgen 会导出 core 别名,须显式声明遮蔽回核心 crate)
    use sandtable_core as core;
    use serde_json::json;

    const YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
    );

    #[test]
    fn validate_valid_and_invalid() {
        let v = validate_config_native(YAML).unwrap();
        assert_eq!(v["players"], 40);
        assert_eq!(v["days"], 3);
        assert!(
            v["config_hash"].as_str().unwrap().len() == 64,
            "SHA-256 hex"
        );

        let err = validate_config_native(
            "schema_version: '1'\nscenario: {population: 40, duration: '3d'}\nmodel:\n  dungeon:\n    tiers: 0\n",
        )
        .unwrap_err();
        assert!(err.starts_with("配置错误"), "{err}");
    }

    #[test]
    fn validate_accepts_experiment_yaml_executors_do_not() {
        // 前端提交纪律:送达的输入快照(含 sweep 节)整份过校验通道。
        // sweep 节摘出后 config_hash 与只写基础配置的版本同源。
        let base = validate_config_native(YAML).unwrap();
        let experiment = YAML.to_string()
            + "sweep:\n  mode: grid\n  replicates: 2\n  parameters:\n"
            + "    model.warrior.attack: {min: 90, max: 110, step: 10}\n"
            + "  targets:\n    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n";
        let v = validate_config_native(&experiment).unwrap();
        assert_eq!(v["players"], 40);
        assert_eq!(v["days"], 3);
        assert_eq!(
            v["config_hash"], base["config_hash"],
            "sweep 节不进配置身份"
        );
        // 执行入口不变:run_simulation 只收场景 YAML,实验节照旧拦截
        let err = run_simulation_native(&experiment, 2).unwrap_err();
        assert!(err.contains("未知参数"), "执行入口不吞实验节:{err}");
    }

    #[test]
    fn param_registry_is_full_static_table() {
        let defs = param_registry_native();
        let n = defs.as_array().unwrap().len();
        assert_eq!(n, 66, "注册表全量 66 项");
        let first = &defs[0];
        assert_eq!(first["path"], "scenario.population");
        assert_eq!(first["kind"], "u32", "kind serde 小写串");
        assert_eq!(
            first.as_object().unwrap().len(),
            4,
            "恰四字段,可选元信息不出场"
        );
    }

    #[test]
    fn param_apply_uses_kernel_addressing_and_revalidates() {
        // 正常应用:回读值 = 应用的值,hash 是 64 位十六进制
        let ok = param_apply_native(YAML, "model.warrior.attack", 250.0).unwrap();
        assert_eq!(ok["value"].as_f64(), Some(250.0));
        assert_eq!(ok["path"], "model.warrior.attack");
        assert_eq!(ok["config_hash"].as_str().unwrap().len(), 64, "SHA-256 hex");
        // 同值重放不改 hash(应用是幂等写)
        let replay = param_apply_native(YAML, "model.warrior.attack", 100.0).unwrap();
        assert_ne!(
            replay["config_hash"], ok["config_hash"],
            "不同值必不同 hash"
        );
        // 未知路径:带相近路径建议,配置错误前缀
        let e = param_apply_native(YAML, "model.warrior.atk", 1.0).unwrap_err();
        assert!(e.starts_with("配置错误") && e.contains("未知参数"), "{e}");
        // 非数值槽:不可数值扫描
        let e2 = param_apply_native(YAML, "scenario.duration", 30.0).unwrap_err();
        assert!(e2.contains("该参数不是数值"), "{e2}");
        // 非法类型/范围:u32 为负
        let e3 = param_apply_native(YAML, "scenario.population", -1.0).unwrap_err();
        assert!(e3.contains("不能为负"), "{e3}");
        // 显式性契约:未配置 loot 时应用 rate_mult 物化半配置 loot,重验即在编辑期报错
        let e4 = param_apply_native(YAML, "model.loot.rate_mult", 2.0).unwrap_err();
        assert!(e4.contains("on_victory"), "{e4}");
    }

    #[test]
    fn ab_compare_pairs_kernel_run_arms() {
        let cand_yaml = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "model:\n  warrior: {attack: 250}\n",
        );
        let a = run_simulation_native(YAML, 6).unwrap();
        let b = run_simulation_native(cand_yaml, 6).unwrap();
        let out = ab_compare_native(
            YAML,
            cand_yaml,
            "win_rate",
            &a["results"].to_string(),
            &b["results"].to_string(),
        )
        .unwrap();
        assert_eq!(out["metric"], "win_rate");
        assert_eq!(out["arm_a"]["n"], 6);
        assert_eq!(out["arm_b"]["n"], 6);
        // 配对差均值 = B 均值 − A 均值(内核直出,前端不重算)
        let mean = |v: &serde_json::Value| -> f64 {
            v["results"]
                .as_array()
                .unwrap()
                .iter()
                .map(|m| m["win_rate"].as_f64().unwrap())
                .sum::<f64>()
                / 6.0
        };
        let expected = mean(&b) - mean(&a);
        assert!((out["diff_mean"].as_f64().unwrap() - expected).abs() < 1e-9);
        // verdict 是内核三值之一(序列化为枚举名)
        assert!(
            ["BHigher", "AHigher", "NoDifference"].contains(&out["verdict"].as_str().unwrap()),
            "{out}"
        );
    }

    #[test]
    fn ab_compare_rejects_bad_inputs_explicitly() {
        let cand_yaml = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 9}\n",
        );
        let a = run_simulation_native(YAML, 4).unwrap();
        let b = run_simulation_native(cand_yaml, 4).unwrap();
        let a_json = &a["results"].to_string();
        let b_json = &b["results"].to_string();
        // 未知指标 → 参数错误 + 可选清单
        let e = ab_compare_native(YAML, YAML, "winrate", a_json, a_json).unwrap_err();
        assert!(e.starts_with("参数错误") && e.contains("win_rate"), "{e}");
        // 种子错位 → CRN 成对前提破坏,配置错误
        let e = ab_compare_native(YAML, cand_yaml, "win_rate", a_json, b_json).unwrap_err();
        assert!(
            e.starts_with("配置错误") && e.contains("base_seed 不一致"),
            "{e}"
        );
        // results JSON 解析失败 → 参数错误
        let e = ab_compare_native(YAML, YAML, "win_rate", "[{\"win_rate\":", a_json).unwrap_err();
        assert!(
            e.starts_with("参数错误") && e.contains("base 臂结果解析失败"),
            "{e}"
        );
        // 指标在某臂不可用(3d 配置没有 retention_d7)→ 配置错误,不静默跳过
        let e = ab_compare_native(YAML, YAML, "retention_d7", a_json, a_json).unwrap_err();
        assert!(e.starts_with("配置错误") && e.contains("不可用"), "{e}");
        // replicate 不等长 → 配置错误
        let two = run_simulation_native(YAML, 2).unwrap();
        let e = ab_compare_native(YAML, YAML, "win_rate", a_json, &two["results"].to_string())
            .unwrap_err();
        assert!(e.contains("replicate 数不一致或为 0"), "{e}");
    }

    #[test]
    fn param_values_reads_effective_not_registry_default() {
        let yaml = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 99}\n",
            "model:\n  warrior: {attack: 250}\n",
        );
        let vals = param_values_native(yaml).unwrap();
        assert_eq!(
            vals["scenario.seed"].as_f64(),
            Some(99.0),
            "当前生效值,不是注册表 default"
        );
        assert_eq!(vals["model.warrior.attack"].as_f64(), Some(250.0));
        // 未配置 loot → 内核真实生效缺省 1.0(read_numeric unwrap_or)
        assert_eq!(vals["model.loot.rate_mult"].as_f64(), Some(1.0));
        // 非数值槽缺键 ≠ 0
        assert!(vals.get("scenario.duration").is_none());
        assert!(vals.get("model.loot.tables").is_none());
        assert!(vals.get("model.formulas.xp_needed").is_none());
        // 数值注册路径全覆盖:66 − 7 非数值 = 59
        assert_eq!(vals.as_object().unwrap().len(), 59);
        // 非法配置报配置错误(与 validate_config 同前缀)
        let err =
            param_values_native("schema_version: '1'\nscenario: {population: -5}\n").unwrap_err();
        assert!(err.starts_with("配置错误"), "{err}");
    }

    #[test]
    fn u64_beyond_safe_integer_is_lossless_or_rejected() {
        // 读:超出 2^53−1 的 seed 以十进制字符串无损表达,不经 f64 舍入
        let big = 9_007_199_254_740_993u64; // 2^53 + 1
        let yaml = format!(
            "schema_version: '1'\nscenario: {{population: 40, duration: '3d', seed: {big}}}\n"
        );
        let vals = param_values_native(&yaml).unwrap();
        assert_eq!(
            vals["scenario.seed"],
            json!(big.to_string()),
            "越界 u64 读 = 字符串无损表达"
        );
        // 读:安全范围内的 seed 仍是数字
        let small = param_values_native(YAML).unwrap();
        assert_eq!(small["scenario.seed"], json!(7), "范围内 u64 读 = 数字");
        // 写:越界值明确拒绝,不静默舍入
        let e = param_apply_native(YAML, "scenario.seed", big as f64).unwrap_err();
        assert!(e.contains("2^53−1") && e.contains("不静默舍入"), "{e}");
        // 写:pity_hard 同门(未配置 gacha 时 get_or_insert 后仍要先过安全整数门)
        let e2 =
            param_apply_native(YAML, "model.gacha.pity_hard", 9_100_000_000_000_000.0).unwrap_err();
        assert!(e2.contains("2^53−1"), "{e2}");
    }

    #[test]
    fn kpi_availability_comes_from_kernel_rules() {
        // 3 天 + 无 gacha/loot:d3(需 ≥3 之内可用?days=3 满足 d3)——
        // d7 与 gacha、loot 三项不可用,reason 是内核原文
        let yaml = "schema_version: '1'\nscenario: {population: 40, duration: '3d', seed: 7}\n";
        let out = kpi_availability_native(yaml).unwrap();
        let items = out.as_array().unwrap();
        assert_eq!(items.len(), 3, "d7/gacha/loot 三项不可用");
        for it in items {
            assert!(
                it["reason"].as_str().unwrap().starts_with("retention_d7")
                    || it["reason"]
                        .as_str()
                        .unwrap()
                        .starts_with("gacha_pulls_to_hit")
                    || it["reason"]
                        .as_str()
                        .unwrap()
                        .starts_with("loot_gold_per_player"),
                "reason 带内核 ID 前缀: {}",
                it["reason"]
            );
        }
        // 7 天 + gacha + loot 齐备 → 空数组 = 全部可用
        let full = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '7d', seed: 7}\n",
            "model:\n",
            "  gacha: {base_rate: 0.05}\n",
            "  loot:\n",
            "    on_victory: chest\n",
            "    tables:\n",
            "      chest:\n",
            "        weights: { gold_small: 100 }\n",
            "    rewards:\n",
            "      gold_small: { gold: 5, xp: 0 }\n",
        );
        assert!(kpi_availability_native(full)
            .unwrap()
            .as_array()
            .unwrap()
            .is_empty());
    }

    #[test]
    fn kpi_validate_and_eval_bridge_shape_and_red_lines() {
        // 校验只编译:回传白名单全集 + 表达式实际引用的变量(声明序去重)
        let v = kpi_validate_native("max(win_rate, win_rate) * retention_d7").unwrap();
        assert_eq!(v["used_vars"], json!(["retention_d7", "win_rate"]));
        assert_eq!(
            v["vars"],
            json!(core::kpi_custom::kpi_var_names()),
            "白名单 = 内置指标名全集(与 CSV 列名同口径)"
        );
        // 校验失败走配置错误通道并点名具体变量;常量表达式没有运行口径
        let e = kpi_validate_native("win_rates * 2").unwrap_err();
        assert!(e.contains("配置错误") && e.contains("win_rates"), "{e}");
        assert!(
            kpi_validate_native("0.5")
                .unwrap_err()
                .contains("常量表达式"),
            "常量表达式必须拒绝"
        );

        // 求值:7 天配置上 d7 有值,同名表达式与内置指标逐值一致
        let week = "schema_version: '1'\nscenario: {population: 40, duration: '7d', seed: 7}\n";
        let sim = run_simulation_native(week, 3).unwrap();
        let out = kpi_eval_native("retention_d7", &sim["results"].to_string()).unwrap();
        let got: Vec<Option<f64>> = serde_json::from_value(out["per_replicate"].clone()).unwrap();
        let want: Vec<Option<f64>> = sim["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                let m: core::metrics::RunMetrics = serde_json::from_value(r.clone()).unwrap();
                core::experiment::MetricKey::RetentionD7.extract(&m)
            })
            .collect();
        assert_eq!(got, want, "同名表达式必须与内置指标逐值一致");
        assert_eq!(out["n_used"], 3);
        assert_eq!(out["stats"]["n"], 3);
        assert!(
            out["stats"]["ci95_lo"].as_f64().unwrap() <= out["stats"]["mean"].as_f64().unwrap(),
            "聚合走 n−1 口径,区间包住均值"
        );
        assert_eq!(out["schema_version"], core::kpi_custom::KPI_SCHEMA_VERSION);
        assert_eq!(out["sd_method"], core::experiment::DAILY_SD_METHOD);

        // 红线一:单次运行不得套统计区间
        let single = serde_json::to_string(&[sim["results"][0].clone()]).unwrap();
        let one = kpi_eval_native("retention_d7", &single).unwrap();
        assert_eq!(one["n_used"], 1);
        assert!(one["stats"].is_null(), "n < 2 不给置信带");
        assert!(
            one.as_object().unwrap().get("stats").is_none(),
            "整组统计缺席时不输出该键(缺席 ≠ 0)"
        );
        assert_eq!(one["per_replicate"][0].as_f64(), got[0]);

        // 红线二:指标缺席记 None,不填 0(3 天配置下 d7 未定义)
        let short = run_simulation_native(YAML, 2).unwrap();
        let s2 = kpi_eval_native("retention_d7", &short["results"].to_string()).unwrap();
        assert_eq!(s2["n_used"], 0);
        assert!(s2["stats"].is_null());
        assert!(s2.as_object().unwrap().get("stats").is_none());
        assert!(s2["per_replicate"][0].is_null());
    }

    #[test]
    fn metric_dictionary_native_shape_and_thresholds() {
        let v = metric_dictionary_native().unwrap();
        assert_eq!(v["dict_version"], core::kpi_dict::METRIC_DICT_VERSION);
        let metrics = v["metrics"].as_array().unwrap();
        assert_eq!(metrics.len(), core::experiment::MetricKey::ALL.len());
        let ids: Vec<&str> = metrics.iter().map(|m| m["id"].as_str().unwrap()).collect();
        let want: Vec<&str> = core::experiment::MetricKey::ALL
            .iter()
            .map(|k| k.name())
            .collect();
        assert_eq!(
            ids, want,
            "字典顺序 = MetricKey::ALL 声明序(与 CSV 列序同序)"
        );
        let get = |id: &str| metrics.iter().find(|m| m["id"] == id).unwrap();
        // 可用性门槛与内核 unavailable_reason 的分支逐条对应
        assert_eq!(get("retention_d7")["days_required"], 7);
        assert_eq!(get("retention_d3")["days_required"], 3);
        assert_eq!(get("win_rate")["days_required"], 0);
        assert_eq!(get("gacha_pulls_to_hit")["requires_gacha"], true);
        assert_eq!(get("loot_gold_per_player")["requires_loot"], true);
        // 量纲与可空口径(显示层换算的唯一依据)
        assert_eq!(get("win_rate")["kind"].as_str(), Some("ratio"));
        assert_eq!(get("churn_rate")["kind"].as_str(), Some("ratio"));
        assert_eq!(get("gold_per_player")["kind"].as_str(), Some("value"));
        assert_eq!(get("gacha_pulls_to_hit")["kind"].as_str(), Some("value"));
        assert_eq!(get("retention_d7")["optional"], true);
        assert_eq!(get("power_p50")["optional"], false);
        assert_eq!(get("win_rate")["decimals"], 1);
    }

    #[test]
    fn run_matches_core_values() {
        let cfg = core::scenario::load_str(YAML).unwrap();
        let v = run_simulation_native(YAML, 2).unwrap();
        let want: Vec<serde_json::Value> = (0..2u32)
            .map(|r| serde_json::to_value(core::sim::run(&cfg, r)).unwrap())
            .collect();
        assert_eq!(
            v["results"],
            serde_json::Value::Array(want),
            "results 与 core::sim::run 直序列化逐值一致"
        );
        assert_eq!(v["results"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn run_days_csv_byte_identical() {
        let cfg = core::scenario::load_str(YAML).unwrap();
        let v = run_simulation_native(YAML, 2).unwrap();
        let want = core::export::day_csv(&core::sim::run(&cfg, 0));
        assert_eq!(
            v["days_csv"].as_str().unwrap(),
            want,
            "与 CLI simulate --out 写盘的 days.csv 同源同字节"
        );
        assert!(want.starts_with("day,active,"), "首列天索引(文档 09 契约)");
    }

    #[test]
    fn run_rejects_param_bounds() {
        assert!(run_simulation_native(YAML, 0).is_err());
        let e = run_simulation_native(YAML, MAX_REPLICATES + 1).unwrap_err();
        assert!(e.contains("上限"), "{e}");
    }

    // —— 参数扫描(文档 12/14/15 章)——
    // 单轴 attack 网格 90..=110 步 10(3 候选),win_rate 硬约束恒可行 [0,1]。
    const EXP_YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
        "sweep:\n",
        "  replicates: 2\n",
        "  parameters:\n",
        "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
        "  targets:\n",
        "    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
    );

    #[test]
    fn sweep_plan_candidates_and_replicates() {
        let v = sweep_plan_native(EXP_YAML, 0).unwrap();
        assert_eq!(v["candidates"].as_array().unwrap().len(), 3);
        assert_eq!(v["sims"], 6);
        assert_eq!(v["replicates"], 2);
        assert_eq!(v["axes"][0]["path"], "model.warrior.attack");
        assert_eq!(v["candidates"][0]["model.warrior.attack"], 90.0);
        assert_eq!(v["targets"][0]["metric"], "win_rate");

        // ST-AUD-01:R=1 单点无法给置信区间,覆盖到 1 必须拒绝(全入口 R≥2)。
        let e = sweep_plan_native(EXP_YAML, 1).unwrap_err();
        assert!(e.contains("replicates 必须 ≥ 2"), "{e}");

        let e = sweep_plan_native(
            "schema_version: '1'\nscenario: {population: 40, duration: '3d', seed: 7}\n",
            0,
        )
        .unwrap_err();
        assert!(e.contains("sweep 节"), "{e}");
    }

    #[test]
    fn sweep_plan_budget_rejected() {
        let big = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "sweep:\n",
            "  replicates: 64\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 90, max: 110, step: 1}\n",
        );
        let e = sweep_plan_native(big, 0).unwrap_err();
        assert!(e.contains("预算"), "{e}");
    }

    // Random 模式(文档 12 章):采样数 = samples,采样流与 base_seed 绑定,
    // 同配置同采样(sweep_plan 输出可复现)。
    const EXP_YAML_RANDOM: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 40, duration: '3d', seed: 7}\n",
        "sweep:\n",
        "  mode: random\n",
        "  samples: 5\n",
        "  replicates: 2\n",
        "  parameters:\n",
        "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
        "  targets:\n",
        "    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
    );

    #[test]
    fn sweep_plan_random_count_reproducible() {
        let v = sweep_plan_native(EXP_YAML_RANDOM, 0).unwrap();
        assert_eq!(v["mode"], "random");
        let cands = v["candidates"].as_array().unwrap();
        assert_eq!(cands.len(), 5, "samples 决定候选数");
        for c in cands {
            let x = c["model.warrior.attack"].as_f64().unwrap();
            assert!((90.0..=110.0).contains(&x), "采样落在 [min, max]:{x}");
        }
        assert_eq!(v["sims"], 10);
        // 同配置同采样:两次 plan 候选逐值一致
        let v2 = sweep_plan_native(EXP_YAML_RANDOM, 0).unwrap();
        assert_eq!(v["candidates"], v2["candidates"]);
        // samples 缺省(grid YAML 无 samples 键)走 grid 分支不受影响
        let g = sweep_plan_native(EXP_YAML, 0).unwrap();
        assert_eq!(g["mode"], "grid");
    }

    // 双轴网格:笛卡尔积 = 3×3 = 9 候选(Web 联合可行域矩阵的数据源,
    // docs 22 后续项)。
    #[test]
    fn sweep_plan_two_axis_cartesian() {
        let yaml2 = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "sweep:\n",
            "  replicates: 4\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 100, max: 260, step: 80}\n",
            "    model.combat.p_hit: {min: 0.9, max: 1.0, step: 0.05}\n",
            "  targets:\n",
            "    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
        );
        let v = sweep_plan_native(yaml2, 0).unwrap();
        assert_eq!(v["axes"].as_array().unwrap().len(), 2);
        let cands = v["candidates"].as_array().unwrap();
        assert_eq!(cands.len(), 9, "3 × 3 笛卡尔积");
        assert_eq!(v["sims"], 36);
        // 两轴键都在每个候选里,取值集合恰为格点
        let mut attacks: Vec<f64> = cands
            .iter()
            .map(|c| c["model.warrior.attack"].as_f64().unwrap())
            .collect();
        attacks.sort_by(|a, b| a.partial_cmp(b).unwrap());
        attacks.dedup();
        assert_eq!(attacks, vec![100.0, 180.0, 260.0]);
        let mut hits: Vec<f64> = cands
            .iter()
            .map(|c| c["model.combat.p_hit"].as_f64().unwrap())
            .collect();
        hits.sort_by(|a, b| a.partial_cmp(b).unwrap());
        hits.dedup();
        // min + k·step 有固有浮点漂移(0.9 + 0.05),近似比较
        assert_eq!(hits.len(), 3);
        for (got, want) in hits.iter().zip([0.9, 0.95, 1.0]) {
            assert!((got - want).abs() < 1e-9, "{got} vs {want}");
        }
    }

    // Latin Hypercube(文档 12 章):serde 名 latin_hypercube,采样数 =
    // samples,与 Random 同走 wasm 透传(plan 纯转发不改写候选)。
    #[test]
    fn sweep_plan_lhs_passthrough() {
        let yaml = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 40, duration: '3d', seed: 7}\n",
            "sweep:\n",
            "  mode: latin_hypercube\n",
            "  samples: 6\n",
            "  replicates: 2\n",
            "  parameters:\n",
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
            "  targets:\n",
            "    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
        );
        let v = sweep_plan_native(yaml, 0).unwrap();
        assert_eq!(v["mode"], "latin_hypercube");
        let cands = v["candidates"].as_array().unwrap();
        assert_eq!(cands.len(), 6, "候选数 = samples");
        assert_eq!(v["sims"], 12);
        for c in cands {
            let x = c["model.warrior.attack"].as_f64().unwrap();
            assert!((90.0..=110.0).contains(&x), "采样落在 [min, max]:{x}");
        }
        // 同配置同采样可复现
        let v2 = sweep_plan_native(yaml, 0).unwrap();
        assert_eq!(v["candidates"], v2["candidates"]);
    }

    #[test]
    fn sweep_candidate_matches_core() {
        let values = r#"{"model.warrior.attack": 100.0}"#;
        let v = sweep_candidate_native(EXP_YAML, 2, values).unwrap();
        let (cfg, spec) = core::scenario::load_experiment_str(EXP_YAML).unwrap();
        let want = core::sweep::run_candidate(
            &cfg,
            &spec,
            &std::collections::BTreeMap::from([("model.warrior.attack".into(), 100.0)]),
        );
        assert_eq!(v, serde_json::to_value(want).unwrap(), "与 core 直跑一致");
        assert!(v["status"] == "ok");
        // 3 天窗口提不出 d14/d30 → 指标少于 ALL,列出的都必须 n = replicates
        let stats = v["metric_stats"].as_array().unwrap();
        assert!(stats.len() < core::experiment::MetricKey::ALL.len());
        assert!(stats.iter().all(|s| s[1]["n"] == 2));

        // 配置错误候选照常上报,不静默丢弃(文档 12 章)
        let bad = sweep_candidate_native(EXP_YAML, 2, r#"{"no.such.path": 1.0}"#).unwrap();
        assert!(bad["status"]["config_error"].as_str().is_some());

        assert!(sweep_candidate_native(EXP_YAML, 0, values).is_err());
        assert!(sweep_candidate_native(EXP_YAML, MAX_REPLICATES + 1, values).is_err());
    }

    #[test]
    fn sweep_recommend_sensitivity_and_interval() {
        let mut results = Vec::new();
        let (cfg, spec) = core::scenario::load_experiment_str(EXP_YAML).unwrap();
        for values in spec.plan(cfg.base_seed).unwrap() {
            results.push(core::sweep::run_candidate(&cfg, &spec, &values));
        }
        let results_json = serde_json::to_string(&results).unwrap();
        let v = sweep_recommend_native(EXP_YAML, &results_json).unwrap();
        let rec = &v["recommendation"];
        assert_eq!(rec["param"], "model.warrior.attack");
        assert_eq!(rec["baseline"], 100.0, "默认 attack 基线");
        // R=2 + 3 天 toy 配置 CI 宽 → 全部格点 BORDERLINE,无可推荐区间
        // (ST-AUD-01:退化/宽 CI 不再冒充 PASS)。区间可为 null,但必须给出原因。
        if rec["interval"].is_array() {
            assert!(rec["interval"].as_array().unwrap().len() == 2, "{rec}");
        } else {
            assert!(rec["interval"].is_null(), "{rec}");
        }
        assert!(rec["confidence"].is_string());
        assert!(!rec["reasons"].as_array().unwrap().is_empty());
        assert_eq!(
            v["elasticities"].as_array().unwrap().len(),
            core::experiment::MetricKey::ALL.len()
        );

        // MVP 红线:推荐仅单参数轴(与 CLI recommend 同源拒绝)
        let two_axis = EXP_YAML.replace(
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n",
            "    model.warrior.attack: {min: 90, max: 110, step: 10}\n    model.warrior.defense: {min: 60, max: 80, step: 10}\n",
        );
        let e = sweep_recommend_native(&two_axis, &results_json).unwrap_err();
        assert!(e.contains("单参数轴"), "{e}");
    }

    // —— 进化寻优 + 代理(文档 12 章自动寻优增量)——
    // 微型预算:population 4 × (generations 2 + 1) × replicates 1 ≤ 200。
    const OPT_YAML: &str = concat!(
        "schema_version: '1'\n",
        "scenario: {population: 20, duration: '3d', seed: 42}\n",
        "optimize:\n",
        "  mode: evolutionary\n",
        "  population: 4\n",
        "  generations: 2\n",
        "  elite: 1\n",
        "  mutation_rate: 0.3\n",
        "  mutation_scale: 0.2\n",
        "  replicates: 2\n",
        "  parameters:\n",
        "    model.warrior.attack: {min: 20, max: 200}\n",
        "  targets:\n",
        "    - {metric: churn_rate, min: 0.0, max: 1.0, kind: hard}\n",
        "  objective:\n",
        "    metric: win_rate\n",
        "    direction: maximize\n",
    );

    #[test]
    fn optimize_evolutionary_shape_and_budget() {
        let v = optimize_native(OPT_YAML).unwrap();
        assert_eq!(v["spec"]["mode"], "evolutionary");
        // 评估账:population + generations × (population − elite) = 4 + 2×3 = 10
        // 候选;total_sims = evaluated × replicates(2)= 20。
        assert_eq!(v["evaluated"], 10);
        assert_eq!(v["total_sims"], 20);
        assert_eq!(v["all"].as_array().unwrap().len(), 10);
        // 逐代统计:初始种群 + 每代一条(共 generations + 1 = 3)
        assert_eq!(v["history"].as_array().unwrap().len(), 3);
        assert!(v["best"]["values"].is_object());
        assert!(v["best_fitness"]["hard_pass"].is_u64());
        // evolutionary 模式不产出前沿(front0 恒空),与 pareto 模式互斥
        assert!(v["front0"].as_array().unwrap().is_empty());

        // 预算超限拒绝:种群 × (代数+1) × replicates 远超 Web 预算
        let big = OPT_YAML.replace(
            "  population: 4\n  generations: 2\n",
            "  population: 200\n  generations: 10\n",
        );
        let e = optimize_native(&big).unwrap_err();
        assert!(e.contains("Web 预算"), "{e}");

        // 与扫描互斥:两种实验形态不能同文件
        let dual = concat!(
            "schema_version: '1'\n",
            "scenario: {population: 20, duration: '3d', seed: 42}\n",
            "sweep:\n  replicates: 2\n  parameters:\n    model.warrior.attack: {min: 90, max: 110, step: 10}\n  targets:\n    - {metric: win_rate, min: 0.0, max: 1.0, kind: hard}\n",
            "optimize:\n  mode: evolutionary\n  population: 4\n  generations: 2\n  replicates: 2\n",
        );
        assert!(
            optimize_native(dual).is_err(),
            "sweep 与 optimize 同文件必须拒绝"
        );

        // 扫描实验文件传给寻优:内核按互斥规则如实拒绝(不静默当寻优跑)
        let e = optimize_native(EXP_YAML).unwrap_err();
        assert!(e.contains("不能同时含"), "{e}");
        // 纯场景文件(无 sweep 也无 optimize 节):点名缺 optimize 节
        let e = optimize_native(YAML).unwrap_err();
        assert!(e.contains("缺少 optimize 节"), "{e}");
    }

    #[test]
    fn optimize_pareto_front_distinct_from_best() {
        let yaml = OPT_YAML.replace("mode: evolutionary", "mode: pareto");
        let yaml = yaml.replace(
            "  objective:\n    metric: win_rate\n    direction: maximize\n",
            "  objectives:\n    - {metric: win_rate, direction: maximize}\n    - {metric: gold_per_player, direction: minimize}\n",
        );
        let v = optimize_native(&yaml).unwrap();
        assert_eq!(v["spec"]["mode"], "pareto");
        let front = v["front0"].as_array().unwrap();
        assert!(!front.is_empty(), "pareto 模式前沿 0 非空");
        // 前沿成员必须同时产出两个目标(否则不进比较)
        for point in front {
            let stats = point["metric_stats"].as_array().unwrap();
            let names: Vec<&str> = stats.iter().map(|s| s[0].as_str().unwrap()).collect();
            assert!(
                names.contains(&"win_rate") && names.contains(&"gold_per_player"),
                "{names:?}"
            );
        }
        // best = 前沿 0 中拥挤距离最大者(代表点),必须落在前沿内
        assert!(v["best"].is_object());
    }

    #[test]
    fn surrogate_train_and_predict_report_tree_disagreement_not_ci() {
        // 训练集 = 扫描真跑产物(代理只读 sweep 产物,零额外仿真)
        let (cfg, spec) = core::scenario::load_experiment_str(EXP_YAML).unwrap();
        let results: Vec<_> = spec
            .plan(cfg.base_seed)
            .unwrap()
            .iter()
            .map(|values| core::sweep::run_candidate(&cfg, &spec, values))
            .collect();
        let results_json = serde_json::to_string(&results).unwrap();

        let v = surrogate_train_native(&results_json, "win_rate", 20, 6, 2, 7).unwrap();
        assert_eq!(v["metric"], "win_rate");
        assert_eq!(v["features"][0], "model.warrior.attack");
        assert_eq!(v["trained"], 3, "3 个可行候选全入训练");
        assert_eq!(v["excluded"], 0);
        assert!(v["importance"].as_array().unwrap().len() == 1);
        assert!(v["spec"]["trees"] == 20 && v["spec"]["seed"] == 7);
        assert!(v["model"]["forest"].as_array().unwrap().len() == 20);

        let model_json = serde_json::to_string(&v["model"]).unwrap();
        let p =
            surrogate_predict_native(&model_json, r#"{"model.warrior.attack": 100.0}"#).unwrap();
        let mean = p["mean"].as_f64().unwrap();
        let lo = p["spread_min"].as_f64().unwrap();
        let hi = p["spread_max"].as_f64().unwrap();
        assert!(
            lo <= mean && mean <= hi,
            "树间分歧包络必须包住均值:{lo} {mean} {hi}"
        );
        assert_eq!(p["trees"], 20);
        assert_eq!(p["metric"], "win_rate");
        // 红线:代理预测输出不得携带置信区间语义字段(下游会据此画置信带)
        let text = serde_json::to_string(&p).unwrap();
        for bad in ["\"ci", "ci95", "confidence", "interval", "band"] {
            assert!(!text.contains(bad), "树间分歧不得标成置信区间:{text}");
        }

        // 缺特征:内核报错,不静默补 0
        let e = surrogate_predict_native(&model_json, "{}").unwrap_err();
        assert!(e.contains("缺少特征"), "{e}");
        // 未知指标 / 超参非法 / 空训练集:配置与参数错误通道如实回传
        assert!(
            surrogate_train_native(&results_json, "not_a_metric", 20, 6, 2, 7)
                .unwrap_err()
                .contains("未知指标")
        );
        assert!(surrogate_train_native(&results_json, "win_rate", 0, 6, 2, 7).is_err());
        let empty = serde_json::to_string(&Vec::<core::sweep::CandidateResult>::new()).unwrap();
        assert!(surrogate_train_native(&empty, "win_rate", 20, 6, 2, 7).is_err());

        // 配置错误候选不入训练,排除账如实回传
        let with_bad = {
            let mut rows = results.clone();
            rows.push(core::sweep::CandidateResult {
                values: std::collections::BTreeMap::from([("model.warrior.attack".into(), 1.0)]),
                status: core::sweep::CandidateStatus::ConfigError("测试配置错误".into()),
                metric_stats: Vec::new(),
                target_outcomes: Vec::new(),
            });
            serde_json::to_string(&rows).unwrap()
        };
        let v2 = surrogate_train_native(&with_bad, "win_rate", 20, 6, 2, 7).unwrap();
        assert_eq!(v2["trained"], 3);
        assert_eq!(v2["excluded"], 1, "配置错误候选被内核过滤并计入排除账");
    }

    // —— 逐日跨 replicate 聚合(native 桥,P2 内核导出面)——

    /// 双错误通道:results JSON 解析失败走参数错误;replicates < 2 走配置
    /// 错误(单次运行不得套置信带,内核原文透传)。
    #[test]
    fn daily_aggregate_rejects_bad_json_and_single_replicate() {
        let e = daily_aggregate_native("not-json").unwrap_err();
        assert!(
            e.starts_with("参数错误") && e.contains("逐日聚合结果解析失败"),
            "{e}"
        );
        let one = run_simulation_native(YAML, 1).unwrap();
        let e = daily_aggregate_native(&one["results"].to_string()).unwrap_err();
        assert!(
            e.starts_with("配置错误") && e.contains("至少需要 2 份"),
            "{e}"
        );
    }

    /// 桥输出与内核直出逐值一致(纯转发纪律,与 run_matches_core_values 同源);
    /// 形状红线:第 1 天 inflation 整键缺席(缺席 ≠ 0),n = replicates。
    #[test]
    fn daily_aggregate_matches_core_and_day0_has_no_inflation() {
        let sim = run_simulation_native(YAML, 3).unwrap();
        let results_json = sim["results"].to_string();
        let parsed: Vec<core::metrics::RunMetrics> = serde_json::from_str(&results_json).unwrap();
        let want =
            serde_json::to_value(core::experiment::daily_aggregate_metrics(&parsed).unwrap())
                .unwrap();
        let got = daily_aggregate_native(&results_json).unwrap();
        assert_eq!(got, want, "桥输出与内核直出逐值一致");
        let first = &got["day_stats"][0];
        assert_eq!(first["day"], 1, "day 索引 1 基");
        assert_eq!(first["active"]["n"], 3);
        assert!(
            first.as_object().unwrap().get("inflation").is_none(),
            "第 1 天 inflation 必须整键缺席:{first}"
        );
        assert!(
            got["trim_warning"].as_str().unwrap().is_empty(),
            "等长日集无裁剪警告"
        );
    }

    /// 日集取交:某 replicate 缺尾日 → 公共天数裁剪,交外天数如实入
    /// trimmed_days + trim_warning,不静默补齐(内核契约的桥面透传)。
    #[test]
    fn daily_aggregate_trims_to_common_days_with_warning() {
        let sim = run_simulation_native(YAML, 3).unwrap();
        let mut rows = sim["results"].as_array().unwrap().clone();
        rows[0]["day_stats"].as_array_mut().unwrap().pop();
        let out = daily_aggregate_native(&serde_json::Value::Array(rows).to_string()).unwrap();
        let days: Vec<u64> = out["day_stats"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["day"].as_u64().unwrap())
            .collect();
        assert_eq!(days, vec![1, 2], "公共天数取交");
        assert_eq!(
            out["trimmed_days"],
            serde_json::json!([3]),
            "交外天数如实列出"
        );
        let warn = out["trim_warning"].as_str().unwrap();
        assert!(warn.contains("取交") && warn.contains("3"), "{warn}");
    }

    // —— KPI 域守卫分支(native 错误通道)——

    /// 可用性入口的 load 臂:YAML 非法走配置错误通道,与 validate_config
    /// 同前缀(前端 classifyWasmError 依赖此通道约定)。
    #[test]
    fn kpi_availability_load_error_uses_config_channel() {
        let e = kpi_availability_native("schema_version: '1'\nscenario: {population: -5}\n")
            .unwrap_err();
        assert!(e.starts_with("配置错误"), "{e}");
    }

    /// 求值入口的解析臂:results JSON 非法走参数错误通道,点名逐 replicate
    /// 解析失败(与 kpi_eval 的 JsValue 包装共享同一 native 体)。
    #[test]
    fn kpi_eval_rejects_bad_results_json_as_param_error() {
        let e = kpi_eval_native("win_rate", "not-json").unwrap_err();
        assert!(
            e.starts_with("参数错误") && e.contains("逐 replicate 结果解析失败"),
            "{e}"
        );
    }

    /// 求值入口的编译臂:未知变量在内核 compile_checked 处拒绝,走配置错误
    /// 通道并点名变量(求值前编译,不静默把未知名当 0)。
    #[test]
    fn kpi_eval_rejects_unknown_variable_as_config_error() {
        let sim = run_simulation_native(YAML, 2).unwrap();
        let e = kpi_eval_native("win_rates * 2", &sim["results"].to_string()).unwrap_err();
        assert!(e.starts_with("配置错误") && e.contains("win_rates"), "{e}");
    }
}
